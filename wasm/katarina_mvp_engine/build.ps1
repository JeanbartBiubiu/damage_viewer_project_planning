param(
    [string]$Profile = "release",
    [string]$Target = "wasm32-unknown-unknown",
    [string]$OutFile = ""
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$crateDir = $scriptDir
$cargoPath = Join-Path $env:USERPROFILE ".rustup\toolchains\stable-x86_64-pc-windows-msvc\bin\cargo.exe"

if (-not (Test-Path $cargoPath)) {
    $cargoPath = "cargo"
}

Write-Host "Building katarina_mvp_engine with cargo: $cargoPath"
& $cargoPath build --manifest-path (Join-Path $crateDir "Cargo.toml") --target $Target --profile $Profile

$wasmFile = Join-Path $crateDir "target\$Target\$Profile\katarina_mvp_engine.wasm"
if (-not (Test-Path $wasmFile)) {
    throw "Wasm output not found: $wasmFile"
}

if ($OutFile) {
    $outDir = Split-Path -Parent $OutFile
    if ($outDir) {
        New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    }
    Copy-Item -Force $wasmFile $OutFile
    Write-Host "Copied wasm to: $OutFile"
} else {
    Write-Host "Wasm output: $wasmFile"
}
