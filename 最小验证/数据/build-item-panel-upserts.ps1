param(
    [string]$ItemJsonPath,
    [string]$AttrDefsPath,
    [string]$OutputItemsPath,
    [string]$OutputMissingAttrsPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if ([string]::IsNullOrWhiteSpace($ItemJsonPath)) {
    $ItemJsonPath = Join-Path $PSScriptRoot 'item.json'
}
if ([string]::IsNullOrWhiteSpace($AttrDefsPath)) {
    $AttrDefsPath = Join-Path $workspaceRoot 'tmp_attr_defs_response.json'
}
if ([string]::IsNullOrWhiteSpace($OutputItemsPath)) {
    $OutputItemsPath = Join-Path $PSScriptRoot 'item_panel_upserts.json'
}
if ([string]::IsNullOrWhiteSpace($OutputMissingAttrsPath)) {
    $OutputMissingAttrsPath = Join-Path $PSScriptRoot 'item_panel_missing_attribute_definitions.json'
}

$statKeyToAttrKey = [ordered]@{
    FlatPhysicalDamageMod    = 'ad'
    FlatMagicDamageMod       = 'ap'
    FlatHPPoolMod            = 'hp'
    FlatMPPoolMod            = 'mana'
    FlatArmorMod             = 'armor'
    FlatSpellBlockMod        = 'magic_resist'
    FlatHPRegenMod           = 'hp_regen'
    FlatCritChanceMod        = 'crit_chance'
    PercentAttackSpeedMod    = 'attack_speed'
    PercentLifeStealMod      = 'life_steal'
    FlatMovementSpeedMod     = 'ms_f'
    PercentMovementSpeedMod  = 'ms_pct'
}

$attrMeta = @{
    ad = @{ attrName = 'Attack Damage'; valueKind = 'scalar' }
    ap = @{ attrName = 'Ability Power'; valueKind = 'scalar' }
    hp = @{ attrName = 'Health'; valueKind = 'scalar' }
    mana = @{ attrName = 'Mana'; valueKind = 'scalar' }
    armor = @{ attrName = 'Armor'; valueKind = 'scalar' }
    magic_resist = @{ attrName = 'Magic Resist'; valueKind = 'scalar' }
    hp_regen = @{ attrName = 'Health Regen'; valueKind = 'rate' }
    crit_chance = @{ attrName = 'Critical Chance'; valueKind = 'scalar' }
    attack_speed = @{ attrName = 'Attack Speed'; valueKind = 'scalar' }
    life_steal = @{ attrName = 'Life Steal'; valueKind = 'scalar' }
    ms_f = @{ attrName = 'Flat Move Speed'; valueKind = 'scalar' }
    ms_pct = @{ attrName = 'Percent Move Speed'; valueKind = 'scalar' }
    ability_haste = @{ attrName = 'Ability Haste'; valueKind = 'scalar' }
}

function To-JsonUtf8NoBom {
    param(
        [Parameter(Mandatory = $true)] [object]$Value,
        [Parameter(Mandatory = $true)] [string]$Path
    )

    $json = ($Value | ConvertTo-Json -Depth 32) -replace "`r`n", "`n"
    if (-not $json.EndsWith("`n")) {
        $json += "`n"
    }
    $dir = Split-Path -Path $Path -Parent
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir | Out-Null
    }
    [System.IO.File]::WriteAllText($Path, $json, [System.Text.UTF8Encoding]::new($false))
}

function Get-AttrKeySet {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    }

    $raw = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path
    $obj = $raw | ConvertFrom-Json

    $definitions = @()
    if ($obj -is [System.Array]) {
        $definitions = $obj
    } elseif ($obj.PSObject.Properties.Name -contains 'attributeDefinitions') {
        $definitions = @($obj.attributeDefinitions)
    }

    $set = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($def in $definitions) {
        $key = [string]$def.attrKey
        if (-not [string]::IsNullOrWhiteSpace($key)) {
            [void]$set.Add($key.Trim())
        }
    }
    return $set
}

function Get-AbilityHasteFromDescription {
    param([string]$Description)

    if ([string]::IsNullOrWhiteSpace($Description)) {
        return 0.0
    }

    $statsMatch = [regex]::Match($Description, '(?is)<stats>(.*?)</stats>')
    if (-not $statsMatch.Success) {
        return 0.0
    }

    $statsBlock = [string]$statsMatch.Groups[1].Value
    if ([string]::IsNullOrWhiteSpace($statsBlock)) {
        return 0.0
    }

    $normalized = [regex]::Replace($statsBlock, '(?i)<br\s*/?>', "`n")
    $lines = [regex]::Split($normalized, "`n")
    foreach ($line in $lines) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }
        if ($line -notmatch '\u6280\u80fd(?:\u6025|\u6781)\u901f') {
            continue
        }

        $plain = [regex]::Replace($line, '<[^>]+>', '')
        $numMatch = [regex]::Match($plain, '([+-]?\d+(?:\.\d+)?)')
        if (-not $numMatch.Success) {
            continue
        }

        $value = 0.0
        if ([double]::TryParse($numMatch.Groups[1].Value, [ref]$value) -and $value -ne 0.0) {
            return $value
        }
    }

    return 0.0
}

$itemRaw = Get-Content -Raw -Encoding UTF8 -LiteralPath $ItemJsonPath
$itemRoot = $itemRaw | ConvertFrom-Json

$items = @()
$unmappedStatKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
$usedAttrKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
$abilityHasteFromDescriptionCount = 0

foreach ($entry in $itemRoot.data.PSObject.Properties) {
    $itemId = [string]$entry.Name
    $item = $entry.Value
    if ($null -eq $item.stats) {
        continue
    }

    $statModifiers = @()
    foreach ($statProp in $item.stats.PSObject.Properties) {
        $sourceKey = [string]$statProp.Name
        $targetAttrKey = $null
        if (-not $statKeyToAttrKey.Contains($sourceKey)) {
            $valueCheck = 0.0
            [double]::TryParse(([string]$statProp.Value), [ref]$valueCheck) | Out-Null
            if ($valueCheck -ne 0.0) {
                [void]$unmappedStatKeys.Add($sourceKey)
            }
            continue
        }

        $targetAttrKey = [string]$statKeyToAttrKey[$sourceKey]
        $value = 0.0
        [double]::TryParse(([string]$statProp.Value), [ref]$value) | Out-Null
        if ($value -eq 0.0) {
            continue
        }
        [void]$usedAttrKeys.Add($targetAttrKey)
        $statModifiers += [PSCustomObject]@{
            attrKey = $targetAttrKey
            value   = $value
        }
    }

    $abilityHaste = Get-AbilityHasteFromDescription -Description ([string]$item.description)
    if ($abilityHaste -ne 0.0) {
        $hasAbilityHasteModifier = $false
        foreach ($existingModifier in $statModifiers) {
            if ([string]$existingModifier.attrKey -eq 'ability_haste') {
                $hasAbilityHasteModifier = $true
                break
            }
        }

        if (-not $hasAbilityHasteModifier) {
            [void]$usedAttrKeys.Add('ability_haste')
            $statModifiers += [PSCustomObject]@{
                attrKey = 'ability_haste'
                value   = $abilityHaste
            }
            $abilityHasteFromDescriptionCount++
        }
    }

    if ($statModifiers.Count -eq 0) {
        continue
    }

    $items += [PSCustomObject]@{
        itemId = $itemId
        name = [string]$item.name
        statModifiers = @($statModifiers | Sort-Object attrKey)
    }
}

$existingAttrKeys = Get-AttrKeySet -Path $AttrDefsPath
$missingAttrDefs = @()
foreach ($attrKey in ($usedAttrKeys | Sort-Object)) {
    if ($existingAttrKeys.Contains($attrKey)) {
        continue
    }
    $meta = $attrMeta[$attrKey]
    $missingAttrDefs += [PSCustomObject]@{
        attrKey = $attrKey
        attrName = [string]$meta.attrName
        attrType = 'number'
        valueKind = [string]$meta.valueKind
        sortOrder = 0
    }
}

$itemsOutput = [PSCustomObject]@{
    source = [PSCustomObject]@{
        itemJsonPath = $ItemJsonPath
        version = [string]$itemRoot.version
        generatedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
    }
    mapping = [PSCustomObject]$statKeyToAttrKey
    summary = [PSCustomObject]@{
        totalItemsInSource = ($itemRoot.data.PSObject.Properties | Measure-Object).Count
        itemsWithPanelStats = $items.Count
        itemsWithAbilityHasteFromDescription = $abilityHasteFromDescriptionCount
        distinctMappedAttrKeys = $usedAttrKeys.Count
        distinctUnmappedNonZeroStatKeys = $unmappedStatKeys.Count
    }
    items = @($items | Sort-Object itemId)
}

$missingOutput = [PSCustomObject]@{
    sourceAttrDefsPath = $AttrDefsPath
    missingAttributeDefinitions = @($missingAttrDefs)
    unmappedNonZeroStatKeys = @($unmappedStatKeys | Sort-Object)
}

To-JsonUtf8NoBom -Value $itemsOutput -Path $OutputItemsPath
To-JsonUtf8NoBom -Value $missingOutput -Path $OutputMissingAttrsPath

"DONE"
"itemsOutput=$OutputItemsPath"
"missingOutput=$OutputMissingAttrsPath"
"itemsWithPanelStats=$($items.Count)"
"mappedAttrKeys=$($usedAttrKeys.Count)"
"missingAttrDefs=$($missingAttrDefs.Count)"
"unmappedNonZeroStatKeys=$($unmappedStatKeys.Count)"
