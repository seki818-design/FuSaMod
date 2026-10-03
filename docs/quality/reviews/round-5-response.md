# 第 5 回レビューへの対応(要約)

第 5 回の合否点: ISO(A1 86 / B1 89 / C1 90)、MBSE(A1 93 / B3 88 / C2 92)、品質(A2 90 / B2 89 / B4 92 / B5 89 / B6 86 / B7 88 / B8 90)。

| 指摘 | 対応 | 証拠 |
|---|---|---|
| `FUSAMOD_TRUST_PROXY` が機能しない(Fastify は数値を無視) | ホップ数を関数で渡す。`true` も 1 段。未設定・`true`・`1` の実際の ip をテスト | server/test/api.test.ts |
| 復元で `aiChanges` が消える / 追記で偽の来歴を書ける | 復元は現在の `aiChanges` を引き継ぐ。保存では**完全一致のみ**許可(サーバーだけが書く) | 同上 |
| 標準形式エクスポート: 同時実行・タイムアウトで JVM が残る | 同時 2 件・待ち 4 件(超過は 429)、プロセスグループごと停止、起動時と変換前に一時ディレクトリを掃除 | server/test/fake-processes.test.ts |
| 誤りのあるモデルで 200 + 空/部分出力、存在しないプロジェクトで 500 | モデルエラーは 409、変換器の失敗/空は 422(内部パスなし)、存在確認を監査より前に | 同上、api.test.ts |
| viewer がエクスポートで監査ログとディスクを増やせる、監査追記が O(全体) | 同じ人の同じ書き出しは 1 分に 1 回、直前ハッシュの記憶 | api.test.ts |
| viewer の UI が編集可能 | store で全ての編集・保存・AI 操作を拒否、見た目も無効化、通知は赤でなく情報表示 | web/test/store.test.ts |
| ASIL を下げる分解の追加、管理策の記述の削除、評価の新規設定が確認なしで通る | `riskChanges` を拡張(分解の追加、記述の削除、未評価への良い評価、HARA の低下、FTTI、確率、削除) | ai/test |
| 人の保存で差分が残らない | `safety.diff` を監査ログに記録(リスク低下の件数つき) | api.test.ts |
| 安全機構の FTTI が目標を超えても検出されない | `MECH_FTTI_EXCEEDS_GOAL` | analysis/test |
| QM の意図機能が警告だけ | ASIL の安全目標があればエラー | analysis/test |
| プレースホルダの根拠(`pending review`、`TBC`、`lorem ipsum`) | 追加で検出 | safety-core/test |
| **tool-qualification の「全 80 通り」が虚偽** | 表を文字どおり書き写した 80 通りのテストを追加(記述が事実になった) | safety-core/test/hara-fta.test.ts |
| `[0..*]` の多重度が無警告 | 上限なし(-1)も警告 | sysml-graph/test |
| 文書のずれ(trustProxy、追記のみ、plan の MSR、ADR の ID の主張) | 訂正。標準形式の制約 X1〜X4 を ADR-0009 に明記 | docs |
| server の行カバレッジ低下(79.5%) | Java なしで動く代役プロセスの単体テストを追加 → 93.5% | coverage |
| 不安定な実時間テスト | 絶対値の上限のみ(3 秒)に変更 | store-crash.test.ts |
| FMEA の RPN/AP 列が初期画面で切れる | 表の余白・幅を詰め、1440×900 で右端まで表示 | スクリーンショット |

## 未対応(報告に残す)
- X1(標準ライブラリ参照の解決)・X4(elementId の再現性)は公式変換器の挙動で、本ツールでは直せない(ADR-0009 に明記)
- SysML v2 API サーバーへの投入形式(Commit)、取り込み、他ツールでの読み込み確認
- 7 ステップ、SPFM/LFM/PMHF、FMEA の複数影響ごとの重大度、FMEA の重大度と HARA の S の照合
- 実ランナーでの CI、Docker イメージのビルド、第三者による脆弱性診断
