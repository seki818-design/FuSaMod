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

## 標準形式の書き出しの既知の制約(公式変換器の挙動。実測)

- **X1 標準ライブラリの参照**: `ScalarValues::Real` などは、JSON では名前のない `Type` / `Namespace`、XMI では解決できない `href` になる(変換器にライブラリを渡していないため)。
- **X2 誤りのあるモデル**: 変換器は部分的な出力を返すことがあるので、本ツールは**モデルにエラーがあれば 409**、変換器が失敗・空の出力なら 422 を返す(部分的な出力は返さない)。
- **X3 非対応の記述**: 単位式(`[kg]`)などを含むモデルは、JSON が作れない(NPE)ことがある。このときは 422(XMI は成功する場合がある)。
- **X4 elementId**: 変換器の出力は毎回ランダムな UUID で、要素の並びも実行ごとに変わる。本ツールは JSON の elementId を、「所有者の経路・名前・種類・内容(参照先を含む署名)」から決めた UUID に置き換える(`stable-ids.ts`)。**同じモデルなら elementId の集合は一致する**が、完全に対称な要素(同じ内容・同じ位置づけの兄弟)の割り当ては入れ替わりうる。XMI の id は置き換えていない(毎回変わる)。FuSaMod の ID(完全修飾名)との対応表は付けていない。
- JSON は API サーバーへそのまま投入する形(`Commit` / `DataVersion` で包んだもの)ではない。**SysML v2 API サーバー・他ツールでの読み込みは未確認**。
- 同時実行は 2 件まで(待ち 4 件)。取り込みは未対応。
- **X5 SCDL を含むモデルの JSON**: 単位式や `@Scdl*` の注釈を含むモデル(例: `examples/sysml/all-stereotypes.sysml`)は、JSON が 422(変換器が NPE)。同じモデルの XMI は成功する。SCDL の交換には、テキスト(`scdl.sysml`)を使うこと。
- **X6 解析のタイムアウト**: 大きなモデルで解析がタイムアウトすると 504(または 503)で返り、モデルの誤り(409)とは区別する。
