param(
  [Parameter(Mandatory = $true)][string]$JsonPath
)
# 图标批量提取器（壁纸工坊 · 快捷方式转盘 / 桌面组件用）
# 输入：JSON 文件 [{ "key": "...", "target": "...", "out": "C:\\...png" }]
# 输出：每个 target 对应一张 PNG（透明通道保留）
# 统一走 Shell 命名空间：普通文件/文件夹/快捷方式用路径，
# 虚拟项（回收站/控制面板/网络/此电脑）用 shell: 或 ::{GUID} 解析为 PIDL。
$ErrorActionPreference = 'Stop'

$cs = @'
using System;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;

[ComImport, Guid("46EB5926-582E-4017-9FDF-E8998DAA0950"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IImageList {
  int Add(IntPtr hbmImage, IntPtr hbmMask, out int pi);
  int ReplaceIcon(int i, IntPtr hicon, out int pi);
  int SetOverlayImage(int iImage, int iOverlay);
  int Replace(int i, IntPtr hbmImage, IntPtr hbmMask);
  int AddMasked(IntPtr hbmImage, int crMask, out int pi);
  int Draw(IntPtr pimldp);
  int Remove(int i);
  int GetIcon(int i, int flags, out IntPtr picon);
  int GetImageInfo(int i, out IntPtr pImageInfo);
  int Copy(int iDst, IImageList punkSrc, int iSrc, int uFlags);
  int Merge(int i1, IImageList punk2, int i2, int dx, int dy, ref Guid riid, out IntPtr ppv);
  int Clone(ref Guid riid, out IntPtr ppv);
  int GetImageRect(int i, out IntPtr prc);
  int GetIconSize(out int cx, out int cy);
  int SetIconSize(int cx, int cy);
  int GetImageCount(out int pi);
  int SetImageCount(int uNewCount);
  int SetBkColor(int clrBk, out int pclr);
  int GetBkColor(out int pclr);
  int BeginDrag(int iTrack, int dxHotspot, int dyHotspot);
  int EndDrag();
  int DragEnter(IntPtr hwndLock, int x, int y);
  int DragLeave(IntPtr hwndLock);
  int DragMove(int x, int y);
  int SetDragCursorImage(ref IImageList punk, int iDrag, int dxHotspot, int dyHotspot);
  int DragShowNolock(int fShow);
  int GetDragImage(ref IntPtr ppt, ref IntPtr pptHotspot, ref Guid riid, out IntPtr ppv);
  int GetItemFlags(int i, out int dwFlags);
  int GetOverlayImage(int iOverlay, out int piIndex);
}

public class ShellIconEx {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct SHFILEINFO {
    public IntPtr hIcon; public int iIcon; public uint dwAttributes;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szDisplayName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string szTypeName;
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, EntryPoint = "SHGetFileInfo")]
  public static extern IntPtr SHGetFileInfoPath(string pszPath, uint dwFileAttributes, ref SHFILEINFO psfi, uint cbSizeFileInfo, uint uFlags);
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, EntryPoint = "SHGetFileInfo")]
  public static extern IntPtr SHGetFileInfoPidl(IntPtr pidl, uint dwFileAttributes, ref SHFILEINFO psfi, uint cbSizeFileInfo, uint uFlags);
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  public static extern int SHParseDisplayName(string pszName, IntPtr pbc, out IntPtr ppidl, uint sfgaoIn, out uint psfgaoOut);
  [DllImport("shell32.dll")]
  public static extern int SHGetImageList(int iImageList, ref Guid riid, out IImageList ppv);
  [DllImport("user32.dll")]
  public static extern bool DestroyIcon(IntPtr hIcon);
  [DllImport("ole32.dll")]
  public static extern void CoTaskMemFree(IntPtr pv);

  const uint SHGFI_ICON = 0x000000100;
  const uint SHGFI_SYSICONINDEX = 0x000004000;
  const uint SHGFI_LARGEICON = 0x000000000;
  const uint SHGFI_SMALLICON = 0x000000001;
  const uint SHGFI_PIDL = 0x000000008;
  const uint SHGFI_ADDOVERLAYS = 0x000000020;
  const uint SHGFI_USEFILEATTRIBUTES = 0x000000010;
  const uint SHGFI_TYPENAME = 0x000000400;
  const uint SHGFI_ICONLOCATION = 0x000001000;
  const int SHIL_EXTRALARGE = 0x2;   // 48x48
  const int SHIL_JUMBO = 0x4;        // 256x256（Win Vista+）
  const int ILD_TRANSPARENT = 0x0001;
  const int ILD_IMAGE = 0x0020;

  /** 取 Shell 图标位图；失败返回 null。虚拟项（shell: / ::{GUID}）自动走 PIDL。 */
  public static Bitmap Get(string target, int px) {
    IntPtr pidl = IntPtr.Zero;
    SHFILEINFO sfi = new SHFILEINFO();
    uint size = (uint)Marshal.SizeOf(typeof(SHFILEINFO));
    uint flags = SHGFI_SYSICONINDEX | SHGFI_ICONLOCATION;
    IntPtr hIcon = IntPtr.Zero;
    bool isVirtual = target.StartsWith("shell:", StringComparison.OrdinalIgnoreCase) || target.StartsWith("::");
    uint attrOut = 0;
    if (isVirtual) {
      flags |= SHGFI_PIDL;
      if (SHParseDisplayName(target, IntPtr.Zero, out pidl, 0, out attrOut) != 0) return null;
      hIcon = SHGetFileInfoPidl(pidl, 0, ref sfi, size, flags | SHGFI_ICON | SHGFI_LARGEICON);
    } else {
      hIcon = SHGetFileInfoPath(target, 0, ref sfi, size, flags | SHGFI_ICON | SHGFI_LARGEICON);
    }
    // 小图标兜底（某些文件类型只有 16px 关联图标）
    if (hIcon == IntPtr.Zero && !isVirtual) {
      hIcon = SHGetFileInfoPath(target, 0, ref sfi, size, flags | SHGFI_ICON | SHGFI_SMALLICON);
    }
    try {
      if (hIcon == IntPtr.Zero) return null;
      // 大图优先：系统图像列表的 JUMBO/EXTRALARGE（清晰，不拉伸模糊）
      Bitmap jumbo = null;
      try { jumbo = FromSysImageList(sfi.iIcon, px); } catch { jumbo = null; }
      if (jumbo != null) return jumbo;
      using (Icon ic = (Icon)Icon.FromHandle(hIcon).Clone()) return ic.ToBitmap();
    } finally {
      if (hIcon != IntPtr.Zero) DestroyIcon(hIcon);
      if (pidl != IntPtr.Zero) CoTaskMemFree(pidl);
    }
  }

  /** 从系统图像列表取指定尺寸图标（48/256），保留透明通道 */
  static Bitmap FromSysImageList(int index, int px) {
    if (index <= 0) return null;
    Guid iid = typeof(IImageList).GUID;
    int shil = px > 64 ? SHIL_JUMBO : SHIL_EXTRALARGE;
    IImageList iml;
    if (SHGetImageList(shil, ref iid, out iml) != 0 || iml == null) return null;
    IntPtr hIcon;
    if (iml.GetIcon(index, ILD_TRANSPARENT | ILD_IMAGE, out hIcon) != 0 || hIcon == IntPtr.Zero) return null;
    try {
      using (Icon ic = (Icon)Icon.FromHandle(hIcon).Clone()) return ic.ToBitmap();
    } finally { DestroyIcon(hIcon); }
  }
}
'@

if (-not ("ShellIconEx" -as [type])) {
  Add-Type -TypeDefinition $cs -ReferencedAssemblies @('System.Drawing', 'System.Windows.Forms') -ErrorAction Stop
}

$items = (Get-Content -LiteralPath $JsonPath -Raw | ConvertFrom-Json)
foreach ($it in $items) {
  $ok = $false
  try {
    $bmp = [ShellIconEx]::Get($it.target, 64)
    if ($bmp -ne $null) {
      $dir = Split-Path -Parent $it.out
      if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
      $bmp.Save($it.out, [System.Drawing.Imaging.ImageFormat]::Png)
      $bmp.Dispose()
      $ok = Test-Path -LiteralPath $it.out
    }
  } catch { $ok = $false }
  if (-not $ok) { Write-Output ("FAIL`t" + $it.key) } else { Write-Output ("OK`t" + $it.key) }
}
