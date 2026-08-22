# get-mpv.ps1 - Download mpv player into assets/mpv/ (for local development)
# The repo does NOT include the mpv binary (exceeds GitHub 100MB file limit).
# Run this after cloning:
#   powershell -ExecutionPolicy Bypass -File scripts/get-mpv.ps1
# Override destination for testing: $env:MPV_DEST = 'C:\temp\mpv'

$ErrorActionPreference = 'Stop'
$dest = if ($env:MPV_DEST) { $env:MPV_DEST } else { Join-Path $PSScriptRoot '..\assets\mpv' }
$mpvExe = Join-Path $dest 'mpv.exe'

if (Test-Path $mpvExe) {
  Write-Host "mpv already present: $mpvExe (delete the folder to force update)" -ForegroundColor Green
  exit 0
}

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

Write-Host 'Fetching latest mpv release info...'
$release = Invoke-RestMethod 'https://api.github.com/repos/mpv-player/mpv/releases/latest'
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
Write-Host "mpv ready: $mpvExe" -ForegroundColor Green
