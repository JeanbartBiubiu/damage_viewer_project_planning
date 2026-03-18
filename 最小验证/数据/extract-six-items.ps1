param(
    [string]$InputPath = "$PSScriptRoot/item.json",
    [string]$OutputPath
)

$targets = @'
[
  { "requestedName": "\u7834\u8d25", "sourceName": "\u7834\u8d25\u738b\u8005\u4e4b\u5203", "sourceItemId": "3153" },
  { "requestedName": "\u7eb3\u4ec0\u4e4b\u7259", "sourceName": "\u7eb3\u4ec0\u4e4b\u7259", "sourceItemId": "3115" },
  { "requestedName": "\u80b2\u6069\u5854\u5c14\u8352\u91ce\u7bad", "sourceName": "\u80b2\u6069\u5854\u5c14\u8352\u91ce\u7bad", "sourceItemId": "3032" },
  { "requestedName": "\u5170\u5fb7\u91cc\u7684\u6298\u78e8", "sourceName": "\u5170\u5fb7\u91cc\u7684\u6298\u78e8", "sourceItemId": "6653" },
  { "requestedName": "\u7f8a\u5200", "sourceName": "\u9b3c\u7d22\u7684\u72c2\u66b4\u4e4b\u5203", "sourceItemId": "3124" },
  { "requestedName": "\u754c\u5f13", "sourceName": "\u754c\u5f13", "sourceItemId": "3302" },
  { "requestedName": "\u51b0\u5fc3", "sourceName": "\u51b0\u971c\u4e4b\u5fc3", "sourceItemId": "3110" },
  { "requestedName": "\u5e03\u7532\u978b", "sourceName": "\u94c1\u677f\u9774", "sourceItemId": "3047" }
]
'@ | ConvertFrom-Json

$source = Get-Content -Raw -Encoding UTF8 $InputPath | ConvertFrom-Json

$result = [ordered]@{
    source = [ordered]@{
        file = [System.IO.Path]::GetFileName($InputPath)
        version = $source.version
    }
    items = @(
        foreach ($target in $targets) {
            $itemProperty = $source.data.PSObject.Properties[$target.sourceItemId]
            if (-not $itemProperty) {
                throw "Missing item source ID: $($target.sourceItemId)"
            }

            $item = $itemProperty.Value
            if ($item.name -ne $target.sourceName) {
                throw "Unexpected item name for ID $($target.sourceItemId): expected '$($target.sourceName)', got '$($item.name)'"
            }

            $entry = [ordered]@{
                requestedName = $target.requestedName
                sourceItemId = $target.sourceItemId
                name = $item.name
                description = $item.description
                plaintext = $item.plaintext
                statsModifier = if ($item.stats) { $item.stats } else { [ordered]@{} }
                recipeIds = @($item.from)
                gold = $item.gold
                tags = @($item.tags)
            }

            if ($item.effect) {
                $entry.effect = $item.effect
            }

            [PSCustomObject]$entry
        }
    )
}

$jsonText = (
    ($result | ConvertTo-Json -Depth 10) `
        -replace '\\u003c', '<' `
        -replace '\\u003e', '>' `
        -replace '\\u0027', "'"
) -replace "`r`n", "`n"

if (-not $jsonText.EndsWith("`n")) {
    $jsonText += "`n"
}

if ($OutputPath) {
    $resolvedOutputPath = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
        $OutputPath
    } else {
        Join-Path (Get-Location) $OutputPath
    }

    [System.IO.File]::WriteAllText(
        $resolvedOutputPath,
        $jsonText,
        [System.Text.UTF8Encoding]::new($false)
    )
}

$jsonText
