@echo off
REM Builds RRQCScanner.exe from RRQCScanner.cs using the C# compiler that ships with Windows (no install needed).
cd /d "%~dp0"
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo C# compiler not found.
  pause
  exit /b 1
)
"%CSC%" /nologo /target:winexe /codepage:65001 /out:RRQCScanner.exe /r:System.Windows.Forms.dll /r:System.Drawing.dll RRQCScanner.cs
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)
"%~dp0RRQCScanner.exe" --make-icon "%~dp0app.ico"
"%CSC%" /nologo /target:winexe /codepage:65001 /win32icon:app.ico /out:RRQCScanner.exe /r:System.Windows.Forms.dll /r:System.Drawing.dll RRQCScanner.cs
del app.ico
echo Built RRQCScanner.exe

