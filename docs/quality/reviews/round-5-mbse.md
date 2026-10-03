# ラウンド 5 レビュー: MBSE / SysML v2 専門家の観点(A1・B3・C2)

- 立場: 独立・厳格な MBSE / SysML v2 専門家(シミュレートしたレビュアー。認証機関ではない)
- 基準: `docs/quality/rubric.md`(証拠主義、未検証は減点、外部確認待ち減点は点数と別に最大 10 点)
- 対象リビジョン: `6337df5`。リポジトリのソースは変更していない(作業物はスクラッチパッドの `m5/`、`proj5/`、`an.py` のみ)。
- 方法(`round-4-response.md` は鵜呑みにせず、すべて実行して再検証):
  - `./tools/sysml-check/run.sh`: SCDL.sysml、examples 6 件、projects の model.sysml が公式実装 0.62.0(Java 21)でエラー・警告ゼロ(再現、約 22 秒)。
  - `pnpm -r test`: 全パッケージ合格(safety-core 124 / sysml-graph 36 / scdl 50 / analysis 53 / web 19 / ai 29 / server 53、Java 結合 6 件 skip)。
  - 新規の敵対的モデル(`m5/e1`、`f1`、`g1`、`bad1`、`bad2`、`empty`、`lib`、`l2`、`l3`)を、実サーバー(`FUSAMOD_SYSML=java`、別ポートの一時プロジェクト群)に流して
    公式抽出器 → `deriveNet` / `analyzeProject`(`POST /analyze`)→ SCDL 書き出し(`export/scdl.sysml`)→ `PilotCheck`(公式検証)を確認。
    - e1: 定義内の再定義(`BigPack :> Pack { part :>> cells {…} }`)、`Wheel[4]` / `[0..*]`、`requirement def` と入れ子、SCDL 側 ID と衝突する part 名(`IF-1`、`SRG-M1`、`NFSR-1`、`RG-1`)、
      Unicode・絵文字・引用符名、`'a/b'` と `a { b }`、同名の複数パッケージ(`C2::Dup`、`C3::Dup`)。
    - f1: 継承特徴の再定義を通る `satisfy`、usage 側の再定義。g1: 入れ子 requirement の影響分析(`impactOfRequirementChange` を直接呼ぶ)。
  - **新機能(標準形式のエクスポート)**: `convert.sh` を直接、`GET /api/projects/:id/export/model.json|model.xmi` をサーバー経由で、サンプルと上記モデル、不正モデル 3 種、空モデル、
    SCDL を import するモデル、単位式 `[kg]` を含むモデルで実行。出力の構造(要素数、参照の整合、ライブラリ参照、ID の再現性)を JSON / XML として解析。
    同時 8 リクエスト、タイムアウト(1.0 / 1.5 秒)、一時ディレクトリ、孤児プロセスを確認。

---

## 総括

| 項目 | 採点 | 外部確認待ち減点 | 合否点 | 判定 |
|---|---|---|---|---|
| A1 機能要件(モデリング/トレーサビリティ/階層/SCDL の観点) | **88** | 5 | 93 | 合格(採点 80 以上) |
| B3 互換性・相互運用性 | **83** | 5 | 88 | **不合格**(合否点 90 未満。採点は 80 以上) |
| C2 MBSE 専門家の観点 | **87** | 5 | 92 | 合格(採点 80 以上) |

ラウンド 4 の実装上の指摘 7 件(C2-N1〜N7)は、**実測ですべて直っていた**(下表)。モデル展開・影響分析・SCDL ID・不正グラフ耐性は明確に前進した。
一方、今回の新機能である標準形式エクスポートは「動く」が、次の点で**「SysML v2 API / 他ツールが消費できる標準の交換」と言える水準には達していない**:
(1) 標準ライブラリ(`ScalarValues::Real` など)への参照が名前のない `Type` / `Namespace` に置き換わる、(2) 要素 ID が毎回ランダムで再現性がない、
(3) エラーのあるモデルでも 200 で部分的な成果物を返す、(4) 単位式 `[kg]`・SCDL の import を含むモデルでは JSON が作れず、誤解を招く 503 になる、(5) 取り込み・API 接続がない。
ADR-0009 は「取り込み・API なし」「他ツールでの読み込みは未確認」と正直だが、(1)〜(4) の制約は書かれていない。B3 は合否点 88 で不合格。

---

## 標準形式エクスポート(新機能)の検証結果

### 確認できたこと(実測)
- 公式変換器 `SysML2JSON` / `SysML2XMI`(0.62.0)を呼び、サンプル(ev-powertrain)で JSON 234 要素・XMI 約 52KB、e1 で JSON 139 要素を生成。サーバー経由でも 200、`Content-Disposition` は `<id>-model.json` / `<id>-model.sysmlx`。
- JSON は `[{ "payload": {…, "@type": "PartUsage", "elementId": …}, "identity": {"@id": …} }]` の配列。`@type`(PartUsage / RequirementUsage / SatisfyRequirementUsage / Redefinition / FeatureTyping など)と
  `elementId` を持ち、**要素間の `{"@id"}` 参照はすべて配列内で閉じている**(ev・e1 とも未解決 0)。XMI はパースでき(`sysml:Namespace` ルート、名前空間 `https://www.omg.org/spec/SysML/20250201`)、Unicode は数値文字参照で保たれる。
- 定義内の再定義(`Redefinition` → `cells` / `bms`)、多重度(`LiteralInteger 4`、`LiteralInfinity`)、`SatisfyRequirementUsage` が JSON に入る。`Dup` や `IF-1` の同名要素は別パッケージとして保たれる。
- 一時ディレクトリは正常・失敗(ENOENT)・タイムアウトのいずれでも `finally` で削除。8 リクエスト同時でも全件 200(合計約 14 秒、4 コアで JVM が 8 本並走)。
- タイムアウト(1.0 / 1.5 秒)後に孤児の `SysML2JSON` プロセスは残らなかった(ps で確認)。
- snapshot モードは 503(テストあり)。ADR-0009 / `docs/plan.md` / `docs/operations.md` は「書き出しのみ。取り込みと API は未実装。他ツールでの読み込み未確認」と整合して記述。

### 欠陥(実装上。重大度順)

**[X1 高] 標準ライブラリへの参照が失われる(意味が欠ける)。**
サンプルの `import ScalarValues::*; in 'accelerator request' : Real;` は、JSON では `NamespaceImport.importedNamespace` と `FeatureTyping.type` が
**名前も `qualifiedName` も持たない空の `Namespace` / `Type` 要素**に置き換わる(ev: 該当 ID の `@type` は `Namespace` / `Type`、`declaredName` なし、`isLibraryElement` は全要素 false)。
XMI では同じ参照が `<type href="model.sysml#|1"/>` のような**解決できないプロキシ**(サンプルで 9 箇所。参照先の `model.sysml` は削除済みの一時ファイル名)になる。
原因は `convert.sh` が標準ライブラリ(`sysml.library`)を読み込ませずに変換器を呼ぶこと。他ツール・API サーバーに取り込むと、`Real` 型の属性が「型不明」になる。
同様に、未解決の型(`bad1` の `Missing`)も、エラーとして報告されずに空の `Type` に化ける。

**[X2 高] エラーのあるモデルでも 200 で出力する(ガードなし)。**
`export/fmea.csv` などは `needAnalysis` で 409 になるが、`model.json|xmi` は `store.read` のみで検証をしない。`bad1`(構文エラー)・`bad2`(未解決の型、重複名)・空モデルで **すべて 200**、
欠損・placeholder 入りの JSON(9〜11 要素)を返し、警告ヘッダもない。結合テストの「誤りのあるモデル」は `resolves.toBeDefined()` で、これを許容するだけの空虚な検証。

**[X3 高] JSON が作れない入力が、誤解を招く 503 になる。**
単位式(`attribute mass : MassValue = 5 [kg]`)を含むモデル、`import SCDL::*` と `@Scdl*` を使うモデル(本ツール自身の `examples/sysml/all-stereotypes.sysml`)で `SysML2JSON` は
`NullPointerException(Element.eResource() is null)` を出して終了するが、**`convert.sh` は `|| true` と `grep` のパイプで終了コードを常に 0 にする**ため、
`convertModel` は「変換結果を読めません: ENOENT: …/tmp/fusamod-convert-XXXX/model.json」(一時パス付き)を **HTTP 503**(一時的な利用不能)で返す。入力起因の恒久的な失敗なので 422 と原因の説明が適切。
同じモデルの XMI は 200 で成功する(JSON と XMI で挙動が非対称)。`convert.sh` 単体も失敗時に終了コード 0。
つまり、本ツールの SCDL 注釈を含むモデルは、標準 JSON に出せない。

**[X4 中] 要素 ID が毎回変わる(再現性がない)。**
同じプロジェクトを 2 回エクスポートすると `elementId` が **139 件すべて異なる**(共通 0)。変換器が UUID を毎回新規採番するため、差分比較・版管理・SysML v2 API の「同一要素の新しい版」としての投入ができない。
FuSaMod 内部の ID(`C1::v::pack`)や SCDL の `modelRef` との対応表も出力されない(`qualifiedName` も payload に無い)。

**[X5 中] 範囲の過大表示のおそれ。** エクスポートされるのは `model.sysml` の変換だけで、安全分析(`safety.json`)・SCDL ビュー・FMEA・トレースは含まれない。
SCDL ビューは `scdl.sysml` として別に書き出せるが、**それを `convert.sh` に通すと NPE になる**(上記と同じ原因: `SCDL.sysml` をライブラリとして与えていない。`ev2-scdl.sysml` で再現)。標準形式で FuSaMod の成果物を丸ごと渡す経路はない。

**[X6 中] 同時実行・資源の上限がない。** リクエストごとに JVM を起動(約 3 秒、RSS 数百 MB)し、同時実行数の制限・キュー・キャッシュがない(8 並行で 14 秒)。`viewer` でも呼べるため、
認証ありの運用でも資源枯渇の経路になる(レート制限の対象かどうかはテストに表れず、確認できていない)。タイムアウト 180 秒は `bash` スクリプトに `SIGKILL` を送る方式で、孤児が残らないことは短いタイムアウトで観測できたが、設計上の保証(プロセスグループの停止)ではない。

**[X7 軽] 一時ディレクトリの残存。** サーバー(tsx)を `pkill` で止めた直後に `/tmp/fusamod-convert-l6ZTvA`(`model.sysml` のみ)が 1 つ残った。シグナル処理も起動時の掃除もない(通常経路では削除される)。

### 文書の正確さ
- ADR-0009 の「できること」表と `docs/plan.md`・`docs/operations.md` は、書き出しのみ・Java 必須・snapshot で 503・他ツール未確認と**概ね正直**。ただし以下が書かれていない: X1(ライブラリ参照の欠落)、X2(エラーモデルも出力)、
  X3(単位式・SCDL import で JSON 不可。503 の誤分類)、X4(ID 非決定)。「SysML v2 API の JSON 形式」は、配列の `payload` / `identity` は API の `DataVersion` の中身に相当するが、
  `Commit` で包まれておらず(`@type: DataVersion` なし)、**そのまま API サーバーに POST できる形ではない**(下記「検証できたこと / できないこと」)。
- ADR-0009 の「方針」(公式の標準 JSON / API 対応を公式実装の API で追加)は、実装が `.sysml` → 変換器の一方向であり、API 経由ではない点で記述と実装が少し異なる。

### 検証できたこと / できないこと
- できた: 公式変換器が JSON / XMI を出力すること、JSON 内の参照が閉じていること、XMI が整形式であること、ID が非決定であること、ライブラリ参照が空要素・プロキシになること。
- できていない: SysML v2 API サーバー(公式 Pilot の API 実装や商用ツール)への実投入、JSON の JSON Schema / OpenAPI 検証、XMI の他ツールでの読み込み、往復(取り込み)。
  環境にそれらがなく、**「他ツールで消費できる」は未確認**。上記 X1 から、ライブラリ参照を含むモデルは受け側で型不明になる可能性が高い(推定)。

---

## C2. MBSE 専門家の観点: 87 点(外部確認待ち減点 5)

### 確認できた長所(実測)
1. **N1 修正**: `BigPack :> Pack { part :>> cells { part extra; } part :>> bms { part mon; } }` と `v : Veh { part pack : BigPack }` で、`BigPack::cells::extra`、`v::pack::cells::extra`、`v::pack::bms::mon` が展開。
   `satisfy r1 by v.pack.cells.extra` が `F1::v::pack::cells::extra` に解決(f1)。`REDEFINITION_IGNORED` は出ない。usage 側(`w { :>> pack { part wx } }`)も正しい。
2. **N2 一部修正**: 最上位 `wheels : Wheel[4]`、`y : X[2..5]` に `MULTIPLICITY_IGNORED`。定義内メンバーの警告は 1 件に重複排除。
3. **N3 修正**: `requirement def Rd { doc …; requirement subA {doc …} requirement subB; }` と `requirement ra : Rd` で、`Rd::subA` の幽霊要求は出ず、`ra`(本文 `d`)・`ra::subA`(本文 `a`)・`ra::subB` が導出。
4. **N4 修正**: g1 で `impact(reqA)` の下位に `reqA::sub1`・`sub1::sub2`、`impact(sub1)` の上位に `reqA`。`ra` ⇄ `ra::subA` も双方向。方向性は維持。
5. **N5/N6 修正(部分)**: 同名の根は完全修飾名の順で `Dup` / `Dup#2`(決定的)。`IF-1`・`SRG-M1` 等と衝突する part 名は `@E`(例 `IF-1@E`)で回避。SCDL 出力は `PilotCheck` でエラー・警告ゼロ(ev2 + Extra パッケージ群、Unicode・`a/b` を含む)。
6. **N7 修正**: 完全修飾名の無い要素は `INVALID_ELEMENT` で除外(テストあり)。コード上も確認。

### 残る欠陥・減点
**[C2-O1 中・無警告] 上限なしの多重度 `[0..*]` と下限 0 が無警告で 1 個扱い。** `part x[0..*] : X` は `MULTIPLICITY_IGNORED` が出ない(警告は数値の上限 > 1 のみ)。
任意(下限 0)の部分も無視される。ADR-0008 は「上限が 1 を超える」としか書いておらず、`*` の扱いが未記述。SPOF 判定を黙って誤らせうる(ラウンド 4 の C2-N2 の残り)。

**[C2-O2 中] SCDL エレメント ID が、パッケージの追加で変わる。** 実測: `{C2::Dup→Dup, C3::Dup→Dup#2}` のモデルに `package A0 { part Dup }` を追加すると、`A0::Dup→Dup`、`C2::Dup→Dup#2`、`C3::Dup→Dup#3` に**全部ずれる**。
ADR-0007 追補の「並び順・パッケージの追加に依存しない」は、**同名の根では成り立たない**(文言は誤り。決定的なのは同一入力に対してのみ)。`modelRef` は完全修飾名なので追跡はできるが、`ScdlElement` の ID(要素名)は版を超えて不安定。
さらに、完全修飾名の文字列順のため `Extra2::Dup`(`Dup`)が `Extra::Dup`(`Dup#2`)より先になる(`2` < `:`)など、直感に反する割当てになる。`IF-1` は `IF-1#2` と `IF-1@E` の 2 つの方式が混在。
`'a/b'` と `a { b }`(`a/b` と `a/b#2`)の `/` の曖昧さも残る。

**[C2-O3 軽] SysML 標準の要求関係(`verify` / `derive` / `refine`)は未導出。** ADR-0008 に記載なし(ラウンド 3 から継続)。port / connection / flow / state / allocation は警告のみで解析に使われない。

**[C2-O4 軽] ID 衝突の回避が `@E` の接尾辞方式。** 実務家は名前空間(接頭辞)を期待。ただし衝突時に壊れない点は良い。

### 外部確認待ち減点: 5 点
MBSE 専門家による G0 の書面レビュー(ADR-0007/0008 の導出規約、SCDL ステレオタイプ設計、展開規約)、他の SysML v2 ツールでの `@Scdl*` と導出規約の解釈確認が未実施。担当: 外部 MBSE 専門家 / ツール担当。

---

## B3. 互換性・相互運用性: 83 点(外部確認待ち減点 5)

### 評価
- 前進: 標準の JSON / XMI の**書き出し**が、公式変換器経由で実在し、サンプルで機械的に整合した出力が得られる(+)。ADR-0009 は範囲を正直に限定。公式実装での検証(`run.sh`)・SCDL 出力の公式検証・特殊文字の往復は維持。
- 減点:
  - 取り込み(JSON / XMI / API)・SysML v2 API 接続がない。交換の相手は `.sysml` テキストのみ。(-5)
  - X1: ライブラリ参照が空要素・プロキシ化。意味が欠ける。(-3)
  - X2/X3: 不正モデルで 200、単位式・SCDL import で JSON 不能かつ 503 の誤分類(`convert.sh` が終了コードを握りつぶす)。(-3)
  - X4: ID が非決定で、版管理・差分・API の版付き投入に使えない。(-2)
  - X6/X7: 同時実行の上限なし、一時ディレクトリの残存の可能性。(-1)
  - 入力できる SysML の範囲(port / connection / state / allocation は警告のみ、`[0..*]` 無警告)。(-2)
  - `@Scdl*` ステレオタイプ・`modelRef` 拡張の他ツール読み込み、ASAM SCDL 仕様書との突合、jar の第三者ライセンス棚卸しの証跡は未確認(外部確認待ちに計上)。(-1)
- 実務家の目では、現状の JSON / XMI は「公式変換器が吐いたものをそのまま配る」機能であり、品質ゲート(エラー時の拒否、ライブラリの解決、安定 ID、メタデータ)がない。

### 外部確認待ち減点: 5 点
他ツール・SysML v2 API サーバー(公式 Pilot の API 実装、商用モデラ)での JSON / XMI / `@Scdl*` 読み込み確認、ASAM SCDL v1.6.0 仕様書との突合(法務確認を含む)。担当: MBSE 専門家 / ツール担当 / 法務。

---

## A1. 機能要件の充足度(モデリング/トレーサビリティ/階層/SCDL の観点): 88 点(外部確認待ち減点 5)

| チェック項目 | 状況 | 所見 |
|---|---|---|
| SysML v2 準拠のモデリング(読み込み・検証・編集・書き出し) | 達成(取り込みは .sysml のみ) | 公式実装で検証。定義内の再定義・requirement def・型付き/特殊化/深い入れ子が読める。標準 JSON / XMI は書き出しのみ(品質に難あり)。 |
| システム階層をモデルから自動生成 | ほぼ達成 | 定義内再定義まで反映。`[0..*]` は無警告で 1 個扱い。 |
| トレーサビリティ(マトリクス・影響分析・整合性チェック) | 達成 | 経路つき `satisfy`、入れ子 requirement の充足継承と影響分析、方向つき(下位/上位/相手)。`verify`/`derive`/`refine` は未導出。 |
| ASAM SCDL ビュー | 達成(穴あり) | `modelRef`、ID 衝突の自動回避(`@E`)、公式検証の通る書き出し。同名の根の ID が、パッケージ追加でずれる。 |
| 標準形式のインポート/エクスポート | 一部 | 書き出しのみ(X1〜X4)。取り込みなし。 |

### 減点理由
- `[0..*]` の無警告、port / connection / state / allocation を解析に使えない: -4
- SCDL ID の不安定(C2-O2)、`verify`/`derive`/`refine` なし: -3
- 標準形式のエクスポートの品質(X1〜X4)と取り込み/API の欠如(機能要件の「読み込み・書き出し」の標準側): -3
- 仕様書との突合の証跡なし、ほか: -2

### 外部確認待ち減点: 5 点
専門家レビュー・他ツールでの確認・SCDL 仕様の突合。

---

## 実務の MBSE 担当者がまだ拒否する点

実装上の欠陥(直せる):
1. 標準 JSON / XMI で `Real` などの標準ライブラリ型が空の要素・プロキシになる(X1)。
2. エラーのあるモデルでも 200 で部分的な成果物を返す(X2)。単位式・SCDL import を含むモデルで JSON が作れず、原因不明の 503(X3)。`convert.sh` の終了コードが常に 0。
3. 要素 ID が毎回変わり、版管理・差分・API 投入に使えない(X4)。
4. `[0..*]` が無警告で 1 個扱い(C2-O1)。同名の根の SCDL ID が、パッケージの追加でずれる(C2-O2。ADR-0007 追補の記述が不正確)。
5. 並行変換の上限なし、一時ディレクトリの掃除なし(X6/X7)。

標準交換の欠如(範囲の問題。ADR-0009 に記載済み):
- SysML v2 API(REST)への接続、JSON / XMI の取り込み、往復がない。他ツール・API サーバーでの消費は未確認。
- port / connection / interface / flow / state / allocation を解析に使えない。`verify` / `derive` / `refine` の要求間関係がない。
- SCDL ステレオタイプは独自のメタデータ定義で、他ツールでの解釈は未確認。

---

## 優先修正(ファイル単位)

1. `tools/sysml-check/convert.sh` と `apps/server/src/sysml/convert.ts`(X1/X3): 公式の `sysml.library`(と SCDL ライブラリ)を変換器に読み込ませる(変換器の `-l` 相当の設定、またはライブラリを同じリソースセットに含める)。
   `|| true` を外して変換器の終了コードを伝え、NPE などの入力起因の失敗は 422(原因つき、一時パスを出さない)にする。回帰: ev のサンプルで `Real` の型が名前つきの要素/参照になること、`[kg]`・`import SCDL::*` を含むモデルが変換できること。
2. `apps/server/src/app.ts`(X2): `model.json|xmi` の前に解析を行い、エラーがあれば他の書き出しと同じく 409(`needAnalysis` 相当)。`apps/server/test/java.integration.test.ts` の「誤りのあるモデル」テストを、`rejects` / 409 の厳密な検証に置き換える。
3. 変換後処理(X4): 出力の `elementId` を、完全修飾名からの決定的な UUID(v5 など)に付け替えて参照を張り替える。または FuSaMod の ID との対応表(`qualifiedName` → `elementId`)を付ける。
4. `apps/server/src/sysml/convert.ts`(X6/X7): 同時実行数の上限(キュー)、プロセスグループごとの停止、起動時の `fusamod-convert-*` の掃除、SIGTERM でのクリーンアップ。
5. `packages/sysml-graph/src/expand.ts`(C2-O1): `multiplicityUpper` が無限(`*`)の場合・下限 0 の場合も `MULTIPLICITY_IGNORED` を出す。`docs/adr/0008` に `*` と下限の扱いを記載。
6. `packages/analysis/src/scdl-map.ts`(C2-O2): 同名の根の ID にパッケージ名(または完全修飾名の安定なハッシュ)を含め、パッケージ追加で既存 ID がずれないようにする。`docs/adr/0007` 追補の「パッケージの追加に依存しない」を、実装に合わせて修正するか実装を直す。
7. `docs/adr/0009`・`docs/plan.md`・`docs/operations.md`: X1〜X4 の制約(ライブラリ参照、ID 非決定、エラーモデルの扱い、`Commit` で包まれていない形式)を明記。「API にそのまま投入できる」とは書かない。
8. 中長期(B3 の最大要因): JSON / XMI の取り込み、SysML v2 API(REST)クライアント、`verify`/`derive`/`refine` と port / connection の取り込み、jar の第三者ライセンス棚卸し、他ツールでの実読込テスト。

---

## ラウンド 4 の指摘 → ラウンド 5 での確認

| ラウンド 4 の指摘 | 判定 | 実測の根拠 |
|---|---|---|
| C2-N1 定義内の再定義が捨てられる | **修正済み** | e1/f1: `BigPack::cells::extra`、`v::pack::cells::extra`、`v::pack::bms::mon` が展開。`satisfy … by v.pack.cells.extra` が解決 |
| C2-N2 最上位の多重度が無警告 | **一部修正** | `Wheel[4]`、`[2..5]` は警告(重複排除済み)。`[0..*]`・下限 0 は無警告(C2-O1) |
| C2-N3 requirement def が展開されない | **修正済み** | e1/g1: 幽霊要求なし。`ra`/`ra::subA` に本文と入れ子が複製 |
| C2-N4 入れ子 requirement が影響分析に未接続 | **修正済み** | g1: `impact(reqA)` に `sub1`・`sub2`、`impact(sub1)` の上位に `reqA`。`verify`/`derive`/`refine` は未導出(継続) |
| C2-N5 複数パッケージの根の ID が並び順依存 | **一部修正** | 同一入力では決定的(完全修飾名の順)。ただしパッケージ追加で全部ずれる(C2-O2)。ADR の記述は不正確 |
| C2-N6 part 名と SCDL ID の衝突で書き出し不能 | **修正済み** | `IF-1@E`、`SRG-M1`・`NFSR-1`・`RG-1` を含む ev2 の SCDL 書き出しが `PilotCheck` でエラー・警告ゼロ |
| C2-N7 `qualifiedName` なしで例外 | **修正済み** | `INVALID_ELEMENT`(コード・テスト確認)。bad1/bad2 でも落ちずに診断 |
| C2-M5/M7 影響分析末尾の混入、同名兄弟の `#n` | **維持(軽微)** | 方向性は機能 |
| B3 標準の交換手段(API/JSON/XMI) | **一部対応(書き出しのみ。品質に欠陥)** | JSON/XMI は出力できる。X1〜X4。取り込み・API は未実装 |
| B3 jar の第三者ライセンス棚卸し | **未確認** | 証跡なし |
| ADR-0007/0008/0009 の正確さ | **一部修正** | 0008 は再定義(定義内/usage 内)・多重度・requirement def を反映。0007 追補の「パッケージの追加に依存しない」は不正確。0009 は制約の記述が不足 |
| 応答文書「SysML v2 標準 JSON・XMI は書き出しのみ実装」 | **事実(ただし限定つき)** | 出力は実在。ライブラリ参照・ID・エラー時の挙動に欠陥 |

## 外部確認待ち(合格時にも要実施)

- MBSE 専門家による G0 書面レビュー(ADR-0007/0008、SCDL ステレオタイプ、展開規約、階層規則)。担当: 外部 MBSE 専門家。
- 他の SysML v2 ツール・SysML v2 API サーバーでの JSON / XMI / `@Scdl*` / `modelRef` の読み込み確認。担当: MBSE 専門家 / ツール担当。
- ASAM SCDL v1.6.0 仕様書との突合(附属書 A)とライセンスの法務確認、jar の第三者ライセンス棚卸し。担当: 安全 + MBSE ドメイン担当、法務。

## 最終サマリ

- **A1: 88(減点 5、合否点 93 = 合格)/ B3: 83(減点 5、合否点 88 = 不合格)/ C2: 87(減点 5、合否点 92 = 合格)**。3 項目とも採点は 80 以上。
- ラウンド 4 の実装上の指摘は、多重度の `*` を除いて**すべて修正を実測で確認**。
- B3 を 90 以上にするには、(1) 標準ライブラリを解決した JSON/XMI、(2) エラーモデルの拒否と入力起因の失敗の正しい分類、(3) 安定 ID、(4) 文書への制約の明記、が最小限必要。取り込み/API は範囲の問題だが、B3 の上限を決める。
