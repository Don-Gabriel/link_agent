param([Parameter(Mandatory=$true)][string]$PublicUrl, [int]$BuildNumber=2)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
$bylineUri=[Uri]$PublicUrl
if($bylineUri.Scheme -ne 'https' -or $bylineUri.AbsolutePath -ne '/' -or $bylineUri.Query -or $bylineUri.UserInfo){throw 'Supply the HTTPS origin of the deployed ByLine service.'}
node scripts/prepare-android-signing.mjs
if($LASTEXITCODE -ne 0){throw 'Signing preparation failed.'}
$bylineOutput=Join-Path (Get-Location).Path '.byline-release'
$bylineTemp=Join-Path $bylineOutput 'java-tmp'
New-Item -ItemType Directory -Force -Path $bylineTemp | Out-Null
$bylineOldTemp=$env:TEMP; $bylineOldTmp=$env:TMP; $bylineOldJava=$env:JAVA_TOOL_OPTIONS
$env:TEMP=$bylineTemp; $env:TMP=$bylineTemp; $env:JAVA_TOOL_OPTIONS="-Djdk.net.unixdomain.tmpdir=$bylineTemp"
Push-Location -LiteralPath 'mobile'
try {
  flutter build apk --release --build-number=$BuildNumber --dart-define=BYLINE_PUBLIC_RELEASE=true --dart-define=BYLINE_APP_VARIANT=live "--dart-define=BYLINE_API_URL=$($PublicUrl.TrimEnd('/'))"
  if($LASTEXITCODE -ne 0){throw 'Android release build failed.'}
  Copy-Item -LiteralPath 'build/app/outputs/flutter-apk/app-release.apk' -Destination (Join-Path $bylineOutput 'byline.apk')
} finally {Pop-Location; $env:TEMP=$bylineOldTemp; $env:TMP=$bylineOldTmp; $env:JAVA_TOOL_OPTIONS=$bylineOldJava}
