param([Parameter(Mandatory=$true)][string]$ManifestPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Drawing
$manifestFile = [System.IO.Path]::GetFullPath($ManifestPath)
$allowedRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
if (-not $manifestFile.StartsWith($allowedRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw '清单不在授权目录' }
$manifest = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($entry in $manifest.items) {
    if ($entry.downloadStatus -ne '下载成功') { continue }
    $imagePath = [System.IO.Path]::GetFullPath($entry.absolutePath)
    if (-not $imagePath.StartsWith($allowedRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw '图片不在授权目录' }
    $stream = $null; $sourceImage = $null; $bitmap = $null; $canvas = $null; $encoded = $null
    try {
        $bytes = [System.IO.File]::ReadAllBytes($imagePath)
        $stream = [System.IO.MemoryStream]::new($bytes, $false)
        # validateImageData=true，然后完整绘制并重新编码到内存，避免只读PNG头而漏掉损坏数据。
        $sourceImage = [System.Drawing.Image]::FromStream($stream, $true, $true)
        if ($sourceImage.RawFormat.Guid -ne [System.Drawing.Imaging.ImageFormat]::Png.Guid) { throw '解码后格式不是PNG' }
        $bitmap = [System.Drawing.Bitmap]::new($sourceImage.Width, $sourceImage.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $canvas = [System.Drawing.Graphics]::FromImage($bitmap)
        $canvas.DrawImage($sourceImage, 0, 0, $sourceImage.Width, $sourceImage.Height)
        $encoded = [System.IO.MemoryStream]::new()
        $bitmap.Save($encoded, [System.Drawing.Imaging.ImageFormat]::Png)
        if ($encoded.Length -le 0) { throw '完整像素解码/内存重编码失败' }
        $result = [ordered]@{ status='成功'; method='Windows System.Drawing：校验数据、完整绘制到32位位图、内存重编码；磁盘源字节保持不变'; width=$sourceImage.Width; height=$sourceImage.Height; format='PNG'; checkedAt=[DateTime]::UtcNow.ToString('o') }
    } catch {
        $result = [ordered]@{ status='失败'; error=$_.Exception.Message; checkedAt=[DateTime]::UtcNow.ToString('o') }
    } finally {
        if ($encoded) { $encoded.Dispose() }
        if ($canvas) { $canvas.Dispose() }
        if ($bitmap) { $bitmap.Dispose() }
        if ($sourceImage) { $sourceImage.Dispose() }
        if ($stream) { $stream.Dispose() }
    }
    $entry | Add-Member -NotePropertyName decode -NotePropertyValue $result -Force
}
$json = $manifest | ConvertTo-Json -Depth 30
[System.IO.File]::WriteAllText($manifestFile, $json, [System.Text.UTF8Encoding]::new($false))
Write-Output ('图片解码成功：' + @($manifest.items | Where-Object { $_.decode.status -eq '成功' }).Count)
