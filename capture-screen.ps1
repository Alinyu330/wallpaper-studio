# capture-screen.ps1 — 截取整个虚拟屏幕
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size)
$g.Dispose()
$bmp.Save("D:\WallPaper\screen-check.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "saved $($b.Width)x$($b.Height)"
