param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
public static class TraeReadGuard {
  [StructLayout(LayoutKind.Sequential)]
  public struct Overlapped {
    public UIntPtr Internal, InternalHigh;
    public uint Offset, OffsetHigh;
    public IntPtr Event;
  }
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool LockFileEx(IntPtr file, uint flags, uint reserved,
    uint low, uint high, ref Overlapped overlapped);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool UnlockFileEx(IntPtr file, uint reserved,
    uint low, uint high, ref Overlapped overlapped);
  public static bool WaitForRelease() {
    return Task.Factory.StartNew(() => Console.ReadLine()).Wait(TimeSpan.FromSeconds(30));
  }
}
'@
$stream=$null
$locked=$false
$dmsLocked=$false
$offset=New-Object TraeReadGuard+Overlapped
$dms=New-Object TraeReadGuard+Overlapped
$dms.Offset=128
# SQLite os_win.c: WIN_SHM_BASE=(22+SQLITE_SHM_NLOCK)*4=120.
# Shared read slots 0 and 1 are bytes 123..124. Slot 0 prevents checkpoint
# writes to the base DB; slot 1 prevents WAL restart. Writer/recovery locks
# and the remaining read slots stay available. The SHM bytes are not modified.
$offset.Offset=123
try {
  $stream=New-Object IO.FileStream($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,
    [IO.FileShare]::ReadWrite)
  # SQLite's dead-man-switch shared lock keeps the live SHM mapping from being
  # discarded when another process closes its last connection.
  $dmsLocked=[TraeReadGuard]::LockFileEx($stream.SafeFileHandle.DangerousGetHandle(),1,0,1,0,[ref]$dms)
  if (-not $dmsLocked) { [Console]::Out.WriteLine('BUSY'); exit 3 }
  $locked=[TraeReadGuard]::LockFileEx($stream.SafeFileHandle.DangerousGetHandle(),1,0,2,0,[ref]$offset)
  if (-not $locked) { [Console]::Out.WriteLine('BUSY'); exit 3 }
  [Console]::Out.WriteLine('READY')
  [Console]::Out.Flush()
  if (-not [TraeReadGuard]::WaitForRelease()) { exit 5 }
} catch {
  [Console]::Error.WriteLine('TRAE read guard could not open the existing SHM file.')
  exit 2
} finally {
  if ($locked) { [void][TraeReadGuard]::UnlockFileEx($stream.SafeFileHandle.DangerousGetHandle(),0,2,0,[ref]$offset) }
  if ($dmsLocked) { [void][TraeReadGuard]::UnlockFileEx($stream.SafeFileHandle.DangerousGetHandle(),0,1,0,[ref]$dms) }
  if ($stream) { $stream.Dispose() }
}
