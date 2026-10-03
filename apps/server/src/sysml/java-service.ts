import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { REPO_ROOT } from "../config.js";
import { SysmlBusyError, SysmlTimeoutError, SysmlUnavailableError, type SysmlResult, type SysmlService } from "./types.js";

interface Pending {
  id: number;
  resolve: (r: SysmlResult) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export interface JavaServiceOptions {
  /** 起動コマンド(既定: tools/sysml-check/serve.sh) */
  command?: string;
  args?: string[];
  /** 起動(取得・コンパイル・ライブラリ読み込み)の待ち時間 [ms] */
  startTimeoutMs?: number;
  /** 1 リクエストの待ち時間 [ms] */
  requestTimeoutMs?: number;
  /** 実行中を含めて、受け付ける解析の数(超えると SysmlBusyError)。既定 8 */
  maxQueue?: number;
  log?: (msg: string) => void;
  /** 子プロセスに足す環境変数(例: SYSML_PILOT_CACHE=公式実装の保存先) */
  env?: Record<string, string>;
}

/**
 * 公式パイロット実装を常駐させた Java プロセスと JSON Lines で通信する。
 *  - リクエストは直列化(プロセスは 1 つ)。
 *  - タイムアウトまたは異常終了したらプロセスを捨て、次のリクエストで再起動する。
 *  - 起動に失敗したら SysmlUnavailableError。
 */
export class JavaSysmlService implements SysmlService {
  readonly mode = "java" as const;
  private proc: ChildProcessWithoutNullStreams | undefined;
  private ready: Promise<void> | undefined;
  private pending: Pending | undefined;
  private chain: Promise<unknown> = Promise.resolve();
  private nextId = 1;
  private closed = false;
  private inFlight = 0;
  private readonly opts: Required<JavaServiceOptions>;

  constructor(opts: JavaServiceOptions = {}) {
    this.opts = {
      command: opts.command ?? resolve(REPO_ROOT, "tools/sysml-check/serve.sh"),
      args: opts.args ?? [],
      startTimeoutMs: opts.startTimeoutMs ?? 180_000,
      requestTimeoutMs: opts.requestTimeoutMs ?? 60_000,
      maxQueue: opts.maxQueue ?? 8,
      log: opts.log ?? (() => {}),
      env: opts.env ?? {},
    };
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolveReady, rejectReady) => {
      const proc = spawn(this.opts.command, this.opts.args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...this.opts.env } });
      this.proc = proc;
      let isReady = false;
      const startTimer = setTimeout(() => {
        rejectReady(new SysmlUnavailableError("SysML サービスの起動がタイムアウトしました"));
        this.kill();
      }, this.opts.startTimeoutMs);
      proc.stderr.on("data", (d: Buffer) => this.opts.log(d.toString("utf8").trimEnd()));
      // 捨てた(kill 済みの)プロセスのイベントは、新しいプロセスの状態に触れさせない
      const stale = () => this.proc !== proc;
      proc.on("error", (e) => {
        clearTimeout(startTimer);
        if (stale()) return;
        rejectReady(new SysmlUnavailableError(`SysML サービスを起動できません: ${e.message}`));
        this.reset();
      });
      proc.on("exit", (code) => {
        clearTimeout(startTimer);
        if (stale()) return;
        if (!isReady) rejectReady(new SysmlUnavailableError(`SysML サービスが起動前に終了しました(終了コード ${code})`));
        this.failPending(new Error(`SysML サービスが終了しました(終了コード ${code})`));
        this.reset();
      });
      // 停止済みの子プロセスへの書き込み(EPIPE)で、サーバー全体が落ちないようにする
      proc.stdin.on("error", (e) => {
        if (stale()) return;
        this.opts.log(`SysML サービスの標準入力でエラー: ${e.message}`);
        this.failPending(new SysmlUnavailableError(`SysML サービスとの通信に失敗しました: ${e.message}`));
      });
      proc.stdout.on("error", () => undefined);
      const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });
      rl.on("line", (line) => {
        if (stale()) return;
        let msg: { ready?: boolean; id?: number } & Partial<SysmlResult>;
        try {
          msg = JSON.parse(line);
        } catch {
          this.opts.log(`SysML サービスの不正な出力: ${line.slice(0, 200)}`);
          return;
        }
        if (msg.ready) {
          isReady = true;
          clearTimeout(startTimer);
          resolveReady();
          return;
        }
        const p = this.pending;
        if (p && msg.id === p.id) {
          clearTimeout(p.timer);
          this.pending = undefined;
          p.resolve({
            ok: msg.ok === true,
            diagnostics: msg.diagnostics ?? [],
            ...(msg.graph ? { graph: msg.graph } : {}),
            ...(msg.exception ? { exception: msg.exception } : {}),
          });
        }
      });
    });
    // 起動失敗時は次のリクエストで再試行できるようにする
    this.ready.catch(() => this.reset());
    return this.ready;
  }

  private kill() {
    const p = this.proc;
    this.proc = undefined; // 先に切り離してから殺す(exit イベントが新しい状態を消さないように)
    p?.kill("SIGKILL");
    // 終了イベントを待たずに捨てる(次のリクエストが、死にかけのプロセスへ書き込まないように)
    this.reset();
  }
  private reset() {
    this.proc = undefined;
    this.ready = undefined;
  }
  private failPending(e: Error) {
    const p = this.pending;
    if (p) {
      clearTimeout(p.timer);
      this.pending = undefined;
      p.reject(e);
    }
  }

  analyze(text: string): Promise<SysmlResult> {
    const run = async (): Promise<SysmlResult> => {
      if (this.closed) throw new SysmlUnavailableError("SysML サービスは停止しています");
      await this.start();
      const proc = this.proc;
      if (!proc) throw new SysmlUnavailableError("SysML サービスが利用できません");
      const id = this.nextId++;
      return new Promise<SysmlResult>((resolveReq, rejectReq) => {
        const timer = setTimeout(() => {
          this.pending = undefined;
          rejectReq(new SysmlTimeoutError("SysML の解析がタイムアウトしました。モデルが大きすぎる可能性があります"));
          this.kill(); // 状態が不明なので捨てる。次のリクエストで再起動
        }, this.opts.requestTimeoutMs);
        this.pending = { id, resolve: resolveReq, reject: rejectReq, timer };
        proc.stdin.write(JSON.stringify({ id, text }) + "\n", (err) => {
          if (err) {
            clearTimeout(timer);
            this.pending = undefined;
            rejectReq(err);
          }
        });
      });
    };
    if (this.inFlight >= this.opts.maxQueue) return Promise.reject(new SysmlBusyError("SysML の解析待ちが多すぎます。しばらくしてからやり直してください"));
    this.inFlight++;
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined).finally(() => {
      this.inFlight--;
    });
    return result;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.kill();
    // 進行中の要求は、プロセスを切り離した後は exit イベントで拒否されないので、ここで拒否する（終了を長引かせない）
    this.failPending(new SysmlUnavailableError("SysML サービスを停止しました"));
  }
}
