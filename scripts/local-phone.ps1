param([string]$Device, [switch]$Rebuild)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')

if (-not (Test-Path -LiteralPath 'node_modules/next/package.json')) {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw 'Backend dependency installation failed.' }
}
npm run local:setup
if ($LASTEXITCODE -ne 0) { throw 'Local database setup failed.' }

function Get-PreviewMode {
  try { return Invoke-RestMethod -Uri 'http://127.0.0.1:3100/api/native-auth' -TimeoutSec 3 }
  catch { return $null }
}
$mode = Get-PreviewMode
if (-not $mode) {
  $listener = Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue
  if ($listener) { throw 'Port 3100 is occupied by an unverified server. Check it before starting ByLine Preview.' }
  $server = Start-Process -FilePath (Get-Command node).Source -ArgumentList 'scripts/local-dev.mjs' `
    -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput '.byline-local/server.stdout.log' -RedirectStandardError '.byline-local/server.stderr.log'
  Set-Content -LiteralPath '.byline-local/server.pid' -Value $server.Id
  $deadline = (Get-Date).AddSeconds(60)
  do {
    Start-Sleep -Seconds 1
    $mode = Get-PreviewMode
    if ($server.HasExited) { throw 'ByLine server exited. See .byline-local/server.stderr.log.' }
  } while (-not $mode -and (Get-Date) -lt $deadline)
}
if (-not $mode.localTest -or $mode.linkedin -or $mode.google) {
  throw 'The server on port 3100 is not the isolated preview. No APK was installed.'
}
if ($Rebuild -or -not (Test-Path -LiteralPath '.byline-local/byline-preview.apk')) {
  & (Join-Path $PSScriptRoot 'build-local-android.ps1')
}
& (Join-Path $PSScriptRoot 'install-local-android.ps1') -Device $Device
Write-Output 'ByLine Preview is ready. Keep USB connected and this computer awake. AI drafts and publishing are simulated.'
