param(
  [string] $Command = 'npm'
)

$ErrorActionPreference = 'Stop'
$commandArguments = $args
if ($Command -notin @('node', 'npm', 'npx')) {
  throw '用法：tools/web.ps1 <node|npm|npx> [命令参数]'
}
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$webRoot = Join-Path $repositoryRoot 'web'
$nodeVersion = (Get-Content -Raw -LiteralPath (Join-Path $webRoot '.node-version')).Trim()
if ($nodeVersion -notmatch '^\d+\.\d+\.\d+$') {
  throw 'web/.node-version 必须是完整的 Node 版本号。'
}

$toolsRoot = Join-Path $repositoryRoot '.tools'
$archiveName = "node-v$nodeVersion-win-x64.zip"
$runtimeRoot = Join-Path $toolsRoot "node-v$nodeVersion-win-x64"
$nodeExecutable = Join-Path $runtimeRoot 'node.exe'
$installationMarker = Join-Path $runtimeRoot '.installation-complete'
if (-not ((Test-Path -LiteralPath $nodeExecutable) -and (Test-Path -LiteralPath $installationMarker))) {
  New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null
  $archivePath = Join-Path $toolsRoot $archiveName
  $releaseUrl = "https://nodejs.org/dist/v$nodeVersion"
  Write-Host "正在下载项目所需的 Node $nodeVersion。"
  Invoke-WebRequest -Uri "$releaseUrl/$archiveName" -OutFile $archivePath -UseBasicParsing
  $checksums = (Invoke-WebRequest -Uri "$releaseUrl/SHASUMS256.txt" -UseBasicParsing).Content
  $checksumLine = ($checksums -split "`n") | Where-Object { $_.Trim().EndsWith("  $archiveName") }
  $expectedHash = $checksumLine -replace '\s+.*$', ''
  if (-not $expectedHash -or (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ine $expectedHash) {
    throw 'Node 压缩包摘要不匹配，安装已停止。'
  }
  Expand-Archive -LiteralPath $archivePath -DestinationPath $toolsRoot -Force
  New-Item -Path $installationMarker -ItemType File -Force | Out-Null
}

$actualVersion = (& $nodeExecutable --version).Trim()
if ($LASTEXITCODE -ne 0 -or $actualVersion -ne "v$nodeVersion") {
  throw '项目 Node 版本与 web/.node-version 不一致。'
}

$originalPath = $env:Path
Push-Location $webRoot
try {
  $env:Path = "$runtimeRoot;$originalPath"
  if ($Command -eq 'node') {
    & $nodeExecutable @commandArguments
  } else {
    $commandScript = Join-Path $runtimeRoot "node_modules/npm/bin/$Command-cli.js"
    & $nodeExecutable $commandScript @commandArguments
  }
  $commandExitCode = $LASTEXITCODE
} finally {
  $env:Path = $originalPath
  Pop-Location
}
exit $commandExitCode
