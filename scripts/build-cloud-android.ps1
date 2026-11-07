$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
if (-not (Test-Path -LiteralPath '.byline-local/cloud-dart-defines.json')) { throw 'Prepare the cloud build configuration first.' }
$bylineTemp = Join-Path (Get-Location).Path '.byline-local/java-tmp'
New-Item -ItemType Directory -Force -Path $bylineTemp | Out-Null
$bylineOldTemp=$env:TEMP; $bylineOldTmp=$env:TMP; $bylineOldJava=$env:JAVA_TOOL_OPTIONS
$env:TEMP=$bylineTemp; $env:TMP=$bylineTemp; $env:JAVA_TOOL_OPTIONS="-Djdk.net.unixdomain.tmpdir=$bylineTemp"
Push-Location -LiteralPath 'mobile'
try {
  flutter build apk --release --dart-define-from-file=../.byline-local/cloud-dart-defines.json
  if ($LASTEXITCODE -ne 0) { throw 'ByLine cloud release build failed.' }
  Copy-Item -LiteralPath 'build/app/outputs/flutter-apk/app-release.apk' -Destination '../.byline-local/byline-cloud-release.apk'
  Write-Output 'Release APK prepared. Nothing was installed on a phone.'
} finally { Pop-Location; $env:TEMP=$bylineOldTemp; $env:TMP=$bylineOldTmp; $env:JAVA_TOOL_OPTIONS=$bylineOldJava }
