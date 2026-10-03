#!/usr/bin/env bash
# 公式パイロット実装の変換器で、SysML v2 テキスト(.sysml)を標準の形式に変換する。
#   使い方: convert.sh json|xmi <.sysml の絶対パス>
#   出力:   入力と同じディレクトリに <名前>.json(SysML v2 API の JSON 形式)または <名前>.sysmlx(XMI)
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
ensure_pilot
fmt="${1:?json か xmi を指定してください}"
file="${2:?入力の .sysml の絶対パスを指定してください}"
[[ "$file" = /* ]] || { echo "絶対パスで指定してください: $file" >&2; exit 2; }
case "$fmt" in
  json) cls=SysML2JSON ;;
  xmi) cls=SysML2XMI ;;
  *) echo "不明な形式: $fmt" >&2; exit 2 ;;
esac
cd "$(dirname "$file")"
# 標準ライブラリ(ScalarValues、単位系)と SCDL ステレオタイプは、変換器に「追加の入力」として同時に渡す。
# 渡さないと、参照が名前のない Type になる(JSON の ID・XMI の href が不安定)、単位式や @Scdl* を含むモデルが変換できない(NPE)。
# ライブラリの置き場には空白を含むパスがあり、変換器が扱えないため、空白のない作業ディレクトリへコピーする。
LIBDIR="$(dirname "$file")/lib"
mkdir -p "$LIBDIR"
KLIB="$KDIR/sysml.library"
extra=()
cp "$KLIB/Kernel Libraries/Kernel Data Type Library/ScalarValues.kerml" "$LIBDIR/"
extra+=("$LIBDIR/ScalarValues.kerml")
if grep -Eq '\b(ISQ[A-Za-z]*|SI|SIPrefixes|MeasurementReferences|Quantities|USCustomaryUnits|Time|[A-Za-z]*Calculations)\b *::|\[ *[A-Za-z]+' "$file"; then
  cp "$KLIB/Domain Libraries/Quantities and Units/"*.sysml "$LIBDIR/"
  for f in "$LIBDIR"/*.sysml; do extra+=("$f"); done
fi
if grep -Eq '\bSCDL\b|@Scdl' "$file"; then
  cp "$ROOT/libs/sysml/scdl/SCDL.sysml" "$LIBDIR/"
  extra+=("$LIBDIR/SCDL.sysml")
fi
# shellcheck disable=SC2086
java $JAVA_OPTS_UTF8 -cp "$JAR" "org.omg.sysml.xtext.util.$cls" "$file" "${extra[@]}" 2>&1 | grep -vE "$NOISE|log4j" >&2
# 終了コードは java のものを返す(出力ファイルの有無は呼び出し側が確認する)
exit "${PIPESTATUS[0]}"
