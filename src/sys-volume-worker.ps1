param([int]$IdleSec = 120)
# sys-volume-worker.ps1 - persistent system master volume worker.
# Protocol (one command per stdin line, one JSON object per stdout line):
#   get           -> {"ok":true,"volume":0..100,"ch":2}
#   set <0..100>  -> {"ok":true,"volume":...}
#   ping          -> {"ok":true,"pong":true}
#   exit          -> quit
#
# Only the unambiguous IAudioEndpointVolume scalar slots are declared/called.
# "Mute" is implemented by the caller as volume 0 + restore, because the exact
# vtable position of SetMute/GetMute differs across published headers and a wrong
# slot would invoke an arbitrary COM method.
#
# NOTE: keep this file pure ASCII. Windows PowerShell 5.1 reads no-BOM files as
# the ANSI codepage, so CJK comments can swallow line breaks and break Add-Type.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject { }

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int dwClsContext, IntPtr pActivationParams, [MarshalAs(UnmanagedType.Interface)] out object ppInterface);
    [PreserveSig] int OpenPropertyStore(int stgmAccess, out IntPtr ppProperties);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppId);
    [PreserveSig] int GetState(out int pnState);
}

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr ppDevices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
}

// IDL order (endpointvolume.idl), IUnknown slots 0..2 then:
// 3 RegisterControlChangeNotify, 4 Unregister..., 5 GetChannelCount,
// 6 SetMasterVolumeLevel, 7 SetMasterVolumeLevelScalar, 8 GetMasterVolumeLevel,
// 9 GetMasterVolumeLevelScalar, 10..13 channel variants, 14 SetMute, 15 GetMute.
[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
    [PreserveSig] int RegisterControlChangeNotify(IntPtr pNotify);
    [PreserveSig] int UnregisterControlChangeNotify(IntPtr pNotify);
    [PreserveSig] int GetChannelCount(out uint pcChannelCount);
    [PreserveSig] int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
    [PreserveSig] int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
    [PreserveSig] int GetMasterVolumeLevel(out float pfLevelDB);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float pfLevel);
    [PreserveSig] int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
    [PreserveSig] int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
}

public static class SysVolume {
    static IMMDeviceEnumerator enumerator = null;
    static IAudioEndpointVolume volume = null;
    public static string LastError = "";

    static bool Ensure() {
        if (volume != null) return true;
        try {
            enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
            IMMDevice device = null;
            int hr = enumerator.GetDefaultAudioEndpoint(0, 1, out device);
            if (hr != 0 || device == null) { LastError = "GetDefaultAudioEndpoint hr=" + hr; return false; }
            Guid iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
            object obj = null;
            hr = device.Activate(ref iid, 1, IntPtr.Zero, out obj);
            if (hr != 0 || obj == null) { LastError = "Activate hr=" + hr; return false; }
            volume = (IAudioEndpointVolume)obj;
            LastError = "";
            return true;
        } catch (Exception ex) {
            enumerator = null; volume = null;
            LastError = ex.GetType().Name + ": " + ex.Message;
            return false;
        }
    }

    public static void Drop() { volume = null; enumerator = null; }

    public static int Get() {
        if (!Ensure()) return -1;
        float f = 0f;
        if (volume.GetMasterVolumeLevelScalar(out f) != 0) { Drop(); return -1; }
        return (int)Math.Round(Math.Min(1f, Math.Max(0f, f)) * 100.0);
    }

    public static int Set(int percent) {
        if (!Ensure()) return -1;
        float f = Math.Min(100f, Math.Max(0f, (float)percent)) / 100f;
        Guid ctx = Guid.Empty;
        if (volume.SetMasterVolumeLevelScalar(f, ref ctx) != 0) { Drop(); return -1; }
        return (int)Math.Round(f * 100.0);
    }

    public static int Channels() {
        if (!Ensure()) return -1;
        uint n = 0;
        if (volume.GetChannelCount(out n) != 0) { Drop(); return -1; }
        return (int)n;
    }

    public static int Muted() {
        if (!Ensure()) return -1;
        bool m = false;
        if (volume.GetMute(out m) != 0) { Drop(); return -1; }
        return m ? 1 : 0;
    }

    public static int SetMuteState(int on) {
        if (!Ensure()) return -1;
        Guid ctx = Guid.Empty;
        if (volume.SetMute(on != 0, ref ctx) != 0) { Drop(); return -1; }
        return on == 0 ? 0 : 1;
    }
}
'@

function Send($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress)); [Console]::Out.Flush() }

$last = Get-Date
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $line = $line.Trim()
    if ($line -eq '') { continue }
    $last = Get-Date
    $parts = $line -split ' ', 2
    $cmd = $parts[0].ToLower()
    try {
        if ($cmd -eq 'get') {
            $v = [SysVolume]::Get()
            Send ([pscustomobject]@{ ok = ($v -ge 0); volume = $v; muted = [SysVolume]::Muted(); ch = [SysVolume]::Channels(); err = [SysVolume]::LastError })
        } elseif ($cmd -eq 'set') {
            $v = [SysVolume]::Set([int]$parts[1])
            Send ([pscustomobject]@{ ok = ($v -ge 0); volume = $v; err = [SysVolume]::LastError })
        } elseif ($cmd -eq 'mute') {
            $m = [SysVolume]::SetMuteState([int]$parts[1])
            Send ([pscustomobject]@{ ok = ($m -ge 0); muted = $m; err = [SysVolume]::LastError })
        } elseif ($cmd -eq 'ping') {
            Send ([pscustomobject]@{ ok = $true; pong = $true })
        } elseif ($cmd -eq 'exit') {
            break
        } else {
            Send ([pscustomobject]@{ ok = $false; error = 'unknown' })
        }
    } catch {
        Send ([pscustomobject]@{ ok = $false; error = "$_" })
    }
    if (((Get-Date) - $last).TotalSeconds -gt $IdleSec) { break }
}
