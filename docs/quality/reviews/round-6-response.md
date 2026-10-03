# 第 6 回レビューへの対応(要約)

第 6 回の合否点: ISO(A1 87 / B1 90 / C1 92)、MBSE(A1 93 / B3 89 / C2 92)、品質(A2 92 / B2 91 / B4 94 / B5 90 / B6 91 / B7 89 / B8 90)。

| 指摘 | 対応 | 証拠 |
|---|---|---|
| **解析タイムアウト後の次の要求でサーバーが落ちる(EPIPE)** | stdin のエラーを受ける、タイムアウト時に即座にプロセスを捨てる、`SysmlTimeoutError`(504/503 でモデルの誤り 409 と区別) | server/test/fake-processes.test.ts |
| 変換テストが OS 共通の tmp に依存(非密閉) | 一時ディレクトリの親を引数化し、テストごとに専用ディレクトリ | 同上 |
| 未知のエクスポート名で監査が増える | 許可リストを監査より前に | api.test.ts |
| `riskChanges` の漏れ(安全要求の QM 降格、機構の ASIL・DC・安全状態、FTA の構造、AP 表) | 分類を拡張。`coversFailureIds` は「増える = リスク低下の主張」に修正 | ai/test |
| 復元に差分の記録が無い | 復元でも `safety.diff` を監査 | api.test.ts |
| `MECH_FTTI_EXCEEDS_GOAL` の迂回(`requirementIds` を空に) | ペアの意図機能の要求も経路に使う | analysis/test |
| QM のダミー要求だけに紐づけた QM の意図機能 | 目標につながらなければエラー。目標より低い元 ASIL もエラー | analysis/test |
| プレースホルダ検査の穴 | 一部を追加（ヒューリスティックの限界は文書化） | — |
| **A1: SPFM/LFM/PMHF/MSR が無い** | **SPFM / LFM を実装**(ISO 26262-5 の定義、手計算と一致するテスト、目標値との比較、画面表示、サンプルはデモ値)。PMHF・MSR 集計は未実装のまま | safety-core/test/hwmetrics.test.ts、analysis/test |
| 要求側の経路つき `satisfy` が欠ける | 抽出器が `requirementChain` を出力し、展開で要求インスタンスに付け替え | sysml-graph/test(公式実装の出力) |
| 多重度 `[n]`・`[0]`・下限 0 が無警告、警告が使用ごとに重複 | 警告を 1 使用 1 回にまとめ、式・0・任意も警告 | 同上 |
| JSON の elementId が毎回違う | 内容の署名から決定的な UUID に置き換え（集合は一致。完全に対称な要素の割り当ては入れ替わりうる） | stable-ids.test.ts、統合テスト |
| SCDL を含むモデルの JSON が 422 | ADR-0009 に明記(X5) | docs |
| ADR-0008 の「標準 JSON/XMI は未対応」が古い | 訂正 | docs |
| 非対称な `ensure_pilot` の排他 | `flock` でロック | lib.sh |
| `pnpm e2e` が証跡画像を上書きして作業ツリーを汚す | 撮影は `pnpm shots` のときだけ | e2e/shots.spec.ts |
| Windows 予約名のプロジェクト ID | 400 | api.test.ts |
| README に Docker・Java・環境変数が無い、TRUST_PROXY=true の危険の警告が無い、viewer の説明が無い | 追記 | docs |
| CI: キャッシュ、バンドルの煙試験が無い | 追加 | ci.yml |

## 未対応(報告に残す)
- X1（標準ライブラリ参照）の解決。変換器にライブラリを渡す方法は未検証（「直せない」とは断定しない）
- PMHF、MSR の集計、7 ステップ、FMEA の複数影響ごとの重大度、FMEA と HARA の整合
- SysML v2 API サーバーでの読み込み確認、実ランナーでの CI、Docker イメージのビルド
- `GET /audit` の大規模ログでの遅さ（ローテーションなし）、viewer の UI の追加フォームを開けること（押すと拒否）
