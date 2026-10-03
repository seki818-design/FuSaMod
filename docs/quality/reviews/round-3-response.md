# 第 3 回レビューへの対応(要約)

第 3 回の合否点: ISO(A1 82 / B1 77 / C1 76。採点 77/74/68)、MBSE(A1 90 / B3 87 / C2 89)、品質(A2 92 / B2 91 / B4 93 / B5 88 / **B6 58(採点 52)** / B7 88 / B8 84)。

| 指摘 | 対応 | 証拠 |
|---|---|---|
| **認証の完全な迂回**: `/%61pi/projects` で認証・viewer・レート制限を回避 | 生の URL ではなく**正規化したパス**(パーセントデコード・`./`・`//`・大文字小文字)と、ルーターが選んだルートの両方で判定する既定拒否に変更。表駆動の回帰テスト(11 の書き方 × 4 メソッド × 役割)。旧コードでは失敗し、新コードで通ることを確認 | server/test/api.test.ts |
| **ASIL を黙って下げられる**(分解先の子孫に `QM(D)`) | 分解先そのものだけ元 ASIL で比較し、子孫は実際の ASIL で比較。子孫の元 ASIL は親と一致が必要。AI の適用経路も同じ検査を通る | safety-core/test/review1.test.ts |
| 形だけの独立性の根拠(`abcdabcd`、`TODO TODO`、`12345678`) | 6 種類以上の文字・数字だけでない・繰り返しでない | 同上 |
| 確率の上限が未展開事象を含んで出る | 未展開・範囲外の確率があれば出さない | 同上 |
| safety-notes の誤記(検出範囲、AP 同梱) | 訂正。FTA の OR のみ・潜在故障なし・MSR は参照と DC/D 整合のみ、を追記。サンプルの AP 表は玩具として全体を保守側に修正し、説明を強化 | docs/safety-notes.md |
| DC と検出度の矛盾が見えない | `MECH_DC_D_MISMATCH`(サンプルの SM-1 を medium に修正) | analysis/test |
| 定義内の ref part、定義内の入れ子 part の型付き使用、多重度、名前のない再定義、入れ子 requirement | 展開で対応(ref は除外、多重度は警告、入れ子は再帰展開、親の satisfy を継承) | sysml-graph/test/expand.test.ts(公式実装の出力) |
| 要求の modelRef が SysML 要求を指さない | 安全要求の `refines` を modelRef に入れる | analysis |
| `FUSAMOD_SYSML_CACHE` が効かない、Docker のキャッシュが書けない | 子プロセスに `SYSML_PILOT_CACHE` を渡す。`HOME=/data`。apt の npm を削除。CI の docker ジョブが Java モードの解析まで確認 | java-service.ts、Dockerfile、ci.yml |
| 履歴の静かな巻き戻し、壊れた proposals.json で 500 | 食い違い・壊れた履歴は `notice` で画面に通知。proposals.json は退避して続行(監査ログ) | server/test/store-crash.test.ts |
| PUT /model のサイズ検査が解析後 | 解析前に 2MB 検査 | app.ts |
| SCDL 図の文字が小さい | 縮小せず原寸(横スクロール) | ScdlView |

## 未対応(報告に残す)
- 7 ステップ、SPFM/LFM/PMHF、FMEA の複数影響ごとの重大度、AI 来歴の改ざん検知
- SysML v2 API / 標準 JSON / XMI、圧縮配信、コンポーネント単位の UI テスト
- 実ランナーでの CI、Docker イメージのビルド(CI の docker ジョブが初の検証になる)
