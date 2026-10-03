# ラウンド 7 品質レビュー(A2 / B2 / B4 / B5 / B6 / B7 / B8、A1 は参考)

レビュー担当: 独立・厳格な品質レビュー担当(ISO/IEC 25010 の観点を使う模擬レビューであり、認証機関ではない)
対象: `/home/user/FuSaMod`(HEAD aeda725)/ 実施日: 2026-10-03
方針: `docs/quality/rubric.md` に従う(証拠主義、未検証は減点、外部確認待ち減点は別枠で最大 10)。`round-6-response.md` は信用せず、すべて再実行した。リポジトリのソースは変更していない(確認用のファイル・サーバーはスクラッチ領域のみ)。
確認用サーバーは **ビルド済みの `apps/server/dist/server.mjs`**(スクラッチ領域の `projects/` のコピーを `FUSAMOD_PROJECTS` に、ポート 8971〜8973、`FUSAMOD_TOKENS=alice:…,bob/viewer:…,carol:…`、すべて 16 文字以上)。終了は PID 指定の `kill` のみ。終了後、自分が起動した `server.mjs`・JVM の残りは 0。
後始末の不備(自分の): 最初のテスト実行で `$TMPDIR` が空のまま `> $TMPDIR/t1.log` と書いたため、ルート直下に空のログ `/t1.log` を作ってしまった(安全確認で削除を拒否されたため残っている。内容は vitest の出力のみ。**削除は利用者側で `rm /t1.log` をお願いします**)。リポジトリ内の変更は無し(`git status` は空)。

## 0. 採点サマリー

| 項目 | R6 採点 | R7 採点 | 外部確認待ち減点 | 合否点 | 採点 80 以上 | 判定(合否点 90 以上かつ採点 80 以上) |
|---|---|---|---|---|---|---|
| A2 画面・UX 要件 | 87 | **86** | 5 | 91 | 〇 | **合格(境界)** |
| B2 性能効率性 | 87 | **83** | 4 | 87 | 〇 | **不合格(87)** |
| B4 使用性 | 86 | **85** | 8 | 93 | 〇 | **合格** |
| B5 信頼性 | 87 | **80** | 3 | 83 | 〇(境界) | **不合格(83)** |
| B6 セキュリティ | 85 | **83** | 6 | 89 | 〇 | **不合格(89)** |
| B7 保守性 | 85 | **87** | 4 | 91 | 〇 | **合格** |
| B8 移植性 | 84 | **84** | 6 | 90 | 〇 | **合格(境界。Docker 未実行が前提)** |
| (参考)A1 機能要件 | 89 | **90** | 5 | 95 | 〇 | 参考(専門家レビューは別途) |

**総評**: 前回の致命的欠陥(解析タイムアウト後の次の要求で `EPIPE` によりサーバーが落ちる)は、**バンドル版・実 HTTP で直っていることを確認した**(巨大モデルで 5 回タイムアウトさせても `kill -0` で生存、JVM の外部 `kill -9` 後も次の解析が成功、`SIGTERM` で正常終了)。R6 の他の指摘(未知の出力名での監査の洪水、`safety.diff` の網羅、テストの密閉性、予約名、`TRUST_PROXY` の警告、README・viewer 文書、CI のキャッシュと煙試験)も、多くが実測で直っている。

ただし、**同じ経路(`apps/server/src/sysml/java-service.ts`)に、今回の再現試験で新しい重大な欠陥を見つけた**。タイムアウトした古い JVM の終了イベントが、**新しく起動した JVM の状態を消す**。結果として(a)JVM(常駐 370〜580 MB)がだれにも管理されず**漏れる**、(b)待っていた次の要求が `SysmlUnavailableError` になり、**サーバー全体が 60 秒間「Java が使えない」状態(保存済みグラフだけの縮退)に落ちる**。この解析は **viewer でも呼べる**(`POST /analyze` は viewer に許可されている)ので、viewer 1 人がメモリ枯渇とサービス劣化を起こせる。したがって B5/B6/B2 は下がる。

## 1. 実行した検証(コマンドと結果)

| コマンド | 結果 |
|---|---|
| `pnpm typecheck` | 7 プロジェクトすべて成功 |
| `pnpm lint` | 出力なし(エラー 0・警告 0) |
| `mkdir /tmp/fusamod-convert-zz` の上で `pnpm -r test` を **3 本同時** | 3 本とも全成功: safety-core 135、sysml-graph 40、scdl 50、analysis 61、web 20、ai 37、server 77(+ 8 スキップ)。**R6 の非密閉の失敗は再現せず(修正を確認)** |
| `pnpm -r test`(CPU を使い切るプロセス 6 個の負荷下) | 全成功(同数) |
| `pnpm coverage` | 最小の行カバレッジ 93.69%(server)。分岐は ai が **76.11%**(R6 の 78.63% から低下)が最小、他 80.8〜90.7% |
| `pnpm bench` | N=100/1000/5000 で一括解析 8/71/461 ms、構造図 1/42/666 ms、SCDL 469 ms。予算内。**`pnpm bench` が追跡対象の `docs/quality/evidence/performance.md` を書き換え、作業ツリーが dirty になる**(`git checkout` で戻した。`pnpm coverage` は差分なし) |
| `pnpm audit --prod` | `No known vulnerabilities found` |
| `pnpm build` → `cd apps/web && pnpm e2e` | **21 件成功、1 件スキップ(shots)**、44.0 秒。**実行後の `git status` は空(R6 の画像上書きは修正を確認)** |
| `FUSAMOD_IT=1 pnpm --filter @fusamod/server test` | 84 件すべて成功(スキップ 0、47 秒) |
| `pnpm --filter @fusamod/server build` | `dist/server.mjs`(1.2 MB)を生成。以降の試験に使用 |
| 実行後の `/tmp` | `pnpm --filter @fusamod/server test` 1 回で `fusamod-*` が 2 つ増える(`store-crash.test.ts` の `mkdtempSync` を閉じていない)。`fusamod-test-*` 85 個、`fusamod-e2e-*` 34 個が蓄積(後始末の不備は R6 から**未修正**) |
| Docker | デーモンが無く未実行。`Dockerfile`・`ci.yml` を精読 |
| CI | GitHub の実ランナーでの実行は未確認 |

## 2. 重大な欠陥(今回の新規): 古い JVM の終了が新しい JVM の状態を消す

### 2.1 前回の致命的欠陥(EPIPE)の再検証 — 修正を確認

`m_flat_15000`(15,000 個の `part def`/`part`、約 1.0 MB)、`m_chain_12000`(12,000 段の特化、0.65 MB)、`m_conn_8000`(8,000 の接続、0.67 MB)を `POST /api/projects/ev-powertrain/analyze` に投げた。いずれも公式実装が 60 秒で終わらない。

| 試験 | 結果 |
|---|---|
| 巨大モデルを 1 本ずつ連続で 3 回 | 各 68.8 / 67.1 / 68.9 秒(= 60 秒のタイムアウト + 再起動)で 200(`modelOk:false`、`sysmlError:"SysML の解析がタイムアウトしました…"`)。直後の `GET /api/health` は 200。**サーバーは落ちない** |
| タイムアウト直後の通常モデルの解析 | 成功(`modelOk:true`) |
| JVM を外部から `kill -9` → 直後に新しいモデルの解析(3 回、`kill` と解析の同時発行を含む) | すべて成功(7〜8 秒で再起動、`132 ms` の再利用)。サーバー生存 |
| `SIGTERM`(解析の途中) | プロセスが終了。自分の JVM の残り 0 |
| 不正な JSON / `null` / 配列 / `__proto__` / 6 MB の本文 / チャンク転送の 6 MB | 400 / 400 / 400 / 400 / 413 / 413。生存 |
| 300 本の途中で止まった接続(スローロリス) | `/api/health` は 0.14 秒で 200。5 秒後も接続は閉じられない(Node の既定のタイムアウトに依存。専用の設定なし) |
| 20 並列の `model.xmi`(viewer) | 受理 6 件(200)、14 件が 429。JVM は 2 まで。一時ディレクトリの残り 0 |
| 未知の出力名(`/export/x1`〜`x100`、viewer) | すべて 404。**`audit.jsonl` は 1 行のまま増えない(R6 の欠陥は修正を確認)** |

→ 前回の致命的な欠陥そのもの(順次の要求)は直った。**ただし次の 2.2 がある。**

### 2.2 同時に 2 本の重い解析が来ると JVM が漏れ、サーバー全体が 60 秒縮退する(新規・高)

**再現**(バンドル版・実 HTTP): 重いモデル A を送り、1 秒後に重いモデル B(または通常モデル)を送る。

```
node an.mjs m_flat_15000.sysml & ; sleep 1; node an.mjs m_conn_8000.sysml
→ A: 200 60.2 s(タイムアウト)  B: 200 65.8 s(待ち 60 s + 約 6 s で SysmlUnavailableError)
サーバーログ: "Java の SysML サービスが使えないため、保存済みグラフに切り替えます: SysML サービスが利用できません"
後続の通常モデルの解析: modelOk:false、sysmlError="Java(公式パイロット実装)が使えないため、保存済みのモデル以外は解析できません。Java 21 以上を用意するか…"
ps: サーバー(PID 31778)の子の java が 2 つ(32600 が 3〜5 分以上生存、999 が新規)。state に載っていない JVM が残る
```

3 回試して 2 回再現(1 回目 JVM 32600 が漏れ、2 回目 999 が漏れた。3 回目は同時発行のタイミングで再現せず。競合なので確率的)。漏れた JVM は RSS 373〜578 MB、`SIGTERM` までサーバーの子として残る(サーバー終了時には消えた)。

**原因**(`java-service.ts` の読解): `proc.on("exit")` のハンドラが、**どの子プロセスの終了かを確かめずに** `this.reset()`(`this.proc`・`this.ready` を捨てる)と `this.failPending(...)` を呼ぶ。`kill()` は `reset()` を即座に呼ぶので、直後に待機中の要求 B が新しい JVM を起動して `this.proc` / `this.ready` を設定すると、古い JVM の `exit` イベントが遅れて届き、**新しい状態を消す**。B は `await this.start()` の後に `this.proc` が `undefined` になって `SysmlUnavailableError`("利用できません")になり、新しい JVM はだれにも参照されない(漏れ)。`FallbackSysmlService` は `SysmlUnavailableError` を受けると `downUntil = now + 60 s` に設定するので、**全員が保存済みグラフだけに縮退し、通常の編集内容の解析が「Java 21 が必要」という誤った文言で失敗する**。実行中の要求があるときは `failPending` が新しい要求を誤って失敗させる可能性もある。
**修正案**: `const proc = spawn(...)` を閉じ込めて、各ハンドラ(`exit`・`error`・stdin の `error`)の先頭で `if (this.proc !== proc) return;`(自分の世代でなければ何もしない)。`reset()` はその世代のときだけ。回帰テスト(`fake-processes.test.ts` に、「タイムアウトした直後にキューの次の要求が成功し、JVM が 1 つだけ残る」)を追加する。

### 2.3 viewer が解析で全利用者を止められる(新規・中)

`readOnlyOk`(`app.ts`)は `POST /analyze` を viewer に許可し、Java の解析は**直列で 1 つ**。viewer が上限 2 MB のモデルを送るだけで、(a)JVM を最大 60 秒占有し、(b)その間の全利用者の解析が待たされ、(c)タイムアウトで 2.2 の競合が起きうる。利用者ごと・全体の解析の同時数・待ち行列の上限(エクスポートには 2+4 がある)が無い。`docs/security.md`・`operations.md` にこの制約の記述は無い(`security.md:37` のタイムアウト 180 秒はエクスポートの話)。また解析のタイムアウトが **HTTP 200(`modelOk:false`)** で返り、クライアントはモデルの誤りとタイムアウトを本文の `sysmlError` でしか区別できない(エクスポートは 503 に改善済み)。

### 2.4 起動時の掃除が、共有の一時領域の他者のディレクトリを消す(新規・低〜中)

`main.ts:44` が `sweepConvertTemp(0)`(年齢の条件なし)を呼ぶため、起動時に **OS 共通の一時領域にある `fusamod-convert-*` をすべて削除する**。実際、今回の試験で自分が置いた `/tmp/fusamod-convert-zz` は、サーバー起動後に消えていた。同じホストで 2 つ目のインスタンス(検証用・別ユーザー)が変換中だと、その作業ディレクトリを消して変換を失敗させる。`tmpRoot` を専用のサブディレクトリにする(インスタンスごとに `FUSAMOD_PROJECTS/.tmp` など)のが妥当。

## 3. セキュリティの再探索(バンドル版)

| 試験 | 結果 |
|---|---|
| 認証・役割の fuzz(生ソケット、13 パス × 19 の書き換え(`/%61pi`、`/%2561pi`、`/API`、`//`、`/./`、`/x/..`、末尾 `/`・`//`・`;`・`?`・`%00`・`#`、`%2f`、`\`、絶対 URI、`/api%2f`、`/ap%69`)× 11 のヘッダ(メソッド上書き、`X-Original-URL`、`X-Forwarded-*`、`Authorization` の変形)× 5 メソッド。約 5,000 件を匿名と viewer で) | 匿名: 401:1,507 / 403:556 / 404:157 / 400:250 / 200:30(**30 件すべて自分が付けた viewer のトークンの `Authorization` を持つ要求**。資格情報なしの 2xx は **0 件**)。viewer: 200:106(すべて GET と解析)、**書き込みメソッドの 2xx は 0 件** |
| `/api/me` | viewer: `{"user":"bob","role":"viewer"}` |
| `FUSAMOD_TRUST_PROXY=2` | `X-Forwarded-For: 1.1.1.1, 9.9.9.9` → 監査 `_server-audit.jsonl` の ip は `1.1.1.1`(2 段目)。XFF を毎回変える 12 回の認証失敗は 429 にならない(設計どおり。文書に警告あり: `security.md:28`) |
| `safety.diff`(人の保存) | 安全機構の ASIL B→QM、診断カバレッジ medium→high、安全要求の ASIL D→QM、`HW-1.dcSpfRf` 0.97→0.5 を**すべて記録**(`lowersRisk:3`)。**R6 の指摘は修正を確認** |
| 復元の差分 | `POST /history/1/restore` で `action:"safety.diff"`, `via:"restore"` が記録される(4 件)。**修正を確認** |
| `aiChanges` | 機構の AI 提案を作って適用(viewer は 403、editor は 200)→ 偽の追記は 400、削除は 422、復元後も 1 件のまま。**維持を確認** |
| 予約名のプロジェクト ID(`con`) | 400(文言で OS の予約名を説明)。**修正を確認** |
| CSV の式インジェクション | `export.ts:22` が `=+-@` で始まる値の先頭に `'` を付ける(コード確認)。名前に `=` を入れる試験は、スキーマが未知キー・形で 400 にした(確認できたのはコードのみ) |
| HW 故障モードの入力検証 | `fit` 負・1e12・文字列・null、`dcSpfRf` 2、`type` 不正、余分なキーは 400(zod の `.strict()`)。`id`・`name` に `<img onerror>`・`<script>` を入れると 200 で受理(React の描画で自動エスケープされるため XSS は不成立だが、サーバー側に文字種の制限は無い。CSV は 2 重防御あり) |
| 監査 | 連鎖(`prev`)が継続。1 プロセス前提(文書化済み) |

その他の観察(R6 から未変更): `GET /audit` が O(ファイルサイズ)でローテーションなし、圧縮なし、トークンの失効・ローテーションなし、CSP の `style-src 'unsafe-inline'`、ソースマップの公開(1.06 MB)。

## 4. 新機能: ISO 26262-5 の SPFM / LFM(`hardwareFailureModes`)

- **式**(`packages/safety-core/src/hwmetrics.ts`): SPFM = 1 − Σ(λSPF+λRF)/Σλ、LFM = 1 − Σλ潜在/(Σλ − Σ(λSPF+λRF))。ISO 26262-5 の定義と一致(安全な故障の割合を先に除く、DC の既定は 0 で保守的)。目標値 B 90/60、C 97/80、D 99/90 は正しい。実測: サンプルは SPFM 99.50%・LFM 95.27%(目標 99/90)。HW-1 の DC を 0.97→0.5 に変えると SPFM 93.97% で `HW_SPFM_BELOW_TARGET`(エラー)になることを API で確認。
- **スキーマ**: zod の `strict`、`fit` 0〜1e9、DC 0〜1、`type` 列挙。**入力検証は良好**。ただし `single` に `dcLatent`、`multiple` に `dcSpfRf` を入れても無視されるだけで警告が出ない。
- **欠落(中)**: ASIL B 以上の安全目標があるのに `hardwareFailureModes` が**空・未定義でも、指摘が一切出ない**(`validateHwModes` は `modes.length === 0` で即 return、`hardware` も未算出)。SPFM/LFM が「未評価」であることが画面にも指摘にも出るのは、コンセプトタブの薄い注記(`ConceptView.tsx:165`)のみ。ISO 26262 の観点では「ASIL D で HW メトリクス未評価」は警告にすべき(実測: `hardwareFailureModes` を削除して解析 → `issues` に HW 関連 0 件、`summary.errors:0`)。
- **`safety.diff` の抜け(低)**: `HW-2.safeFraction: - → 0.99`(未設定から 0.99 へ。SPFM の分母から 99% を除く、リスクを下げる主張)が `[リスク低下]` と記録されない(`operations.ts:217` の `inc` 判定が `undefined` の元値を扱わない)。`fit` の減少、DC の上昇、削除は正しく記録。
- **使用性(中)**: 故障率の入力は「データ」タブの JSON を直接編集するしかない(`user-guide.md:44` も同旨)。専用の表・フォーム・単位の説明・合計の検算が無い。表示(`ConceptView.tsx:170`)は `totalFit` を生の浮動小数で出す(`safeFraction` 使用時に `0.30000000000000004` のような表示になりうる)。
- **文書の矛盾**: `docs/safety-notes.md:55` が「SPFM/LFM/PMHF の算出」を**未実装**と書いたまま(同ファイル 49 行目以降と `plan.md:23` は実装済み)。ADR も無い。
- **画面**: スクリーンショット 05-concept(下記 5)では、HW メトリクスの帯と注記が加わったぶん、その下の「意図機能」「ペア」「分解」「要求」の表が**さらに圧縮**され、1 行ずつしか見えない。メトリクスの表示自体は読みやすい(緑のバッジ、目標つき)。

## 5. 画面(1440x900。`docs/quality/evidence/screenshots` を目視。再撮影はしていない)

| 画面 | 評価 |
|---|---|
| 01-main(FMEA) | RPN・AP の列が見える(R6 の修正は維持)。「予防管理」「検出管理」の入力欄は依然として狭く、内容が切れる |
| 05-concept | **悪化**: HW メトリクスの帯が増え、ペア・分解・要求の表が 1〜2 行の高さに潰れて読めない。入れ子のスクロールが多い |
| 06-scdl | **未修正**: 図の左右・下が切れ、「全体表示」が無い |
| viewer UI | コード上は R6 から**変更なし**(`styles.css:169-172` の `pointer-events:none` のみ。追加ボタンは有効、フォームが開き押すと拒否。viewer の E2E なし。トップバーの折り返しも未確認のまま)。今回は Playwright での再実測をしていない |
| 全般 | ダークで統一、4 階層 × 4 視点のパズルビュー、axe(dark/light)は E2E で成功 |

## 6. 保守性・文書・CI・移植性

| 項目 | 判定 |
|---|---|
| `docs/security.md`(監査の「1 分に 1 回」「許可リスト」)| **一致**(実測で 404 は監査に残らない)。`TRUST_PROXY=true` の直接公開の警告も追記済み |
| `.env.example` の `FUSAMOD_TRUST_PROXY` | 警告の追記なし(R6 の依頼のうち未対応) |
| `README.md` | Java 21・Docker・`FUSAMOD_TOKENS` への言及が 2 行で追加(`FUSAMOD_*` 一式は `.env.example` へ誘導)。最小限 |
| `docs/user-guide.md` | viewer(41 行)と HW メトリクス(44 行)を追加。**HW の入力が JSON のみ**であることが弱点 |
| `docs/operations.md` | Docker の手順(47 行目〜)あり。`-e HOST=0.0.0.0` はイメージの ENV が既定なので問題なし。**解析の直列・タイムアウトの運用上の影響(2.3)の記述なし** |
| `docs/safety-notes.md:55` | **古い記述**(SPFM/LFM が未実装と書かれている) |
| ADR | 9 本。SPFM/LFM の ADR なし |
| `.github/workflows/ci.yml` | `test`(型・lint・テスト・カバレッジ・性能・監査・ビルド・バンドル版の煙試験・E2E)、`sysml-integration`(`actions/cache` あり)、`docker`。現実的。煙試験は `FUSAMOD_SYSML=snapshot` で **health と一覧のみ**(認証・viewer・`TRUST_PROXY`・エクスポートの確認なし)。キーが固定(`sysml-pilot-0.62.0`)で `lib.sh` 変更時に無効化されない。Node のマトリクスなし。`pnpm bench` が追跡ファイルを書き換えるため `git diff --exit-code` を CI に入れられない。実ランナーでは未実行 |
| `Dockerfile` | 精読のみ。node(glibc 2.36 の bookworm)を jammy(glibc 2.35)に持ち込む点は**未実測**(公式配布の node は glibc 2.28 以上で動く見込みだが、検証していない) |
| モード | `git ls-files -s`: `convert.sh`・`extract.sh`・`run.sh`・`serve.sh`・`fake-convert.sh` が 100755、`lib.sh` が 100644(`source` 用で正しい) |
| `lib.sh` の `flock` | `ensure_pilot` に排他あり、`flock` が無い環境(macOS 標準)では省略(= その環境では排他なしに縮退。文書化は `lib.sh` のコメントのみ)。fd 9 は `exec java` に継承される(害は小さい) |
| テスト品質 | `fake-processes.test.ts` は専用の一時ディレクトリで密閉化。**3 本同時 + 迷子ディレクトリの上で全成功を確認**。ただし `store-crash.test.ts`(毎回 2 個)、`helpers.ts`(`fusamod-test-*` 85 個)、e2e(34 個)の後始末漏れは未修正。ai の分岐カバレッジは 76.11%。**2.2 の競合(タイムアウト直後にキューの次の要求が来る)を捉えるテストが無い**ため、R6 の致命的欠陥の修正テストは通っても今回の欠陥は見逃された |
| `app.ts` / `projects.ts` | 432 / 465 行。責務の集中は R6 と同様。画面コンポーネントの単体テストなし |

## 7. 項目別レビュー

### A2. 画面・UX 要件の充足度 — 採点 86 / 外部確認待ち減点 5(合否点 91)
良い点: ダーク、エクスプローラ・ビューペース(図/テキスト)・AI 対話・パズルビュー、FMEA の RPN/AP、SPFM/LFM の目標つきバッジ、viewer の更新拒否(状態は変わらない)。
減点: (1)安全コンセプトタブがさらに圧縮され、主要な表が読めない(05)、(2)SCDL が全体表示できない(06)、(3)HW の入力が JSON のみ(画面に入力手段なし)、(4)viewer で追加フォームが開く(R6 から未対応)、(5)FMEA の管理欄が狭い、(6)図上のモデル編集なし。
外部確認待ち減点 5: 実利用者(安全担当・MBSE 担当)による画面・操作性の評価。

### B2. 性能効率性 — 採点 83 / 外部確認待ち減点 4(合否点 87)**不合格**
良い点: ベンチは予算内(N=5000 で解析 461 ms)。エクスポートの同時数が有界(2+4、20 並列で 6 受理・14 件の 429、実測)。監査の追記が O(1)(R6 で確認、今回コードは変更なし)。
減点: (1)**漏れた JVM(1 個 370〜580 MB)が蓄積しうる**(2.2)、(2)解析が 1 つの JVM に直列で、1 件の重い要求(最大 60 秒)が全員を止める。上限・公平性なし(2.3)、(3)タイムアウト後の 60 秒の縮退で、正常なモデルの解析が失敗(2.2)、(4)`GET /audit` が O(ファイルサイズ)、圧縮なし、変換結果のキャッシュなし(R6 から未対応)、(5)長時間・API 経由の負荷とメモリの計測なし。
外部確認待ち減点 4: 実運用規模・同時利用での性能。

### B4. 使用性 — 採点 85 / 外部確認待ち減点 8(合否点 93)
良い点: axe 成功、矢印キーのタブ、`Ctrl+S`、日本語のエラー、提案の承認制、リスク低下の確認、viewer の更新拒否、SPFM/LFM の色つきバッジと注記(PMHF は算出しない旨)。
減点: HW 入力が JSON のみでエラー防止が弱い、`totalFit` の浮動小数表示、viewer の追加フォーム(押すと赤い拒否)、コンセプトタブの視認性、オンボーディングなし、viewer の E2E なし。
外部確認待ち減点 8: 実利用者によるユーザビリティ評価、支援技術での手動検査。

### B5. 信頼性 — 採点 80 / 外部確認待ち減点 3(合否点 83)**不合格**
良い点: 前回の致命的欠陥(EPIPE)は直り、順次のタイムアウト 5 回・外部 `kill -9` 4 回でも生存。異常入力(不正 JSON・巨大本文・null・`__proto__`)は 4xx。`SIGTERM` で終了。エクスポートの 404/409/422/429/503 の分類が改善(解析失敗は 503)。
減点: (1)**同じ経路の新しい競合(2.2)**: JVM の漏れと、60 秒の誤った縮退(「Java 21 が必要」という誤案内)。致命的な欠陥の「修正の穴」で、修正時のテストが順次の場合しか見ていないことを示す、(2)解析のタイムアウトが 200 で返る、(3)2 プロセスでの追記の破断のガードなし(R6 から)、(4)`fsync` なし、(5)障害注入(ENOSPC など)は未検証、(6)起動時の掃除が他者の一時ディレクトリを消す(2.4)。
外部確認待ち減点 3: 実運用での長期稼働、実ディスク・実ネットワーク障害での確認。

### B6. セキュリティ — 採点 83 / 外部確認待ち減点 6(合否点 89)**不合格**
良い点(実測): 認証・役割の迂回なし(匿名の資格情報なし 2xx 0、viewer の書き込み 2xx 0)。未知の出力名の監査洪水を修正。`safety.diff` と復元の差分を網羅。予約名の拒否。`TRUST_PROXY` の警告を文書化。`aiChanges` の保護を維持。依存の脆弱性 0 件。CSV の式インジェクション対策。
減点: (1)**viewer が解析経由でサービスを止め、JVM を漏らせる**(2.2・2.3。認可の観点では「読み取り専用」の利用者が資源を枯渇させる)、(2)起動時の `sweepConvertTemp(0)` が共有領域の他者のファイルを消す(2.4)、(3)トークンは平文でローテーション・失効なし、CSP の `unsafe-inline`、ソースマップの公開、(4)`GET /audit` が無制限、(5)`id`・`name` の文字種制限なし(描画は安全)、(6)第三者の侵入試験なし。
外部確認待ち減点 6: 第三者による侵入試験(プロキシ構成を含む)、TLS 終端を含む運用構成の確認。

### B7. 保守性 — 採点 87 / 外部確認待ち減点 4(合否点 91)
良い点: 型・lint(警告 0)、単体・結合 約 480 件(統合 84 件を含む)、E2E 21 件、server のカバレッジ 93.7%、R6 の欠陥ごとの回帰テスト、**テストの密閉化を 3 本同時 + 迷子ディレクトリで実測確認**、`pnpm e2e` が作業ツリーを汚さない(`git status` 空)、ADR 9 本、CI のキャッシュと煙試験の追加、実行権限の正しさ。
減点: (1)**致命的欠陥の周辺の並行性の試験が無く、直後に同じファイルの競合が残った**(2.2)、(2)`store-crash` などの一時ディレクトリの後始末漏れ(毎回 2 個)、(3)`pnpm bench` が追跡ファイルを変更する、(4)文書の不一致(`safety-notes.md:55`)、`.env.example` の警告なし、ADR なし、(5)ai の分岐カバレッジ 76%、画面コンポーネントの単体テストなし、(6)煙試験が health のみ、(7)`app.ts`/`projects.ts` の肥大化。
外部確認待ち減点 4: GitHub 実ランナーでの CI の実行、第三者によるコードレビュー。

### B8. 移植性 — 採点 84 / 外部確認待ち減点 6(合否点 90)
確認できた点: `Dockerfile`(`HOME=/data`、キャッシュ、`pnpm deploy --legacy`、`HEALTHCHECK`、`USER 1000`)、CI の `docker` ジョブ(起動 → 作成 → 解析 `modelOk:true`)が現実的、`flock` の排他、実行権限が git 上で正しい、`PORT`/`HOST` の不正値は起動失敗、バンドル版は `HOME` 非依存。Windows 予約名を拒否。README・operations に Docker 手順。
減点: (1)Docker のビルド・起動は未検証(glibc の件は未実測)、(2)初回の jar 取得(約 120 MB)はネットワーク必須(オフライン手順は 1 行)、(3)bash 専用(Windows/macOS は未検証、`flock` なしでは排他が無い)、(4)起動時に共有 `/tmp` を掃除する(複数インスタンスで干渉。2.4)、(5)Node のマトリクスなし、実ランナー未実行。
外部確認待ち減点 6: Docker のビルド・起動(Java 経路を含む)、他 OS・オフライン環境での設置確認。

### (参考)A1 機能要件 — 見立て 90 / 外部確認待ち 5
SPFM/LFM(式・目標値・画面・監査)が加わり、安全要求側の経路や決定的 ID などが進んだ。PMHF、FMEA-MSR の集計、7 ステップ、SysML v2 API は未実装(明記あり)。ASIL B 以上で HW データ未入力でも警告が出ない点は、機能の正しさ(専門家の観点)でも指摘されうる。専門家の判定は別途。

## 8. 優先して直す点(ファイル単位)

1. **B5/B6/B2 `apps/server/src/sysml/java-service.ts`**: 世代ガード。`exit`/`error`/stdin の `error`/`stdout` のハンドラで `if (this.proc !== proc) return;`。`kill()` は対象の `proc` を明示して殺す。タイムアウト後に待ちの要求が新しい JVM で成功し、JVM が 1 つだけ残る回帰テストを `apps/server/test/fake-processes.test.ts` に追加(2 本同時、`FAKE_MODE=hang` の代役サーバーで)。
2. **B6/B2 `apps/server/src/app.ts`、`services.ts`**: 解析の待ち行列に上限(例: 同時 1 + 待ち N、超過は 429/503)と、利用者あたりの上限。解析のタイムアウトは 504(または 503)で返す。`FallbackSysmlService` は、タイムアウト(`SysmlTimeoutError`)では縮退させない(`SysmlUnavailableError` のみ)ことを確認。viewer の `/analyze` のモデルサイズ上限を下げる、または保存済みのみ許可。
3. **B6/B8 `apps/server/src/main.ts`、`sysml/convert.ts`**: `sweepConvertTemp(0)` を専用の一時ディレクトリ(`FUSAMOD_PROJECTS/.tmp` など)に限定するか、自プロセスの PID を名前に入れて自分の分だけ消す。
4. **A1/B1 `packages/safety-core/src/hwmetrics.ts`、`packages/analysis/src/analyze.ts`**: ASIL B 以上の目標があり `hardwareFailureModes` が空なら `HW_METRICS_MISSING`(警告)。`type` に不要なフィールド(single の `dcLatent` など)を警告。`operations.ts:217` で `safeFraction` の `undefined → 値` も `inc` として扱い `lowersRisk`。
5. **A2/B4 `apps/web/src/components/ConceptView.tsx`、`styles.css`**: HW 故障モードの表編集(追加・削除・FIT・DC の入力と範囲検証、合計の検算)。コンセプトタブの高さ配分(表を折りたたみ式にする、またはタブ内でページ全体をスクロール)。`totalFit` を丸める。SCDL の「全体表示」。viewer では追加・作成ボタンを `disabled`、viewer の E2E。
6. **B7 `docs/safety-notes.md:55`、`.env.example`、`docs/operations.md`**: 古い SPFM/LFM 未実装の記述を直す。`FUSAMOD_TRUST_PROXY` の警告を `.env.example` にも。解析の直列・タイムアウト・縮退の運用説明。SPFM/LFM の ADR。
7. **B7 `apps/server/test/store-crash.test.ts`、`helpers.ts`、`apps/web/e2e/server.mjs`**: 一時ディレクトリの後始末。`tools/quality/bench.ts` が追跡ファイルを書き換えないようにする(または CI で許容)。
8. **B7/B8 `.github/workflows/ci.yml`**: 煙試験にトークン・viewer・エクスポートの 4xx を追加。キャッシュキーに `tools/sysml-check/**` のハッシュ。Node 22/24 のマトリクス。実ランナーの結果を記録。
9. **B2 `apps/server/src/projects.ts`**: `GET /audit` の末尾読み取り・ローテーション、変換結果のキャッシュ、圧縮。

## 9. ラウンド 6 の指摘 → ラウンド 7 の検証

| R6 の指摘 | 判定 | 根拠 |
|---|---|---|
| **解析タイムアウト後にサーバーが EPIPE で落ちる(致命)** | **修正を確認(ただし 2.2 の別の欠陥あり)** | 5 回のタイムアウト + 4 回の外部 `kill -9` でも生存。同時 2 本で JVM の漏れと縮退(新規) |
| 変換テストが共有 `/tmp` に依存(非密閉) | **修正を確認** | 迷子 `fusamod-convert-zz` + 3 本同時で全成功 |
| 未知の出力名で監査が増える | **修正を確認** | 100 回の未知名で監査 1 行のまま、404 |
| `safety.diff` が安全要求・機構の ASIL/DC/安全状態を記録しない | **修正を確認** | 実 HTTP で 4 件すべて記録。残: `safeFraction` の `undefined→値`(低) |
| 復元に差分の記録が無い | **修正を確認** | `via:"restore"` の `safety.diff` |
| `TRUST_PROXY=true` の直接公開の警告が無い | **一部**(`security.md` は修正、`.env.example` は未対応) | `security.md:28` |
| README に Docker・Java・環境変数が無い | **一部修正**(2 行で最小限) | README 26-27 行 |
| `user-guide.md` に viewer が無い | **修正を確認** | 41 行 |
| Windows 予約名 | **修正を確認** | `con` → 400 |
| `ensure_pilot` の排他 | **修正を確認(flock のある環境)** | `lib.sh` |
| `pnpm e2e` が証跡画像を書き換える | **修正を確認** | e2e 後の `git status` 空。ただし `pnpm bench` が追跡ファイルを書き換える |
| CI にキャッシュ・煙試験が無い | **一部修正** | あり。煙試験は health のみ |
| 変換の環境失敗が 422(モデルの誤りと混同) | 一部(解析失敗は 503 になったが、変換器自体の環境失敗は未再確認) | `app.ts` 289-320 行 |
| `GET /audit` が O(n) | 未修正 | — |
| viewer の追加フォーム・トップバーの折り返し・viewer の E2E | 未修正 | コード変更なし |
| 安全コンセプトの表・SCDL の全体表示 | 未修正(コンセプトは悪化) | 05, 06 |
| `assertAiChangesUnchanged` のロック外の比較 | 未確認(コードは変更なし) | `app.ts:246` |
| 2 プロセスでの追記の破断のガード | 未修正(文書化のみ) | — |
| 実ランナーでの CI、Docker のビルド | 未実施(外部) | — |

## 10. 合否判定

合格: A2(91。境界)、B4(93)、B7(91)、B8(90。境界)。**不合格: B2(87)、B5(83)、B6(89)**。いずれも原因は 2.2・2.3(JVM の競合による漏れと縮退、viewer から呼べる解析の直列・無制限)。優先 1〜3 を直せば B5/B6/B2 は再評価の対象になる。

## 11. 外部確認待ち一覧(誰が・何を)

| 項目 | 実施者 | 内容 |
|---|---|---|
| A2 / B4 | 実利用者(安全担当・MBSE 担当) | 画面・操作性の評価、タスク達成の観察、支援技術での手動アクセシビリティ検査 |
| B2 | 運用担当 | 実プロジェクト規模・同時利用での負荷試験(解析の同時実行、標準形式の書き出し、巨大な監査ログ) |
| B5 | 運用担当 | 数週間の連続運転、障害注入(ディスク満杯・権限・電源断・ネットワーク) |
| B6 | 第三者のセキュリティ専門家 | 侵入試験(`TRUST_PROXY` の構成を含む)、TLS 終端を含む運用構成の確認 |
| B7 | 開発担当 / 第三者 | GitHub 実ランナーでの CI の実行、第三者によるコードレビュー |
| B8 | 開発担当 | Docker ビルド・起動(Java 経路を含む)、他 OS・オフライン環境での設置確認 |
