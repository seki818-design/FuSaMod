#!/usr/bin/env bash
# 公式パイロット実装を常駐させる(JSON Lines)。起動時にライブラリ(SCDL)を 1 回だけ読み込み、{"ready":true} を出力する。
# 標準出力はプロトコル専用。取得・コンパイルの進捗は標準エラーに出す。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
ensure_pilot >&2
# shellcheck disable=SC2086
exec java $JAVA_OPTS_UTF8 -Xss4m -cp "$CACHE:$JAR" SysmlServer "$KDIR/sysml.library" "$ROOT/libs/sysml/scdl/SCDL.sysml"
