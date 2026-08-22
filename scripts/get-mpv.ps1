# get-mpv.ps1 — 下载 mpv 播放器到 assets/mpv/（本地开发用）
# 仓库不包含 mpv 二进制（超过 GitHub 100MB 单文件限制），克隆后请先运行本脚本：
#   powershell -ExecutionPolicy Bypass -File scripts/get-mpv.ps1

$ErrorActionPreference = 'Stop'
$dest = Join-Path $PSScriptRoot '..\assets\mpv'
$mpvExe = Join-Path $dest 'mpv.exe'

if (Test-Path $mpvExe) {
  Write-Host "mpv 已存在: $mpvExe（如需更新请先删除 assets/mpv 目录）" -ForegroundColor Green
  exit 0
}

Write-Host '正在获取 mpv 最新版本信息...'
$release = Invoke-RestMethod 'https://api.github.com/repos/mpv-player/mpv/releases/latest'
$asset = $release.assets | Where-Object { $_.name -match '^mpv-x86_64.*\.7z$' } | Select-Object -First 1
if (-not $asset) { throw '未找到 mpv Windows x86_64 构建资产' }

Write-Host "下载 $($asset.name)（$([math]::Round($asset.size/1MB,1)) MB）..."
$tmp = Join-Path $env:TEMP $asset.name
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tmp

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Write-Host '解压中...'
if (Get-Command 7z -ErrorAction SilentlyContinue) {
  7z x $tmp "-o$dest" -y | Out-Null
} else {
  # Windows 11 自带 tar 支持 7z 解压；否则回退到 Expand-Archive（需 zip）
  tar -xf $tmp -C $dest
}
Remove-Item $tmp -Force

if (-not (Test-Path $mpvExe)) { throw '解压后未找到 mpv.exe，请手动下载：https://github.com/mpv-player/mpv/releases' }
Write-Host "mpv 就绪: $mpvExe" -ForegroundColor Green
