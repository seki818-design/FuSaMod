# ラウンド 3 品質レビュー(A2 / B2 / B4 / B5 / B6 / B7 / B8、A1 は参考)

レビュー担当: 独立・厳格な品質レビュー担当(ISO/IEC 25010 の観点を使う模擬レビューであり、認証機関ではない)
対象: `/home/user/FuSaMod`(HEAD d94b060。作業ツリーには他の担当/作者による未コミット変更あり: `packages/safety-core`、`sysml-graph`、`projects/ev-powertrain/safety.json` など。私は一切変更していない)/ 実施日: 2026-10-03
方針: `docs/quality/rubric.md` に従う(証拠主義、未検証は減点、外部確認待ち減点は別枠で最大 10)。ラウンド 2 の対応文書は信用せず、すべて再実行した。
確認用サーバーは一時ディレクトリ(スクラッチ)のコピー・ポート 8931 で起動し、終了済み(`kill <pid>` のみ使用)。

## 0. 採点サマリー

| 項目 | R2 採点 | R3 採点 | 外部確認待ち減点 | 合否点 | 採点 80 以上 | 判定(合否点 90 以上かつ採点 80 以上) |
|---|---|---|---|---|---|---|
| A2 画面・UX 要件 | 87 | **87** | 5 | 92 | 〇 | **合格** |
| B2 性能効率性 | 87 | **87** | 4 | 91 | 〇 | **合格** |
| B4 使用性 | 84 | **85** | 8 | 93 | 〇 | **合格** |
| B5 信頼性 | 82 | **85** | 3 | 88 | 〇 | **不合格(88)** |
| B6 セキュリティ | 74 | **52** | 6 | 58 | **×** | **不合格(大幅悪化)** |
| B7 保守性 | 86 | **84** | 4 | 88 | 〇 | **不合格(88)** |
| B8 移植性 | 80 | **80** | 4 | 84 | 〇(境界) | **不合格(84)** |
| (参考)A1 機能要件 | 85 | **86** | 5 | 91 | 〇 | 境界(専門家レビューは別途) |

**最重要の所見(B6)**: R2 で直したはずの viewer のバイパスは直っていた(クエリ付きは 403)。しかし今回の探索で、**認証と権限制御そのものを 1 つの URL 表記で丸ごと回避できる**ことを実測した。
`/api/...` の代わりに `/%61pi/...`(または `/a%70i/...`)を送ると、Fastify はパーセントデコードして同じルートに振り分けるが、認証フック(`app.ts` の `onRequest`)は**生の `req.url` に対して `startsWith("/api/")`** で適用対象を判定するため、**認証・viewer 制限・API レート制限のすべてを素通りする**。
トークン無しで一覧取得、CSV の取得、プロジェクト作成(201)、監査ログの閲覧ができ、操作者は `local`/`editor` として記録される。AI の別承認者設定(`FUSAMOD_AI_SEPARATE_APPROVER`)も、この経路では無意味になる。
ドキュメント(`docs/operations.md`: 「全 API にベアラートークンが必要」「閲覧者は読み取りと解析のみ」)と実態が食い違う。R2 の指摘(クエリでのバイパス)と同根の「URL の判定を生の文字列で行う」欠陥の別経路で、R2 の修正は個別のパターンだけを塞ぎ、原則(許可リスト・正規化後の判定)に至っていない。

## 1. 実行した検証(コマンドと結果)

| コマンド | 結果 |
|---|---|
| `pnpm typecheck` | 7 プロジェクトすべて成功 |
| `pnpm lint` | 出力なし(エラー 0・警告 0) |
| `pnpm -r test` | safety-core 103、sysml-graph 27、scdl 50、analysis 49、web 19、ai 29、server 39(+ 3 スキップ)すべて成功 |
| `FUSAMOD_IT=1 pnpm --filter @fusamod/server test` | 3 ファイル 42 件成功(Java 結合 3 件を含む。公式 SysML 実装で 7.5 秒) |
| `pnpm coverage` | 最小の行カバレッジ 83.48%(server)。他は 94.09〜98.85%。分岐は 80.2〜90.69%。しきい値 80% 強制 |
| `pnpm bench` | N=100/1000/5000 で一括解析 7/60/407 ms、構造図レイアウト 1/43/693 ms、予算内 |
| `pnpm audit --prod` | `No known vulnerabilities found` |
| `pnpm build` → `cd apps/web && pnpm e2e` | **22 件すべて成功**(42.0 秒。axe の dark/light、狭い画面の縦積み、認証ダイアログ、非公式 AP の明示を含む)。viewer 用 UI の E2E は無い |
| `pnpm --filter @fusamod/server build` | `dist/server.mjs` を生成 |
| Docker 相当の配置の再現 | `pnpm --filter @fusamod/server --prod deploy --legacy <dir>` を実行 → `<dir>/node_modules`(`fastify`、`@fastify`、`@fusamod/*`(`.pnpm` への相対 symlink)、`tsx`、`zod`)。これを Dockerfile と同じ配置(`app/apps/server/node_modules`、`app/apps/server/dist/server.mjs`、`app/pnpm-workspace.yaml`、`app/apps/web/dist`、`app/tools`、`app/libs`)にコピーして `node apps/server/dist/server.mjs`(`FUSAMOD_SYSML=snapshot`)を起動 → 起動し、`/api/health` と SPA の配信が正常。**`pnpm deploy --legacy` の出力配置とバンドルの期待位置の整合は実測で確認**(Docker 自体は未実行) |
| Docker | デーモンが無いため未実行。Dockerfile を精読(後述 B8) |
| CI | `.github/workflows/ci.yml` を精読。GitHub の実ランナーでの実行は未確認 |

## 2. 手動の再探索の記録

### セキュリティ(バンドル版サーバー、トークン 3 種: alice 編集 / bob 閲覧 / carol 編集)

| 試験 | 結果 | 評価 |
|---|---|---|
| **`/%61pi/projects`(トークン無し)** | **200 でプロジェクト一覧**(`/api/projects` は 401) | **重大な欠陥** |
| **`/a%70i/projects`(トークン無し)** | 200 | 同上 |
| **`POST /%61pi/projects`(トークン無し)** | **201 でプロジェクト作成**。`audit.jsonl` に `actor:"local", action:"project.create"` | 認証なしの書き込み |
| **`POST /%61pi/projects`(viewer の bob)** | **201**(viewer 制限も迂回) | 権限昇格 |
| `GET /%61pi/projects/ev-powertrain/export/fmea.csv`、`/%61pi/projects/ev-powertrain/audit`(トークン無し) | 200 | 機密性の欠如 |
| `GET /%61pi/me`(bob のトークン付き) | `{"user":"local","role":"editor"}` | 偽装された操作者名 |
| `%2561pi`、`/api%2Fprojects`、`/API/…` | SPA の index.html(200)または 404。API には届かない | 良 |
| viewer: 通常の `PUT /model`、`POST ai/chat`、`history/1/restore`、`proposals/x/apply`、`DELETE`/`PATCH` | 403 | 良 |
| viewer: クエリ付き(`?x=/analyze`、`#/analyze`)、`/ANALYZE`、`/%61nalyze`(パス末尾側のエンコード) | 403(R2 の欠陥は解消) | 良 |
| viewer: `//api/…`、`/analyze/`(末尾スラッシュ) | 404(許可されず到達もしない) | 良 |
| viewer: `X-HTTP-Method-Override`、`X-Method-Override` | 403(ヘッダは無視される) | 良 |
| viewer: `OPTIONS` 204、`HEAD`(restore)404、`analyze` 200 | 想定どおり | 良 |
| プロジェクト ID(`%2e%2e%2fx`、`ev-powertrain%2f..%2f..%2fetc`)、`export/..%2f..%2fx`、`--path-as-is` の `/../../../etc/passwd`、`/assets/..%2f…etc%2fpasswd` | 400 / 400 / 404 / 200(SPA の index.html。ファイルは漏れない) / 200(SPA) | 良 |
| 6 MB の PUT | 413 | 良 |
| 不正トークンの連続試行 | 2 回 401 → 3 回目から 429(`Retry-After: 60`)。有効トークンは 200 のまま。`X-Forwarded-For` を変えても 429(`trustProxy` 未設定=偽装不可。ただしプロキシ背後では全員が同一 IP になる懸念は残る) | 良 |
| 監査ログの改ざん検出 | 行の内容変更: 検出(`brokenAtLine:4`)/ 先頭削除: 検出 / 偽行の追記: 検出 / **末尾削除: 検出されない** / **全行の再計算: 検出されない**(無鍵 SHA-256。ドキュメントに限界は明記) | 良(限界は明記済み)。HMAC・外部アンカーは無い |
| AI 別承認者(`FUSAMOD_AI_SEPARATE_APPROVER=1`) | alice が依頼 → alice の承認は 403、viewer は 403、carol の承認は 200。`safety.json` に `aiChanges`(提案者・承認者)が残る。監査ログに `alice:ai.chat → carol:ai.apply` | 良。**ただし `/%61pi` 経路では actor が `local` になり、分離も認証も効かない** |
| CSV インジェクション | `csvCell` が先頭の `=`、`+`、`-`、`@`、タブ、CR に `'` を付ける(数値は除外)。BOM つき | 良 |
| XSS | `dangerouslySetInnerHTML`/`innerHTML` は 0 件。CSP `default-src 'self'`(`style-src 'unsafe-inline'` は残) | 良 |
| `onSend` の `Cache-Control: no-store` も `req.url.startsWith("/api/")` | `/%61pi/…` の応答には `no-store` が付かない(同根) | 軽微 |
| `trustProxy`、監査の範囲(GET・認証失敗・エクスポート) | 未対応のまま | 弱い |

### 信頼性(ProjectStore)

| 試験 | 結果 | 評価 |
|---|---|---|
| **最新リビジョンの `meta.json` を壊す** | R2 の「恒久的な 500」は解消。壊れた後の `PUT` は 200 で、版番号はディレクトリ最大値+1(rev 3 が壊れ、次は rev 4)。**ただし `GET` は壊れた版の内容(rev 3 の MARK)を黙って捨て、rev 2 を最新として返す**(警告なし。`history` 一覧にも壊れた版は出ない)。壊れた版のディレクトリは隔離されず残る | 改善(保存不能は解消)。無警告の巻き戻しは残る |
| 現在の `model.sysml` を空にする | 確定済みの履歴の内容を返す | 良 |
| 現在の `safety.json` を壊す(`{bad`) | 履歴から回復して 200 | 良 |
| **`model.sysml` を手で追記(`// HAND`)** | 履歴のハッシュと不一致のため **黙って履歴の版に戻される(追記は消える)** | 注意(R2 の指摘どおり。`docs/operations.md` に明記も警告も無い) |
| **`proposals.json` を壊す** | 500 のまま(自己修復なし) | 欠陥(R2 から未修正) |
| 8 並行 PUT(同じ `baseRevision`) | 1 件 200、7 件 409。履歴は連番で重複なし | 良 |
| ベースライン(履歴のない手置きプロジェクト) | `ensureBaseline` が最初の保存前に版 1「最初の保存の前の内容(取り込み)」を作る(コード確認。`store-crash.test.ts` に回帰あり) | R2 の指摘を解消 |
| 履歴の自動削除 | `history.prune` を監査ログに記録(コード確認) | 解消 |
| `create` | `withLock` の外で `exists`→`mkdir`→`commit`。同一 ID の同時作成で競合しうる(コード上。未再現) | 軽微 |
| 版の確定と監査の追記 | 別の処理のまま(間で落ちると版だけ残る) | 軽微 |
| Java が無い環境 | snapshot で動作、`sysmlError` を返す | 良 |

## 3. 項目別レビュー

### A2. 画面・UX 要件の充足度 — 採点 87 / 外部確認待ち減点 5(合否点 92)

証拠: 1440x900 の 9 枚(`docs/quality/evidence/screenshots`、E2E の撮影で再生成)を目視した。01(メイン)、04(HARA)、05(安全コンセプト)、06(SCDL)を詳細に確認。
- 良い点: ダークで統一、エクスプローラ・ビューペース(図/テキスト)・AI 対話・パズルビュー(4 視点 × 4 階層、整合/要確認/未確定、記号と凡例つき)が揃う。図は幅に収まり 4 階層の入れ子と ASIL バッジが読める。HARA(04)の表は右端まで収まり、ASIL・安全目標も見える(R2 の「AS(IL) 列の欠け」は解消)。
- 非公式 AP の注意書きバナーが FMEA 画面に出る(E2E でも確認)。viewer 用に「読み取り専用」バッジと保存ボタンの無効化がある(`TopBar.tsx` のコードを確認。E2E は無い)。

残る減点理由
1. 解析パネル(下段)は依然として高さが約 370px。FMEA(01)は S/O/D の先の RPN/AP 列が最初の画面に出ない。安全コンセプト(05)は「ペア」「分解」の表が 1 行しか見えず、入れ子のスクロールが多い。中心の分析画面が窮屈。
2. SCDL 図(06)は文字が約 6px で実用上読めず、右端と下端が切れる。R2 から実質変化なし(R2 対応文書は「920px 基準」としたが、見た目の改善は小さい)。
3. AI 対話スペースは空のとき縦に余り、分析パネルとの配分が偏る。
4. 図上でのモデル編集なし(SysML テキスト編集で代替。`plan.md` に明記)。
5. 画面コンポーネントの単体テストなし(`apps/web/test` は `store`・`layout`・`helpers` のみ)。viewer UI の自動テストなし。
6. 実ユーザー評価(外部)。

外部確認待ち減点 5: 実際の利用者(安全担当・MBSE 担当)による画面・操作性の評価が未実施。

優先して直す点
1. `apps/web/src/styles.css`、`AnalysisTabs.tsx`: 解析パネルの高さ配分(既定で拡大、AI 欄を縮める)、FMEA の列(RPN/AP が初期表示で見えるように)。
2. `ScdlView.tsx`: 縮尺の下限、領域外のスクロール/ズーム、文字サイズの最小値。
3. viewer UI の E2E と、コンポーネントのテスト。

### B2. 性能効率性 — 採点 87 / 外部確認待ち減点 4(合否点 91)

証拠
- `pnpm bench`: N=5000 で一括解析 407 ms、構造図レイアウト 693 ms、予算内(R2 とほぼ同等)。
- `/assets/*` に `Cache-Control: public, max-age=31536000, immutable`、`index.html` に `no-cache` を設定(`app.ts` のコードで確認。今回は実測せず)。
- 8 並行 PUT の動作は正常(1 件成功、他は 409)。保存時間の劣化テストあり。

残る減点理由
1. 圧縮(gzip/br)は未対応(`@fastify/compress` 無し)。JS 340 kB(gzip 106 kB)、ソースマップ 1 MB。ドキュメントはリバースプロキシでの圧縮を前提。
2. `PUT /model` は解析(Java 呼び出し)の後に `MAX_MODEL_BYTES` を検査する(`app.ts`:zod の `max(2_000_000)` は文字数。バイト数の検査は `saveModel` 内)。R2 から未修正。
3. `findGraphByModelHash` は全プロジェクトを走査(O(プロジェクト数))、履歴 1 版ごとに全体を複製(最大 500 版)。容量の上限の説明が無い。
4. 負荷試験・API 経由の計測が無い。bench は合成データのみ。
5. 認証迂回経路(`/%61pi`)では API レート制限も効かない(B6 と同根)。

外部確認待ち減点 4: 実運用規模・同時利用での性能は、この環境では検証できない。

優先して直す点: `app.ts` に `@fastify/compress` と、PUT のバイト数検査の前倒し。`projects.ts` の `findGraphByModelHash` に索引。`tools/quality/bench.ts` に API 経由の計測。

### B4. 使用性 — 採点 85 / 外部確認待ち減点 8(合否点 93)

証拠: axe の dark/light が成功(E2E)。矢印キーのタブ移動、`Ctrl+S`、日本語のエラーメッセージ、提案の承認制、削除・復元の確認ダイアログ、パズルビューの色以外の記号(✓ ▲ ?)、履歴タブの監査ログ整合バッジ。viewer の「読み取り専用」表示と保存ボタン無効化を追加(R2 の指摘に対応。コード確認)。

残る減点理由
1. 画面の窮屈さ(A2 の 1〜2)。SCDL 図は読めない。
2. オンボーディング(初回案内・空状態の説明)なし。
3. 競合(409)・破損(500)・巻き戻し(破損した履歴)時の画面上の復旧導線は未確認。壊れた履歴が黙って巻き戻る(B5)ことをユーザーは画面から気づけない。
4. viewer の UI は保存ボタンのみ無効化。AI の提案・復元・新規作成などの無効化は、コードの確認範囲では網羅的ではなく、E2E もない(未検証)。
5. 実利用者の評価・支援技術での手動検査(外部)。

外部確認待ち減点 8: 実利用者によるユーザビリティ評価(タスク達成の観察)、スクリーンリーダー等での手動アクセシビリティ検査。

優先して直す点: 解析パネルの配分、viewer の全編集系ボタンの無効化と E2E、初回の案内、409/500 時の復旧導線。

### B5. 信頼性 — 採点 85 / 外部確認待ち減点 3(合否点 88)

良くなった点(実測): 壊れた最新 `meta.json` でも保存が継続できる(版番号をディレクトリ最大値+1)。初回保存前のベースライン版。履歴の自動削除の監査記録。現在ファイルの欠損・破損から確定済み履歴で回復。並行保存は 1 件のみ成功。`store-crash.test.ts` のクラッシュ再現テスト。Java 無しで縮退。

減点理由
1. **壊れた履歴の版を黙って無視して、1 つ前の版を最新として返す**(実測: rev 3 の内容が見えなくなる)。検出・警告・隔離・起動時の整合検査が無い。ユーザーからはデータ喪失に見える。
2. 手で `model.sysml` を編集すると、履歴のハッシュ不一致で黙って巻き戻る(実測)。`docs/operations.md` が Git での直接編集を想定する運用と衝突する。警告・取り込み手段が無い。
3. `proposals.json` が壊れると 500 のまま(R2 から未修正)。AI 提案の適用は「安全データの保存 → 提案の状態更新」の 2 段階。
4. `create` がロック外。版の確定と監査の追記が別処理。ロックはプロセス内のみ(複数プロセスの制約はドキュメントに未記載)。
5. 障害注入(ディスク満杯、権限)は未検証。
6. 認証迂回(B6)により、未認証の書き込みが可能で、データ保全の前提が崩れる。

外部確認待ち減点 3: 実運用での長期稼働と、実ディスク・実ネットワーク障害での確認。

優先して直す点
1. `projects.ts`: `latestMeta` が壊れた版を飛ばしたときは明示エラー/警告にし、`.history/<n>.corrupt` へ隔離。`read()` が履歴に戻したとき(手編集の巻き戻し含む)はレスポンスに警告を付け、監査ログに記録。
2. `projects.ts`: `readProposals` の破損からの回復(`.bak` へ退避して空で続行)。`create` をロック内に。
3. `docs/operations.md`: 直接編集の扱いと、単一プロセスの制約を明記。

### B6. セキュリティ — 採点 52 / 外部確認待ち減点 6(合否点 58)

良くなった点(実測): クエリ付き URL による viewer の迂回は解消し、回帰テストも追加。PORT/HOST の検証。AI の別承認者(`aiChanges` に提案者・承認者の来歴)。トークン書式の検査、認証失敗の 429(有効トークンは阻害されない)、パストラバーサルの二重防御、zod の `.strict()`、CSV 対策、CSP、依存の脆弱性 0 件、監査ログのハッシュ連鎖。

減点理由
1. **認証・viewer 制限・レート制限を、`/%61pi/…` で完全に迂回できる**(2 章の実測)。トークン無しで、一覧・エクスポート・監査ログの閲覧、プロジェクト作成ができる。原因は `app.ts` の `onRequest` フックの `req.url.startsWith("/api/")`(生の URL)。Fastify のルーティングはパーセントデコード後で行われる。「認証が必要」と書いたドキュメントと矛盾し、**アクセス制御の全面的な不備**。R2 で同じ種類の欠陥(生の URL による判定)を指摘したが、パターンの修正にとどまった。テストはエンコード形を試していない。
2. 監査ログは無鍵のハッシュ連鎖で、末尾削除・全面再計算を検出できない(明記あり)。参照(GET)・認証失敗・エクスポートは記録されない。迂回経路では操作者が `local` になり、責任追跡性も失われる。
3. `trustProxy` 未設定。リバースプロキシ背後では全員が同一 IP と見なされ、認証失敗の制限が共有される(コードからの推定)。
4. トークンは環境変数の平文(ローテーション・失効なし)。TLS はプロキシ前提。
5. CSP が `style-src 'unsafe-inline'`。`/api/health` は無認証で構成を返す。脅威モデルの文書なし、第三者の侵入試験なし。

外部確認待ち減点 6: 第三者による侵入試験、運用環境(TLS 終端・ネットワーク構成)での確認。

優先して直す点(この順)
1. `apps/server/src/app.ts`: 認証フックの対象判定を、生の URL ではなく、**正規化後のパス**(`decodeURIComponent` した `pathname`)または `req.routeOptions.url`(ルート定義のパターン)にする。望ましくは **API を Fastify の登録スコープ(`register(..., { prefix: "/api" })`)にして `addHook("onRequest")` を付ける**(エンコード表記に依存しない)。静的配信と `/api/health` 以外は既定で拒否。`onSend` の `no-store` も同様に。
2. `apps/server/test/api.test.ts`: `/%61pi/projects`、`/a%70i/…`、`//api`、大文字小文字、末尾スラッシュ、`HEAD`/`OPTIONS`、メソッド上書きヘッダについて、トークン無し・viewer・editor の表を網羅するパラメータ化テスト。
3. 監査ログに認証失敗・エクスポート・履歴の削除を記録、HMAC か外部アンカー。`FUSAMOD_TRUST_PROXY` の設定。
4. `docs/` に脅威モデル。

### B7. 保守性 — 採点 84 / 外部確認待ち減点 4(合否点 88)

証拠
- 型・lint(警告 0)・単体 約 300 件・結合 3 件・E2E 22 件。カバレッジのしきい値(行 80%)を `coverage.mjs` が強制、CI でも実行。ADR 9 本。`docs/safety-notes.md`(検出できる誤り/できない誤りの一覧)が追加。CI に `sysml-integration` と `docker` ジョブ。
- `store-crash.test.ts` が壊れた meta の回帰を含む。viewer のクエリ付き回帰テストが追加された。

減点理由
1. **認証の迂回(B6)をテストが見逃している**。R2 で「権限のテストが素のパスのみ」と指摘したのに対し、クエリ付きの 5 経路だけを足した。テストの設計が「見つかった経路の再現」にとどまり、性質(任意の `/api` 表記で認証が必須)を検査していない。
2. **ドキュメントと実装の食い違い**: `.env.example` と `docs/operations.md` は `FUSAMOD_SYSML_CACHE` を「公式実装 jar の保存先」と説明するが、`config.ts` の `sysmlCacheDir` はどこからも使われていない(デッドな設定)。実際のキャッシュは `tools/sysml-check/lib.sh` の `SYSML_PILOT_CACHE`/`$HOME/.cache/...`。Dockerfile もこの無効な変数を設定している。`docs/operations.md` の「全 API にトークンが必要」は迂回により偽。
3. CI は実ランナー未実行(`docker` ジョブも)。`sysml-integration` はキャッシュなしで毎回約 120 MB を取得。`pnpm audit --prod` は新しい勧告で突然失敗しうる。Node の複数版のマトリクスなし。
4. 画面コンポーネントの単体テストなし。server は行 83.5% で `main.ts` は計測外。
5. `ProjectStore`(398 行)が検証・ロック・履歴・監査・参照・提案を担う。`app.ts`(347 行)に AI の承認の業務ロジックがある。パッケージが `main: ./src/index.ts`(TS ソース直公開)。

外部確認待ち減点 4: CI が実ランナーで通ることの確認、第三者によるコードレビュー。

優先して直す点
1. `apps/server/test/api.test.ts`: 認証の性質ベース/表駆動テスト(B6 の 2)。
2. `config.ts`: `sysmlCacheDir` を `JavaSysmlService` に渡して `SYSML_PILOT_CACHE` として子プロセスの環境に設定する(またはドキュメントと Dockerfile から削除)。
3. `.github/workflows/ci.yml`: 実ランナーで実行し、結果を `docs/quality/evidence` に残す。`sysml-integration` にキャッシュ、`docker` ジョブで Java 経路(`FUSAMOD_SYSML=java`)も確認。
4. `projects.ts` の保存層とサービス層の分離、コンポーネントのテスト。

### B8. 移植性 — 採点 80 / 外部確認待ち減点 4(合否点 84)

実測で確認できた良い点: `pnpm deploy --legacy` の出力は `<dir>/node_modules`(中身は相対 symlink)で、Dockerfile の `COPY --from=build /deploy/node_modules ./apps/server/node_modules` と整合する。この配置で `node apps/server/dist/server.mjs` が起動し、`REPO_ROOT` は `/app/pnpm-workspace.yaml` を見つける設計どおり動作した(スナップショット方式)。`libs/` の追加、ロックからの依存固定、`PORT` の検証、`HOST` の判定(`::1`/`localhost`)、`FUSAMOD_WEB_DIST`/`FUSAMOD_PROJECTS` の外部化、`HEALTHCHECK`(curl)と `USER 1000`、`/data` の chown は妥当。

減点理由(Dockerfile を精読。ビルド・起動は未実行のため、以下は推論を含む)
1. **コンテナ内で Java 経路(公式 SysML)が起動しない可能性が高い**: Dockerfile は `FUSAMOD_SYSML_CACHE=/data/.sysml-cache` を設定するが、この変数は誰にも使われない(B7 の 2)。`lib.sh` は `${SYSML_PILOT_CACHE:-$HOME/.cache/fusamod/...}` を使い、`USER 1000` が `/etc/passwd` に無いイメージでは Docker は `HOME=/` を与えるため、キャッシュ先が `/.cache/...`(書き込み不可)になり、`set -u`/`mkdir -p` で失敗する。`auto` モードでは snapshot に縮退するが、保存済みモデル以外を解析できず、Dockerfile の「Java 21 + 公式実装」の趣旨が成立しない。CI の `docker` ジョブは `FUSAMOD_SYSML=snapshot` で起動するだけで、この不具合を検出できない。
2. 不要な `npm` を `apt` で導入(jammy の古い `nodejs` を引き込み、イメージが重い)。`COPY` した Node 22 が PATH で先になるため動く見込みだが未検証。`pnpm`/`corepack` はビルド段のみで問題なし。
3. デモプロジェクト(`projects/`)が入らず、`/data` は空で起動する(UI の初期状態は空のプロジェクト一覧)。
4. `lib.sh` の実行時 `pip install --user zstandard`(`zstd` 無し時)が残る。Dockerfile は `zstd` を入れるので影響は小さいが、オフライン用の手順が具体的でない。bash 専用で、Windows/macOS は未検証。
5. CI は Ubuntu・Node 22 のみ。Docker のビルド/起動は実ランナー未実行。公式 SysML 実装は初回にネットワークが必須(jar を含めない方式)。

外部確認待ち減点 4: 他の OS・コンテナ・オフライン環境での設置確認(Docker ビルドを含む)。

優先して直す点
1. `Dockerfile`: `ENV SYSML_PILOT_CACHE=/data/.sysml-cache HOME=/data`(または `config.ts` から子プロセスに渡す)。`apt` の `npm` を削除。`docker run` で `FUSAMOD_SYSML=java` の解析まで CI で確認。
2. `config.ts`/`java-service.ts`: `sysmlCacheDir` を実際に使う。
3. `lib.sh`: 実行時の `pip install` をやめ、前提の確認とエラー文に。
4. CI に Node 22/24 のマトリクス、Docker の実ランナー実行。

### (参考)A1 機能要件 — 見立て 86 / 外部確認待ち 5

R2 の対応(分解の循環/導出検査、ID 重複、非公式 AP の明示、`satisfy` の連鎖、`modelRef`、影響分析の方向性など)に対応するテストが通ることを確認(safety-core 103、sysml-graph 27、scdl 50、analysis 49)。AI の別承認者と来歴は実測で動作を確認。残る欠落(AIAG-VDA の 7 ステップ、SPFM/LFM/PMHF、図上の編集、SysML v2 API/XMI など)は `plan.md` と対応文書に未対応として明記されている。専門家観点の判定は別途。

## 4. ラウンド 2 の指摘 → ラウンド 3 の検証

| R2 の指摘 | 判定 | 根拠 |
|---|---|---|
| viewer がクエリ(`?x=/analyze`)で書き込める | 修正を確認(ただし**同根の新たな迂回**) | クエリ・`#`・大文字・パス末尾のエンコードは 403。**だが `/%61pi/` で認証ごと迂回(新規・重大)** |
| 最新 `meta.json` が壊れると保存が恒久 500 | 修正を確認 | 壊した後の PUT が 200(版番号はディレクトリ最大値+1)。ただし GET が壊れた版を無警告で捨てる |
| 初回保存前の内容が履歴に残らない | 修正を確認 | `ensureBaseline`(コード+テスト) |
| 履歴の自動削除が監査に残らない | 修正を確認 | `history.prune`(コード確認) |
| Dockerfile に `libs/` が無い | 修正を確認 | `COPY libs`(Dockerfile) |
| Dockerfile の依存がロック外 | 修正を確認 | `pnpm deploy --legacy` を実行し、出力配置と起動を実測 |
| Dockerfile の `npm` を `apt` で導入 | 未修正 | 残る |
| (新)Dockerfile の `FUSAMOD_SYSML_CACHE` が無効 | **新規の欠陥** | 変数が未使用、`HOME` 未設定でキャッシュ先が書けない見込み |
| PORT の検証 / HOST の判定 | 修正を確認 | `config.ts`/`main.ts` |
| 静的資産の `immutable` | 修正を確認(コード) | `app.ts`。圧縮は未対応 |
| `PUT /model` のサイズ検査が解析後 | 未修正 | |
| `findGraphByModelHash` が O(n) | 未修正 | |
| viewer の UI がない | 修正を確認(コード) | `/api/me`、バッジ、保存ボタン無効化。E2E なし |
| 提案者と承認者の分離 | 修正を確認 | `FUSAMOD_AI_SEPARATE_APPROVER`、実測で 403/200。ただし迂回経路で無効 |
| AI 由来の印 | 修正を確認 | `aiChanges`、監査ログ |
| 非公式 AP 表が「設定済み」と表示される | 修正を確認 | FMEA 画面のバナー(スクリーンショット 01)、E2E |
| 監査ログに GET・認証失敗・エクスポートなし | 未修正 | |
| `trustProxy` の設定 | 未修正 | |
| `proposals.json` 破損で 500 | 未修正 | 実測で 500 |
| 手編集の `model.sysml` が無警告で巻き戻る | 未修正 | 実測 |
| `create` / 確定と監査が別処理 | 未修正 | |
| コンポーネントの単体テストなし | 未修正 | |
| SCDL 図の文字が小さい/切れる | 未修正(実質) | スクリーンショット 06 |
| 解析パネルの欠け(FMEA の列、安全コンセプトの表) | 一部 | HARA は収まった。FMEA/コンセプトは残る |
| CI が実ランナーで未実行(`docker` ジョブ追加) | 一部 | ジョブは追加。未実行 |
| 脅威モデル文書なし | 未修正 | |
| `operations.md` の viewer/トークン記述が実態と異なる | **まだ偽**(迂回経路) | R2 のクエリは解消したが、`/%61pi` で依然として偽 |

## 5. 合否判定と次の優先修正

合格: A2(92)、B2(91)、B4(93)。不合格: **B6(58、採点 52 で 80 未満)**、B5(88)、B7(88)、B8(84)。

1. **B6(最優先、リリース阻害)**: `apps/server/src/app.ts` の認証フックを、正規化後のパス/ルート定義またはスコープ登録で適用する。`/%61pi/...` と `/a%70i/...` の回帰テスト(トークン無し・viewer・editor、全メソッド)。修正後に、同じ探索(エンコード・二重スラッシュ・大文字小文字・メソッド上書き)を再実施。
2. **B8**: `Dockerfile` の `SYSML_PILOT_CACHE`/`HOME` と `config.ts` の `sysmlCacheDir` の接続。`npm` の `apt` 導入の削除。CI の `docker` ジョブで Java 経路も確認。
3. **B5**: 壊れた履歴の検出・警告・隔離、手編集の巻き戻しの警告、`proposals.json` の回復。
4. **B7**: 認証の性質ベースのテスト、ドキュメントとコードの一致(`FUSAMOD_SYSML_CACHE`)、CI の実ランナー実行の記録。
5. **A2/B4**: 解析パネルの高さと列、SCDL 図の可読性、viewer UI の E2E。
6. **B2**: 圧縮、PUT のサイズ検査の前倒し。

## 6. 外部確認待ち一覧(誰が・何を)

| 項目 | 実施者 | 内容 |
|---|---|---|
| A2 / B4 | 実利用者(安全担当・MBSE 担当) | 画面・操作性の評価、タスク達成の観察、支援技術での手動アクセシビリティ検査 |
| B2 | 運用担当 | 実プロジェクト規模・同時利用での負荷試験 |
| B5 | 運用担当 | 数週間の連続運転、障害注入(ディスク・ネットワーク) |
| B6 | 第三者のセキュリティ専門家 | 侵入試験、TLS 終端を含む運用構成の確認(今回の迂回は第三者を待たずに見つかった。修正後の再試験を含める) |
| B7 | 開発担当 / 第三者 | GitHub 実ランナーでの CI の実行、第三者によるコードレビュー |
| B8 | 開発担当 | Docker ビルド・起動(Java 経路を含む)・他 OS・オフライン環境での設置確認 |
