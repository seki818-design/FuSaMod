# ADR-0009: 相互運用の範囲

- 状態: 採用
- 背景: 他の MBSE ツールや規格のデータと、どこまで交換できるかを明示する(「できること」と「できないこと」)。

## できること

| 対象 | 方式 | 確認 |
|---|---|---|
| SysML v2 テキスト記法の読み込み・検証 | 公式パイロット実装(0.62.0)を常駐させて解析 | `tools/sysml-check/run.sh`、結合テスト |
| **SysML v2 標準の JSON(API の形式)と XMI への書き出し** | 公式実装の変換器(`SysML2JSON` / `SysML2XMI`)を `tools/sysml-check/convert.sh` で呼ぶ。API: `GET /api/projects/:id/export/model.json`・`model.xmi`(Java 必要。snapshot では 503) | 結合テスト(`FUSAMOD_IT=1`)。**他ツールでの読み込みは未確認** |
| SysML v2 テキストの書き出し(SCDL のステレオタイプ) | `@fusamod/scdl` の `exportSysml` | 公式実装で検証、往復テスト(特殊文字・Unicode を含む) |
| 解析結果の汎用の要素グラフ(JSON) | `tools/sysml-check/SysmlExtract.java` | 独自形式(ツール非依存、ADR-0002) |
| FMEA / トレース / 指摘の CSV、Markdown レポート | `@fusamod/analysis` の export | CSV は数式として解釈されないよう無害化 |

## できないこと(今後の課題)

- **SysML v2 API(REST)** への接続、および標準 JSON / XMI の**取り込み**(書き出しのみ対応)。取り込みは、テキスト記法(.sysml)を介する。
- ASAM SCDL の公式ツール・公式交換形式との相互運用(SCDL は SysML のステレオタイプとして独自に表現。ADR-0007)。
- ReqIF、Excel の FMEA 取り込み(AIAG-VDA のワークシートへの書き出しは CSV のみ)。

## 方針

公式の標準 JSON / API への対応は、公式実装(Pilot)が提供する API を利用する形で追加する。独自形式のグラフは、その変換の中間表現として残す。
