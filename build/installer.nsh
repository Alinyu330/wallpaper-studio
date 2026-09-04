; ============================================================================
; 壁纸工坊 自定义卸载逻辑（electron-builder nsis.include 钩子）
;
; 背景：默认卸载器在用户运行时卸载存在三处"卸载不干净"：
;   1) 安装目录残留 —— 卸载器强杀主进程后，Job Object(KILL_ON_JOB_CLOSE)
;      对 mpv 引擎子进程的清场存在延迟，卸载器立即 RMDir 会与文件锁竞争，
;      导致 assets/mpv 等文件删不掉；
;   2) 数据目录残留 —— electron-builder 默认不删除 %APPDATA%\壁纸工坊
;      （壁纸库 / 配置 / 收纳的文件 / 日志）；
;   3) 自启注册残留 —— 应用用 setLoginItemSettings 写入 HKCU Run 的开机
;      自启项，默认卸载器不清理。
;
; 方案：customRemoveFiles 接管"删除已安装文件"（加等待 + 失败重试）；
;       customUnInstall 在卸载末尾清理自启注册、抢救收纳文件、删除数据目录。
; ============================================================================

!macro customRemoveFiles
  ; 卸载器工作目录默认被 uninstaller.nsh 设为 $INSTDIR —— Windows 不允许
  ; 删除进程 cwd 所在目录，会残留"空目录壳"。先把 cwd 移出安装目录。
  SetOutPath "$PLUGINSDIR"

  ; --- 卸载器已强杀主进程。等待 Job 清场引擎子进程 + 系统句柄释放 ---
  ; （避免 RMDir 与残留 mpv.exe 抢文件锁，v1.8.2 实测的安装目录残留源）
  Sleep 1500

  ; 删除全部已安装文件与子目录，再删目录壳
  RMDir /r "$INSTDIR"
  RMDir "$INSTDIR"

  ; 兜底重试：极少数情况下句柄释放较慢，二次删除
  IfFileExists "$INSTDIR\*.*" 0 remove_done
    Sleep 1500
    RMDir /r "$INSTDIR"
    RMDir "$INSTDIR"
  remove_done:
!macroend

!macro customUnInstall
  ; --- 1) 清理开机自启注册（app.setLoginItemSettings 写入 HKCU Run，value = 应用名）---
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "壁纸工坊"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "wallpaper-studio"

  ; --- 2) 抢救收纳文件：删除数据目录前，先把收纳的桌面文件移回桌面 ---
  ; filebox-box = 桌面普通文件收纳区收纳的文件（移动隐藏，需恢复原处）；
  ; launcher-box = 快捷方式/程序文件收纳。均为平铺目录，整目录改名回桌面防数据丢失。
  ; 目标名冲突时依次尝试基础名与 _2.._9 后缀（多次装-卸叠加场景），全占则放弃。
  Push $0
  Push $1
  Push $2
  StrCpy $0 "$APPDATA\壁纸工坊"

  ; --- filebox-box 抢救 ---
  IfFileExists "$0\filebox-box\*.*" 0 skip_filebox
    StrCpy $1 "$DESKTOP\壁纸工坊-收纳文件(卸载恢复)"
    StrCpy $2 0
    fb_loop:
      IfFileExists "$1\*.*" 0 fb_rename
      IntOp $2 $2 + 1
      IntCmp $2 9 fb_giveup fb_trynext fb_giveup
    fb_trynext:
      StrCpy $1 "$DESKTOP\壁纸工坊-收纳文件(卸载恢复)_$2"
      Goto fb_loop
    fb_rename:
      Rename "$0\filebox-box" "$1"
      Goto fb_done
    fb_giveup:
    fb_done:
  skip_filebox:

  ; --- launcher-box 抢救 ---
  IfFileExists "$0\launcher-box\*.*" 0 skip_launcher
    StrCpy $1 "$DESKTOP\壁纸工坊-收纳快捷方式(卸载恢复)"
    StrCpy $2 0
    lb_loop:
      IfFileExists "$1\*.*" 0 lb_rename
      IntOp $2 $2 + 1
      IntCmp $2 9 lb_giveup lb_trynext lb_giveup
    lb_trynext:
      StrCpy $1 "$DESKTOP\壁纸工坊-收纳快捷方式(卸载恢复)_$2"
      Goto lb_loop
    lb_rename:
      Rename "$0\launcher-box" "$1"
      Goto lb_done
    lb_giveup:
    lb_done:
  skip_launcher:

  ; --- 3) 删除用户数据目录（彻底卸载；收纳文件已在上一步抢救回桌面）---
  RMDir /r "$0"
  Pop $2
  Pop $1
  Pop $0
!macroend
