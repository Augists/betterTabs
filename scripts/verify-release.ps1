param([string]$Version = '0.2.0')

Add-Type -AssemblyName System.IO.Compression
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$zipPath = Join-Path $root "release/Qiqian-$Version-webstore.zip"
$crxPath = Join-Path $root "release/Qiqian-$Version.crx"

function Test-Entries($archive, [string]$label) {
  $entries = @($archive.Entries | ForEach-Object FullName)
  if ($entries -notcontains 'manifest.json') { throw "${label}: manifest.json is not at the archive root" }
  if ($entries | Where-Object { $_ -match '\.(pem|map)$' -or $_ -match '^node_modules/' }) {
    throw "${label}: private or development files found"
  }
  $manifestEntry = $archive.GetEntry('manifest.json')
  $reader = [System.IO.StreamReader]::new($manifestEntry.Open())
  try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
  if ($manifest.manifest_version -ne 3 -or $manifest.version -ne $Version) {
    throw "${label}: unexpected manifest version"
  }
  $required = @('index.html', $manifest.background.service_worker)
  $required += @($manifest.icons.PSObject.Properties.Value)
  $required += @($manifest.action.default_icon.PSObject.Properties.Value)
  foreach ($path in $required | Select-Object -Unique) {
    if ($entries -notcontains $path) { throw "${label}: missing $path" }
  }
  $icon = $archive.GetEntry('icons/icon-128.png')
  $stream = $icon.Open()
  $bytes = [byte[]]::new(24)
  try { if ($stream.Read($bytes, 0, 24) -ne 24) { throw 'Icon is truncated' } } finally { $stream.Dispose() }
  $signature = [byte[]](137,80,78,71,13,10,26,10)
  for ($i=0; $i -lt 8; $i++) { if ($bytes[$i] -ne $signature[$i]) { throw "${label}: invalid PNG icon" } }
  $width = ([int]$bytes[16] -shl 24) -bor ([int]$bytes[17] -shl 16) -bor ([int]$bytes[18] -shl 8) -bor [int]$bytes[19]
  $height = ([int]$bytes[20] -shl 24) -bor ([int]$bytes[21] -shl 16) -bor ([int]$bytes[22] -shl 8) -bor [int]$bytes[23]
  if ($width -ne 128 -or $height -ne 128) { throw "${label}: icon must be 128 x 128" }
  Write-Output "$label verified: $($entries.Count) files, Manifest V3 $Version, 128 x 128 icon"
}

$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try { Test-Entries $zip 'Web Store ZIP' } finally { $zip.Dispose() }

$crx = [System.IO.File]::ReadAllBytes($crxPath)
if ([System.Text.Encoding]::ASCII.GetString($crx, 0, 4) -ne 'Cr24' -or [BitConverter]::ToUInt32($crx, 4) -ne 3) {
  throw 'CRX3 header invalid'
}
$headerLength = [BitConverter]::ToUInt32($crx, 8)
$offset = 12 + $headerLength
if ($offset -ge $crx.Length) { throw 'CRX3 payload is empty' }
$stream = [System.IO.MemoryStream]::new($crx, $offset, $crx.Length - $offset, $false)
$archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Read)
try { Test-Entries $archive 'Signed CRX3' } finally { $archive.Dispose(); $stream.Dispose() }


