# ラウンド 8 レビューへの対応

（レビュアーはシミュレートした専門家で、認証機関ではありません。）

第 8 回の合否点: ISO（A1 91 / **B1 89** / C1 92）、MBSE（A1 95 / B3 92 / C2 95）、品質（A2 93 / **B2 89** / B4 95 / B5 90 / B6 92 / B7 90 / B8 90）。不合格は B1 と B2（各 1 点不足）。B5/B7/B8 は境界。

| 指摘 | 対応 | 証拠 |
|---|---|---|
| **ISO: `riskChanges` のテキスト差分が死んでいる（記述あり → 記述ありは両方 "(記述あり)" で捨てられる）。応答書の「独立性の変更も出る」は偽だった** | `text()` を、内容が変わったことを必ず記録（長さつき）、半分未満に弱める・消すのを `lowersRisk` に。独立性・安全状態・FMEA の管理策・HARA の根拠の書き換えが差分と監査ログ（`safety.diff`）に出る | ai/test（記述あり → 別の記述） |
| ISO: HW 欠落が目標単位・故障率 0 では無指摘、画面が緑 | 安全目標ごとに、関係する故障率が 0/無しなら `HW_METRICS_MISSING`。画面の「—」「算出不可」を警告色にし、目標別の未達があれば合算の緑を出さない。`totalFit` を丸めて表示 | safety-core/test、analysis/test |
| ISO: DC の貸し出し元（QM・ペア無しの機構）の検査が緩い | 機構が QM なら `HW_DC_MECHANISM_QM`（エラー）、ペアが無ければ `HW_DC_MECHANISM_UNPAIRED`（警告） | safety-core/test |
| ISO: 根拠文字列の穴（`n.a.`、`in progress`、`TBA`、`not yet`、`未実施`） | 追加（`analysis` の `na` を誤判定しないよう、語境界で判定） | safety-core/test |
| ISO: 意図機能の ASIL 付け替えの検出 | 前回の `requirementIds` 付け替えの差分（lowersRisk）に加え、記述の書き換えも差分化 | ai/test |
| **MBSE N8: 無関係な編集で `satisfy` の関係要素の ID が要求間で入れ替わる** | 名前の無い要素の鍵に、所有する要素・参照先・参照元の名前（深さ 2）を含める | 統合テスト（編集の前後で `satisfy` の ID → 要求名が不変） |
| **MBSE N9/N10b: 例 9 件中 2 件で 2 回の出力が不一致、JSON と XMI でライブラリ ID が食い違う、SCDL を含む XMI の href が毎回変わる** | ライブラリ要素（変換器の UUID v5）の ID は置き換えない。出力に含まれない要素への参照は参照元から決定的な ID に。署名に参照元の署名も取り込む。SCDL の定義は変換するファイルの先頭に取り込み、出力 JSON が自己完結に | 統合テスト（同梱の例すべてでバイト一致） |
| MBSE N10: 利用者の `@Scdl*` が黙って無視される。ADR-0007 の「本番の読み込み経路」は事実と異なる | `SCDL_ANNOTATIONS_NOT_IMPORTED` で警告。ADR-0007 を実態（ライブラリ関数。アプリの解析経路では呼ばない）に訂正 | analysis/test、docs |
| MBSE: 変換器自体のタイムアウトが 503 | 504（`SysmlTimeoutError`）に統一 | fake-processes.test.ts |
| MBSE: `[RFC]` と書くだけで単位系ライブラリを読み込み、変換が 25 秒以上 | 単位系は、`ISQ::` などの import または数値の後ろの `[単位]` のときだけ追加 | convert.sh |
| **品質: 重い解析の失敗が記憶されず、開くたびに共有 JVM を長く占有する** | タイムアウトしたモデルは 5 分間、同じハッシュを再解析しない（モデルを変えれば再試行）。待ちの上限（前回追加）と合わせて占有を抑える | fake-processes.test.ts |
| 品質: `/analyze`・`GET project`・`PUT model` でタイムアウトなどが 200 + 文言のみ | 応答に機械可読の `sysmlFailure`（`timeout`/`unavailable`/`busy`）を追加 | api |
| 品質: 起動時の掃除が、同じユーザーの別インスタンスの変換中ディレクトリを消す | 10 分より古いものだけ掃除（変換のタイムアウトは 3 分） | main.ts |
| 品質: `pnpm bench`/`pnpm coverage` が追跡ファイルを書き換える | 書き込みは `--write`（`pnpm evidence`）のときだけ | tools/quality |
| 品質: ルートの `pnpm build` が `dist/server.mjs` を作らず、古い dist で 500 | ルートの build が web とサーバーの両方を作る | package.json |
| 品質: `SIGTERM` が進行中の重い解析の完了を待ち、約 63 秒かかる | 先に Java を止めてから HTTP を閉じる | main.ts |

## 未対応（報告に残す）
- viewer の画面で、追加ボタンが有効のまま（押すとクライアントの検査とサーバーが拒否する。入力欄は CSS で無効化）。
- SCDL の幅合わせ表示は文字が小さい（「原寸で表示」で切り替え）。
- 再定義と組み合わせた定義内 `satisfy`（N7b）、`verify`/`derive` の無警告の脱落、無名 `allocate` の警告文言。
- 取り込み（JSON/XMI/API）、port・connection・allocation・state の導出、PMHF、FMEA-MSR の集計、7 ステップ。
- テストが `/tmp/fusamod-*` を残すことがある。実ランナーでの CI、Docker のビルドは未実施。AP 表は非公式のおもちゃ。故障率は利用者の入力。
