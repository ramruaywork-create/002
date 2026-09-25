@echo off
REM Stops the background scanner logger and removes it from Windows startup.
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\RRQC-ScannerLogger.lnk" 2>nul
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*scanner-logger.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo Stopped and removed from startup.
pause
