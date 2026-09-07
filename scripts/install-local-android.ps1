param([string]$Device)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
$adbCommand = Get-Command adb -ErrorAction SilentlyContinue
$bylineAdb = if ($adbCommand) { $adbCommand.Source } else { 'C:/Android/Sdk/platform-tools/adb.exe' }
if (-not $Device) {
  $phones = @(& $bylineAdb devices | Where-Object { $_ -match '^\S+\s+device$' } | ForEach-Object { ($_ -split '\s+')[0] })
  if ($phones.Count -ne 1) { throw 'Connect one Android phone with USB debugging, or provide -Device SERIAL.' }
  $Device = $phones[0]
}
$apk = 'mobile/build/app/outputs/flutter-apk/app-debug.apk'
if (-not (Test-Path -LiteralPath $apk)) { throw 'Build the local preview APK first.' }
& $bylineAdb -s $Device reverse tcp:3100 tcp:3100
if ($LASTEXITCODE -ne 0) { throw 'USB connection forwarding failed.' }
& $bylineAdb -s $Device install -r $apk
if ($LASTEXITCODE -ne 0) { throw 'APK installation failed.' }
& $bylineAdb -s $Device shell am start -n com.linkdin.byline_preview/com.linkdin.linkdin_mobile.MainActivity
