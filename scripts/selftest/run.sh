#!/usr/bin/env bash
# 丛书分卷逻辑自测：纯 tsc 编译到临时目录后用 node 运行，不依赖任何测试框架。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/lib"
cp -r "$ROOT/lib/series" "$TMP/lib/series"
cp "$ROOT/scripts/selftest/suite.ts" "$TMP/suite.ts"
# 测试文件在临时目录里以 ./lib/series 引用逻辑层
sed "s#from '../../lib/series/#from './lib/series/#g" "$ROOT/scripts/selftest/suite.ts" > "$TMP/suite.ts"
FILES="$(ls "$TMP/lib/series/"*.ts | grep -v store.ts || true)"
"$ROOT/node_modules/.bin/tsc" \
  --outDir "$TMP/out" --rootDir "$TMP" \
  --module commonjs --target ES2022 --lib ES2022,DOM \
  --moduleResolution node --strict --skipLibCheck \
  "$TMP/suite.ts" $FILES
node "$TMP/out/suite.js"
