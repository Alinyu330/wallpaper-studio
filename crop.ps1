param([string]$in, [string]$out, [int]$x, [int]$y, [int]$w, [int]$h, [int]$scale = 2)
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Bitmap]::FromFile($in)
$rect = New-Object System.Drawing.Rectangle($x, $y, $w, $h)
$crop = $src.Clone($rect, $src.PixelFormat)
$big = New-Object System.Drawing.Bitmap($crop, ($w*$scale), ($h*$scale))
$big.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$src.Dispose()
Write-Output "saved $out"
