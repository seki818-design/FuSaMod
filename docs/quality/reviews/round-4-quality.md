# ラウンド 4 品質レビュー(A2 / B2 / B4 / B5 / B6 / B7 / B8、A1 は参考。重点: セキュリティ)

レビュー担当: 独立・厳格な品質レビュー担当(ISO/IEC 25010 の観点を使う模擬レビューであり、認証機関ではない)
対象: `/home/user/FuSaMod`(HEAD fc565e6、作業ツリーはクリーン)/ 実施日: 2026-10-03
方針: `docs/quality/rubric.md` に従う(証拠主義、未検証は減点、外部確認待ち減点は別枠で最大 10)。ラウンド 3 の対応文書は信用せず、すべて再実行した。リポジトリのソースは変更していない(E2E の実行でスクリーンショットが再生成されるが、`git status` は差分なし)。
確認用サーバーは、スクラッチ領域の `projects/` のコピー(`FUSAMOD_PROJECTS`)、ポート 8941/8942、`FUSAMOD_TOKENS=alice:…(editor),bob/viewer:…,carol:…`(いずれも 16 文字以上)で、**ビルド済みの `apps/server/dist/server.mjs` を実 HTTP(生ソケットで要求行を直接送信)で**試験した。終了済み(PID 指定の `kill` のみ。`pkill -f` は不使用)。

## 0. 採点サマリー

| 項目 | R3 採点 | R4 採点 | 外部確認待ち減点 | 合否点 | 採点 80 以上 | 判定(合否点 90 以上かつ採点 80 以上) |
|---|---|---|---|---|---|---|
| A2 画面・UX 要件 | 87 | **86** | 5 | 91 | 〇 | **合格** |
| B2 性能効率性 | 87 | **87** | 4 | 91 | 〇 | **合格** |
| B4 使用性 | 85 | **85** | 8 | 93 | 〇 | **合格** |
| B5 信頼性 | 85 | **88** | 3 | 91 | 〇 | **合格** |
| B6 セキュリティ | 52 | **82** | 6 | 88 | 〇 | **不合格(88)** |
| B7 保守性 | 84 | **85** | 4 | 89 | 〇 | **不合格(89)** |
| B8 移植性 | 80 | **84** | 6 | 90 | 〇 | **合格(境界。Docker 未実行が前提)** |
| (参考)A1 機能要件 | 86 | **87** | 5 | 92 | 〇 | 境界(専門家レビューは別途) |

**最重要の所見(B6)**: ラウンド 3 の認証の完全な迂回(`/%61pi/...`)は、**ビルド済みサーバーに対する実 HTTP で、修正を確認した**。トークン無し・viewer の両方で、約 3 万 4 千件の変形リクエスト(後述)から、認証・権限の逸脱は 1 件も見つからなかった。修正は、生の URL ではなく正規化パスとルーターが選んだルートの両方で既定拒否にしており、方針は適切。
残る問題は迂回そのものではなく、(1)`onSend` の `Cache-Control: no-store` と SPA フォールバックが**生の URL の `startsWith("/api/")` のまま**(同根の取り残し。実測で `/%61pi/...` の応答に `no-store` が付かない)、(2)ラウンド 2・3 から**繰り返し指摘された未修正事項**(`trustProxy`、監査対象の拡大、脅威モデル)、(3)回帰テストが `app.inject` と 1 本の経路(`/projects`)・「2xx でなければ可」という弱い検査にとどまること。
B6 と B7 が不合格(88、89)。他は合格。

## 1. 実行した検証(コマンドと結果)

| コマンド | 結果 |
|---|---|
| `pnpm typecheck` | 7 プロジェクトすべて成功 |
| `pnpm lint` | 出力なし(エラー 0・警告 0) |
| `pnpm -r test` | safety-core 116、sysml-graph 32、scdl 50、analysis 50、web 19、ai 29、server 46(+ 3 スキップ)すべて成功 |
| `pnpm coverage` | 最小の行カバレッジ 84.25%(server)。他は 96.95〜98.85%。分岐 80.2〜90.69%。しきい値 80% |
| `pnpm bench` | N=100/1000/5000 で一括解析 7/125/464 ms、構造図レイアウト 1/42/646 ms、予算内 |
| `pnpm audit --prod` | `No known vulnerabilities found` |
| `pnpm build` → `cd apps/web && pnpm e2e` | **22 件すべて成功**(40.7 秒。axe の dark/light、狭い画面、認証ダイアログ、非公式 AP の明示を含む。viewer 用 UI の E2E は無い) |
| `FUSAMOD_IT=1 pnpm --filter @fusamod/server test` | **1 回目: 1 件失敗**(`store-crash.test.ts`「保存の所要時間が履歴の増加で悪化しない」が 5000 ms のタイムアウト。ほかのテストと並行して負荷が高い状態)。単独で 3 回再実行したところ 49 件すべて成功(Java 結合 3 件を含む)。**負荷で落ちる不安定なテスト**(B7) |
| `pnpm --filter @fusamod/server build` | `dist/server.mjs`(1.19 MB)を生成。起動して以下の試験に使用 |
| Java モードの配線 | `FUSAMOD_SYSML=java FUSAMOD_SYSML_CACHE=<コピーした公式実装のキャッシュ> HOME=/nonexistent-home` でバンドル版を起動 → `POST …/analyze` が `modelOk:true`、子プロセスの引数が指定したキャッシュを指すことを確認(R3 の「`FUSAMOD_SYSML_CACHE` が無効」は解消。`HOME` が書けなくても動く) |
| Docker | デーモンが無いため未実行。Dockerfile と CI の `docker` ジョブを精読(後述 B8) |
| CI | GitHub の実ランナーでの実行は未確認 |

## 2. セキュリティの再探索(バンドル版・実 HTTP。2.3 以外は同一の手順)

生ソケットで要求行を直接送る試験器を作成し(`app.inject` ではなく Node の HTTP 解析を通す)、接続元を 127.0.0.x で変えて認証失敗の制限(429)を避けた。

### 2.1 経路の変形(トークン無し / viewer)

| 試験 | 結果 | 評価 |
|---|---|---|
| `/%61pi/projects`、`/a%70i/projects`、`/%41PI/…`、`/API/…`、`/api/%70rojects`、`/%2561pi`、`/%252561pi`(二重・三重エンコード) | トークン無し: すべて **401**。viewer: 正しい経路は 200、到達しない綴りは SPA か 404 | **修正を確認** |
| `//api/…`、`///api`、`/./api`、`/api/./projects`、`/x/../api`、`/x/%2e%2e/api`、`/%2e/api`(ドットセグメント) | トークン無し: 401 または 403(不正)。データ到達なし | 良 |
| `;` パラメータ(`/api/projects;x=1`、`/api;x=1/projects`、`/api/health;x`)、末尾ドット(`/api./`、`/api/projects.`)、バックスラッシュ(`/api\projects`)、`%00`、`%2f`(`/api%2fprojects`)、`%c0%ae`、不正な `%zz`、制御文字 | 認証が必要な綴りは 401。`/api;x=1/projects` と `/api./projects` は SPA の `index.html`(データなし)。不正な % は 400。**すべてデータ到達なし** | 良 |
| `/api/health/../projects`、`/api/health/%2e%2e/projects`、`/api/health%2f..%2fprojects`、`/api/healt%68/../projects`(health 経由の迂回) | 401 | 良 |
| 絶対 URI の要求行(`GET http://evil/%61pi/projects`、`GET http://127.0.0.1/api/projects`、`GET http://evil/api/health/../projects`) | 401 | 良 |
| `GET *`、`OPTIONS *`、`TRACE`、`PROPFIND`、`CONNECT`、HTTP/1.0 | データ到達なし(SPA 200 / 401 / 404 / 空) | 良 |
| `HEAD /api/projects`、`HEAD /%61pi/projects`(トークン無し) | 401 | 良 |
| `OPTIONS /api/…`(トークン無し) | 204(本文なし。CORS ヘッダなし) | 良(情報なし) |
| **網羅試験(トークン無し)**: `api` の各文字を `%xx`/`%XX`/`%25xx`/大文字にした変形 × 7 つの API パス × 7 つの接尾の変形 = **1,992 件** | 401 が 1,590、403 が 318、400 が 56、200 が 28(**200 はすべて SPA の `index.html` か `/api/health`**。データの漏えい 0 件) | **良** |
| **網羅試験(viewer)**: 書き込み 7 経路(作成、モデル、安全データ、復元、AI チャット、提案の承認・却下)× 綴りの変形 × 接尾 11 種 × メソッド上書きヘッダ 4 種(`X-HTTP-Method-Override: GET` など)= **28,688 件** | 403 が 28,552、404 が 88、400 が 48。**書き込み成功 0 件**。作成されたプロジェクトは editor が作った 1 件のみ(`ls` で確認) | **良** |
| メソッド上書き(`X-HTTP-Method-Override`、`X-Method-Override`、`X-HTTP-Method`) | 無視される | 良 |
| `Host: evil.com`、`127.0.0.1.`、`[::1]`、`X-Forwarded-For/Host/Proto`、`X-Real-IP`、`X-Original-URL`、`X-Rewrite-URL`、`Forwarded` | 認証は迂回できない(401)。health だけ 200 | 良 |
| `Authorization`: `Bearer`(空)、`Basic …`、末尾に 1 文字足したトークン、1 文字足りないトークン、2 つのトークンのカンマ連結、タブ | すべて 401。`bearer`(小文字)と複数スペースは受理(無害) | 良 |
| 長い URL | 20 kB: 431、100 kB: 接続切断、`%61`×5000: 403、`%25`×2000: 400(「不正な URL」)、`../`×3000: 401 | 良(DoS なし) |

### 2.2 全ルート × 役割の表(実測。ev-powertrain)

匿名 / viewer / editor。GET の `health` は全員 200。`/api/me`、`projects`(一覧)、`projects/:id`、`analyze`、`refs`、`history`、`history/1`、`audit`、`export/*`(`fmea.csv`、`model.sysml`、`analysis.json`、`scdl.sysml`)、`ai/proposals`: **匿名 401 / viewer 200 / editor 200**。
`POST /projects`、`PUT …/model`、`PUT …/safety`、`POST …/history/1/restore`、`POST …/ai/chat`、`POST …/ai/proposals/:pid/{apply,reject}`、`DELETE`/`PATCH`/`PUT /projects/:id`: **匿名 401 / viewer 403 / editor 200・201・404・409(業務エラー)**。`POST …/analyze/`(末尾スラッシュ)は viewer・editor ともに 404(許可もされず到達もしない)。
→ 実装とドキュメント(「閲覧者は読み取りと解析のみ」)が一致。viewer が読める範囲に**監査ログ(AI への質問文を含む)とエクスポートが含まれる**点は仕様どおりだが、脅威モデルの文書が無く、意図が確認できない。

### 2.3 入力検証・トラバーサル

| 試験(editor) | 結果 |
|---|---|
| プロジェクト ID: `..`、`%2e%2e`、`..%2f..%2fetc`、`ev-powertrain%2f..%2f..`、`EV-Powertrain`、`%00`、`.history`、65 文字 | すべて 400(ID の形式検査) |
| 作成時の ID: `../x`、`a/b`、`-x`、`a b`、`a\b`、`a%2fb`、`.`、`a.b`、`__proto__` | 400。`x-`、`con`、`aux`、`constructor`、64 文字は 201(Linux では無害。Windows の予約名は未対応で移植性の軽微な弱点) |
| リビジョン: `..%2f..%2fmeta`、`-1`、`1.5`、`%2e%2e` | 400。`1e3`、`0x1` は数値に変換される(無害) |
| エクスポート名: `..%2f..%2fsafety.json`、`..`、`audit.jsonl`、`%00`、`fmea.csv%00` | 404(許可リストの `switch`) |
| `?element=../../x`、`element[]=a` | 200(CSV の絞り込みのみ。ファイルは開かない) |
| 提案 ID: `..%2f..%2fx`、`__proto__`、`constructor`、`%00`、`x'` | 404(ファイルを開かない) |
| 本文: `__proto__` を含む JSON、不正 JSON、`text/plain`、`x-www-form-urlencoded` | 400 / 415。`.strict()` で拒否 |
| 6 MB の本体 / 2.1 MB の文字 | 413 / 400(解析の前) |
| 静的配信: `/assets/..%5c..%5cetc/passwd`、`/assets/%2e%2e/…/etc/passwd`、`/..%2f..%2fetc/passwd`、`/projects/ev-powertrain/model.sysml`、`/audit.jsonl`、`/.history` | 403 または SPA の `index.html`。**プロジェクトのデータは SPA フォールバック経由で漏れない** |
| CORS(`FUSAMOD_CORS_ORIGIN` 未設定)の `Origin: http://evil.com` | `Access-Control-*` ヘッダなし(CORS 無効) |

### 2.4 その他

| 試験 | 結果 | 評価 |
|---|---|---|
| トークンのタイミング(各 300 回の中央値): 先頭 1 文字違い 637 / 524 µs、末尾 1 文字違い 583 / 530 µs、長さ違い 589 µs | 差は揺らぎの範囲。SHA-256 後の `timingSafeEqual`、全件を比較する実装 | 良 |
| 認証失敗の制限(10 回/分/IP)、有効トークンは失敗回数に影響されない | 前回と同じ | 良 |
| **`Cache-Control: no-store`**: `/api/projects` は付く。**`/%61pi/projects`(editor の正しい認証付き)の応答には付かない** | `onSend` が生の `req.url.startsWith("/api/")` のまま。R3 で指摘した同根の取り残し | **欠陥(軽微)**。プロキシのキャッシュに API の応答が残りうる。SPA フォールバックの `!req.url.startsWith("/api/")` も生の URL(`/%61pi/…` は未認証でも `index.html` が返るだけで害はない) |
| `trustProxy`、監査の範囲(GET・認証失敗・エクスポート)、脅威モデルの文書 | **R2・R3 から未修正**(`grep trustProxy` はコード・ドキュメントに 0 件) | 弱い |
| 失敗用の制限器(`Map`)は、IP ごとの記録を削除しない | 多数の IP で増え続ける(アクセスのたびに自分のキーだけを整理)。軽微なメモリ増加 | 軽微 |
| ソースマップ(1 MB)が `/assets/*.map` で公開される | 情報として軽微 | 軽微 |

## 3. 信頼性の再探索(バンドル版・実 HTTP)

| 試験 | 結果 | 評価 |
|---|---|---|
| 最新リビジョンの `meta.json` を壊す(`{bad`) | `GET` は 200 で、**`notice`**「…壊れた履歴があります(000003): 最新の有効なリビジョンから続けます」を返す。壊した後の `PUT` は 200、版は 4(ディレクトリ最大値+1)。`history` は `[4,2,1]` | **改善**(R3 の無警告の巻き戻しは通知される)。ただし壊れた版は**隔離されず**、通知が恒久的に出続ける |
| すべてのリビジョンの `meta` を壊す | revision 0 で読め、`PUT` は 200(版 4)。通知あり | 良 |
| `model.sysml` に `// HAND` を手で追記 | 履歴の版に戻り、`notice`「ファイルを直接書き換えた場合、その変更は反映されません」 | 通知は付いた。**ただし手編集の内容は失われる**(取り込み・退避の手段なし。`docs/operations.md` には記載あり) |
| `safety.json` を壊す / `model.sysml` を空にする / `model.graph.json` を削除 | 200 で履歴から回復(通知つき) | 良 |
| **`proposals.json` を壊す** | 200 で `{"proposals":[]}`。`proposals.json.corrupt-<時刻>` に退避、監査ログに `system:proposals.corrupt` | **修正を確認** |
| `audit.jsonl` に不正行を追記 | `GET …/audit` は 200、`chain: {ok:false, brokenAtLine:6}`。以降の `PUT` も 200 | 良(破損を検出して続行) |
| 同じ ID の作成を 12 並列 | 201 が 1、409 が 11、履歴 1 件、監査 1 行 | 良(R3 の「作成の競合」は再現せず) |
| UI での通知 | `store.ts` が `notice` をトースト(`toast("error", …)`)で出す。**一過性の表示**で、E2E は無い | 弱い(画面を見逃すと気づけない) |

## 4. 項目別レビュー

### B6. セキュリティ — 採点 82 / 外部確認待ち減点 6(合否点 88)

**確認できた良い点(実測)**: 認証の迂回の修正(2.1〜2.2。約 3 万 4 千件で逸脱 0)。判定の設計(正規化したパスとルート定義の両方、既定拒否)。viewer の全書き込み経路の拒否(メソッド上書きを含む)。パストラバーサルの多重防御(ID の形式、許可リスト、`.strict()`)。CSV インジェクション対策、CSP、定数時間のトークン比較、認証失敗の 429、AI の別承認者、依存の脆弱性 0 件、`proposals.json` の回復。

減点理由
1. **生の URL による判定が 2 か所に残っている**(`onSend` の `no-store`、SPA フォールバック)。認証の根本は直ったが、同じ種類の欠陥(「判定を生の文字列で行う」)を R3 の指摘後も取りこぼした。`/%61pi/` 経路の応答に `no-store` が付かないことを実測。
2. **`trustProxy` 未対応(R2 から 3 回連続の指摘)**。リバースプロキシ背後では全員が同一 IP と見なされ、認証失敗の制限(10 回/分)が全員で共有され、監査・制限の利用者特定ができない。`FUSAMOD_TRUST_PROXY` の設定もドキュメントも無い。
3. **監査ログの範囲**: 認証失敗、GET、エクスポート、履歴の削除は記録されない(R2 から未修正)。無鍵のハッシュ連鎖で末尾削除・全面再計算を検出できない(明記あり)。
4. **脅威モデルの文書なし**(R2・R3 の指摘が未対応)。viewer に監査ログやエクスポートを許す方針の根拠が文書で確認できない。
5. **回帰テストの設計が弱い**: 表駆動テストは `app.inject` のみで、実 HTTP の解析(絶対 URI、`\`、不正 %)を通らない。検査は「2xx でなければ可」で 401 を要求せず、`/projects` 以外の経路(`export`、`audit`、`me`)・editor の網羅・`no-store` を見ない。
6. トークンは環境変数の平文でローテーション・失効なし。TLS はプロキシ前提。CSP が `style-src 'unsafe-inline'`。`/api/health` は無認証で構成を返す。制限器の `Map` が増え続ける。ソースマップの公開。
7. 第三者の侵入試験なし(外部)。

外部確認待ち減点 6: 第三者による侵入試験(今回の修正後の再試験を含む)、TLS 終端を含む運用構成の確認。

優先して直す点
1. `apps/server/src/app.ts`: `onSend` の `no-store` とフォールバックの判定を `normalizedPath` に揃える(または API を `register(..., {prefix: "/api"})` のスコープにして、フックを 1 か所にする)。
2. `apps/server/src/config.ts`、`app.ts`: `FUSAMOD_TRUST_PROXY` → `Fastify({ trustProxy })`、`docs/operations.md` と `.env.example` に記載。制限器のキーにトークンの接頭辞を併用し、古いキーを定期的に消す。
3. `apps/server/src/app.ts`: 認証失敗(IP・URL の経路のみ。トークンは記録しない)、エクスポート、履歴の削除を監査へ。可能なら HMAC か外部アンカー。
4. `docs/security.md`(新規): 脅威モデル(資産、攻撃者、viewer が読める範囲、TLS・プロキシの前提、鍵の運用)。
5. `apps/server/test/api.test.ts`: 全ルート × {匿名, viewer, editor} の表(R3 の 2.2 の表をそのまま)、`401` の厳密な期待、`no-store` の検査。可能なら実ポートで `node:net` の生リクエスト(絶対 URI、`\`)の試験を追加。

### B5. 信頼性 — 採点 88 / 外部確認待ち減点 3(合否点 91)

実測で確認した改善: 壊れた履歴の `notice`、`proposals.json` の退避と監査記録、`meta` を壊しても保存が継続、現在のファイルの欠損・破損からの回復、並行作成の排他、並行保存、Java 無しでの縮退。

減点理由
1. **壊れた履歴が隔離されない**: 通知は恒久的に出続け、再起動・復元以外に解消できない。`.history/<n>.corrupt` への退避、または「修復」操作が必要。
2. 手編集の `model.sysml` は通知されるが、**内容は失われる**(退避・取り込みなし)。
3. `notice` の表示は一過性のトースト。E2E なし。
4. 版の確定と監査の追記が別処理(間で落ちると版だけ残る)。ロックはプロセス内のみで、複数プロセスで同じ `FUSAMOD_PROJECTS` を使う制約がドキュメントにない。
5. 保存時間のテストが負荷下で不安定(1 回失敗)。
6. 障害注入(ディスク満杯、権限)は未検証。

外部確認待ち減点 3: 実運用での長期稼働、実ディスク・実ネットワーク障害での確認。

優先して直す点: `projects.ts` で壊れた版を `.corrupt` へ退避(監査記録)、読み込み時に手編集の内容を `.history` へ「取り込み」版として残す選択肢、`operations.md` に単一プロセスの制約、`store-crash.test.ts` のタイムアウト緩和または比率の計測方法の見直し。

### B7. 保守性 — 採点 85 / 外部確認待ち減点 4(合否点 89)

良い点: 型・lint(警告 0)、単体 約 340 件、結合 3 件、E2E 22 件、カバレッジのしきい値と CI、ADR 9 本、`safety-notes.md`、`FUSAMOD_SYSML_CACHE` の配線(実測)。

減点理由
1. **セキュリティの回帰テストが弱い**(B6 の 5)。R3 で「性質を検査せよ」と指摘したのに対し、綴り 11 種 × `/projects` のみ。
2. **不安定なテスト**: `FUSAMOD_IT=1` の実行で 1 件がタイムアウトで失敗(単独実行では 3 回成功)。CI での偶発的な失敗の原因になる。
3. **ドキュメントとコードの食い違い**: `docs/quality/evidence/coverage.md` は「E2E(20 件)」と書くが、実際は 22 件。`.env.example` に `FUSAMOD_AI_SEPARATE_APPROVER` が無い(`safety-notes.md` にのみ記載)。`app.ts` に、対象の関数と無関係な孤立コメント(「読み取り専用の役割でも使える操作」が `normalizedPath` の説明の前に残る)。`docs/operations.md` は `notice`、`trustProxy`、単一プロセスの制約に触れない。
4. CI は実ランナー未実行(`docker` ジョブを含む)。`sysml-integration` はキャッシュなし。Node の複数版のマトリクスなし(外部)。
5. 画面コンポーネントの単体テストなし。server の `main.ts` は計測外。`ProjectStore`(422 行)が多くの責務を持つ。

外部確認待ち減点 4: GitHub 実ランナーでの CI の実行、第三者によるコードレビュー。

優先して直す点: 1) `api.test.ts` の網羅表と厳密な期待、2) `store-crash.test.ts` の安定化、3) `coverage.md` の件数を `coverage.mjs` で自動生成、`.env.example` の追記、孤立コメントの削除、4) CI の実行記録を `docs/quality/evidence` に保存、5) `ProjectStore` の分割。

### B8. 移植性 — 採点 84 / 外部確認待ち減点 6(合否点 90)

実測・確認できた点: `SYSML_PILOT_CACHE` の配線(`HOME` が存在しない環境でも、指定したキャッシュで Java モードの解析が成功)。`HOME=/data` と `FUSAMOD_SYSML_CACHE=/data/.sysml-cache` をボリュームに置く設計。`apt` の `npm` を削除。`zstd` を導入しているので実行時の `pip install` は通らない。`tools/sysml-check` の `serve.sh`/`lib.sh` は実行ビット付き(`git ls-files -s` で 100755)。`libs/`、`pnpm deploy --legacy`、`HEALTHCHECK`、`USER 1000`、`PORT`/`HOST` の検証。CI の `docker` ジョブが `FUSAMOD_SYSML` を既定のまま(`auto`)にして、**Java モードの解析(`modelOk:true`)まで確認**する設計に変わった。

減点理由(Dockerfile と CI は精読のみ。ビルド・起動は未実行)
1. Docker のビルドと起動は、この環境では検証できない。`node:22-bookworm-slim` から `node` 単体を `eclipse-temurin:21-jdk-jammy` へコピーする方式の互換性(glibc・libstdc++)は、推論では動く見込みだが未実測。
2. `python3-pip` は不要(`zstd` を入れているため)で、イメージが重い。
3. デモプロジェクトが入らず `/data` は空で起動する。`con`/`aux` などの Windows 予約名の ID を作成できる。
4. 初回に公式実装(約 120 MB)をネットワークから取得する必要がある。オフライン用の具体的な手順は未整備。bash 専用で Windows/macOS は未検証。
5. CI は Ubuntu・Node 22 のみ。`docker` ジョブはボリュームの永続化(再起動後のキャッシュ再利用)を確認しない。

外部確認待ち減点 6: Docker のビルド・起動(Java 経路を含む)、他 OS・オフライン環境での設置確認。

優先して直す点: 1) 実ランナーで `docker` ジョブを実行して結果を残す、2) `python3-pip` の削除、3) オフライン手順(事前配置したキャッシュを `/data/.sysml-cache` に置く方法)を `operations.md` に、4) Node 22/24 のマトリクス。

### A2. 画面・UX 要件の充足度 — 採点 86 / 外部確認待ち減点 5(合否点 91)

証拠: 1440x900 のスクリーンショット(`docs/quality/evidence/screenshots` の 01、05、06 を目視。E2E の撮影で再生成)。
- 良い点: ダークで統一、エクスプローラ・ビューペース(図/テキスト)・AI 対話・パズルビュー(4 視点 × 4 階層、記号つき)が揃う。図は 4 階層の入れ子と ASIL バッジが読める。SCDL 図は原寸表示(横スクロール)になり、文字が読める大きさになった(R3 の「約 6px」は解消)。非公式 AP のバナーがある。
- 残る問題: (1)解析パネルが低く、FMEA(01)は **RPN/AP の列が初期画面に出ない**(S/O/D の先で切れ、「機能」列が縦書きのように 1 文字ずつ折り返す)。(2)安全コンセプト(05)は「ペア」「分解」の表が 1 行しか見えず、入れ子のスクロールが多い。(3)SCDL(06)は原寸にしたことで、1 画面に収まらず全体像が把握できない(拡大縮小・全体表示の操作なし)。(4)AI 対話スペースは空のとき縦に余る。(5)図上のモデル編集なし。(6)画面コンポーネントの単体テスト・viewer UI の自動テストなし。

外部確認待ち減点 5: 実利用者(安全担当・MBSE 担当)による画面・操作性の評価。

優先して直す点: `styles.css`/`AnalysisTabs.tsx` で解析パネルの高さ配分と FMEA の列幅、`ScdlView.tsx` に全体表示/ズーム、viewer の E2E。

### B4. 使用性 — 採点 85 / 外部確認待ち減点 8(合否点 93)

証拠: axe の dark/light が成功、矢印キーのタブ移動、`Ctrl+S`、日本語のエラー、提案の承認制、確認ダイアログ、色以外の記号、`notice` のトースト。
減点: 画面の窮屈さ(A2)、`notice`(壊れた履歴・巻き戻し)が一過性のトーストで、永続の警告帯でない、オンボーディングなし、viewer の編集系ボタンの無効化が網羅的か未検証(E2E なし)、409/500 時の復旧導線が未確認。
外部確認待ち減点 8: 実利用者によるユーザビリティ評価、スクリーンリーダー等での手動検査。
優先: 警告帯への昇格、viewer の E2E、解析パネルの配分、初回の案内。

### B2. 性能効率性 — 採点 87 / 外部確認待ち減点 4(合否点 91)

証拠: `pnpm bench` N=5000 で一括解析 464 ms、構造図レイアウト 646 ms(予算内)。バンドル版の実測で `GET /api/projects/ev-powertrain`(88 kB)が中央値 7.2 ms、95 パーセンタイル 10.1 ms(200 回)、エクスポート 約 10 ms。PUT のサイズ検査は解析前に働く(6 MB は 413、2 MB 超は 400)ことを実測(R3 の指摘は解消)。`/assets/*` に `immutable`。
減点: 圧縮(gzip/br)なし(JS 356 kB を無圧縮で配信。`Accept-Encoding: gzip` でも `content-encoding` なしを実測)、`findGraphByModelHash` が O(プロジェクト数)、履歴 1 版ごとに全体を複製、API 経由の負荷試験なし、メモリ使用量の計測なし。
外部確認待ち減点 4: 実運用規模・同時利用での性能。
優先: `@fastify/compress`、`findGraphByModelHash` の索引、負荷試験。

### (参考)A1 機能要件 — 見立て 87 / 外部確認待ち 5

R3 の対応に対するテスト(safety-core 116、sysml-graph 32、analysis 50)が通る。AI の別承認者・来歴は R3 から変化なし。残る欠落(7 ステップ、SPFM/LFM/PMHF、図上の編集、SysML v2 API/XMI など)は対応文書に未対応として明記されている。専門家の判定は別途。

## 5. ラウンド 3 の指摘 → ラウンド 4 の検証

| R3 の指摘 | 判定 | 根拠 |
|---|---|---|
| `/%61pi/…` による認証・viewer・レート制限の完全な迂回 | **修正を確認(実 HTTP)** | 匿名 1,992 件・viewer 28,688 件の変形で逸脱 0、全ルート表を実測 |
| `onSend` の `no-store` が生の URL | **未修正** | `/%61pi/projects`(認証付き)の応答に `Cache-Control` なし |
| 表駆動の回帰テスト | 一部 | 追加されたが `inject` のみ・1 経路・「2xx でなければ可」 |
| `trustProxy`(`FUSAMOD_TRUST_PROXY`) | 未修正 | コード・文書に 0 件 |
| 監査ログに認証失敗・GET・エクスポートなし | 未修正 | |
| 脅威モデルの文書 | 未修正 | |
| 監査ログの無鍵ハッシュ連鎖 | 未修正(限界は明記) | |
| 壊れた最新リビジョンが無警告で捨てられる | 一部修正 | `notice` を返すことを実測。隔離なし、トースト表示のみ |
| 手編集の `model.sysml` が無警告で巻き戻る | 一部修正 | `notice` あり(実測)。内容は失われる |
| `proposals.json` 破損で 500 | **修正を確認** | 200、`.corrupt-<時刻>` に退避、監査記録 |
| `create` がロック外 | 実害は再現せず | 12 並列で 201 は 1 件のみ |
| 版の確定と監査の追記が別処理 | 未修正 | |
| `FUSAMOD_SYSML_CACHE` が無効(Dockerfile・文書) | **修正を確認** | `HOME` を存在しない場所にしても、指定したキャッシュで Java 解析が成功 |
| Dockerfile の `npm` の `apt` 導入 | **修正を確認(コード)** | Dockerfile から削除 |
| Docker 内で Java 経路が起動しない見込み | 修正(推論。実測不可) | `HOME=/data`、`FUSAMOD_SYSML_CACHE=/data/.sysml-cache`、CI の Java 解析確認。未実行 |
| `PUT /model` のサイズ検査が解析後 | **修正を確認** | 6 MB: 413、2 MB 超: 400(解析前) |
| 圧縮なし / `findGraphByModelHash` が O(n) | 未修正 | |
| SCDL 図の文字が小さい | 修正を確認(スクリーンショット 06) | 原寸+横スクロール。ただし全体把握が難しい |
| 解析パネルの欠け(FMEA の RPN/AP、安全コンセプト) | 未修正 | スクリーンショット 01、05 |
| viewer UI の E2E なし / コンポーネントのテストなし | 未修正 | |
| `operations.md` の「全 API にトークンが必要」が偽 | **解消** | 実測で真 |
| CI が実ランナーで未実行 | 未実施(外部) | |

## 6. 合否判定と次の優先修正

合格: A2(91)、B2(91)、B4(93)、B5(91)、B8(90。境界)。不合格: **B6(88)**、**B7(89)**。

1. **B6**(`app.ts`、`config.ts`、`docs/`): `no-store`/フォールバックを正規化パスに、`trustProxy`、監査の拡大、脅威モデル、網羅的な認証テスト(合否点は約 4〜6 点上がる見込み)。
2. **B7**(`api.test.ts`、`store-crash.test.ts`、`coverage.md`、`.env.example`): 認証テストの強化、不安定なテストの解消、文書とコードの一致。
3. **B5**: 壊れた履歴の隔離、`notice` の恒久表示。
4. **A2/B4**: 解析パネルの配分と FMEA の列、SCDL の全体表示、viewer の E2E。
5. **B8**: 実ランナーでの Docker ジョブ実行と記録、`python3-pip` の削除、オフライン手順。
6. **B2**: 圧縮、索引。

## 7. 外部確認待ち一覧(誰が・何を)

| 項目 | 実施者 | 内容 |
|---|---|---|
| A2 / B4 | 実利用者(安全担当・MBSE 担当) | 画面・操作性の評価、タスク達成の観察、支援技術での手動アクセシビリティ検査 |
| B2 | 運用担当 | 実プロジェクト規模・同時利用での負荷試験 |
| B5 | 運用担当 | 数週間の連続運転、障害注入(ディスク・ネットワーク) |
| B6 | 第三者のセキュリティ専門家 | 侵入試験(今回の迂回修正の再試験を含む)、TLS 終端を含む運用構成の確認 |
| B7 | 開発担当 / 第三者 | GitHub 実ランナーでの CI の実行、第三者によるコードレビュー |
| B8 | 開発担当 | Docker ビルド・起動(Java 経路を含む)、他 OS・オフライン環境での設置確認 |
