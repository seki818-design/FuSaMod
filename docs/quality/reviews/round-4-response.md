# 第 4 回レビューへの対応(要約)

第 4 回の合否点: ISO(A1 85 / B1 86 / C1 89)、MBSE(A1 90 / B3 87 / C2 90)、品質(A2 91 / B2 91 / B4 93 / B5 91 / B6 88 / B7 89 / B8 90)。

| 指摘 | 対応 | 証拠 |
|---|---|---|
| 意図機能・安全機構の ASIL が検査されない(QM にできる、元 ASIL の偽装) | `validateElementAsil`(`ELEMENT_ASIL_BELOW_REQ` / `DECOMP_ORPHAN` / `ELEMENT_QM_UNLINKED`)。AI の追加経路も 422 | safety-core/test/review1.test.ts、server/test/api.test.ts |
| AI の適用ゲートが、リスクを下げる編集を通す | 重大度・発生度・検出度の低下、QM の追加を検出し、**確認なしでは 409**。確認すると適用され、差分(前後の値)と確認の事実が来歴に残る。UI は確認ダイアログ | 同上 |
| `aiChanges` を PUT で消せる | 追記のみ(削除・書き換えは 422) | 同上 |
| 形だけの根拠(`asdfghjk`、`DFA-XXX-000`、`DFA TBD 1234`) | プレースホルダ語・数字/区切りの有無を検査 | 同上 |
| safety-notes の誤記(DC は記録のみ) | 訂正(MECH_DC_D_MISMATCH と閾値が経験則であること)、「検出しない」一覧に追記 | docs/safety-notes.md |
| 負テストの一覧・ツール分類の提案が無い | `docs/quality/evidence/negative-tests.md`、`docs/quality/tool-qualification.md`(提案) | docs |
| `no-store` と SPA フォールバックが生の URL で判定 | 正規化したパスで判定。エンコードしたパスの応答にも `no-store` | server/test |
| `trustProxy` 未対応 | `FUSAMOD_TRUST_PROXY`(既定は X-Forwarded-For を信用しない) | config.ts、docs/security.md |
| 認証失敗・エクスポートが監査されない | 認証失敗は `_server-audit.jsonl`(連鎖つき)、エクスポートはプロジェクトの監査ログ | server/test |
| 脅威モデルの文書が無い | docs/security.md | docs |
| 回帰テストが弱い(1 経路、「2xx でなければ可」) | **全ルート × {匿名, viewer, editor}** の厳密な表(401/429、403、no-store) | server/test/api.test.ts |
| 不安定なテスト | タイムアウトを延ばし、中央値で比較 | store-crash.test.ts |
| 壊れた履歴が隔離されない | `.corrupt-*` に隔離し、監査ログと恒久の通知 | store-crash.test.ts |
| 定義内の再定義が捨てられる / 最上位の多重度が無警告 / requirement def が展開されない | 再定義を反映、多重度を最上位でも警告、`requirement def` を展開(本文・入れ子) | sysml-graph/test/expand.test.ts(公式実装の出力) |
| 入れ子 requirement が影響分析に未接続 | 影響分析の関係に追加 | analysis/test |
| SCDL の同名の根が並び順依存、part 名が SCDL の ID と衝突 | 完全修飾名の順で割り当て、衝突する名前には `@E` | analysis/test |
| 完全修飾名の無い要素で落ちる | 警告して除く(`INVALID_ELEMENT`) | sysml-graph/test |
| `.env.example` / coverage.md の食い違い、不要な python3-pip | 修正 | — |

## 未対応(報告に残す)
- SysML v2 API / 標準 JSON / XMI の入出力(B3 の最大の要因)、`verify`/`derive`/`refine` などの要求間関係
- 7 ステップ、SPFM/LFM/PMHF、FMEA の複数影響ごとの重大度、FMEA の重大度と HARA の S の照合
- 実ランナーでの CI、Docker イメージのビルド、第三者による脆弱性診断
