#!/usr/bin/env bash
# 公式パイロット実装で examples/sysml/*.sysml を読み、汎用の要素グラフ(JSON)を examples/sysml/*.graph.json に出力する。
# このグラフを @fusamod/scdl の scdlFromGraph が読む(SysML アダプタ PoC)。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
ensure_pilot

OUT="${1:-$ROOT/examples/sysml}"
# shellcheck disable=SC2086
java $JAVA_OPTS_UTF8 -cp "$CACHE:$JAR" SysmlExtract "$KDIR/sysml.library" "$OUT" \
  "$ROOT/libs/sysml/scdl/SCDL.sysml" "$ROOT"/examples/sysml/*.sysml 2>&1 | grep -vE "$NOISE"
exit "${PIPESTATUS[0]}"
