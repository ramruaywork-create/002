@echo off
REM รันครั้งเดียวบนเครื่องเก่า: ไม่ให้เครื่อง/จอ sleep ตอนเสียบไฟ และทำทางลัดให้เปิดหน้ากล้องอัตโนมัติตอนเปิดเครื่อง
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 0
powercfg /change disk-timeout-ac 0

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%STARTUP%\RRQC-CCTV.lnk'); $s.TargetPath='%~dp0start-cctv.bat'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"

echo Done: sleep disabled while plugged in, and the CCTV page will open automatically at startup.
pause
