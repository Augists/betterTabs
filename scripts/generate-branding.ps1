Add-Type -AssemblyName System.Drawing

function New-RoundRect([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function Save-Icon([int]$size) {
  $bmp = [System.Drawing.Bitmap]::new($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $scale = $size / 128.0
  $g.ScaleTransform($scale, $scale)
  $sage = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(77, 112, 91))
  $paper = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(247, 248, 241))
  $light = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(185, 210, 192))
  $bg = New-RoundRect 16 16 96 96 22
  $back = New-RoundRect 37 35 57 13 5
  $mid = New-RoundRect 32 51 62 13 5
  $front = New-RoundRect 27 67 67 18 6
  $g.FillPath($sage, $bg)
  $g.FillPath($light, $back)
  $g.FillPath($paper, $mid)
  $g.FillPath($paper, $front)
  $dot = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(77, 112, 91))
  $g.FillEllipse($dot, 77, 73, 6, 6)
  $out = Join-Path (Join-Path $PSScriptRoot '..\public\icons') "icon-$size.png"
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $dot.Dispose(); $front.Dispose(); $mid.Dispose(); $back.Dispose(); $bg.Dispose()
  $paper.Dispose(); $light.Dispose(); $sage.Dispose(); $g.Dispose(); $bmp.Dispose()
}

New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot '..\public\icons') -Force | Out-Null
foreach ($size in 16, 32, 48, 128) { Save-Icon $size }

$tile = [System.Drawing.Bitmap]::new(440, 280)
$g = [System.Drawing.Graphics]::FromImage($tile)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::FromArgb(244, 247, 241))
$sage = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(77, 112, 91))
$muted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(112, 128, 116))
$paper = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
$icon = [System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot '..\public\icons\icon-128.png'))
$g.DrawImage($icon, 24, 24, 90, 90)
$title = [System.Drawing.Font]::new('Microsoft YaHei UI', 27, [System.Drawing.FontStyle]::Bold)
$subtitle = [System.Drawing.Font]::new('Microsoft YaHei UI', 13)
$small = [System.Drawing.Font]::new('Microsoft YaHei UI', 10)
$g.DrawString('栖签', $title, $sage, 126, 35)
$g.DrawString('把标签，存进你的书签。', $subtitle, $muted, 127, 86)
$card = New-RoundRect 32 145 376 103 15
$g.FillPath($paper, $card)
$g.DrawString('一键归档   ·   随时恢复', $subtitle, $sage, 53, 163)
$g.DrawString('随 Chrome 书签同步到其他电脑', $small, $muted, 54, 203)
$tile.Save((Join-Path $PSScriptRoot '..\release\small-promo-440x280.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$card.Dispose(); $title.Dispose(); $subtitle.Dispose(); $small.Dispose()
$icon.Dispose(); $paper.Dispose(); $muted.Dispose(); $sage.Dispose(); $g.Dispose(); $tile.Dispose()
