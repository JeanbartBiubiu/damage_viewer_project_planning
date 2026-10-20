[CmdletBinding()]
param(
    [string]$TinyGo = "tinygo",
    [string]$Entry = "./cmd/engine_wasm",
    [string]$Out = "./dist/tinygo_engine_v2.wasm",
    [string]$Target = "./targets/wasm-256m.json",
    [string[]]$TinyGoArgs = @("-scheduler=none", "-no-debug", "-opt=2")
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$workspaceRoot = Resolve-Path (Join-Path $root "..\..")
$projectRoot = Resolve-Path (Join-Path $workspaceRoot "..")
$targetPath = Resolve-Path (Join-Path $root $Target)
$outPath = Join-Path $root $Out
$outDir = Split-Path -Parent $outPath

function Resolve-LocalTool {
    param(
        [string[]]$Candidates
    )

    return $Candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if (-not (Get-Command $TinyGo -ErrorAction SilentlyContinue)) {
    if ($TinyGo -eq "tinygo") {
        $resolvedFallback = Resolve-LocalTool @(
            (Join-Path $workspaceRoot ".tools\tinygo0.40.1\tinygo\bin\tinygo.exe"),
            (Join-Path $projectRoot "tinygo0.40.1\tinygo\bin\tinygo.exe")
        )
        if ($resolvedFallback) {
            $TinyGo = $resolvedFallback
        }
    }
}

if (-not (Get-Command $TinyGo -ErrorAction SilentlyContinue)) {
    throw "TinyGo executable '$TinyGo' was not found on PATH or repo-local fallback locations. Install TinyGo or pass -TinyGo <path>."
}

if (-not $env:WASMOPT) {
    $resolvedWasmOpt = Resolve-LocalTool @(
        (Join-Path $workspaceRoot ".tools\binaryen-version_129\bin\wasm-opt.exe"),
            (Join-Path $projectRoot "binaryen-version_129\bin\wasm-opt.exe")
    )
    if ($resolvedWasmOpt) {
        $env:WASMOPT = $resolvedWasmOpt
    }
}

if (-not $env:WASMOPT) { $env:WASMOPT = "wasm-opt" }
$tinyGoVersion = & $TinyGo version
if ($LASTEXITCODE -ne 0 -or $tinyGoVersion -notmatch '^tinygo version 0\.40\.1\b.*using go version go1\.25\.2\b') {
    throw "Formal build requires TinyGo 0.40.1 using Go 1.25.2. Actual: $tinyGoVersion"
}
$wasmOptVersion = & $env:WASMOPT --version
if ($LASTEXITCODE -ne 0 -or $wasmOptVersion -notmatch '^wasm-opt version 129\b') {
    throw "Formal build requires Binaryen 129. Actual: $wasmOptVersion"
}
Write-Host $tinyGoVersion
Write-Host $wasmOptVersion

New-Item -ItemType Directory -Force $outDir | Out-Null

Push-Location $root
try {
    $argsList = @("build") + $TinyGoArgs + @("-target", $targetPath, "-o", $outPath, $Entry)
    & $TinyGo @argsList
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }

    $artifact = Get-Item $outPath
    Write-Host ("Built {0} ({1} bytes)" -f $artifact.FullName, $artifact.Length)
}
finally {
    Pop-Location
}
