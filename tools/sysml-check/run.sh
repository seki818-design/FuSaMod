#!/usr/bin/env bash
# 公式パイロット実装で、SCDL ライブラリと examples/sysml の全 .sysml を検証する(型・参照・多重度)。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
ensure_pilot

# ライブラリを先に、続いて examples/sysml の全ファイルを同一セッションで読み込む
FILES=("$ROOT/libs/sysml/scdl/SCDL.sysml" "$ROOT"/examples/sysml/*.sysml "$ROOT"/projects/*/model.sysml)
# shellcheck disable=SC2086
java $JAVA_OPTS_UTF8 -cp "$CACHE:$JAR" PilotCheck "$KDIR/sysml.library" "${FILES[@]}" 2>&1 | grep -vE "$NOISE"
exit "${PIPESTATUS[0]}"
