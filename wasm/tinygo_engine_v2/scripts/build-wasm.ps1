[CmdletBinding()]
param(
    [string]$TinyGo = "tinygo",
    [string]$Entry = "./cmd/engine_wasm",
    [string]$Out = "./dist/tinygo_engine_v2.wasm",
    [string]$Target = "./targets/wasm-256m.json",
    [string[]]$TinyGoArgs = @("-scheduler=none", "-no-debug", "-opt=z")
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
        (Join-Path $workspaceRoot ".tools\binaryen-version_124\bin\wasm-opt.exe"),
        (Join-Path $projectRoot "binaryen-version_129\bin\wasm-opt.exe"),
        (Join-Path $projectRoot "binaryen-version_124\bin\wasm-opt.exe")
    )
    if ($resolvedWasmOpt) {
        $env:WASMOPT = $resolvedWasmOpt
    }
}

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
