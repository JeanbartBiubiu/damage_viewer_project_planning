param(
    [string]$ApiBaseUrl = 'http://localhost:8080',
    [string]$GameId = 'lol',
    [string]$AdminToken = '',
    [string]$InputPath,
    [string]$ReportPath,
    [int]$Limit = 0,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($InputPath)) {
    $InputPath = Join-Path $PSScriptRoot 'item_panel_upserts.json'
}
if ([string]::IsNullOrWhiteSpace($ReportPath)) {
    $ReportPath = Join-Path $PSScriptRoot 'item_panel_import_report.json'
}

function ConvertTo-CompactJson {
    param([Parameter(Mandatory = $true)][object]$Value)
    return ($Value | ConvertTo-Json -Depth 32 -Compress)
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

function New-RequestHeaders {
    param([string]$Token)
    $headers = @{
        'Accept' = 'application/json'
    }
    if (-not [string]::IsNullOrWhiteSpace($Token)) {
        $headers['Authorization'] = "Bearer $Token"
    }
    return $headers
}

function Normalize-StringArray {
    param([object]$Value)
    if ($null -eq $Value) {
        return $null
    }
    if ($Value -isnot [System.Array]) {
        return $null
    }
    $result = @()
    foreach ($v in $Value) {
        if ($null -eq $v) {
            continue
        }
        $text = [string]$v
        if (-not [string]::IsNullOrWhiteSpace($text)) {
            $result += $text
        }
    }
    return $result
}

function Get-OptionalPropertyValue {
    param(
        [Parameter(Mandatory = $true)][object]$Object,
        [Parameter(Mandatory = $true)][string]$Name
    )
    $prop = $Object.PSObject.Properties[$Name]
    if ($null -eq $prop) {
        return $null
    }
    return $prop.Value
}

if (-not (Test-Path -LiteralPath $InputPath)) {
    throw "Input not found: $InputPath"
}

$headers = New-RequestHeaders -Token $AdminToken
$base = $ApiBaseUrl.TrimEnd('/')
$itemsUri = "$base/api/admin/games/$GameId/items"

$existingPayload = Invoke-RestMethod -Method Get -Uri $itemsUri -Headers $headers -TimeoutSec 30
$existingItems = @($existingPayload.items)
$existingMap = @{}
foreach ($item in $existingItems) {
    $existingMap[[string]$item.itemId] = $item
}

$sourcePayload = Get-Content -Raw -Encoding UTF8 -LiteralPath $InputPath | ConvertFrom-Json
$upserts = @($sourcePayload.items)
if ($Limit -gt 0) {
    $upserts = @($upserts | Select-Object -First $Limit)
}

$total = $upserts.Count
$success = 0
$failed = 0
$created = 0
$updated = 0
$errors = @()

for ($idx = 0; $idx -lt $total; $idx++) {
    $entry = $upserts[$idx]
    $itemId = [string]$entry.itemId
    if ([string]::IsNullOrWhiteSpace($itemId)) {
        $failed++
        $errors += [PSCustomObject]@{
            itemId = ''
            reason = 'itemId missing'
        }
        continue
    }

    $mods = @()
    foreach ($mod in @($entry.statModifiers)) {
        $attrKey = [string]$mod.attrKey
        if ([string]::IsNullOrWhiteSpace($attrKey)) {
            continue
        }
        $value = [double]$mod.value
        $mods += [PSCustomObject]@{
            attrKey = $attrKey
            value = $value
        }
    }

    $existing = $null
    if ($existingMap.ContainsKey($itemId)) {
        $existing = $existingMap[$itemId]
    }

    $body = [ordered]@{
        itemId = $itemId
        statModifiers = $mods
    }

    $name = [string]$entry.name
    if ([string]::IsNullOrWhiteSpace($name) -and $null -ne $existing) {
        $name = [string]$existing.name
    }
    if (-not [string]::IsNullOrWhiteSpace($name)) {
        $body.name = $name
    }

    if ($null -ne $existing) {
        $existingGoldCost = Get-OptionalPropertyValue -Object $existing -Name 'goldCost'
        if ($null -ne $existingGoldCost) {
            $body.goldCost = [int]$existingGoldCost
        }
        $iconUrl = [string](Get-OptionalPropertyValue -Object $existing -Name 'iconUrl')
        if (-not [string]::IsNullOrWhiteSpace($iconUrl)) {
            $body.iconUrl = $iconUrl
        }
        $skillRefs = Normalize-StringArray -Value (Get-OptionalPropertyValue -Object $existing -Name 'skillRefs')
        if ($null -ne $skillRefs) {
            $body.skillRefs = $skillRefs
        }
        $recipeIds = Normalize-StringArray -Value (Get-OptionalPropertyValue -Object $existing -Name 'recipeIds')
        if ($null -ne $recipeIds) {
            $body.recipeIds = $recipeIds
        }
    }

    if ($DryRun) {
        $success++
        if ($null -ne $existing) { $updated++ } else { $created++ }
        continue
    }

    $itemUri = "$itemsUri/$([Uri]::EscapeDataString($itemId))"
    $jsonBody = ConvertTo-CompactJson -Value $body
    $jsonBytes = [System.Text.Encoding]::UTF8.GetBytes($jsonBody)

    try {
        Invoke-WebRequest `
            -Method Put `
            -Uri $itemUri `
            -Headers $headers `
            -ContentType 'application/json; charset=utf-8' `
            -Body $jsonBytes `
            -UseBasicParsing `
            -TimeoutSec 30 | Out-Null
        $success++
        if ($null -ne $existing) { $updated++ } else { $created++ }
    } catch {
        $failed++
        $responseBody = ''
        if ($_.Exception.Response) {
            try {
                $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $responseBody = $reader.ReadToEnd()
                $reader.Close()
            } catch {
                $responseBody = ''
            }
        }
        $errors += [PSCustomObject]@{
            itemId = $itemId
            reason = $_.Exception.Message
            response = $responseBody
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
    inputPath = $InputPath
    dryRun = [bool]$DryRun
    total = $total
    success = $success
    failed = $failed
    created = $created
    updated = $updated
    errors = $errors
}

Write-JsonFile -Value $report -Path $ReportPath

"DONE"
"reportPath=$ReportPath"
"total=$total"
"success=$success"
"failed=$failed"
"created=$created"
"updated=$updated"
