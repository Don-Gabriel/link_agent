param([string]$Device)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
$bylineAdb='C:/Android/Sdk/platform-tools/adb.exe'
if(-not $Device){
  $phones=@(& $bylineAdb devices | Where-Object {$_ -match '^\S+\s+device$'} | ForEach-Object {($_ -split '\s+')[0]})
  if($phones.Count -ne 1){throw 'Connect one Android phone or specify -Device SERIAL.'}
  $Device=$phones[0]
}
& $bylineAdb -s $Device reverse tcp:3000 tcp:3000
if($LASTEXITCODE -ne 0){throw 'Could not forward the backend connection.'}
& $bylineAdb -s $Device install -r '.byline-local/byline-live.apk'
if($LASTEXITCODE -ne 0){throw 'Could not install the ByLine live app.'}
Write-Output 'ByLine live installed as com.linkdin.byline. Open it and choose Continue with LinkedIn.'
