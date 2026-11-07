$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$bylineRoot = Split-Path -Parent $PSScriptRoot
$bylineImage = [System.Drawing.Image]::FromFile((Join-Path $bylineRoot 'mobile/assets/branding/byline-logo.png'))
function Write-BrandPng([string]$RelativePath, [int]$Size) {
  $target = Join-Path $bylineRoot $RelativePath
  [System.IO.Directory]::CreateDirectory((Split-Path -Parent $target)) | Out-Null
  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawImage($bylineImage, 0, 0, $Size, $Size)
    $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
try {
  # Package the selected artwork at platform densities; do not redraw the logo.
  foreach ($entry in @(@('mdpi',48,108),@('hdpi',72,162),@('xhdpi',96,216),@('xxhdpi',144,324),@('xxxhdpi',192,432))) {
    Write-BrandPng "mobile/android/app/src/main/res/mipmap-$($entry[0])/ic_launcher.png" $entry[1]
    Write-BrandPng "mobile/android/app/src/main/res/mipmap-$($entry[0])/ic_launcher_foreground.png" $entry[2]
  }
  foreach ($size in @(192,512)) {
    Write-BrandPng "mobile/web/icons/Icon-$size.png" $size
    Write-BrandPng "mobile/web/icons/Icon-maskable-$size.png" $size
  }
  Write-BrandPng 'mobile/web/favicon.png' 32
  # ICO supports PNG-compressed entries. Embed every Windows launcher size.
  $sizes = @(16,24,32,48,64,128,256)
  $frames = @()
  foreach ($size in $sizes) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $stream = New-Object System.IO.MemoryStream
    try {
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.DrawImage($bylineImage,0,0,$size,$size)
      $bitmap.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png)
      $frames += ,$stream.ToArray()
    } finally { $stream.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
  }
  $icon = [System.IO.File]::Create((Join-Path $bylineRoot 'mobile/windows/runner/resources/app_icon.ico'))
  $writer = New-Object System.IO.BinaryWriter($icon)
  try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    for($i=0; $i -lt $sizes.Count; $i++) {
      $dimension = if($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
      $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
      $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([uint16]1); $writer.Write([uint16]32)
      $writer.Write([uint32]$frames[$i].Length); $writer.Write([uint32]$offset)
      $offset += $frames[$i].Length
    }
    foreach($frame in $frames) { $writer.Write([byte[]]$frame) }
  } finally { $writer.Dispose(); $icon.Dispose() }
} finally { $bylineImage.Dispose() }
Write-Output 'Packaged ByLine artwork for Android, Windows and web icons.'
