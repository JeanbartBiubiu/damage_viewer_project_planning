#!/usr/bin/env bash
# macOS/Linux 正式构建，入口、target 与参数同 build-wasm.ps1。
# TinyGo 不在 PATH 时用 TINYGO=<路径> 指定；WASMOPT 可指定 wasm-opt。
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workspace="$(cd "$root/../.." && pwd)"
project="$(cd "$workspace/.." && pwd)"
entry="${ENTRY:-./cmd/engine_wasm}"
out="${OUT:-./dist/tinygo_engine_v2.wasm}"
target="$root/targets/wasm-256m.json"

first_existing() {
  for candidate in "$@"; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 0
}

tinygo="${TINYGO:-tinygo}"
if ! command -v "$tinygo" >/dev/null 2>&1; then
  tinygo="$(first_existing "$workspace/.tools/tinygo0.40.1/tinygo/bin/tinygo" "$project/tinygo0.40.1/tinygo/bin/tinygo")"
  if [ -z "$tinygo" ]; then
    echo "TinyGo was not found on PATH or local fallback locations. Install TinyGo or set TINYGO=<path>." >&2
    exit 1
  fi
fi

if [ -z "${WASMOPT:-}" ]; then
  wasmopt="$(first_existing "$workspace/.tools/binaryen-version_129/bin/wasm-opt" \
    "$project/binaryen-version_129/bin/wasm-opt")"
  if [ -n "$wasmopt" ]; then
    export WASMOPT="$wasmopt"
  fi
fi

export WASMOPT="${WASMOPT:-wasm-opt}"
tinygo_version="$("$tinygo" version)"
if [[ "$tinygo_version" != "tinygo version 0.40.1 "* || "$tinygo_version" != *"using go version go1.25.2 "* ]]; then
  echo "Formal build requires TinyGo 0.40.1 using Go 1.25.2. Actual: $tinygo_version" >&2
  exit 1
fi
wasmopt_version="$("$WASMOPT" --version)"
if [[ ! "$wasmopt_version" =~ ^wasm-opt\ version\ 129([^0-9]|$) ]]; then
  echo "Formal build requires Binaryen 129. Actual: $wasmopt_version" >&2
  exit 1
fi
echo "$tinygo_version"
echo "$wasmopt_version"

cd "$root"
mkdir -p "$(dirname "$out")"
"$tinygo" build -scheduler=none -no-debug -opt=2 -target "$target" -o "$out" "$entry"
echo "Built $root/${out#./} ($(wc -c < "$out" | tr -d ' ') bytes)"
