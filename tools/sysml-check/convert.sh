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
# shellcheck disable=SC2086
java $JAVA_OPTS_UTF8 -cp "$JAR" "org.omg.sysml.xtext.util.$cls" "$file" 2>&1 | grep -vE "$NOISE|log4j" >&2 || true
