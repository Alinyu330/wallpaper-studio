; ============================================================================
; 壁纸工坊 自定义安装/卸载逻辑（electron-builder nsis.include 钩子）
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
;
; ★ v1.12.0 数据保护总纲（修复"更新后收纳文件无法恢复/壁纸库/设置全丢"）：
;   NSIS 覆盖安装升级时，新安装器会先静默运行旧版卸载器
;   （electron-builder installSection.nsh: uninstallOldVersion），旧卸载器里的
;   customUnInstall 同样会执行 —— v1.11.0 及之前的版本由此在每次升级时把
;   %APPDATA%\壁纸工坊 整目录删掉（config.json = 全部设置 + 壁纸库索引）。
;   三层防御 + 收纳文件夹随装随还原：
;   a) customInit 升级前预备份：新安装器 .onInit 先于旧卸载器执行，把
;      config.json（全部设置+壁纸库）与安装目录里两个收纳文件夹的内容备份到
;      旧卸载器不认识的 %APPDATA%\壁纸工坊-update-backup
;      （旧卸载器硬编码只删 %APPDATA%\壁纸工坊）—— 即使旧卸载器无守卫也丢不了；
;   b) customUnInstall / customRemoveFiles 解析 --updated 参数（升级时
;      electron-builder installUtil.nsh 恒向旧卸载器传入 --updated，真卸载没有）：
;      带该参数即为升级触发的卸载，跳过用户数据删除与桌面抢救 ——
;      v1.12.0 之后的升级不再触碰任何用户数据；
;   c) 真卸载抢救硬化：收纳文件夹在 RMDir $INSTDIR 之前改名回桌面
;      （Rename 失败用 CopyFiles 只读复制兜底），用户文件绝不静默丢失；
;   d) customInstall 装完即还原：把预备份里的 config.json 与收纳内容
;      放回 %APPDATA% 与安装目录收纳文件夹 —— 升级后第一次启动一切如旧
;      （应用内 repair.js 自愈作为兜底第二保险）。
;
;   收纳文件夹说明（与应用内 src/app-root.js 对应）：
;     $INSTDIR\收纳快捷方式(卸载恢复)\  ← 转盘收纳的快捷方式
;     $INSTDIR\收纳文件(卸载恢复)\      ← 文件收纳区收纳的普通文件
;   默认为空，用户在客户端收纳时文件才移入；安装包不含任何个人文件。
; ============================================================================

!macro customInit
  ; --- 升级前预备份（此刻旧版应用与数据都还完好）---
  ; 本宏在新安装器 .onInit 内执行，先于 install Section 的 uninstallOldVersion
  ; （即先于旧卸载器的任何删除动作）。仅当数据目录里确有配置时才刷新备份：
  ; 覆盖备份前先整目录清掉，避免上次升级残留的陈旧备份与本次数据混杂。
  IfFileExists "$APPDATA\壁纸工坊\config.json" 0 no_preupdate_backup
    RMDir /r "$APPDATA\壁纸工坊-update-backup"
    CreateDirectory "$APPDATA\壁纸工坊-update-backup"
    CopyFiles /SILENT "$APPDATA\壁纸工坊\config.json" "$APPDATA\壁纸工坊-update-backup\config.json"
    CopyFiles /SILENT "$APPDATA\壁纸工坊\config.json.bak" "$APPDATA\壁纸工坊-update-backup\config.json.bak"
    CopyFiles /SILENT "$APPDATA\壁纸工坊\weather.json" "$APPDATA\壁纸工坊-update-backup\weather.json"
    ; 旧版保管目录（v1.11 及之前的 %APPDATA% 位置）照旧备份，兼容跨版本升级
    CopyFiles /SILENT "$APPDATA\壁纸工坊\filebox-box" "$APPDATA\壁纸工坊-update-backup\filebox-box"
    CopyFiles /SILENT "$APPDATA\壁纸工坊\launcher-box" "$APPDATA\壁纸工坊-update-backup\launcher-box"
    ; 安装目录收纳文件夹（v1.12.0 起的收纳位置）随数据一并备份
    CopyFiles /SILENT "$INSTDIR\收纳快捷方式(卸载恢复)" "$APPDATA\壁纸工坊-update-backup\收纳快捷方式(卸载恢复)"
    CopyFiles /SILENT "$INSTDIR\收纳文件(卸载恢复)" "$APPDATA\壁纸工坊-update-backup\收纳文件(卸载恢复)"
  no_preupdate_backup:
!macroend

!macro customRemoveFiles
  ; 卸载器工作目录默认被 uninstaller.nsh 设为 $INSTDIR —— Windows 不允许
  ; 删除进程 cwd 所在目录，会残留"空目录壳"。先把 cwd 移出安装目录。
  SetOutPath "$PLUGINSDIR"

  ; --- 真卸载（无 --updated）时，先把安装目录的两个收纳文件夹抢救回桌面 ---
  ; 升级（带 --updated）不抢救：内容已由 customInit 备份、customInstall 会还原，
  ; 抢救到桌面反而打乱收纳状态。
  Push $R0
  Push $R1
  ClearErrors
  ${GetParameters} $R0
  ${GetOptions} $R0 "--updated" $R1
  ${ifNot} ${Errors}
    Pop $R1
    Pop $R0
    Goto rmf_no_rescue
  ${endif}
  ClearErrors
  Pop $R1
  Pop $R0

  Push $1
  Push $2

  ; --- 收纳快捷方式 → 桌面 ---
  IfFileExists "$INSTDIR\收纳快捷方式(卸载恢复)\*.*" 0 rmf_skip_sc
    StrCpy $1 "$DESKTOP\壁纸工坊-收纳快捷方式(卸载恢复)"
    StrCpy $2 0
  rmf_sc_loop:
    IfFileExists "$1\*.*" 0 rmf_sc_rename
    IntOp $2 $2 + 1
    IntCmp $2 9 rmf_sc_giveup rmf_sc_trynext rmf_sc_giveup
  rmf_sc_trynext:
    StrCpy $1 "$DESKTOP\壁纸工坊-收纳快捷方式(卸载恢复)_$2"
    Goto rmf_sc_loop
  rmf_sc_rename:
    Rename "$INSTDIR\收纳快捷方式(卸载恢复)" "$1"
    IfFileExists "$INSTDIR\收纳快捷方式(卸载恢复)\*.*" 0 rmf_sc_done
      ; Rename 失败（跨卷/文件占用）：只读复制兜底，复制成功才清源
      CopyFiles /SILENT "$INSTDIR\收纳快捷方式(卸载恢复)" "$1"
      RMDir /r "$INSTDIR\收纳快捷方式(卸载恢复)"
    rmf_sc_done:
    Goto rmf_sc_after
  rmf_sc_giveup:
  rmf_sc_after:
  rmf_skip_sc:

  ; --- 收纳文件 → 桌面 ---
  IfFileExists "$INSTDIR\收纳文件(卸载恢复)\*.*" 0 rmf_skip_fb
    StrCpy $1 "$DESKTOP\壁纸工坊-收纳文件(卸载恢复)"
    StrCpy $2 0
  rmf_fb_loop:
    IfFileExists "$1\*.*" 0 rmf_fb_rename
    IntOp $2 $2 + 1
    IntCmp $2 9 rmf_fb_giveup rmf_fb_trynext rmf_fb_giveup
  rmf_fb_trynext:
    StrCpy $1 "$DESKTOP\壁纸工坊-收纳文件(卸载恢复)_$2"
    Goto rmf_fb_loop
  rmf_fb_rename:
    Rename "$INSTDIR\收纳文件(卸载恢复)" "$1"
    IfFileExists "$INSTDIR\收纳文件(卸载恢复)\*.*" 0 rmf_fb_done
      CopyFiles /SILENT "$INSTDIR\收纳文件(卸载恢复)" "$1"
      RMDir /r "$INSTDIR\收纳文件(卸载恢复)"
    rmf_fb_done:
    Goto rmf_fb_after
  rmf_fb_giveup:
  rmf_fb_after:
  rmf_skip_fb:

  Pop $2
  Pop $1

  rmf_no_rescue:
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

!macro customInstall
  ; --- 安装目录的收纳文件夹（默认为空；升级时从预备份还原内容）---
  CreateDirectory "$INSTDIR\收纳快捷方式(卸载恢复)"
  CreateDirectory "$INSTDIR\收纳文件(卸载恢复)"

  ; --- 升级还原：预备份里的配置与收纳内容直接放回，应用首启即一切如旧 ---
  ; （应用内 repair.js 自愈仍作为兜底：此处还原成功时 repair 检测到配置健康
  ;   即跳过还原并清理预备份）
  IfFileExists "$APPDATA\壁纸工坊\config.json" ci_cfg_ok
    CreateDirectory "$APPDATA\壁纸工坊"
    CopyFiles /SILENT "$APPDATA\壁纸工坊-update-backup\config.json" "$APPDATA\壁纸工坊\config.json"
    CopyFiles /SILENT "$APPDATA\壁纸工坊-update-backup\config.json.bak" "$APPDATA\壁纸工坊\config.json.bak"
    CopyFiles /SILENT "$APPDATA\壁纸工坊-update-backup\weather.json" "$APPDATA\壁纸工坊\weather.json"
  ci_cfg_ok:
  ; 收纳内容（新旧两种备份形态都尝试；同名文件 CopyFiles 自动覆盖为同内容）
  CopyFiles /SILENT "$APPDATA\壁纸工坊-update-backup\收纳快捷方式(卸载恢复)\*.*" "$INSTDIR\收纳快捷方式(卸载恢复)\"
  CopyFiles /SILENT "$APPDATA\壁纸工坊-update-backup\收纳文件(卸载恢复)\*.*" "$INSTDIR\收纳文件(卸载恢复)\"
  CopyFiles /SILENT "$APPDATA\壁纸工坊-update-backup\launcher-box\*.*" "$INSTDIR\收纳快捷方式(卸载恢复)\"
  CopyFiles /SILENT "$APPDATA\壁纸工坊-update-backup\filebox-box\*.*" "$INSTDIR\收纳文件(卸载恢复)\"
!macroend

!macro customUnInstall
  ; --- 0) 升级守卫：覆盖安装升级时 electron-builder 会给旧卸载器传 --updated
  ; 参数（installUtil.nsh: "always pass --updated flag"），真卸载没有该参数。
  ; 带 --updated = 这次卸载是新版本覆盖安装的中间步骤，用户数据必须原样保留，
  ; 后面新安装器会继续使用同一数据目录（v1.12.0 起的卸载器自带本守卫）。
  Push $R0
  Push $R1
  ClearErrors
  ${GetParameters} $R0
  ${GetOptions} $R0 "--updated" $R1
  ${ifNot} ${Errors}
    Pop $R1
    Pop $R0
    Return
  ${endif}
  ClearErrors
  Pop $R1
  Pop $R0

  ; --- 1) 清理开机自启注册（app.setLoginItemSettings 写入 HKCU Run，value = 应用名）---
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "壁纸工坊"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "wallpaper-studio"

  ; --- 2) 抢救旧版收纳目录（v1.11 及之前存在 %APPDATA% 保管目录，跨版本
  ; 卸载兼容；v1.12.0 起收纳内容在 $INSTDIR，由 customRemoveFiles 抢救）---
  ; filebox-box = 桌面普通文件收纳区收纳的文件（移动隐藏，需恢复原处）；
  ; launcher-box = 快捷方式/程序文件收纳。均为平铺目录，整目录改名回桌面防数据丢失。
  ; 目标名冲突时依次尝试基础名与 _2.._9 后缀（多次装-卸叠加场景），全占则放弃；
  ; Rename 失败（个别文件被占用）时用 CopyFiles 只读复制兜底，复制成功同样不丢。
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
      IfFileExists "$0\filebox-box\*.*" 0 fb_done
        ; Rename 失败：目标名可写，源目录里有文件被占用 —— 只读复制兜底
        CopyFiles /SILENT "$0\filebox-box" "$1"
        RMDir /r "$0\filebox-box"
      fb_done:
      Goto fb_after
    fb_giveup:
    fb_after:
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
      IfFileExists "$0\launcher-box\*.*" 0 lb_done
        CopyFiles /SILENT "$0\launcher-box" "$1"
        RMDir /r "$0\launcher-box"
      lb_done:
      Goto lb_after
    lb_giveup:
    lb_after:
  skip_launcher:

  ; --- 3) 删除用户数据目录（彻底卸载；收纳文件已在上一步抢救回桌面）---
  RMDir /r "$0"
  Pop $2
  Pop $1
  Pop $0
!macroend
