# 共通: 公式パイロット実装(jupyter-sysml-kernel 同梱の jar)の取得・展開とツールのコンパイル。
# 初回のみ conda-forge から jar を取得してキャッシュする(約 120MB)。必要: Java 21+、unzip、zstd か python3(pip)。
# 使い方: source lib.sh && ensure_pilot  → $CACHE / $JAR / $KDIR / $ROOT が設定される

VERSION="0.62.0"
BUILD="pyhd8ed1ab_0"
SHA256="67997bf79f88acb3d9617e3ca33e2a17f8562a00bc1500ae3b15f4f113c11cd6"
FILE="jupyter-sysml-kernel-${VERSION}-${BUILD}.conda"
URL="https://conda.anaconda.org/conda-forge/noarch/${FILE}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CACHE="${SYSML_PILOT_CACHE:-$HOME/.cache/fusamod/sysml-pilot-${VERSION}}"
KDIR="$CACHE/kernel/share/jupyter/kernels/sysml"
JAR="$KDIR/jupyter-sysml-kernel-${VERSION}-all.jar"
JAVA_OPTS_UTF8="-Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 -Dfile.encoding=UTF-8"
# 取得時の進捗ログなどを除くフィルタ
NOISE='^Reading |JAVA_TOOL_OPTIONS|^log4j'

ensure_pilot() {
  # 同時に複数のプロセスが取得・展開・コンパイルを始めて壊し合わないよう、排他ロックを取る(flock が無ければ省略)
  mkdir -p "$(dirname "$CACHE")"
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$CACHE.lock"
    flock 9
  fi
  if [ ! -f "$JAR" ]; then
    mkdir -p "$CACHE"
    echo "パイロット実装を取得します: $URL" >&2
    curl -fsS -o "$CACHE/$FILE" "$URL"
    echo "$SHA256  $CACHE/$FILE" | sha256sum -c - >&2
    (cd "$CACHE" && unzip -o -q "$FILE" "pkg-*.tar.zst")
    mkdir -p "$CACHE/kernel"
    if command -v zstd >/dev/null 2>&1; then
      zstd -dc "$CACHE"/pkg-*.tar.zst | tar -x -C "$CACHE/kernel"
    else
      python3 -m pip install -q --user zstandard >&2
      python3 - "$CACHE" <<'PY'
import glob, sys, tarfile, zstandard
cache = sys.argv[1]
with open(glob.glob(cache + "/pkg-*.tar.zst")[0], "rb") as f:
    tarfile.open(fileobj=zstandard.ZstdDecompressor().stream_reader(f), mode="r|").extractall(cache + "/kernel")
PY
    fi
    rm -f "$CACHE/$FILE" "$CACHE"/pkg-*.tar.zst
  fi
  for c in PilotCheck SysmlExtract SysmlServer; do
    if [ ! -f "$CACHE/$c.class" ] || [ "$HERE/$c.java" -nt "$CACHE/$c.class" ]; then
      javac -cp "$JAR:$CACHE" -d "$CACHE" "$HERE/$c.java" 2>&1 | { grep -v JAVA_TOOL_OPTIONS || true; }
    fi
  done
  if command -v flock >/dev/null 2>&1; then flock -u 9; fi
}
