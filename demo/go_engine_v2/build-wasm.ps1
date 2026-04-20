$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root "dist"
$wasmPath = Join-Path $dist "go_engine_v2_demo.wasm"
$gzipPath = Join-Path $dist "go_engine_v2_demo.wasm.gz"
$wasmExecPath = Join-Path $dist "wasm_exec.js"

New-Item -ItemType Directory -Force $dist | Out-Null

$previousGoos = $env:GOOS
$previousGoarch = $env:GOARCH

try {
    $env:GOOS = "js"
    $env:GOARCH = "wasm"
    go build -trimpath -ldflags="-s -w" -o $wasmPath ./cmd/wasm

    $goroot = (go env GOROOT).Trim()
    $wasmExecSource = Join-Path $goroot "lib\wasm\wasm_exec.js"
    if (-not (Test-Path $wasmExecSource)) {
        $wasmExecSource = Join-Path $goroot "misc\wasm\wasm_exec.js"
    }
    Copy-Item $wasmExecSource $wasmExecPath -Force

    if (Test-Path $gzipPath) {
        Remove-Item $gzipPath -Force
    }

    $inputStream = [System.IO.File]::OpenRead($wasmPath)
    try {
        $outputStream = [System.IO.File]::Create($gzipPath)
        try {
            $gzipStream = New-Object System.IO.Compression.GZipStream(
                $outputStream,
                [System.IO.Compression.CompressionLevel]::Optimal
            )
            try {
                $inputStream.CopyTo($gzipStream)
            } finally {
                $gzipStream.Dispose()
            }
        } finally {
            $outputStream.Dispose()
        }
    } finally {
        $inputStream.Dispose()
    }

    $rawSize = (Get-Item $wasmPath).Length
    $gzipSize = (Get-Item $gzipPath).Length
    Write-Host ("built_wasm={0}" -f $wasmPath)
    Write-Host ("raw_bytes={0}" -f $rawSize)
    Write-Host ("gzip_bytes={0}" -f $gzipSize)
} finally {
    $env:GOOS = $previousGoos
    $env:GOARCH = $previousGoarch
}
