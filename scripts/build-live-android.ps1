$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
$bylineTemp = Join-Path (Get-Location).Path '.byline-local/java-tmp'
New-Item -ItemType Directory -Force -Path $bylineTemp | Out-Null
$bylineOldTemp=$env:TEMP; $bylineOldTmp=$env:TMP; $bylineOldJava=$env:JAVA_TOOL_OPTIONS
$env:TEMP=$bylineTemp; $env:TMP=$bylineTemp; $env:JAVA_TOOL_OPTIONS="-Djdk.net.unixdomain.tmpdir=$bylineTemp"
Push-Location -LiteralPath 'mobile'
try {
  flutter build apk --debug --dart-define-from-file=../.byline-local/live-dart-defines.json
  if($LASTEXITCODE -ne 0){throw 'ByLine live Android build failed.'}
  Copy-Item -LiteralPath 'build/app/outputs/flutter-apk/app-debug.apk' -Destination '../.byline-local/byline-live.apk'
} finally {Pop-Location; $env:TEMP=$bylineOldTemp; $env:TMP=$bylineOldTmp; $env:JAVA_TOOL_OPTIONS=$bylineOldJava}
