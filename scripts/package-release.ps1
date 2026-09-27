param([string]$Version = '0.2.0')

$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$dist = (Resolve-Path -LiteralPath (Join-Path $workspace 'dist')).Path
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$key = Join-Path $workspace 'release/private/Qiqian.pem'
$profile = Join-Path $workspace '.pack-profile'
$zip = Join-Path $workspace "release/Qiqian-$Version-webstore.zip"
$crx = Join-Path $workspace "release/Qiqian-$Version.crx"
$chromeOutput = Join-Path $workspace 'dist.crx'

if (-not (Test-Path -LiteralPath $chrome)) { throw 'Chrome is not installed at the expected path' }
if (-not (Test-Path -LiteralPath $key)) { throw 'Signing key missing; do not generate a new key for an update' }
$manifest = Get-Content -LiteralPath (Join-Path $dist 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne $Version) { throw 'Build and release versions differ' }

$arguments = @("--user-data-dir=$profile", "--pack-extension=$dist", "--pack-extension-key=$key", '--no-first-run', '--disable-gpu')
$process = Start-Process -FilePath $chrome -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $chromeOutput)) {
  throw "Chrome could not pack the extension (exit $($process.ExitCode))"
}
Move-Item -LiteralPath $chromeOutput -Destination $crx -Force
Compress-Archive -Path (Join-Path $dist '*') -DestinationPath $zip -Force
& (Join-Path $PSScriptRoot 'verify-release.ps1') -Version $Version
