$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$crateRoot = $PSScriptRoot
$wasmSource = Join-Path $crateRoot "target\wasm32-unknown-unknown\release\katarina_mvp_engine.wasm"
$wasmTargetDir = Join-Path $repoRoot "web\src\engine\wasm"
$wasmTarget = Join-Path $wasmTargetDir "katarina_mvp_engine.wasm"
$cargoCandidates = @(
    (Join-Path $env:USERPROFILE ".cargo\bin\cargo.exe"),
    "cargo.exe"
)
$cargo = $cargoCandidates | Where-Object { $_ -eq "cargo.exe" -or (Test-Path $_) } | Select-Object -First 1

if (-not $cargo) {
    throw "cargo.exe not found. Install Rust and ensure cargo is available."
}

Push-Location $crateRoot
try {
    & $cargo build --target wasm32-unknown-unknown --release
    if ($LASTEXITCODE -ne 0) {
        throw "cargo build failed with exit code $LASTEXITCODE. See compiler output above for the root cause."
    }
    if (-not (Test-Path $wasmSource)) {
        throw "Expected Wasm output was not found: $wasmSource"
    }
    if (-not (Test-Path $wasmTargetDir)) {
        New-Item -ItemType Directory -Path $wasmTargetDir | Out-Null
    }
    Copy-Item -Path $wasmSource -Destination $wasmTarget -Force
    Write-Output "Updated $wasmTarget"
} finally {
    Pop-Location
}
