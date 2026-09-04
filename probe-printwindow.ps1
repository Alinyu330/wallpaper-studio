param([string]$hwndList = "")
$hwnds = @($hwndList -split ',' | ForEach-Object { [int]::Parse($_.Trim()) })
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PW {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
  public struct RECT { public int L, T, R, B; }
}
"@
foreach ($h in $hwnds) {
  $p = New-Object PW+RECT
  [PW]::GetWindowRect([IntPtr]$h, [ref]$p) | Out-Null
  $w = [Math]::Max(1, $p.R - $p.L); $ht = [Math]::Max(1, $p.B - $p.T)
  $bmp = New-Object System.Drawing.Bitmap($w, $ht)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  $ok = [PW]::PrintWindow([IntPtr]$h, $hdc, 2)
  $g.ReleaseHdc($hdc); $g.Dispose()
  $out = "D:\WallPaper\pw-$h.png"
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "hwnd=$h ok=$ok size=${w}x${ht} -> $out"
}
