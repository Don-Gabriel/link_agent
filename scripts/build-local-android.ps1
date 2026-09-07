$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
$bylineTemp = Join-Path (Get-Location).Path '.byline-local/java-tmp'
New-Item -ItemType Directory -Force -Path $bylineTemp | Out-Null
# Process-local settings: avoid the packaged-shell/JVM Unix-socket temp-path issue.
$bylineOldTemp = $env:TEMP
$bylineOldTmp = $env:TMP
$bylineOldJavaOptions = $env:JAVA_TOOL_OPTIONS
$env:TEMP = $bylineTemp
$env:TMP = $bylineTemp
$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=$bylineTemp"
Push-Location -LiteralPath 'mobile'
try {
  flutter build apk --debug --dart-define=BYLINE_API_URL=http://localhost:3100 --dart-define=BYLINE_LOCAL_TEST=true
  if ($LASTEXITCODE -ne 0) { throw 'Android preview build failed.' }
} finally {
  Pop-Location
  $env:TEMP = $bylineOldTemp
  $env:TMP = $bylineOldTmp
  $env:JAVA_TOOL_OPTIONS = $bylineOldJavaOptions
}
