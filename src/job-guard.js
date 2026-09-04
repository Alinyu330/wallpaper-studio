// job-guard.js — 子进程孤儿守卫（Windows Job Object）
//
// 背景：壁纸引擎子进程（mpv 播放器、EXE 壁纸程序）由主进程 spawn。
// 正常退出时 main.js 的 will-quit 会 stopAll 清理它们；但当主进程被
// 外部强杀（任务管理器结束、NSIS 卸载器 taskkill）时清理不执行，
// 残留的 mpv 会持续锁定安装目录文件（assets/mpv/mpv.exe 等），
// 导致「卸载程序时文件删不掉」。
//
// 方案：把这类「随主进程同生共死」的引擎子进程 Assign 进一个带
// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE 的 Job Object。主进程持有的
// job 句柄随进程退出/死亡而关闭，系统随即强制结束 job 内全部进程，
// 文件锁即刻释放 —— 无论主进程是正常退出还是被强杀。
//
// 注意：只用于「壁纸引擎子进程」。用户主动打开的程序
// （转盘/收纳区启动的应用、更新安装包 spawn）绝不 guard，
// 它们应独立于应用生命周期。
const koffi = require('koffi');
const kernel32 = koffi.load('kernel32.dll');

const CreateJobObjectW = kernel32.func('void* __stdcall CreateJobObjectW(void* lpJobAttributes, void* lpName)');
const SetInformationJobObject = kernel32.func('bool __stdcall SetInformationJobObject(void* hJob, int32 infoClass, void* lpInfo, uint32 cbLength)');
const AssignProcessToJobObject = kernel32.func('bool __stdcall AssignProcessToJobObject(void* hJob, void* hProcess)');
const OpenProcess = kernel32.func('void* __stdcall OpenProcess(uint32 dwDesiredAccess, int32 bInheritHandle, uint32 dwProcessId)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void* hObject)');

const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9; // 仅用其 BasicLimitInfo.LimitFlags 字段
const PROCESS_SET_QUOTA = 0x0100;
const PROCESS_TERMINATE = 0x0001;
// sizeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)（x64）= 144；
// 其中 BasicLimitInformation.LimitFlags 字段偏移 = 16（x64 对齐后）。
const EXT_INFO_SIZE = 144;
const LIMIT_FLAGS_OFFSET = 16;

let jobHandle = null;

/** 惰性创建孤儿守卫 Job（失败返回 null，不影响正常功能） */
function getJob() {
  if (jobHandle) return jobHandle;
  try {
    const h = CreateJobObjectW(null, null);
    if (!h) return null;
    const info = koffi.alloc('uint8', EXT_INFO_SIZE);
    koffi.encode(info, LIMIT_FLAGS_OFFSET, 'uint32', JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE);
    const ok = SetInformationJobObject(h, JOB_OBJECT_EXTENDED_LIMIT_INFORMATION, info, EXT_INFO_SIZE);
    if (!ok) {
      CloseHandle(h);
      return null;
    }
    jobHandle = h;
    console.log('[job-guard] 孤儿守卫 Job 已就绪（主进程死亡自动结束引擎子进程）');
  } catch (e) {
    jobHandle = null;
  }
  return jobHandle;
}

/**
 * 把子进程纳入孤儿守卫（spawn 后立即调用）。
 * 子进程刚启动时 OpenProcess/Assign 偶发竞态失败，内部做少量重试。
 * @returns {boolean} 是否已纳入守卫（失败仅打日志，不影响功能）
 */
function guardChild(child) {
  if (!child || typeof child.pid !== 'number' || child.exitCode !== null) return false;
  const job = getJob();
  if (!job) return false;

  let attempts = 0;
  const tryAssign = () => {
    let hProc = null;
    try {
      hProc = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, child.pid);
      if (!hProc) {
        // 进程刚创建可能短暂无句柄权限（EPROCESS 初始化竞态），重试几次
        if (attempts++ < 5) { setTimeout(tryAssign, 100); return; }
        return false;
      }
      const ok = AssignProcessToJobObject(job, hProc);
      if (!ok && attempts++ < 5) {
        CloseHandle(hProc);
        setTimeout(tryAssign, 100);
        return;
      }
      CloseHandle(hProc);
      if (!ok) console.warn(`[job-guard] 纳入守卫失败 pid=${child.pid}`);
      return ok;
    } catch (e) {
      if (hProc) { try { CloseHandle(hProc); } catch (_) {} }
      return false;
    }
  };
  tryAssign();
  return true;
}

/** 释放守卫 Job（应用正常退出时兜底调用；进程退出本身也会关闭句柄） */
function dispose() {
  if (jobHandle) {
    try { CloseHandle(jobHandle); } catch (_) {}
    jobHandle = null;
  }
}

module.exports = { guardChild, dispose };
