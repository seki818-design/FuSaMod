# 負テスト一覧(わざと誤ったデータ・操作を与え、検出・拒否されることの確認)

「検出する」と文書(docs/safety-notes.md、docs/security.md)に書いたものと、それを確認するテスト。

## 安全分析(`packages/safety-core/test/review1.test.ts`、`asil.test.ts`、`hara-fta.test.ts`、`packages/analysis/test/analyze.test.ts`)
| 誤り | 検出コード | テスト |
|---|---|---|
| S/E/C が範囲外・NaN・小数 | `RangeError` / `HARA_RANGE` | determineAsil の入力検証 |
| ASIL の事象に安全目標が無い | `EVENT_NO_GOAL`(エラー) | 同上 |
| 要求の ASIL が安全目標より低い | `REQ_BELOW_GOAL_ASIL` | ASIL の継承規則 |
| 要求が親より低い ASIL(分解によらない) | `REQ_ASIL_DOWNGRADE` | 同上 |
| 分解先の**子孫**に `QM(D)` / `A(D)` | `REQ_ASIL_DOWNGRADE` | 元 ASIL の表記を盾にした引き下げ |
| 元 ASIL の偽装(分解に属さない) | `DECOMP_ORPHAN` | 同上 |
| ASIL 付きの目標に要求が無い | `GOAL_NO_FSR` | 同上 |
| 要求の親子の循環・自己親 | `REQ_PARENT_CYCLE` | 循環・導出・ID |
| 分解の自己参照・循環 | `DECOMP_CYCLE` | 同上 |
| 分解先が分解元から導出されていない | `DECOMP_CHILD_NOT_DERIVED` | 同上 |
| 二重分解・分解先の再利用 | `DECOMP_DUPLICATE_PARENT` / `DECOMP_CHILD_REUSED` | デコンポジションの重複 |
| 独立性の根拠が無い / 形だけ | `DECOMP_NO_EVIDENCE`(エラー)/ `DECOMP_EVIDENCE_WEAK` | 形だけの根拠 |
| 分解先が同一要素・祖先/子孫の要素・未配置 | `DECOMP_NOT_INDEPENDENT` / `DECOMP_NOT_ALLOCATED` | analyze.test.ts |
| 意図機能・安全機構の ASIL が要求より低い / 偽装 | `ELEMENT_ASIL_BELOW_REQ` / `DECOMP_ORPHAN` | 意図機能・安全機構の ASIL |
| 存在しない故障ノードを安全機構が対象にする | `UNKNOWN_REF` | analyze.test.ts |
| ID の重複 | `DUP_ID` | analyze.test.ts |
| FTA: 循環・未知ノード・空ゲート・打ち切り | `problems` / `truncated` | FTA の堅牢性 |
| FTA: 未展開・範囲外の確率 | 確率の上限を出さない | 確率の上限 |
| DC と検出度の矛盾 | `MECH_DC_D_MISMATCH` | analyze.test.ts |
| 非公式の AP 表 | `AP_TABLE_NOT_OFFICIAL` / `apStatus` | analyze.test.ts、E2E |

## AI と API(`apps/server/test/api.test.ts`)
| 誤り・攻撃 | 期待 |
|---|---|
| 新しいエラーを生む提案の承認(QM(D) の意図機能の追加を含む) | 422 |
| リスクを下げる提案(重大度 → 1) | 409 → 確認すると適用、差分が来歴に残る |
| 依頼した本人による承認(`FUSAMOD_AI_SEPARATE_APPROVER=1`) | 403 |
| `aiChanges` の削除・書き換え | 422 |
| 認証なし・URL の書き換え(11 通り × 4 メソッド) | 401/429(2xx にならない) |
| viewer による書き込み(クエリ・エンコード含む) | 403 |
| 認証の連続失敗 | 429 |
| 全ルート × {匿名, viewer, editor} | 厳密な表 |
| SCDL にエラーがあるときの書き出し | 409 |

## 信頼性(`apps/server/test/store-crash.test.ts`)
壊れた meta.json、途中で落ちた保存、履歴の食い違い、壊れた proposals.json、監査ログの改ざん・削除・同時書き込み。

## 追加（第 6 回レビューへの対応）
| 誤り・攻撃 | 期待 | テスト |
|---|---|---|
| 分解の追加、管理策の記述の削除、HARA の低下、FTA の構造変更、AP 表の全 L 化、診断カバレッジ向上の主張、ハードウェア故障率の低下 | `riskChanges` が「リスク低下」と分類 | ai/test |
| 人の保存・履歴の復元 | 差分が `safety.diff`（監査ログ）に残る | server/test/api.test.ts |
| 安全機構の `requirementIds` を空にして FTTI を延ばす | ペアの意図機能の要求から目標の FTTI を照合してエラー | analysis/test |
| QM のダミー要求だけに紐づけた QM の意図機能 | `ELEMENT_QM_UNLINKED`（エラー） | analysis/test |
| SPFM/LFM が目標に届かない | `HW_SPFM_BELOW_TARGET` / `HW_LFM_BELOW_TARGET`（エラー）。手計算と一致 | safety-core/test/hwmetrics.test.ts |
| 解析のタイムアウト後・プロセス死亡後の次の要求 | サーバーが落ちない（EPIPE を握りつぶさず例外で返る） | server/test/fake-processes.test.ts |
| 未知のエクスポート名 | 404、監査に書かない | api.test.ts |
| Windows の予約名のプロジェクト ID | 400 | api.test.ts |
