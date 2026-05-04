param(
    [string]$ApiBaseUrl = 'http://localhost:8080',
    [string]$GameId = 'lol',
    [string]$AdminToken = '',
    [string]$ItemJsonPath,
    [string]$ReportPath,
    [int]$Limit = 0,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ItemJsonPath)) {
    $ItemJsonPath = Join-Path $PSScriptRoot 'item.json'
}
if ([string]::IsNullOrWhiteSpace($ReportPath)) {
    $ReportPath = Join-Path $PSScriptRoot 'item_image_key_repair_report.json'
}

function New-JsonHeaders {
    param([string]$Token)
    $headers = @{
        Accept = 'application/json'
    }
    if (-not [string]::IsNullOrWhiteSpace($Token)) {
        $headers.Authorization = "Bearer $Token"
    }
    return $headers
}

function Write-JsonFile {
    param(
        [Parameter(Mandatory = $true)][object]$Value,
        [Parameter(Mandatory = $true)][string]$Path
    )
    $json = ($Value | ConvertTo-Json -Depth 32) -replace "`r`n", "`n"
    if (-not $json.EndsWith("`n")) {
        $json += "`n"
    }
    [System.IO.File]::WriteAllText($Path, $json, [System.Text.UTF8Encoding]::new($false))
}

function To-DataUrl {
    param(
        [Parameter(Mandatory = $true)][byte[]]$Bytes,
        [Parameter(Mandatory = $true)][string]$MimeType
    )
    return "data:$MimeType;base64,$([Convert]::ToBase64String($Bytes))"
}

if (-not (Test-Path -LiteralPath $ItemJsonPath)) {
    throw "item json not found: $ItemJsonPath"
}

$itemRoot = Get-Content -Raw -Encoding UTF8 -LiteralPath $ItemJsonPath | ConvertFrom-Json
$version = [string]$itemRoot.version

$itemMetaById = @{}
foreach ($prop in $itemRoot.data.PSObject.Properties) {
    $itemId = [string]$prop.Name
    $item = $prop.Value
    if ($null -eq $item) {
        continue
    }
    $full = [string]$item.image.full
    if ([string]::IsNullOrWhiteSpace($full)) {
        continue
    }
    $itemMetaById[$itemId] = [PSCustomObject]@{
        itemId = $itemId
        name = [string]$item.name
        imageFull = $full
    }
}

$headers = New-JsonHeaders -Token $AdminToken
$base = $ApiBaseUrl.TrimEnd('/')
$itemsApi = "$base/api/admin/games/$GameId/items"

$itemsResp = Invoke-RestMethod -Method Get -Uri $itemsApi -Headers $headers -TimeoutSec 60
$numericItems = @($itemsResp.items | Where-Object { ([string]$_.itemId) -match '^[0-9]+$' } | Sort-Object { [int]$_.itemId })
if ($Limit -gt 0) {
    $numericItems = @($numericItems | Select-Object -First $Limit)
}

$total = $numericItems.Count
$success = 0
$failed = 0
$missingInJson = 0
$errors = @()

for ($idx = 0; $idx -lt $total; $idx++) {
    $itemId = [string]$numericItems[$idx].itemId
    if (-not $itemMetaById.ContainsKey($itemId)) {
        $missingInJson++
        $failed++
        $errors += [PSCustomObject]@{
            itemId = $itemId
            reason = 'missing item metadata in json'
        }
        continue
    }

    $meta = $itemMetaById[$itemId]
    $full = [string]$meta.imageFull
    $uriKey = "item_$itemId"
    $iconUrl = "https://ddragon.leagueoflegends.com/cdn/$version/img/item/$full"

    if ($DryRun) {
        $success++
        continue
    }

    try {
        $resp = Invoke-WebRequest -Method Get -Uri $iconUrl -UseBasicParsing -TimeoutSec 45
        $bytes = [byte[]]$resp.Content
        $dataUrl = To-DataUrl -Bytes $bytes -MimeType 'image/png'

        $payload = @{ imageBase64 = $dataUrl } | ConvertTo-Json -Compress
        $payloadBytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
        $putUrl = "$base/api/admin/games/$GameId/images/$uriKey"
        Invoke-WebRequest -Method Put -Uri $putUrl -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $payloadBytes -UseBasicParsing -TimeoutSec 45 | Out-Null

        $success++
    } catch {
        $failed++
        $message = $_.Exception.Message
        $errors += [PSCustomObject]@{
            itemId = $itemId
            uri = $uriKey
            source = $iconUrl
            reason = $message
        }
    }

    if ((($idx + 1) % 50) -eq 0 -or ($idx + 1) -eq $total) {
        "progress=$($idx + 1)/$total success=$success failed=$failed"
    }
}

$report = [PSCustomObject]@{
    generatedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
    apiBaseUrl = $ApiBaseUrl
    gameId = $GameId
    sourceItemJson = $ItemJsonPath
    version = $version
    total = $total
    success = $success
    failed = $failed
    missingInJson = $missingInJson
    dryRun = [bool]$DryRun
    errors = $errors
}

Write-JsonFile -Value $report -Path $ReportPath

"DONE"
"reportPath=$ReportPath"
"total=$total"
"success=$success"
"failed=$failed"
