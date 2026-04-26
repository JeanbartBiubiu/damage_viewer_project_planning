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
$targetPath = Resolve-Path (Join-Path $root $Target)
$outPath = Join-Path $root $Out
$outDir = Split-Path -Parent $outPath

if (-not (Get-Command $TinyGo -ErrorAction SilentlyContinue)) {
    throw "TinyGo executable '$TinyGo' was not found on PATH. Install TinyGo or pass -TinyGo <path>."
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
