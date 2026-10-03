#!/usr/bin/env bash
# 公式パイロット実装で SysML を読み、汎用の要素グラフ(JSON)を出力する。
#   examples/sysml/*.sysml        → examples/sysml/*.graph.json
#   projects/*/model.sysml        → projects/*/model.graph.json
# このグラフを @fusamod/sysml-graph / @fusamod/scdl が読む。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
ensure_pilot

LIB="$ROOT/libs/sysml/scdl/SCDL.sysml"
status=0

# shellcheck disable=SC2086
java $JAVA_OPTS_UTF8 -cp "$CACHE:$JAR" SysmlExtract "$KDIR/sysml.library" "${1:-$ROOT/examples/sysml}" \
  "$LIB" "$ROOT"/examples/sysml/*.sysml 2>&1 | grep -vE "$NOISE" || true
[ "${PIPESTATUS[0]}" -eq 0 ] || status=1

for m in "$ROOT"/projects/*/model.sysml; do
  [ -f "$m" ] || continue
  # shellcheck disable=SC2086
  java $JAVA_OPTS_UTF8 -cp "$CACHE:$JAR" SysmlExtract "$KDIR/sysml.library" "$(dirname "$m")" "$LIB" "$m" 2>&1 | grep -vE "$NOISE" || true
  [ "${PIPESTATUS[0]}" -eq 0 ] || status=1
done
exit "$status"
