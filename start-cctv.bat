@echo off
REM เปิดเว็บ RRQC หน้ากล้อง CCTV ในเครื่องนี้ (ต้องติดตั้ง Python ก่อน 1 ครั้ง: python.org)
REM ต้องรันผ่านเซิร์ฟเวอร์ในเครื่อง ไม่งั้นเบราว์เซอร์จะไม่ยอมให้เลือกโฟลเดอร์บันทึกคลิป
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  where py >nul 2>nul
  if errorlevel 1 (
    echo Python not found. Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
    pause
    exit /b 1
  )
  start "RRQC server" /min py -m http.server 5510
) else (
  start "RRQC server" /min python -m http.server 5510
)

timeout /t 3 /nobreak >nul
start "" chrome --new-window "http://localhost:5510/index.html#cctv" || start "" msedge --new-window "http://localhost:5510/index.html#cctv"
