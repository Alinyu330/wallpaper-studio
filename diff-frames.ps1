Add-Type -AssemblyName System.Drawing
$a=[System.Drawing.Bitmap]::FromFile('D:\WallPaper\screen-check.png')
$b=[System.Drawing.Bitmap]::FromFile('D:\WallPaper\screen-check2.png')
$diff=0
$regions=@{}
for($x=0; $x -lt $a.Width; $x+=8){
  for($y=0; $y -lt $a.Height; $y+=8){
    $p1=$a.GetPixel($x,$y); $p2=$b.GetPixel($x,$y)
    $d=[math]::Abs($p1.R-$p2.R)+[math]::Abs($p1.G-$p2.G)+[math]::Abs($p1.B-$p2.B)
    if($d -gt 24){
      $diff++
      $key=[string][math]::Floor($x/170)+','+[string][math]::Floor($y/160)
      $regions[$key]=1+$regions[$key]
    }
  }
}
Write-Output ("diffSamples: "+$diff)
$keys = $regions.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 14
foreach($k in $keys){ Write-Output ("region: "+$k.Key+" changes="+$k.Value) }
$a.Dispose(); $b.Dispose()
