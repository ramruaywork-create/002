@echo off
REM Installs the background scanner logger: it starts automatically when you log in to Windows
REM and records every scan (codes starting with TH or SPX) no matter which program is in front.
REM Look for the small icon in the system tray (bottom-right, may be under the ^ arrow). Right-click it - Exit to stop.
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%STARTUP%\RRQC-ScannerLogger.lnk'); $s.TargetPath='powershell.exe'; $s.Arguments='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"%~dp0scanner-logger.ps1\"'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"
start "" powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0scanner-logger.ps1"
echo Installed and started. It will also start automatically at every login.
pause
