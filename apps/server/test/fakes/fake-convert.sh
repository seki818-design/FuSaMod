#!/usr/bin/env bash
# convert.sh の代役。引数: <json|xmi> <入力の絶対パス>。MODE 環境変数で挙動を変える。
fmt="$1"; file="$2"; dir="$(dirname "$file")"
case "${FAKE_MODE:-ok}" in
  ok) if [ "$fmt" = json ]; then echo '[{"payload":{"@type":"PartUsage","elementId":"x"}}]' > "$dir/model.json"; else echo '<?xml version="1.0"?><x/>' > "$dir/model.sysmlx"; fi ;;
  empty) echo '[]' > "$dir/model.json" ;;
  fail) echo "boom /tmp/secret/path" >&2; exit 1 ;;
  slow) sleep 30 ;;
  spawn-child) (sleep 30 &) ; sleep 30 ;;
esac
