# get-mpv.ps1 - Download the pinned mpv player into assets/mpv/ (for local development)
# The repo does NOT include the mpv binary (exceeds GitHub 100MB file limit).
# Run this after cloning:
#   powershell -ExecutionPolicy Bypass -File scripts/get-mpv.ps1
# Override destination for testing: $env:MPV_DEST = 'C:\temp\mpv'
# Bump the pinned release with:      $env:MPV_TAG = 'v0.42.0'
# The pin keeps local and CI build inputs identical; an existing binary that does
# not report the pinned version is replaced rather than silently reused.

$ErrorActionPreference = 'Stop'
$dest = if ($env:MPV_DEST) { $env:MPV_DEST } else { Join-Path $PSScriptRoot '..\assets\mpv' }
$mpvExe = Join-Path $dest 'mpv.exe'

# Pinned mpv release. v0.41.0 assets are immutable; the rolling "git-release"
# nightly is a prerelease and is deliberately not used.
$pinTag = if ($env:MPV_TAG) { $env:MPV_TAG } else { 'v0.41.0' }

# NOTE: the official Windows asset under a *stable* tag still reports a dev
# build string, so the tag and the reported version are intentionally separate.
$pinVersion = if ($env:MPV_VERSION) { $env:MPV_VERSION } else { 'v0.41.0-dev-g41f6a6450' }

function Get-MpvVersion($exe) {
  if (-not (Test-Path $exe)) { return '' }
  try {
    $line = (& $exe --version 2>$null | Select-Object -First 1)
    return ("" + $line -replace '^mpv\s+', '' -replace '\s+Copyright.*$', '').Trim()
  } catch { return '' }
}

if (Test-Path $mpvExe) {
  $have = Get-MpvVersion $mpvExe
  if ($have -eq $pinVersion) {
    Write-Host "mpv $have present: $mpvExe (matches pin)" -ForegroundColor Green
    exit 0
  }
  Write-Host "existing mpv is '$(if ($have) { $have } else { 'unknown' })' but pinned is '$pinVersion' - re-downloading" -ForegroundColor Yellow
}

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

Write-Host "Fetching mpv release $pinTag ..."
$release = Invoke-RestMethod "https://api.github.com/repos/mpv-player/mpv/releases/tags/$pinTag"
if (-not $release -or -not $release.assets) { throw "release tag $pinTag not found" }
$assets = $release.assets

# Asset naming changed across versions:
#   new (v0.41+): mpv-v0.41.0-x86_64-w64-mingw32.zip  (zip containing an inner zip)
#   old:          mpv-x86_64-xxxxxxxx-git-0.xx.x.7z
$asset = $assets | Where-Object { $_.name -match '^mpv-v.*-x86_64-w64-mingw32\.zip$' } | Select-Object -First 1
if (-not $asset) { $asset = $assets | Where-Object { $_.name -match '^mpv-v.*-x86_64-pc-windows-msvc\.zip$' } | Select-Object -First 1 }
if (-not $asset) { $asset = $assets | Where-Object { $_.name -match '^mpv-x86_64.*\.7z$' } | Select-Object -First 1 }
if (-not $asset) { throw 'mpv Windows x86_64 asset not found in latest release' }

Write-Host "Downloading $($asset.name) ($([math]::Round($asset.size/1MB,1)) MB)..."
$tmp = Join-Path $env:TEMP $asset.name
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tmp

$work = Join-Path $env:TEMP ("mpv-extract-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $work | Out-Null

function Expand-Any($file, $outDir) {
  if ($file -match '\.zip$') {
    Expand-Archive -Path $file -DestinationPath $outDir -Force
  } elseif (Get-Command 7z -ErrorAction SilentlyContinue) {
    7z x $file "-o$outDir" -y | Out-Null
  } else {
    tar -xf $file -C $outDir
    if ($LASTEXITCODE -ne 0) { throw "failed to extract $file" }
  }
}

Write-Host 'Extracting...'
Expand-Any $tmp $work

# v0.41+ official zips wrap the real archive inside another zip - unwrap it
Get-ChildItem $work -Filter *.zip -Recurse -File | ForEach-Object {
  $sub = Join-Path $_.DirectoryName ($_.BaseName + '-inner')
  New-Item -ItemType Directory -Force -Path $sub | Out-Null
  Expand-Any $_.FullName $sub
}

# Locate the directory that contains mpv.exe (deepest match wins)
$found = Get-ChildItem $work -Recurse -Filter mpv.exe -File |
  Sort-Object { $_.FullName.Length } -Descending | Select-Object -First 1
if (-not $found) { throw 'mpv.exe not found after extraction. Manual download: https://github.com/mpv-player/mpv/releases' }

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item (Join-Path $found.DirectoryName '*') $dest -Recurse -Force
Remove-Item $tmp -Force -ErrorAction SilentlyContinue
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue

if (-not (Test-Path $mpvExe)) { throw 'unexpected: mpv.exe still missing' }
$got = Get-MpvVersion $mpvExe
if ($got -ne $pinVersion) { throw "downloaded mpv reports '$(if ($got) { $got } else { 'unknown' })' but pin requires '$pinVersion'" }
Write-Host "mpv $got ready: $mpvExe" -ForegroundColor Green
