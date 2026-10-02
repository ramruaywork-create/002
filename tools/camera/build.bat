@echo off
REM Builds RRQCCamera.exe with the C# compiler that ships with Windows (no install needed).
cd /d "%~dp0"
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo C# compiler not found.
  if not defined NOPAUSE pause
  exit /b 1
)
"%CSC%" /nologo /target:winexe /codepage:65001 /out:RRQCCamera.exe /r:System.Windows.Forms.dll /r:System.Drawing.dll *.cs
if errorlevel 1 (
  echo Build failed.
  if not defined NOPAUSE pause
  exit /b 1
)
echo Built RRQCCamera.exe
