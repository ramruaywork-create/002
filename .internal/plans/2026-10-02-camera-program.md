# RRQCCamera.exe — ย้ายงานกล้อง CCTV ไปไว้ในโปรแกรม Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use beads-superpowers:subagent-driven-development (recommended) or beads-superpowers:executing-plans to implement this plan task-by-task. เครื่องนี้ไม่มี `bd` (beads) จึงติดตามงานด้วยช่องติ๊ก `- [ ]` ในไฟล์นี้แทน

**Goal:** โปรแกรม `RRQCCamera.exe` บนคอมเครื่องหลักเปิดกล้อง EMEET ตรวจความเคลื่อนไหว บันทึกคลิป และให้เว็บดูสด/ย้อนหลังผ่าน HTTP ใน LAN ส่วนหน้าเว็บเหลือแค่ฝั่งดู

**Architecture:** `ffmpeg.exe` ตัวเดียว (1 process) อ่านกล้องผ่าน DirectShow แล้วออก 2 ทาง: (A) JPEG ต่อเนื่องทาง stdout เข้าโปรแกรมเพื่อส่งสดและตรวจความเคลื่อนไหว (B) ท่อน mp4 10 วินาทีลงโฟลเดอร์พัก โปรแกรมตัดสินว่าท่อนไหนเก็บ (มีความเคลื่อนไหว + pre-roll/cooldown) แล้วย้ายเป็น `motion_*.mp4` เซิร์ฟเวอร์ HTTP เขียนเองบน `TcpListener` ให้เว็บเรียก `/live` `/api/*` `/clips/*`

**Tech Stack:** C# 5 (csc ที่มากับ Windows: `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`), WinForms, System.Drawing, ffmpeg essentials build (gyan.dev), JavaScript ธรรมดาในหน้าเว็บเดิม

**Spec:** `.internal/specs/2026-10-02-camera-program-design.md` (commit `46d2fe4`)

## Global Constraints

- ภาษา C# 5 เท่านั้น: ห้าม string interpolation `$""`, `?.`, `nameof`, expression-bodied members, `out var`, auto-property initializer ห้ามใช้ไลบรารี/NuGet
- คอมไพล์ด้วย csc ที่มากับ Windows ไม่ต้องติดตั้งอะไรเพิ่ม ยกเว้น `ffmpeg.exe` ที่วางข้างโปรแกรม ไม่ commit ลง git
- ที่อยู่ข้อมูล: `%APPDATA%\RRQC-Camera\` (`settings.ini`, `camera.log`, `buffer\`)
- ffmpeg เขียนเฉพาะ `buffer\` (พาธ ASCII) ห้ามส่งโฟลเดอร์คลิป (อาจมีภาษาไทย) ให้ ffmpeg โปรแกรมย้ายไฟล์เอง
- ชื่อคลิป: `motion_YYYY-MM-DD_HH-mm-ss.mp4` (รับ `.webm` ของเดิมตอนอ่านด้วย) ชื่อท่อนพัก: `seg_YYYY-MM-DD_HH-mm-ss.mp4`
- ท่อนยาว 10 วินาที, cooldown 3/5/10 วินาที, ตรวจเคลื่อนไหวทุก ~220 ms บนภาพ 160x120, `pixelThreshold = 90 - sens*6`, `ratio = 0.012 - sens*0.0009`
- เซิร์ฟเวอร์: `TcpListener` พอร์ตเริ่มต้น 8787 (ห้ามใช้ `HttpListener`) ทุกเส้นทางต้องมี `?k=<รหัส 8 ตัว>` ยกเว้น OPTIONS, header ไม่เกิน 8 KB, ผิดรหัสเกิน 10 ครั้ง/นาที/IP ตอบ 429, ดูสดพร้อมกันไม่เกิน 4, การเชื่อมต่อรวมไม่เกิน 16
- ชื่อคลิปที่รับผ่านเว็บ: `^motion_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.(mp4|webm)$` เท่านั้น
- รหัสดูกล้อง: 8 ตัว จากชุดอักษร `abcdefghjkmnpqrstuvwxyz23456789` ด้วย `RandomNumberGenerator`
- ค่าเริ่มต้น: 1080p, 15 fps, ความไว 5, cooldown 5 วินาที, เก็บคลิป 30 วัน (0 = ไม่ลบ), ลบเฉพาะไฟล์ `motion_*` ในโฟลเดอร์คลิป
- ไม่ push ขึ้น GitHub จนกว่าผู้ใช้สั่ง ทุก commit ต่อท้ายด้วยบรรทัด `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- ไฟล์ไทย/UTF-8: เขียนด้วยเครื่องมือ Write/Edit เท่านั้น ห้ามใช้ `Get-Content | Set-Content` กับไฟล์ที่มีภาษาไทย คอมไพล์ด้วย `/codepage:65001`
- ข้อความที่แสดงผู้ใช้เป็นภาษาไทย ชื่อโค้ดเป็นภาษาอังกฤษ

## File Structure

โฟลเดอร์ใหม่ `tools/camera/` (ทุกไฟล์ .cs คอมไพล์รวมเป็น `RRQCCamera.exe`)

| ไฟล์ | หน้าที่ |
|---|---|
| `Settings.cs` | `AppPaths`, `Log`, `Settings` (อ่าน/เขียน/ตรวจค่า) |
| `Clips.cs` | `ClipNames`, `KeepPolicy`, `ClipInfo`, `ClipStore` (list/purge/resolve), `ClipRecorder` (ตัดสินใจเก็บท่อน) |
| `Frames.cs` | `JpegSplitter`, `MotionDetector`, `FrameTools`, `FrameHub` |
| `Net.cs` | `HttpReq`, `HttpParse`, `Auth`, `RateLimiter`, `IServerHost` |
| `HttpServer.cs` | เซิร์ฟเวอร์ HTTP + เส้นทาง |
| `Ffmpeg.cs` | `CameraMode`, `FfmpegPipeline` (สร้างอาร์กิวเมนต์, คุมโปรเซส, parser รายการกล้อง/โหมด) |
| `Engine.cs` | `CameraEngine` ผูก pipeline + motion + recorder + retention |
| `UI.cs` | `MainForm`, `CameraArt` |
| `Program.cs` | `Main`, single instance, ตัวเลือก `--selftest --make-icon --test-source --tray --data-dir` |
| `SelfTest.cs` | ชุดทดสอบหน่วยในตัว (`RRQCCamera.exe --selftest <ไฟล์ผลลัพธ์>`) |
| `build.bat` | คอมไพล์ 2 รอบ (ใส่ไอคอน) |
| `run-selftest.ps1` | build + รัน selftest + แสดงผล |
| `tests/integration.ps1` | ทดสอบเต็มระบบด้วย `--test-source` |

แก้ของเดิม: `js/cctv.js` (เขียนใหม่เป็นฝั่งดู), `index.html` (บล็อก `pageCctv`), `css/style.css` (ส่วนเพิ่ม), `README.md`, `.gitignore`, `tools/cctv/start-cctv.bat` (เหมือนเดิม ใช้เปิดเว็บ)

## ลำดับพึ่งพา

Task 1 (ยืนยัน ffmpeg+กล้อง) → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 (ทำตามลำดับ Task 3–7 ไม่พึ่งกันนอกจากตาม Interfaces)

---

### Task 1: ขออนุญาตและดาวน์โหลด ffmpeg ยืนยันคำสั่งกับกล้องจริง

**Files:**
- Create (ไม่ commit): `tools/camera/ffmpeg.exe`
- Modify: `.gitignore` (เพิ่ม `ffmpeg.exe`, `tools/camera/buffer/`, `tools/camera/app.ico`, `tools/camera/RRQCCamera.exe`)

**Interfaces:**
- Produces: ค่าคงที่ที่ยืนยันแล้ว 3 อย่างที่ Task 8 ใช้ — (1) สตริง filter ที่ ffmpeg รับได้ (2) ชื่อกล้องและโหมด MJPEG ที่กล้อง EMEET รองรับจริง (3) ผล `-list_devices`/`-list_options` ตัวอย่างจริงไว้เป็น fixture ของ test parser

**Acceptance Criteria:**
- ได้ `tools/camera/ffmpeg.exe` ที่ผ่านการตรวจ SHA-256 ตรงกับค่าที่ gyan.dev ประกาศ และ `ffmpeg -version` ทำงาน
- คำสั่งทดลอง 1 บรรทัดสร้าง: JPEG บน stdout (อ่านเป็นภาพได้) + ท่อน `seg_*.mp4` ลง `buffer\` ทุก ~10 วินาที เล่นได้ (`ffmpeg -v error -i seg.mp4 -f null -` ไม่มี error)
- ถ้ากล้อง EMEET ต่ออยู่กับเครื่องนี้: คำสั่งเดียวกันกับกล้องจริงที่ 1920x1080 MJPEG ได้ภาพไม่ขาด ถ้าไม่ได้ต่ออยู่: บันทึกว่าตรวจกับกล้องจริงไม่ได้ในงานนี้ และไปตรวจใน Task 13

- [x] **Step 1: ขออนุญาตผู้ใช้ก่อนดาวน์โหลด** (หยุดรอคำตอบ)

ข้อความที่ต้องถาม: "ขอดาวน์โหลด ffmpeg-release-essentials.zip (~80-100 MB) จาก https://www.gyan.dev/ffmpeg/builds/ และไฟล์ .sha256 ที่คู่กัน เพื่อวางที่ tools/camera/ffmpeg.exe ตกลงไหม" ถ้าไม่ตกลง หยุดแผนทั้งหมด (โปรแกรมนี้ต้องพึ่ง ffmpeg)

- [x] **Step 2: ดาวน์โหลดและตรวจ hash**

```powershell
$tmp = Join-Path $env:TEMP 'ffmpeg-dl'; New-Item -ItemType Directory -Force $tmp | Out-Null
Invoke-WebRequest 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile "$tmp\ff.zip"
$want = (Invoke-WebRequest 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256').Content.ToString().Trim().ToLower()
$got  = (Get-FileHash "$tmp\ff.zip" -Algorithm SHA256).Hash.ToLower()
"want=$want`ngot =$got"
if ($want -ne $got) { throw 'SHA-256 ไม่ตรง ห้ามใช้ไฟล์นี้' }
Expand-Archive "$tmp\ff.zip" "$tmp\x" -Force
$exe = Get-ChildItem "$tmp\x" -Recurse -Filter ffmpeg.exe | Select -First 1
New-Item -ItemType Directory -Force 'tools\camera' | Out-Null
Copy-Item $exe.FullName 'tools\camera\ffmpeg.exe'
& 'tools\camera\ffmpeg.exe' -version | Select -First 1
```
Expected: บรรทัด `want`/`got` ตรงกัน และพิมพ์ `ffmpeg version ...`

- [x] **Step 3: เพิ่มบรรทัดใน `.gitignore`**

เพิ่มท้ายไฟล์: `ffmpeg.exe`, `tools/camera/buffer/`, `tools/camera/RRQCCamera.exe`, `tools/camera/app.ico`

- [x] **Step 4: ทดลองสร้างภาพจำลอง (ไม่ใช้กล้อง) ด้วยคำสั่งเต็มที่โปรแกรมจะใช้**

```powershell
$buf = Join-Path $env:TEMP 'rrqc-buf-test'; Remove-Item $buf -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $buf | Out-Null
$ffArgs = '-hide_banner -loglevel info -stats -re -f lavfi -i "color=c=0x303030:s=1280x720:r=15,drawbox=x=''mod(t*150,iw-200)'':y=100:w=200:h=200:color=white:t=fill:enable=''lt(mod(t,20),6)''" ' +
  '-filter_complex "[0:v]drawtext=fontfile=''C\:/Windows/Fonts/consola.ttf'':text=''%{localtime}'':x=w-tw-12:y=h-th-12:fontsize=h/28:fontcolor=0x3ddc97:shadowcolor=black:shadowx=1:shadowy=1,split=2[rec][live];[live]fps=10,scale=''min(1280,iw)'':-2[lv]" ' +
  '-map "[lv]" -an -c:v mjpeg -q:v 6 -pix_fmt yuvj420p -f image2pipe pipe:1 ' +
  "-map ""[rec]"" -an -c:v libx264 -preset veryfast -crf 26 -pix_fmt yuv420p -g 30 -force_key_frames ""expr:gte(t,n_forced*10)"" -f segment -segment_time 10 -reset_timestamps 1 -strftime 1 -segment_format_options movflags=+faststart ""$buf\seg_%Y-%m-%d_%H-%M-%S.mp4"""
$psi = New-Object Diagnostics.ProcessStartInfo 'tools\camera\ffmpeg.exe', $ffArgs
$psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.RedirectStandardInput = $true; $psi.CreateNoWindow = $true
$p = [Diagnostics.Process]::Start($psi); $err = $p.StandardError.ReadToEndAsync()
$ms = New-Object IO.MemoryStream; $t0 = Get-Date
$task = $p.StandardOutput.BaseStream.CopyToAsync($ms)
Start-Sleep 28; $p.StandardInput.WriteLine('q'); Start-Sleep 3; if (-not $p.HasExited) { $p.Kill() }
Start-Sleep 1
"stdout bytes: $($ms.Length)"; Get-ChildItem $buf | Select Name,Length
```
Expected: `stdout bytes` > 100000 (หลายเฟรม JPEG) และมีไฟล์ `seg_*.mp4` อย่างน้อย 2 ไฟล์ ถ้า ffmpeg ฟ้อง error เรื่อง filter/quote/`drawbox` expression/`mjpeg` pix_fmt ให้แก้สตริงจนผ่านแล้ว **บันทึกสตริงที่ผ่านจริงลงในคอมเมนต์ท้าย Task นี้** (Task 8 ต้องใช้สตริงนั้นแทนค่าในแผน) ตรวจท่อนเล่นได้: `& tools\camera\ffmpeg.exe -v error -i "$buf\<ไฟล์แรก>" -f null -` ต้องไม่พิมพ์ error

- [x] **Step 5: ถ้ามีกล้อง EMEET ต่ออยู่ ทดลองกับกล้องจริง**

```powershell
& tools\camera\ffmpeg.exe -hide_banner -list_devices true -f dshow -i dummy 2>&1 | Select-String '\(video\)'
$cam = 'EMEET SmartCam S600'   # ใช้ชื่อที่พิมพ์ออกมาจริง
& tools\camera\ffmpeg.exe -hide_banner -list_options true -f dshow -i "video=$cam" 2>&1 | Select-String 'vcodec|pixel_format'
```
บันทึกผลทั้งสองคำสั่งไว้เป็นข้อความตัวอย่างสำหรับ test parser (Task 8) แล้วลองสตรีม 1920x1080 MJPEG 15 fps 10 วินาทีด้วยอาร์กิวเมนต์อินพุต `-f dshow -video_size 1920x1080 -framerate 15 -vcodec mjpeg -i video="<ชื่อ>"` ต่อกับเอาต์พุตเดียวกับ Step 4 ถ้าไม่มีกล้อง: เขียนว่า "ไม่มีกล้องบนเครื่องนี้" และใช้ตัวอย่าง fixture ใน Task 8 แทน

- [x] **Step 6: Commit** (เฉพาะ `.gitignore`)

```bash
git add .gitignore
git commit -m "chore: ignore ffmpeg and camera build outputs

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

**ผลการทำ (2026-10-02):**
- ดาวน์โหลด `ffmpeg-release-essentials.zip` (109.5 MB, ffmpeg 9.0.2) SHA-256 ตรงกับค่าของ gyan.dev (`60f46726...47ba`) ผู้ใช้อนุญาตแล้ว
- คำสั่งเต็มใน Step 4 (filter, `-pix_fmt yuvj420p`, `-segment_format_options movflags=+faststart`, `-force_key_frames`) **ทำงานได้โดยไม่ต้องแก้**: stdout ได้ JPEG 2.5 MB ใน 28 วินาที, ท่อน mp4 3 ไฟล์ decode ไม่มี error, ความยาว 10.00 วินาที, ออกด้วย `q` ได้ (exit 0)
- ข้อสังเกต: ท่อนแรกใช้เวลาปิดไฟล์ ~12 วินาทีจากเวลาในชื่อ (เริ่มช้า ~2 วินาที) ท่อนถัดไปตรง 10 วินาที ไม่กระทบ `KeepPolicy.Ready` ที่เผื่อ 2 วินาที
- **เครื่องนี้ไม่มีกล้อง** (`-list_devices` ไม่พบอุปกรณ์วิดีโอ) จึงยังไม่ได้ตรวจกับ EMEET จริง และยังไม่เห็นรูปแบบข้อความ `-list_devices`/`-list_options` ของ ffmpeg 9.0.2 จริง fixture ใน Task 8 เป็นรูปแบบที่คาดไว้ ต้องเทียบใน Task 13 บนเครื่องที่ต่อกล้อง

### Task 2: โครงโปรแกรม ตัวทดสอบในตัว และสคริปต์ build

**Files:**
- Create: `tools/camera/build.bat`, `tools/camera/run-selftest.ps1`, `tools/camera/Program.cs`, `tools/camera/SelfTest.cs`

**Interfaces:**
- Produces: `static class T` — `T.Run(string name, Action body)`, `T.True(bool cond, string name)`, `T.Eq(object expected, object actual, string name)`, `T.Done(string outFile) -> int` (0 = ผ่านทั้งหมด) และ `static class SelfTest { public static int Run(string outFile) }` ที่ Task ถัดไปเพิ่มบรรทัด `T.Run("ชื่อ", SomeTests.Method);` ลงใน `Run`
- Produces: `Program.Main(string[] args)` รองรับ `--selftest <ไฟล์>`; ส่วนที่เหลือเป็น stub จนถึง Task 11

**Acceptance Criteria:**
- `run-selftest.ps1` build ผ่านและพิมพ์ `1 passed, 0 failed` (ทดสอบตัวเอง 1 ข้อ) คืนค่า exit code 0
- ถ้าแก้ให้ test หนึ่งข้อล้มเหลว สคริปต์พิมพ์ `FAIL: ...` และ exit code เป็น 1

- [x] **Step 1: สร้าง `build.bat`**

```bat
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
```

- [x] **Step 2: สร้าง `run-selftest.ps1`**

```powershell
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:NOPAUSE = '1'
cmd /c "`"$here\build.bat`""
if ($LASTEXITCODE -ne 0) { Write-Host 'BUILD FAILED'; exit 2 }
$out = Join-Path $env:TEMP 'rrqc-camera-selftest.txt'
Remove-Item $out -ErrorAction SilentlyContinue
$p = Start-Process "$here\RRQCCamera.exe" -ArgumentList '--selftest', "`"$out`"" -Wait -PassThru
if (Test-Path $out) { Get-Content $out } else { Write-Host 'selftest ไม่สร้างไฟล์ผลลัพธ์' }
exit $p.ExitCode
```

- [x] **Step 3: สร้าง `SelfTest.cs`**

```csharp
using System;
using System.IO;
using System.Text;

static class T
{
    static int pass, fail;
    static readonly StringBuilder log = new StringBuilder();

    public static void Run(string name, Action body)
    {
        try { body(); }
        catch (Exception ex) { fail++; log.AppendLine("FAIL: " + name + " threw " + ex.GetType().Name + ": " + ex.Message); }
    }
    public static void True(bool cond, string name)
    {
        if (cond) pass++; else { fail++; log.AppendLine("FAIL: " + name); }
    }
    public static void Eq(object expected, object actual, string name)
    {
        if (object.Equals(expected, actual)) pass++;
        else { fail++; log.AppendLine("FAIL: " + name + " expected=[" + expected + "] actual=[" + actual + "]"); }
    }
    public static int Done(string outFile)
    {
        log.AppendLine(pass + " passed, " + fail + " failed");
        File.WriteAllText(outFile, log.ToString(), Encoding.UTF8);
        return fail == 0 ? 0 : 1;
    }
}

static class SelfTest
{
    public static int Run(string outFile)
    {
        T.Run("harness", delegate { T.True(true, "harness works"); });
        return T.Done(outFile);
    }
}
```

- [x] **Step 4: สร้าง `Program.cs` (stub ชั่วคราว)**

```csharp
using System;
using System.Windows.Forms;

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length >= 2 && args[0] == "--selftest") return SelfTest.Run(args[1]);
        if (args.Length >= 2 && args[0] == "--make-icon") { return 0; }   // Task 11 แทนที่ด้วยการสร้างไอคอนจริง
        MessageBox.Show("RRQCCamera ยังไม่พร้อมใช้งาน (กำลังพัฒนา)");
        return 0;
    }
}
```

- [x] **Step 5: รัน** `powershell -File tools\camera\run-selftest.ps1` Expected: `1 passed, 0 failed`

- [x] **Step 6: ทดสอบว่า test ล้มเหลวได้จริง** แก้ `T.True(true,...)` เป็น `T.True(false,...)` รันดูว่า exit code 1 และมี `FAIL:` แล้วแก้กลับ

- [x] **Step 7: Commit**

```bash
git add tools/camera/build.bat tools/camera/run-selftest.ps1 tools/camera/Program.cs tools/camera/SelfTest.cs
git commit -m "feat(camera): project skeleton with built-in self-test harness

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Settings, AppPaths, Log

**Files:**
- Create: `tools/camera/Settings.cs`
- Modify: `tools/camera/SelfTest.cs` (เพิ่ม `SettingsTests`)

**Interfaces:**
- Produces:
  - `static class AppPaths { static string DataDir {get;set;} /* ค่าเริ่มต้น %APPDATA%\RRQC-Camera */; string SettingsFile; string BufferDir; string LogFile; string FfmpegPath; string DefaultClipDir; }`
  - `static class Log { static void Write(string msg) }`
  - `class Settings` ฟิลด์สาธารณะ: `string CameraName; int Width, Height, Fps, Sensitivity, CooldownMs, Rotation, Port, RetentionDays; string ClipDir; bool LocalOnly; string Code; bool Running;` เมธอด `static Settings Parse(IEnumerable<string> lines)`, `List<string> ToLines()`, `void Clamp()`, `static Settings Load()`, `void Save()`, `static string NewCode()`, `static bool IsValidCode(string c)`

**Acceptance Criteria:**
- ค่าเริ่มต้น: 1920x1080, 15 fps, ความไว 5, cooldown 5000, rotation 0, port 8787, retention 30, localOnly false, running true
- `Parse` ของ `port=99999` ได้ 65535, `port=80` ได้ 1024, `rotation=45` ได้ 0, `sensitivity=0` ได้ 1, `code=BAD` ได้ `""`, `cameraname=A"B` ตัดเครื่องหมาย `"` ออก
- `ToLines` แล้ว `Parse` กลับได้ค่าเท่าเดิม (round-trip)
- `NewCode()` ได้ 8 ตัวจากชุดอักษรที่กำหนดเสมอ และสองครั้งต่างกัน

- [x] **Step 1: เขียน test ที่ล้มเหลวก่อน** เพิ่มใน `SelfTest.cs`

```csharp
static class SettingsTests
{
    public static void All()
    {
        Settings d = Settings.Parse(new string[0]);
        T.Eq(1920, d.Width, "default width"); T.Eq(1080, d.Height, "default height");
        T.Eq(15, d.Fps, "default fps"); T.Eq(5, d.Sensitivity, "default sens");
        T.Eq(5000, d.CooldownMs, "default cooldown"); T.Eq(8787, d.Port, "default port");
        T.Eq(30, d.RetentionDays, "default retention"); T.Eq(0, d.Rotation, "default rot");

        Settings c = Settings.Parse(new string[] { "port=99999", "rotation=45", "sensitivity=0", "code=BAD", "cameraname=A\"B", "fps=500", "retentiondays=-3" });
        T.Eq(65535, c.Port, "port high clamp"); T.Eq(0, c.Rotation, "bad rotation"); T.Eq(1, c.Sensitivity, "sens low clamp");
        T.Eq("", c.Code, "bad code cleared"); T.Eq("AB", c.CameraName, "quote stripped");
        T.Eq(60, c.Fps, "fps clamp"); T.Eq(0, c.RetentionDays, "retention clamp");
        T.Eq(1024, Settings.Parse(new string[] { "port=80" }).Port, "port low clamp");

        Settings r = new Settings();
        r.CameraName = "EMEET SmartCam S600"; r.Width = 1280; r.Height = 720; r.Fps = 30; r.Sensitivity = 7;
        r.CooldownMs = 10000; r.Rotation = 270; r.ClipDir = @"C:\คลิป\กล้อง"; r.Port = 9000; r.RetentionDays = 7;
        r.LocalOnly = true; r.Code = "abcd2345"; r.Running = false;
        Settings r2 = Settings.Parse(r.ToLines());
        T.Eq(r.CameraName, r2.CameraName, "rt camera"); T.Eq(r.Width, r2.Width, "rt w"); T.Eq(r.Height, r2.Height, "rt h");
        T.Eq(r.Fps, r2.Fps, "rt fps"); T.Eq(r.Sensitivity, r2.Sensitivity, "rt sens"); T.Eq(r.CooldownMs, r2.CooldownMs, "rt cool");
        T.Eq(r.Rotation, r2.Rotation, "rt rot"); T.Eq(r.ClipDir, r2.ClipDir, "rt dir"); T.Eq(r.Port, r2.Port, "rt port");
        T.Eq(r.RetentionDays, r2.RetentionDays, "rt ret"); T.Eq(r.LocalOnly, r2.LocalOnly, "rt local");
        T.Eq(r.Code, r2.Code, "rt code"); T.Eq(r.Running, r2.Running, "rt running");

        string a = Settings.NewCode(), b = Settings.NewCode();
        T.True(Settings.IsValidCode(a), "new code valid"); T.Eq(8, a.Length, "code length"); T.True(a != b, "codes differ");
        T.True(!Settings.IsValidCode("ABCDEFGH"), "uppercase invalid"); T.True(!Settings.IsValidCode("abcdefg"), "7 chars invalid");
        T.True(!Settings.IsValidCode("abcdefg1"), "digit 1 not in alphabet");
    }
}
```
และเพิ่ม `T.Run("settings", SettingsTests.All);` ใน `SelfTest.Run` ก่อน `return`

- [x] **Step 2: รัน** `run-selftest.ps1` Expected: BUILD FAILED (ยังไม่มี `Settings`)

- [x] **Step 3: เขียน `Settings.cs`**

```csharp
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

static class AppPaths
{
    public static string DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "RRQC-Camera");
    public static string SettingsFile { get { return Path.Combine(DataDir, "settings.ini"); } }
    public static string BufferDir { get { return Path.Combine(DataDir, "buffer"); } }
    public static string LogFile { get { return Path.Combine(DataDir, "camera.log"); } }
    public static string FfmpegPath { get { return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ffmpeg.exe"); } }
    public static string DefaultClipDir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "RRQC-Clips"); } }
}

static class Log
{
    static readonly object L = new object();
    public static void Write(string msg)
    {
        try
        {
            lock (L)
            {
                Directory.CreateDirectory(AppPaths.DataDir);
                string f = AppPaths.LogFile;
                FileInfo fi = new FileInfo(f);
                if (fi.Exists && fi.Length > 1024 * 1024) { File.Copy(f, f + ".old", true); File.Delete(f); }
                File.AppendAllText(f, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + msg + "\r\n", Encoding.UTF8);
            }
        }
        catch { }
    }
}

class Settings
{
    public const string CodeAlphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    static readonly Regex CodeRx = new Regex("^[abcdefghjkmnpqrstuvwxyz23456789]{8}$");

    public string CameraName = "";
    public int Width = 1920, Height = 1080, Fps = 15;
    public int Sensitivity = 5;
    public int CooldownMs = 5000;
    public int Rotation = 0;
    public string ClipDir = "";
    public int Port = 8787;
    public int RetentionDays = 30;
    public bool LocalOnly = false;
    public string Code = "";
    public bool Running = true;

    static int Clamp(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }

    public void Clamp()
    {
        Width = Clamp(Width, 160, 7680); Height = Clamp(Height, 120, 4320); Fps = Clamp(Fps, 5, 60);
        Sensitivity = Clamp(Sensitivity, 1, 10); CooldownMs = Clamp(CooldownMs, 1000, 60000);
        if (Rotation != 0 && Rotation != 90 && Rotation != 180 && Rotation != 270) Rotation = 0;
        Port = Clamp(Port, 1024, 65535); RetentionDays = Clamp(RetentionDays, 0, 3650);
        CameraName = (CameraName ?? "").Replace("\"", "").Replace("\r", "").Replace("\n", "").Trim();
        ClipDir = (ClipDir ?? "").Replace("\r", "").Replace("\n", "").Trim();
        if (!IsValidCode(Code)) Code = "";
    }

    public static bool IsValidCode(string c) { return c != null && CodeRx.IsMatch(c); }

    public static string NewCode()
    {
        // ตัด byte >= 248 ทิ้ง (31*8) เพื่อไม่ให้เอียงเมื่อ mod 31
        StringBuilder sb = new StringBuilder();
        byte[] one = new byte[1];
        using (RandomNumberGenerator rng = RandomNumberGenerator.Create())
        {
            while (sb.Length < 8)
            {
                rng.GetBytes(one);
                if (one[0] < 248) sb.Append(CodeAlphabet[one[0] % 31]);
            }
        }
        return sb.ToString();
    }

    static int I(string v, int def) { int x; return int.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out x) ? x : def; }

    public static Settings Parse(IEnumerable<string> lines)
    {
        Settings s = new Settings();
        foreach (string line in lines)
        {
            int i = line.IndexOf('=');
            if (i < 0) continue;
            string k = line.Substring(0, i).Trim().ToLowerInvariant(), v = line.Substring(i + 1).Trim();
            switch (k)
            {
                case "cameraname": s.CameraName = v; break;
                case "width": s.Width = I(v, s.Width); break;
                case "height": s.Height = I(v, s.Height); break;
                case "fps": s.Fps = I(v, s.Fps); break;
                case "sensitivity": s.Sensitivity = I(v, s.Sensitivity); break;
                case "cooldownms": s.CooldownMs = I(v, s.CooldownMs); break;
                case "rotation": s.Rotation = I(v, 0); break;
                case "clipdir": s.ClipDir = v; break;
                case "port": s.Port = I(v, s.Port); break;
                case "retentiondays": s.RetentionDays = I(v, s.RetentionDays); break;
                case "localonly": s.LocalOnly = (v == "1"); break;
                case "code": s.Code = v; break;
                case "running": s.Running = (v != "0"); break;
            }
        }
        s.Clamp();
        return s;
    }

    public List<string> ToLines()
    {
        List<string> l = new List<string>();
        l.Add("cameraname=" + CameraName); l.Add("width=" + Width); l.Add("height=" + Height); l.Add("fps=" + Fps);
        l.Add("sensitivity=" + Sensitivity); l.Add("cooldownms=" + CooldownMs); l.Add("rotation=" + Rotation);
        l.Add("clipdir=" + ClipDir); l.Add("port=" + Port); l.Add("retentiondays=" + RetentionDays);
        l.Add("localonly=" + (LocalOnly ? "1" : "0")); l.Add("code=" + Code); l.Add("running=" + (Running ? "1" : "0"));
        return l;
    }

    public static Settings Load()
    {
        Settings s;
        try { s = File.Exists(AppPaths.SettingsFile) ? Parse(File.ReadAllLines(AppPaths.SettingsFile, Encoding.UTF8)) : new Settings(); }
        catch (Exception ex) { Log.Write("อ่านตั้งค่าไม่สำเร็จ: " + ex.Message); s = new Settings(); }
        bool changed = false;
        if (s.Code == "") { s.Code = NewCode(); changed = true; }
        if (s.ClipDir == "") { s.ClipDir = AppPaths.DefaultClipDir; changed = true; }
        if (changed) s.Save();
        return s;
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(AppPaths.DataDir);
            File.WriteAllLines(AppPaths.SettingsFile, ToLines().ToArray(), Encoding.UTF8);
        }
        catch (Exception ex) { Log.Write("บันทึกตั้งค่าไม่สำเร็จ: " + ex.Message); }
    }
}
```

- [x] **Step 4: รัน** `run-selftest.ps1` Expected: `... passed, 0 failed`

- [x] **Step 5: Commit** (`git add tools/camera/Settings.cs tools/camera/SelfTest.cs`, ข้อความ `feat(camera): settings, paths and log`)

---

### Task 4: ClipNames และ KeepPolicy

**Files:**
- Create: `tools/camera/Clips.cs` (ส่วน `ClipNames`, `KeepPolicy`)
- Modify: `tools/camera/SelfTest.cs`

**Interfaces:**
- Produces:
  - `static class ClipNames { bool IsClipName(string n); bool TryParseClip(string n, out DateTime localStart); bool TryParseSeg(string n, out DateTime localStart); string ClipNameFor(DateTime localStart) /* "motion_YYYY-MM-DD_HH-mm-ss.mp4" */; string SegNameFor(DateTime localStart) }`
  - `static class KeepPolicy { bool Keep(IList<DateTime> motions, DateTime segStart, int segSeconds, int cooldownMs); bool Ready(DateTime now, DateTime segStart, int segSeconds) }`

**Acceptance Criteria:**
- `IsClipName` รับ `motion_2026-10-02_09-05-07.mp4` และ `.webm` ปฏิเสธ `..\x.mp4`, `motion_2026-10-02_09-05-07.mp4.exe`, `motion_2026-13-40_99-99-99.mp4` (วันที่เป็นไปไม่ได้), `seg_...`, null, `""`
- `Keep`: มี motion ในท่อน → true; motion ในท่อนถัดไป → true; motion ก่อนเริ่มท่อนภายใน cooldown → true; ก่อนเกิน cooldown → false; ไม่มี motion → false
- `Ready(now, start, 10)` เป็น false ก่อน `start+22s` และ true ตั้งแต่ `start+22s`

- [x] **Step 1: เขียน test** (เพิ่ม `ClipRulesTests` ใน `SelfTest.cs`, ลงทะเบียนใน `Run`)

```csharp
static class ClipRulesTests
{
    public static void All()
    {
        T.True(ClipNames.IsClipName("motion_2026-10-02_09-05-07.mp4"), "clip mp4");
        T.True(ClipNames.IsClipName("motion_2026-10-02_09-05-07.webm"), "clip webm");
        T.True(!ClipNames.IsClipName(@"..\x.mp4"), "traversal");
        T.True(!ClipNames.IsClipName("motion_2026-10-02_09-05-07.mp4.exe"), "double ext");
        T.True(!ClipNames.IsClipName("motion_2026-13-40_99-99-99.mp4"), "impossible date");
        T.True(!ClipNames.IsClipName("seg_2026-10-02_09-05-07.mp4"), "seg is not clip");
        T.True(!ClipNames.IsClipName(null), "null"); T.True(!ClipNames.IsClipName(""), "empty");
        DateTime t;
        T.True(ClipNames.TryParseClip("motion_2026-10-02_09-05-07.mp4", out t), "parse clip");
        T.Eq(new DateTime(2026, 10, 2, 9, 5, 7), new DateTime(t.Year, t.Month, t.Day, t.Hour, t.Minute, t.Second), "clip time");
        T.True(ClipNames.TryParseSeg("seg_2026-10-02_23-59-50.mp4", out t), "parse seg");
        T.Eq(23, t.Hour, "seg hour");
        T.Eq("motion_2026-10-02_09-05-07.mp4", ClipNames.ClipNameFor(new DateTime(2026, 10, 2, 9, 5, 7)), "name for");
        T.Eq("seg_2026-10-02_09-05-07.mp4", ClipNames.SegNameFor(new DateTime(2026, 10, 2, 9, 5, 7)), "seg name for");

        DateTime s0 = new DateTime(2026, 10, 2, 9, 0, 0);
        System.Collections.Generic.List<DateTime> none = new System.Collections.Generic.List<DateTime>();
        T.True(!KeepPolicy.Keep(none, s0, 10, 5000), "no motion drop");
        T.True(KeepPolicy.Keep(new DateTime[] { s0.AddSeconds(4) }, s0, 10, 5000), "motion inside");
        T.True(KeepPolicy.Keep(new DateTime[] { s0.AddSeconds(14) }, s0, 10, 5000), "motion next segment = pre-roll");
        T.True(!KeepPolicy.Keep(new DateTime[] { s0.AddSeconds(20) }, s0, 10, 5000), "motion two segments later drop");
        T.True(KeepPolicy.Keep(new DateTime[] { s0.AddSeconds(-3) }, s0, 10, 5000), "recent motion within cooldown");
        T.True(!KeepPolicy.Keep(new DateTime[] { s0.AddSeconds(-6) }, s0, 10, 5000), "old motion beyond cooldown");
        T.True(!KeepPolicy.Ready(s0.AddSeconds(21.9), s0, 10), "not ready yet");
        T.True(KeepPolicy.Ready(s0.AddSeconds(22), s0, 10), "ready at 22s");
    }
}
```

- [x] **Step 2: รัน** Expected: BUILD FAILED

- [x] **Step 3: เขียน `Clips.cs` (ส่วนแรก)**

```csharp
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;

static class ClipNames
{
    static readonly Regex ClipRx = new Regex(@"^motion_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.(mp4|webm)$", RegexOptions.Compiled);
    static readonly Regex SegRx = new Regex(@"^seg_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.mp4$", RegexOptions.Compiled);

    static bool Parse(Regex rx, string name, out DateTime t)
    {
        t = DateTime.MinValue;
        if (name == null) return false;
        Match m = rx.Match(name);
        if (!m.Success) return false;
        try
        {
            t = new DateTime(int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value), int.Parse(m.Groups[3].Value),
                int.Parse(m.Groups[4].Value), int.Parse(m.Groups[5].Value), int.Parse(m.Groups[6].Value), DateTimeKind.Local);
            return true;
        }
        catch (ArgumentOutOfRangeException) { return false; }
    }

    public static bool IsClipName(string n) { DateTime t; return Parse(ClipRx, n, out t); }
    public static bool TryParseClip(string n, out DateTime localStart) { return Parse(ClipRx, n, out localStart); }
    public static bool TryParseSeg(string n, out DateTime localStart) { return Parse(SegRx, n, out localStart); }
    public static string ClipNameFor(DateTime t) { return "motion_" + t.ToString("yyyy-MM-dd_HH-mm-ss", CultureInfo.InvariantCulture) + ".mp4"; }
    public static string SegNameFor(DateTime t) { return "seg_" + t.ToString("yyyy-MM-dd_HH-mm-ss", CultureInfo.InvariantCulture) + ".mp4"; }
}

static class KeepPolicy
{
    // เก็บท่อนที่เริ่ม segStart ถ้ามี motion ใน [segStart - cooldown, segStart + 2*segSeconds)
    // (ท่อนนี้ + ท่อนถัดไปเป็น pre-roll + หางหลัง motion ตาม cooldown)
    public static bool Keep(IList<DateTime> motions, DateTime segStart, int segSeconds, int cooldownMs)
    {
        DateTime from = segStart.AddMilliseconds(-cooldownMs), to = segStart.AddSeconds(2 * segSeconds);
        for (int i = 0; i < motions.Count; i++) if (motions[i] >= from && motions[i] < to) return true;
        return false;
    }

    // ตัดสินได้เมื่อท่อนถัดไปจบแล้วบวกเวลาเผื่อปิดไฟล์ 2 วินาที
    public static bool Ready(DateTime now, DateTime segStart, int segSeconds)
    {
        return now >= segStart.AddSeconds(2 * segSeconds + 2);
    }
}
```
หมายเหตุ: `Keep` รับ `IList<DateTime>` และ `DateTime[]` เป็น `IList<DateTime>` ได้

- [x] **Step 4: รัน** Expected: ผ่านทั้งหมด **Step 5: Commit** (`feat(camera): clip naming and keep policy`)

---

### Task 5: ClipStore และ ClipRecorder

**Files:**
- Modify: `tools/camera/Clips.cs` (ต่อท้าย `ClipInfo`, `ClipStore`, `ClipRecorder`)
- Modify: `tools/camera/SelfTest.cs`

**Interfaces:**
- Consumes: `ClipNames`, `KeepPolicy`, `Settings`
- Produces:
  - `class ClipInfo { string Name; long StartMs, EndMs, Size; }`
  - `static class ClipStore { long ToEpochMs(DateTime local); List<ClipInfo> List(string dir, long fromMs, long toMs); string ResolvePath(string dir, string name); int PurgeOld(string dir, DateTime now, int days); }`
  - `class ClipRecorder { const int SegSeconds = 10; ClipRecorder(Settings s, string bufferDir); event Action<string> ClipSaved; void NoteMotion(DateTime localNow); void ResetBuffer(); void DropLatestSegment(); void Tick(DateTime localNow); }`

**Acceptance Criteria:**
- `List` คืนเฉพาะคลิปที่ช่วงเวลาทับกับ [from,to] เรียงตามเวลาเริ่ม ไม่คืนไฟล์ชื่อแปลก `end = max(เวลาแก้ไขไฟล์, start+1000)` เป็น epoch ms UTC
- `ResolvePath` ได้พาธเมื่อชื่อถูกต้องและไฟล์มีจริง คืน null สำหรับชื่อแปลก/ไม่มีไฟล์
- `PurgeOld` ลบเฉพาะ `motion_*` ที่ **เวลาในชื่อ** เก่ากว่า `days` วัน; `days = 0` ไม่ลบอะไร; ไม่แตะไฟล์อื่น (เช่น `notes.txt`)
- `Tick`: ท่อนที่พร้อมและมี motion → ย้ายไป ClipDir ชื่อ `motion_*.mp4` และยิง `ClipSaved`; ท่อนที่พร้อมแต่ไม่มี motion → ถูกลบ; ท่อนที่ยังไม่พร้อมไม่ถูกแตะ; ไฟล์ขนาด 0 ถูกลบ
- `DropLatestSegment` ลบท่อนล่าสุด (ชื่อใหม่สุด) ในโฟลเดอร์พักเท่านั้น

- [x] **Step 1: เขียน test** (`ClipStoreTests`, `ClipRecorderTests`)

```csharp
static class ClipStoreTests
{
    static string NewDir() { string d = Path.Combine(Path.GetTempPath(), "rrqc-t-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(d); return d; }
    static void Touch(string dir, string name, int bytes, DateTime? mtime)
    {
        string p = Path.Combine(dir, name); File.WriteAllBytes(p, new byte[bytes]);
        if (mtime.HasValue) File.SetLastWriteTime(p, mtime.Value);
    }

    public static void All()
    {
        string d = NewDir();
        DateTime a = new DateTime(2026, 10, 2, 9, 0, 0), b = new DateTime(2026, 10, 2, 10, 0, 0);
        Touch(d, ClipNames.ClipNameFor(a), 100, a.AddSeconds(12));
        Touch(d, ClipNames.ClipNameFor(b), 200, b.AddSeconds(30));
        Touch(d, "notes.txt", 5, null); Touch(d, "motion_bad.mp4", 5, null);
        long from = ClipStore.ToEpochMs(a.AddMinutes(-1)), to = ClipStore.ToEpochMs(a.AddMinutes(1));
        System.Collections.Generic.List<ClipInfo> l = ClipStore.List(d, from, to);
        T.Eq(1, l.Count, "list overlap count"); T.Eq(ClipNames.ClipNameFor(a), l[0].Name, "list name");
        T.Eq(ClipStore.ToEpochMs(a), l[0].StartMs, "start ms"); T.Eq(ClipStore.ToEpochMs(a.AddSeconds(12)), l[0].EndMs, "end ms");
        T.Eq(100L, l[0].Size, "size");
        T.Eq(2, ClipStore.List(d, from, ClipStore.ToEpochMs(b.AddHours(1))).Count, "list both");
        T.True(ClipStore.ResolvePath(d, ClipNames.ClipNameFor(a)) != null, "resolve ok");
        T.True(ClipStore.ResolvePath(d, "notes.txt") == null, "resolve rejects non-clip");
        T.True(ClipStore.ResolvePath(d, ClipNames.ClipNameFor(a.AddDays(5))) == null, "resolve missing");
        T.True(ClipStore.ResolvePath(d, @"..\" + ClipNames.ClipNameFor(a)) == null, "resolve traversal");

        T.Eq(0, ClipStore.PurgeOld(d, b.AddDays(10), 0), "days 0 deletes nothing");
        T.Eq(1, ClipStore.PurgeOld(d, new DateTime(2026, 10, 3, 9, 30, 0), 1), "purge old by name time");
        T.True(!File.Exists(Path.Combine(d, ClipNames.ClipNameFor(a))), "old clip deleted");
        T.True(File.Exists(Path.Combine(d, ClipNames.ClipNameFor(b))), "newer clip kept");
        T.True(File.Exists(Path.Combine(d, "notes.txt")), "other files untouched");
        Directory.Delete(d, true);
    }
}

static class ClipRecorderTests
{
    public static void All()
    {
        string root = Path.Combine(Path.GetTempPath(), "rrqc-t-" + Guid.NewGuid().ToString("N"));
        string buf = Path.Combine(root, "buf"), clips = Path.Combine(root, "clips");
        Directory.CreateDirectory(buf);
        Settings s = new Settings(); s.ClipDir = clips; s.CooldownMs = 5000;
        ClipRecorder r = new ClipRecorder(s, buf);
        int saved = 0; r.ClipSaved += delegate(string n) { saved++; };

        DateTime t0 = new DateTime(2026, 10, 2, 9, 0, 0);
        DateTime[] starts = { t0, t0.AddSeconds(10), t0.AddSeconds(20), t0.AddSeconds(30), t0.AddSeconds(40) };
        foreach (DateTime st in starts) File.WriteAllBytes(Path.Combine(buf, ClipNames.SegNameFor(st)), new byte[10]);
        File.WriteAllBytes(Path.Combine(buf, ClipNames.SegNameFor(t0.AddSeconds(50))), new byte[0]);   // 0 byte
        r.NoteMotion(t0.AddSeconds(33));    // อยู่ในท่อน t0+30 → เก็บ t0+30 และ pre-roll t0+20

        r.Tick(t0.AddSeconds(21));          // ท่อน t0 ยังไม่พร้อม (ต้อง >= 22s)
        T.True(File.Exists(Path.Combine(buf, ClipNames.SegNameFor(t0))), "t0 untouched before ready");
        r.Tick(t0.AddSeconds(100));         // ทุกท่อนที่เริ่มก่อน t0+78 พร้อมแล้ว
        T.True(!File.Exists(Path.Combine(buf, ClipNames.SegNameFor(t0))), "t0 dropped");
        T.True(!File.Exists(Path.Combine(buf, ClipNames.SegNameFor(t0.AddSeconds(10)))), "t0+10 dropped");
        T.True(File.Exists(Path.Combine(clips, ClipNames.ClipNameFor(t0.AddSeconds(20)))), "t0+20 kept (pre-roll)");
        T.True(File.Exists(Path.Combine(clips, ClipNames.ClipNameFor(t0.AddSeconds(30)))), "t0+30 kept");
        T.True(!File.Exists(Path.Combine(clips, ClipNames.ClipNameFor(t0.AddSeconds(40)))), "t0+40 not kept");
        T.True(!File.Exists(Path.Combine(buf, ClipNames.SegNameFor(t0.AddSeconds(50)))), "0 byte deleted");
        T.Eq(2, saved, "ClipSaved fired twice");

        File.WriteAllBytes(Path.Combine(buf, ClipNames.SegNameFor(t0.AddSeconds(200))), new byte[5]);
        File.WriteAllBytes(Path.Combine(buf, ClipNames.SegNameFor(t0.AddSeconds(210))), new byte[5]);
        r.DropLatestSegment();
        T.True(File.Exists(Path.Combine(buf, ClipNames.SegNameFor(t0.AddSeconds(200)))), "older seg stays");
        T.True(!File.Exists(Path.Combine(buf, ClipNames.SegNameFor(t0.AddSeconds(210)))), "latest seg dropped");
        r.ResetBuffer();
        T.Eq(0, Directory.GetFiles(buf, "seg_*").Length, "reset clears buffer");
        Directory.Delete(root, true);
    }
}
```
ลงทะเบียน `T.Run("clip store", ClipStoreTests.All); T.Run("clip recorder", ClipRecorderTests.All);` ใน `SelfTest.Run` (เวลา 09:00 วันที่ 2 เก่ากว่า 1 วัน ณ 09:30 วันที่ 3 จึงถูกลบ; 10:00 ยังไม่เก่ากว่า จึงอยู่)

- [x] **Step 2: รัน** Expected: BUILD FAILED

- [x] **Step 3: เพิ่มโค้ดต่อท้าย `Clips.cs`**

```csharp
class ClipInfo { public string Name; public long StartMs, EndMs, Size; }

static class ClipStore
{
    static readonly DateTime Epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    public static long ToEpochMs(DateTime local) { return (long)(local.ToUniversalTime() - Epoch).TotalMilliseconds; }

    public static List<ClipInfo> List(string dir, long fromMs, long toMs)
    {
        List<ClipInfo> res = new List<ClipInfo>();
        if (!Directory.Exists(dir)) return res;
        foreach (string path in Directory.GetFiles(dir, "motion_*"))
        {
            string name = Path.GetFileName(path);
            DateTime start;
            if (!ClipNames.TryParseClip(name, out start)) continue;
            FileInfo fi = new FileInfo(path);
            long s = ToEpochMs(start), e = Math.Max(ToEpochMs(fi.LastWriteTime), s + 1000);
            if (e < fromMs || s > toMs) continue;
            ClipInfo c = new ClipInfo(); c.Name = name; c.StartMs = s; c.EndMs = e; c.Size = fi.Length;
            res.Add(c);
        }
        res.Sort(delegate(ClipInfo x, ClipInfo y) { return x.StartMs.CompareTo(y.StartMs); });
        return res;
    }

    public static string ResolvePath(string dir, string name)
    {
        if (!ClipNames.IsClipName(name)) return null;
        string p = Path.Combine(dir, name);
        return File.Exists(p) ? p : null;
    }

    public static int PurgeOld(string dir, DateTime now, int days)
    {
        if (days <= 0 || !Directory.Exists(dir)) return 0;
        DateTime cutoff = now.AddDays(-days);
        int n = 0;
        foreach (string path in Directory.GetFiles(dir, "motion_*"))
        {
            DateTime start;
            if (!ClipNames.TryParseClip(Path.GetFileName(path), out start)) continue;
            if (start < cutoff) { try { File.Delete(path); n++; } catch (IOException) { } }
        }
        return n;
    }
}

class ClipRecorder
{
    public const int SegSeconds = 10;
    readonly Settings s;
    readonly string bufDir;
    readonly List<DateTime> motions = new List<DateTime>();
    readonly object sync = new object();
    public event Action<string> ClipSaved;

    public ClipRecorder(Settings settings, string bufferDir) { s = settings; bufDir = bufferDir; }

    public void NoteMotion(DateTime localNow) { lock (sync) { motions.Add(localNow); } }

    public void ResetBuffer()
    {
        if (!Directory.Exists(bufDir)) return;
        foreach (string f in Directory.GetFiles(bufDir, "seg_*")) { try { File.Delete(f); } catch (IOException) { } }
    }

    // ffmpeg ถูกฆ่ากลางทาง ท่อนล่าสุดอาจเขียนไม่จบ เล่นไม่ได้ จึงทิ้ง
    public void DropLatestSegment()
    {
        if (!Directory.Exists(bufDir)) return;
        string latest = null; DateTime latestT = DateTime.MinValue;
        foreach (string f in Directory.GetFiles(bufDir, "seg_*"))
        {
            DateTime t;
            if (ClipNames.TryParseSeg(Path.GetFileName(f), out t) && t > latestT) { latestT = t; latest = f; }
        }
        if (latest != null) { try { File.Delete(latest); } catch (IOException) { } }
    }

    public void Tick(DateTime now)
    {
        if (!Directory.Exists(bufDir)) return;
        List<DateTime> snap;
        lock (sync)
        {
            motions.RemoveAll(delegate(DateTime m) { return m < now.AddMinutes(-5); });
            snap = new List<DateTime>(motions);
        }
        foreach (string path in Directory.GetFiles(bufDir, "seg_*.mp4"))
        {
            DateTime start;
            if (!ClipNames.TryParseSeg(Path.GetFileName(path), out start)) continue;
            if (!KeepPolicy.Ready(now, start, SegSeconds)) continue;
            try
            {
                FileInfo fi = new FileInfo(path);
                if (fi.Length == 0 || !KeepPolicy.Keep(snap, start, SegSeconds, s.CooldownMs)) { File.Delete(path); continue; }
                Directory.CreateDirectory(s.ClipDir);
                string name = ClipNames.ClipNameFor(start), dest = Path.Combine(s.ClipDir, name);
                if (File.Exists(dest)) { File.Delete(path); continue; }
                File.Move(path, dest);
                Action<string> h = ClipSaved; if (h != null) h(name);
            }
            catch (IOException ex) { Log.Write("ย้ายคลิปไม่สำเร็จ (จะลองใหม่): " + ex.Message); }
            catch (UnauthorizedAccessException ex) { Log.Write("ไม่มีสิทธิ์เขียนโฟลเดอร์คลิป: " + ex.Message); }
        }
    }
}
```

- [x] **Step 4: รัน** Expected: ผ่านทั้งหมด **Step 5: Commit** (`feat(camera): clip store, retention and recorder decisions`)

---

### Task 6: JpegSplitter, MotionDetector, FrameTools, FrameHub

**Files:**
- Create: `tools/camera/Frames.cs`
- Modify: `tools/camera/SelfTest.cs`

**Interfaces:**
- Produces:
  - `class JpegSplitter { List<byte[]> Push(byte[] data, int count) }`
  - `class MotionDetector { const int W = 160, H = 120; int Sensitivity; void Reset(); bool Update(byte[] rgb /* length W*H*3 */) }` (ครั้งแรกหลัง Reset คืน false)
  - `static class FrameTools { byte[] ToRgb160(byte[] jpeg); System.Drawing.Bitmap Decode(byte[] jpeg); byte[] MakeJpeg(System.Drawing.Bitmap bmp) }`
  - `class FrameHub { void Publish(byte[] jpeg); bool WaitNext(long after, int timeoutMs, out byte[] jpeg, out long seq); byte[] Latest(); long Seq }`

**Acceptance Criteria:**
- `JpegSplitter` ได้ 3 เฟรมเมื่อป้อน 3 JPEG ต่อกันแม้ถูกหั่นเป็นก้อน 1/7/1000 ไบต์ ข้อมูลขยะก่อน SOI ถูกข้าม ไม่คืนเฟรมที่ยังไม่ครบ และบัฟเฟอร์ไม่โตเกิน 16 MB
- `MotionDetector`: เฟรมแรก false; เฟรมเหมือนเดิม false; เฟรมที่เปลี่ยน >50% ของพิกเซลมากๆ true; เปลี่ยนเล็กน้อย (1% ของพิกเซล ความต่างน้อย) ที่ความไว 1 false แต่ที่ความไว 10 อาจ true ตามสูตร (ทดสอบด้วยค่าที่คำนวณได้แน่ ดูโค้ด test)
- `FrameTools.ToRgb160` คืนอาร์เรย์ยาว 160*120*3 จาก JPEG ใดๆ ขนาดภาพใดก็ได้
- `FrameHub.WaitNext` คืนเฟรมใหม่ที่ seq มากกว่า `after`; หมดเวลาคืน false; ปลุกเธรดที่รออยู่เมื่อ `Publish`

- [x] **Step 1: เขียน test**

```csharp
static class FrameTests
{
    public static byte[] Jpg(int w, int h, System.Drawing.Color c)
    {
        using (System.Drawing.Bitmap b = new System.Drawing.Bitmap(w, h))
        {
            using (System.Drawing.Graphics g = System.Drawing.Graphics.FromImage(b)) g.Clear(c);
            return FrameTools.MakeJpeg(b);
        }
    }

    public static void All()
    {
        byte[] j1 = Jpg(64, 48, System.Drawing.Color.Red), j2 = Jpg(64, 48, System.Drawing.Color.Green), j3 = Jpg(32, 32, System.Drawing.Color.Blue);
        System.IO.MemoryStream all = new System.IO.MemoryStream();
        byte[] junk = { 1, 2, 3, 0xFF };
        all.Write(junk, 0, junk.Length); all.Write(j1, 0, j1.Length); all.Write(j2, 0, j2.Length); all.Write(j3, 0, j3.Length);
        byte[] stream = all.ToArray();
        foreach (int chunk in new int[] { 1, 7, 1000 })
        {
            JpegSplitter sp = new JpegSplitter(); int n = 0;
            for (int i = 0; i < stream.Length; i += chunk)
            {
                int c = Math.Min(chunk, stream.Length - i); byte[] part = new byte[c]; Array.Copy(stream, i, part, 0, c);
                System.Collections.Generic.List<byte[]> got = sp.Push(part, c);
                foreach (byte[] f in got) { n++; T.True(f[0] == 0xFF && f[1] == 0xD8 && f[f.Length - 2] == 0xFF && f[f.Length - 1] == 0xD9, "frame markers chunk=" + chunk); }
            }
            T.Eq(3, n, "3 frames chunk=" + chunk);
        }
        JpegSplitter sp2 = new JpegSplitter();
        T.Eq(0, sp2.Push(j1, j1.Length - 5).Count, "incomplete frame not returned");
        T.Eq(1, sp2.Push(new byte[] { j1[j1.Length - 5], j1[j1.Length - 4], j1[j1.Length - 3], j1[j1.Length - 2], j1[j1.Length - 1] }, 5).Count, "completes later");

        byte[] rgb = FrameTools.ToRgb160(j3);
        T.Eq(MotionDetector.W * MotionDetector.H * 3, rgb.Length, "rgb size");

        MotionDetector d = new MotionDetector(); d.Sensitivity = 5;
        byte[] a = new byte[MotionDetector.W * MotionDetector.H * 3], b = new byte[a.Length];
        T.True(!d.Update(a), "first frame no motion");
        T.True(!d.Update(a), "identical frame");
        for (int i = 0; i < b.Length; i++) b[i] = 255;
        T.True(d.Update(b), "all-white vs black = motion");
        // ความไว 5: pixelThreshold=60 ratio=0.0075 → เปลี่ยน 1% ของพิกเซล (192 px) ด้วยความต่าง 765 ผ่านทั้งคู่ → true
        d.Reset(); d.Update(a);
        byte[] c2 = (byte[])a.Clone();
        for (int p = 0; p < 192; p++) { c2[p * 3] = 255; c2[p * 3 + 1] = 255; c2[p * 3 + 2] = 255; }
        T.True(d.Update(c2), "1% bright change at sens 5");
        // ความไว 1: ratio=0.0111 → 192/19200 = 0.01 ไม่เกิน → false
        d.Reset(); d.Sensitivity = 1; d.Update(a);
        T.True(!d.Update(c2), "1% change below ratio at sens 1");
        // ความต่างเล็กกว่า pixelThreshold (ความไว 5 = 60): ต่าง 20+20+19=59 ไม่นับ
        d.Reset(); d.Sensitivity = 5; d.Update(a);
        byte[] c3 = (byte[])a.Clone();
        for (int i = 0; i < c3.Length; i += 3) { c3[i] = 20; c3[i + 1] = 20; c3[i + 2] = 19; }
        T.True(!d.Update(c3), "small per-pixel diff ignored");

        FrameHub hub = new FrameHub(); byte[] got2; long seq;
        T.True(!hub.WaitNext(0, 50, out got2, out seq), "timeout when empty");
        System.Threading.ThreadPool.QueueUserWorkItem(delegate { System.Threading.Thread.Sleep(100); hub.Publish(j1); });
        T.True(hub.WaitNext(0, 2000, out got2, out seq), "wakes on publish");
        T.Eq(1L, seq, "seq 1"); T.Eq(j1.Length, got2.Length, "payload");
        T.True(!hub.WaitNext(1, 50, out got2, out seq), "no newer frame");
        hub.Publish(j2);
        T.True(hub.WaitNext(1, 50, out got2, out seq), "newer frame"); T.Eq(2L, seq, "seq 2");
        T.True(hub.Latest() != null, "latest set");
    }
}
```
ลงทะเบียน `T.Run("frames", FrameTests.All);` (ต้องมี `using System;` บนสุดของ SelfTest.cs แล้วจาก Task 2)

- [x] **Step 2: รัน** Expected: BUILD FAILED

- [x] **Step 3: เขียน `Frames.cs`**

```csharp
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Threading;

class JpegSplitter
{
    const int MaxBuf = 16 << 20;
    byte[] buf = new byte[1 << 20];
    int len;

    int Find(byte second, int from)
    {
        for (int i = from; i + 1 < len; i++) if (buf[i] == 0xFF && buf[i + 1] == second) return i;
        return -1;
    }

    public List<byte[]> Push(byte[] data, int count)
    {
        List<byte[]> frames = new List<byte[]>();
        if (len + count > MaxBuf) len = 0;                 // กันบัฟเฟอร์โตไม่หยุดเมื่อสตรีมเสีย
        if (len + count > buf.Length) Array.Resize(ref buf, Math.Max(buf.Length * 2, len + count));
        Buffer.BlockCopy(data, 0, buf, len, count);
        len += count;
        int pos = 0;
        while (true)
        {
            int soi = Find(0xD8, pos);
            if (soi < 0) { pos = Math.Max(pos, len - 1); break; }   // เก็บไบต์ท้ายไว้เผื่อเป็น 0xFF ครึ่งแรกของ marker
            int eoi = Find(0xD9, soi + 2);
            if (eoi < 0) { pos = soi; break; }
            byte[] f = new byte[eoi + 2 - soi];
            Buffer.BlockCopy(buf, soi, f, 0, f.Length);
            frames.Add(f);
            pos = eoi + 2;
        }
        if (pos > 0) { Buffer.BlockCopy(buf, pos, buf, 0, len - pos); len -= pos; }
        return frames;
    }
}

class MotionDetector
{
    public const int W = 160, H = 120;
    public int Sensitivity = 5;
    byte[] prev;

    public void Reset() { prev = null; }

    public bool Update(byte[] rgb)
    {
        bool motion = false;
        if (prev != null)
        {
            int pixelThreshold = 90 - Sensitivity * 6;
            double ratio = 0.012 - Sensitivity * 0.0009;
            int changed = 0;
            for (int i = 0; i + 2 < rgb.Length; i += 3)
            {
                int d = Math.Abs(prev[i] - rgb[i]) + Math.Abs(prev[i + 1] - rgb[i + 1]) + Math.Abs(prev[i + 2] - rgb[i + 2]);
                if (d > pixelThreshold) changed++;
            }
            motion = (double)changed / (W * H) > ratio;
        }
        prev = rgb;
        return motion;
    }
}

static class FrameTools
{
    public static Bitmap Decode(byte[] jpeg)
    {
        using (MemoryStream ms = new MemoryStream(jpeg))
        using (Image img = Image.FromStream(ms)) { return new Bitmap(img); }
    }

    public static byte[] ToRgb160(byte[] jpeg)
    {
        using (MemoryStream ms = new MemoryStream(jpeg))
        using (Image img = Image.FromStream(ms))
        using (Bitmap small = new Bitmap(MotionDetector.W, MotionDetector.H, PixelFormat.Format24bppRgb))
        {
            using (Graphics g = Graphics.FromImage(small))
            {
                g.InterpolationMode = InterpolationMode.Bilinear;
                g.DrawImage(img, 0, 0, MotionDetector.W, MotionDetector.H);
            }
            BitmapData bd = small.LockBits(new Rectangle(0, 0, MotionDetector.W, MotionDetector.H), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
            try
            {
                byte[] res = new byte[MotionDetector.W * MotionDetector.H * 3];
                for (int y = 0; y < MotionDetector.H; y++)
                    System.Runtime.InteropServices.Marshal.Copy(new IntPtr(bd.Scan0.ToInt64() + (long)y * bd.Stride), res, y * MotionDetector.W * 3, MotionDetector.W * 3);
                return res;
            }
            finally { small.UnlockBits(bd); }
        }
    }

    public static byte[] MakeJpeg(Bitmap bmp)
    {
        using (MemoryStream ms = new MemoryStream()) { bmp.Save(ms, ImageFormat.Jpeg); return ms.ToArray(); }
    }
}

class FrameHub
{
    readonly object o = new object();
    byte[] last;
    long seq;

    public long Seq { get { lock (o) { return seq; } } }
    public byte[] Latest() { lock (o) { return last; } }

    public void Publish(byte[] jpeg)
    {
        lock (o) { last = jpeg; seq++; Monitor.PulseAll(o); }
    }

    public bool WaitNext(long after, int timeoutMs, out byte[] jpeg, out long newSeq)
    {
        lock (o)
        {
            if (seq <= after) Monitor.Wait(o, timeoutMs);
            if (seq > after) { jpeg = last; newSeq = seq; return true; }
        }
        jpeg = null; newSeq = after;
        return false;
    }
}
```
หมายเหตุ: test "completes later" ใช้ `Push(j1, j1.Length - 5)` แล้ว push ไบต์ท้าย 5 ไบต์ ต้องได้ 1 เฟรม ตรวจว่าข้อมูลที่ส่งไปแล้ว (ไม่ครบ) ถูกเก็บค้างไว้จริง

- [x] **Step 4: รัน** Expected: ผ่านทั้งหมด **Step 5: Commit** (`feat(camera): jpeg splitter, motion detector, frame hub`)

---

### Task 7: HttpParse, Auth, RateLimiter, IServerHost

**Files:**
- Create: `tools/camera/Net.cs`
- Modify: `tools/camera/SelfTest.cs`

**Interfaces:**
- Produces:
  - `class HttpReq { string Method, Path; Dictionary<string,string> Query; Dictionary<string,string> Headers; }` (Headers ไม่สนตัวพิมพ์)
  - `static class HttpParse { bool TryParse(string head, out HttpReq req); bool TryRange(string header, long size, out long start, out long end); string UrlDecode(string s); }`
  - `static class Auth { bool CodeEquals(string a, string b); }`
  - `class RateLimiter { RateLimiter(int maxFails, TimeSpan window); bool IsBlocked(string ip, DateTime now); void Fail(string ip, DateTime now); }`
  - `interface IServerHost { FrameHub Hub { get; } string StatusJson(); bool SetRotation(int deg); }`

**Acceptance Criteria:**
- `TryParse("GET /api/clips?from=1&to=2&k=abc%20d HTTP/1.1\r\nHost: x\r\nRange: bytes=0-9")` → Method GET, Path `/api/clips`, Query k=`abc d`, Headers["range"] ได้ค่า; ปฏิเสธ `GET` เฉยๆ, `GET / FTP/1.0`, method มีอักขระแปลก
- `TryRange`: size=100: `bytes=0-9`→0..9, `bytes=90-`→90..99, `bytes=-10`→90..99, `bytes=0-999`→0..99; ปฏิเสธ `bytes=100-`, `bytes=5-2`, `bytes=0-1,5-6`, `items=0-1`, `bytes=-0`, `bytes=abc`; size=0 ปฏิเสธเสมอ
- `CodeEquals` true เมื่อเท่ากัน, false เมื่อต่าง/ยาวต่าง/null
- `RateLimiter(10, 1 นาที)`: ผิด 10 ครั้งยังไม่ถูกบล็อก ครั้งที่ 11 บล็อก (`IsBlocked` true) ผ่านไป 61 วินาทีปลดบล็อก ไอพีอื่นไม่โดน

- [x] **Step 1: เขียน test** (`NetPrimitivesTests`)

```csharp
static class NetPrimitivesTests
{
    public static void All()
    {
        HttpReq r;
        T.True(HttpParse.TryParse("GET /api/clips?from=1&to=2&k=abc%20d HTTP/1.1\r\nHost: x\r\nRange: bytes=0-9", out r), "parse ok");
        T.Eq("GET", r.Method, "method"); T.Eq("/api/clips", r.Path, "path");
        T.Eq("abc d", r.Query["k"], "query decoded"); T.Eq("1", r.Query["from"], "query from");
        T.Eq("bytes=0-9", r.Headers["range"], "header case-insensitive"); T.Eq("x", r.Headers["HOST"], "header HOST");
        T.True(!HttpParse.TryParse("GET", out r), "reject short");
        T.True(!HttpParse.TryParse("GET / FTP/1.0", out r), "reject non-http");
        T.True(!HttpParse.TryParse("G<T / HTTP/1.1", out r), "reject odd method");
        T.True(HttpParse.TryParse("POST /api/rot?v=90&k=x HTTP/1.1", out r), "post ok"); T.Eq("POST", r.Method, "post method");
        T.Eq("a b+c", HttpParse.UrlDecode("a%20b%2Bc"), "urldecode");

        long a, b;
        T.True(HttpParse.TryRange("bytes=0-9", 100, out a, out b) && a == 0 && b == 9, "range a-b");
        T.True(HttpParse.TryRange("bytes=90-", 100, out a, out b) && a == 90 && b == 99, "range a-");
        T.True(HttpParse.TryRange("bytes=-10", 100, out a, out b) && a == 90 && b == 99, "range -n");
        T.True(HttpParse.TryRange("bytes=0-999", 100, out a, out b) && a == 0 && b == 99, "range clamp end");
        foreach (string bad in new string[] { "bytes=100-", "bytes=5-2", "bytes=0-1,5-6", "items=0-1", "bytes=-0", "bytes=abc", "", null })
            T.True(!HttpParse.TryRange(bad, 100, out a, out b), "range reject " + bad);
        T.True(!HttpParse.TryRange("bytes=0-1", 0, out a, out b), "range empty file");

        T.True(Auth.CodeEquals("abcd2345", "abcd2345"), "code equal");
        T.True(!Auth.CodeEquals("abcd2345", "abcd2346"), "code differ"); T.True(!Auth.CodeEquals("abcd2345", "abcd234"), "len differ");
        T.True(!Auth.CodeEquals(null, "x"), "null a"); T.True(!Auth.CodeEquals("x", null), "null b");

        RateLimiter rl = new RateLimiter(10, TimeSpan.FromMinutes(1)); DateTime t = new DateTime(2026, 10, 2, 9, 0, 0);
        for (int i = 0; i < 10; i++) rl.Fail("1.1.1.1", t.AddSeconds(i));
        T.True(!rl.IsBlocked("1.1.1.1", t.AddSeconds(10)), "10 fails not blocked");
        rl.Fail("1.1.1.1", t.AddSeconds(11));
        T.True(rl.IsBlocked("1.1.1.1", t.AddSeconds(12)), "11th fail blocked");
        T.True(!rl.IsBlocked("2.2.2.2", t.AddSeconds(12)), "other ip fine");
        T.True(!rl.IsBlocked("1.1.1.1", t.AddSeconds(80)), "unblocked after window");
    }
}
```

- [x] **Step 2: รัน** Expected: BUILD FAILED

- [x] **Step 3: เขียน `Net.cs`**

```csharp
using System;
using System.Collections.Generic;
using System.Globalization;

class HttpReq
{
    public string Method, Path;
    public Dictionary<string, string> Query = new Dictionary<string, string>();
    public Dictionary<string, string> Headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
}

interface IServerHost
{
    FrameHub Hub { get; }
    string StatusJson();
    bool SetRotation(int deg);
}

static class HttpParse
{
    public static string UrlDecode(string s) { return s == null ? "" : Uri.UnescapeDataString(s.Replace('+', ' ')).Replace("\u0000", ""); }

    public static bool TryParse(string head, out HttpReq req)
    {
        req = null;
        if (head == null) return false;
        string[] lines = head.Split(new string[] { "\r\n" }, StringSplitOptions.None);
        string[] first = lines[0].Split(' ');
        if (first.Length != 3 || !first[2].StartsWith("HTTP/")) return false;
        foreach (char c in first[0]) if (!(c >= 'A' && c <= 'Z')) return false;
        if (first[0].Length == 0 || first[1].Length == 0 || first[1][0] != '/') return false;
        HttpReq r = new HttpReq();
        r.Method = first[0];
        string target = first[1];
        int q = target.IndexOf('?');
        r.Path = q < 0 ? target : target.Substring(0, q);
        if (q >= 0)
        {
            foreach (string pair in target.Substring(q + 1).Split('&'))
            {
                if (pair.Length == 0) continue;
                int e = pair.IndexOf('=');
                string k = e < 0 ? pair : pair.Substring(0, e), v = e < 0 ? "" : pair.Substring(e + 1);
                r.Query[UrlDecode(k)] = UrlDecode(v);
            }
        }
        for (int i = 1; i < lines.Length; i++)
        {
            int c = lines[i].IndexOf(':');
            if (c <= 0) continue;
            r.Headers[lines[i].Substring(0, c).Trim()] = lines[i].Substring(c + 1).Trim();
        }
        req = r;
        return true;
    }

    // รองรับ Range ช่วงเดียว: a-b, a-, -n (ตามที่ตัวเล่นวิดีโอของเบราว์เซอร์ใช้)
    public static bool TryRange(string header, long size, out long start, out long end)
    {
        start = 0; end = 0;
        if (header == null || size <= 0 || !header.StartsWith("bytes=") || header.IndexOf(',') >= 0) return false;
        string spec = header.Substring(6).Trim();
        int dash = spec.IndexOf('-');
        if (dash < 0) return false;
        string a = spec.Substring(0, dash), b = spec.Substring(dash + 1);
        long x, y;
        if (a.Length == 0)
        {
            if (!long.TryParse(b, NumberStyles.None, CultureInfo.InvariantCulture, out y) || y <= 0) return false;
            start = Math.Max(0, size - y); end = size - 1; return true;
        }
        if (!long.TryParse(a, NumberStyles.None, CultureInfo.InvariantCulture, out x)) return false;
        if (b.Length == 0) y = size - 1;
        else if (!long.TryParse(b, NumberStyles.None, CultureInfo.InvariantCulture, out y)) return false;
        if (x >= size || y < x) return false;
        start = x; end = Math.Min(y, size - 1);
        return true;
    }
}

static class Auth
{
    public static bool CodeEquals(string a, string b)
    {
        if (a == null || b == null || a.Length != b.Length) return false;
        int diff = 0;
        for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
        return diff == 0;
    }
}

class RateLimiter
{
    readonly int max;
    readonly TimeSpan window;
    readonly Dictionary<string, List<DateTime>> fails = new Dictionary<string, List<DateTime>>();
    readonly object o = new object();

    public RateLimiter(int maxFails, TimeSpan win) { max = maxFails; window = win; }

    void Prune(List<DateTime> l, DateTime now) { l.RemoveAll(delegate(DateTime t) { return now - t > window; }); }

    public bool IsBlocked(string ip, DateTime now)
    {
        lock (o)
        {
            List<DateTime> l;
            if (!fails.TryGetValue(ip, out l)) return false;
            Prune(l, now);
            return l.Count > max;
        }
    }

    public void Fail(string ip, DateTime now)
    {
        lock (o)
        {
            List<DateTime> l;
            if (!fails.TryGetValue(ip, out l)) { l = new List<DateTime>(); fails[ip] = l; }
            Prune(l, now);
            l.Add(now);
        }
    }
}
```
หมายเหตุ: `IsBlocked` ใช้ `> max` (ผิด 10 ครั้งยังไม่บล็อก ครั้งที่ 11 บล็อก) ตรงกับ test

- [x] **Step 4: รัน** Expected: ผ่านทั้งหมด **Step 5: Commit** (`feat(camera): http parsing, range, auth and rate limit primitives`)

---

### Task 8: FfmpegPipeline และ parser รายการกล้อง/โหมด

**Files:**
- Create: `tools/camera/Ffmpeg.cs`
- Modify: `tools/camera/SelfTest.cs`

**Interfaces:**
- Consumes: `Settings`, `JpegSplitter`, `AppPaths`, `Log`
- Produces:
  - `class CameraMode { string Codec; int Width, Height; double MaxFps; }`
  - `static class FfmpegText { List<string> ParseDevices(string text); List<CameraMode> ParseModes(string text); }`
  - `class FfmpegPipeline : IDisposable { FfmpegPipeline(Settings s, string ffmpegPath, string bufferDir, bool testSource); event Action<byte[]> Frame; event Action<string> StateChanged /* "starting"|"running"|"recovering"|"stopped" */; event Action<bool> ProcessEnded /* true=graceful */; string State; int ActualWidth, ActualHeight; double ActualFps; string LastError; void Start(); void Stop(); static string BuildArgs(Settings s, string bufferDir, bool testSource, bool mjpegInput); static List<string> ListCameras(string ffmpegPath); static List<CameraMode> ListModes(string ffmpegPath, string camera); }`

**Acceptance Criteria:**
- `ParseDevices` ได้เฉพาะรายการ `(video)` จากตัวอย่างข้อความ (ไม่รวม `(audio)` `(none)` และบรรทัด `Alternative name`)
- `ParseModes` ได้โหมด `mjpeg` และ `yuyv422` พร้อมขนาด/fps สูงสุดจากตัวอย่าง และไม่ซ้ำ
- `BuildArgs` ใส่ `-vcodec mjpeg` เมื่อ `mjpegInput`, ใช้ `lavfi` เมื่อ `testSource`, ตรงกับ filter ที่ยืนยันใน Task 1, ใส่ `transpose` ตามมุมหมุน, ชื่อกล้องมีช่องว่างอยู่ในเครื่องหมายคำพูด, พาธท่อนพักอยู่ท้ายคำสั่ง
- Integration (test source): รัน `Start()` 15 วินาที ได้ `Frame` มากกว่า 50 เฟรมที่ JPEG ถูกต้อง, `State == "running"`, มีไฟล์ `seg_*.mp4` ในโฟลเดอร์พัก, `Stop()` ใช้เวลาไม่เกิน 6 วินาที และไม่เหลือโปรเซส `ffmpeg`
- ฆ่า ffmpeg ด้วยมือ: pipeline เปิดใหม่เอง (State เป็น `recovering` แล้วกลับ `running`) และยิง `ProcessEnded(false)`

- [ ] **Step 1: เขียน test ส่วน parser/args (หน่วย)**

```csharp
static class FfmpegTextTests
{
    const string Devs =
        "[dshow @ 000001a] DirectShow video devices (some may be both video and audio devices)\r\n" +
        "[dshow @ 000001a]  \"EMEET SmartCam S600\" (video)\r\n" +
        "[dshow @ 000001a]   Alternative name \"@device_pnp_\\\\?\\usb#vid_328f\"\r\n" +
        "[dshow @ 000001a] DirectShow audio devices\r\n" +
        "[dshow @ 000001a]  \"Microphone (EMEET)\" (audio)\r\n" +
        "[dshow @ 000001a]  \"Other thing\" (none)\r\n" +
        "[dshow @ 000001a]  \"Integrated Webcam\" (video)\r\n";
    const string Modes =
        "[dshow @ 000001a] DirectShow video device options (from video devices)\r\n" +
        "[dshow @ 000001a]  Pin \"Capture\" (alternative pin name \"Capture\")\r\n" +
        "[dshow @ 000001a]   pixel_format=yuyv422  min s=640x480 fps=5 max s=640x480 fps=30\r\n" +
        "[dshow @ 000001a]   pixel_format=yuyv422  min s=640x480 fps=5 max s=640x480 fps=30\r\n" +
        "[dshow @ 000001a]   vcodec=mjpeg  min s=1920x1080 fps=5 max s=1920x1080 fps=30\r\n" +
        "[dshow @ 000001a]   vcodec=mjpeg  min s=2560x1440 fps=5 max s=2560x1440 fps=30\r\n";

    public static void All()
    {
        System.Collections.Generic.List<string> d = FfmpegText.ParseDevices(Devs);
        T.Eq(2, d.Count, "2 video devices"); T.Eq("EMEET SmartCam S600", d[0], "first device"); T.Eq("Integrated Webcam", d[1], "second device");
        System.Collections.Generic.List<CameraMode> m = FfmpegText.ParseModes(Modes);
        T.Eq(3, m.Count, "3 distinct modes");
        T.Eq("mjpeg", m[1].Codec, "mjpeg codec"); T.Eq(1920, m[1].Width, "w"); T.Eq(1080, m[1].Height, "h"); T.Eq(30.0, m[1].MaxFps, "fps");

        Settings s = new Settings(); s.CameraName = "EMEET SmartCam S600"; s.Width = 1920; s.Height = 1080; s.Fps = 15; s.Rotation = 90;
        string a = FfmpegPipeline.BuildArgs(s, @"C:\data\buffer", false, true);
        T.True(a.Contains("-f dshow"), "dshow input"); T.True(a.Contains("-vcodec mjpeg"), "mjpeg input");
        T.True(a.Contains("-video_size 1920x1080"), "size"); T.True(a.Contains("-framerate 15"), "framerate");
        T.True(a.Contains("video=\"EMEET SmartCam S600\""), "quoted name"); T.True(a.Contains("transpose=1"), "rotation 90");
        T.True(a.Contains("pipe:1"), "stdout pipe"); T.True(a.Contains("\"C:\\data\\buffer\\seg_%Y-%m-%d_%H-%M-%S.mp4\""), "segment path last");
        T.True(a.Contains("-segment_time 10"), "10s segments");
        string raw = FfmpegPipeline.BuildArgs(s, @"C:\data\buffer", false, false);
        T.True(!raw.Contains("-vcodec mjpeg"), "no mjpeg when fallback");
        s.Rotation = 0; T.True(!FfmpegPipeline.BuildArgs(s, @"C:\b", false, true).Contains("transpose"), "no rotation");
        s.Rotation = 180; T.True(FfmpegPipeline.BuildArgs(s, @"C:\b", false, true).Contains("hflip,vflip"), "180");
        s.Rotation = 270; T.True(FfmpegPipeline.BuildArgs(s, @"C:\b", false, true).Contains("transpose=2"), "270");
        string t = FfmpegPipeline.BuildArgs(s, @"C:\b", true, true);
        T.True(t.Contains("-f lavfi") && !t.Contains("dshow"), "test source uses lavfi");
    }
}
```
ลงทะเบียน `T.Run("ffmpeg text", FfmpegTextTests.All);`

- [ ] **Step 2: รัน** Expected: BUILD FAILED

- [ ] **Step 3: เขียน `Ffmpeg.cs`**

**สำคัญ:** สตริง filter/อาร์กิวเมนต์ด้านล่างเป็นค่าตั้งต้นจากแผน ให้เทียบกับสตริงที่ผ่านจริงใน Task 1 Step 4 แล้วแก้ให้ตรงก่อน (อย่างน้อย: การ escape พาธฟอนต์, `drawbox`, `-pix_fmt yuvj420p`) ถ้า Task 1 ปรับ ให้แก้ test `BuildArgs` ข้างบนให้ตรงด้วย

```csharp
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

class CameraMode { public string Codec; public int Width, Height; public double MaxFps; }

static class FfmpegText
{
    static readonly Regex DevRx = new Regex("\"([^\"]+)\"\\s+\\(video\\)", RegexOptions.Compiled);
    static readonly Regex ModeRx = new Regex(@"(vcodec|pixel_format)=(\S+)\s+min s=(\d+)x(\d+) fps=([\d.]+) max s=(\d+)x(\d+) fps=([\d.]+)", RegexOptions.Compiled);

    public static List<string> ParseDevices(string text)
    {
        List<string> res = new List<string>();
        foreach (Match m in DevRx.Matches(text ?? "")) if (!res.Contains(m.Groups[1].Value)) res.Add(m.Groups[1].Value);
        return res;
    }

    public static List<CameraMode> ParseModes(string text)
    {
        List<CameraMode> res = new List<CameraMode>();
        foreach (Match m in ModeRx.Matches(text ?? ""))
        {
            CameraMode c = new CameraMode();
            c.Codec = m.Groups[2].Value;
            c.Width = int.Parse(m.Groups[6].Value); c.Height = int.Parse(m.Groups[7].Value);
            c.MaxFps = double.Parse(m.Groups[8].Value, CultureInfo.InvariantCulture);
            bool dup = false;
            foreach (CameraMode x in res) if (x.Codec == c.Codec && x.Width == c.Width && x.Height == c.Height) dup = true;
            if (!dup) res.Add(c);
        }
        return res;
    }
}

class FfmpegPipeline : IDisposable
{
    readonly Settings s;
    readonly string exe, bufDir;
    readonly bool testSource;
    Thread worker;
    volatile bool stop;
    Process proc;
    DateTime lastFrameUtc = DateTime.UtcNow;
    long frames;
    readonly object stateLock = new object();
    string state = "stopped";

    public event Action<byte[]> Frame;
    public event Action<string> StateChanged;
    public event Action<bool> ProcessEnded;
    public int ActualWidth, ActualHeight;
    public double ActualFps;
    public string LastError = "";

    public string State { get { lock (stateLock) { return state; } } }

    public FfmpegPipeline(Settings settings, string ffmpegPath, string bufferDir, bool useTestSource)
    {
        s = settings; exe = ffmpegPath; bufDir = bufferDir; testSource = useTestSource;
    }

    void SetState(string st)
    {
        lock (stateLock) { if (state == st) return; state = st; }
        Action<string> h = StateChanged; if (h != null) h(st);
    }

    public static string BuildArgs(Settings s, string bufferDir, bool testSource, bool mjpegInput)
    {
        StringBuilder a = new StringBuilder();
        a.Append("-hide_banner -loglevel info -stats ");
        if (testSource)
        {
            a.Append("-re -f lavfi -i \"color=c=0x303030:s=" + s.Width + "x" + s.Height + ":r=" + s.Fps +
                ",drawbox=x='mod(t*150,iw-200)':y=100:w=200:h=200:color=white:t=fill:enable='lt(mod(t,20),6)'\" ");
        }
        else
        {
            a.Append("-f dshow -rtbufsize 128M -video_size " + s.Width + "x" + s.Height + " -framerate " + s.Fps + " ");
            if (mjpegInput) a.Append("-vcodec mjpeg ");
            a.Append("-i video=\"" + s.CameraName + "\" ");
        }
        string rot = s.Rotation == 90 ? "transpose=1," : s.Rotation == 180 ? "hflip,vflip," : s.Rotation == 270 ? "transpose=2," : "";
        string text = "drawtext=fontfile='C\\:/Windows/Fonts/consola.ttf':text='%{localtime}':x=w-tw-12:y=h-th-12:fontsize=h/28:fontcolor=0x3ddc97:shadowcolor=black:shadowx=1:shadowy=1";
        a.Append("-filter_complex \"[0:v]" + rot + text + ",split=2[rec][live];[live]fps=10,scale='min(1280,iw)':-2[lv]\" ");
        a.Append("-map \"[lv]\" -an -c:v mjpeg -q:v 6 -pix_fmt yuvj420p -f image2pipe pipe:1 ");
        a.Append("-map \"[rec]\" -an -c:v libx264 -preset veryfast -crf 26 -pix_fmt yuv420p -g " + (s.Fps * 2) +
            " -force_key_frames \"expr:gte(t,n_forced*10)\" -f segment -segment_time 10 -reset_timestamps 1 -strftime 1 " +
            "-segment_format_options movflags=+faststart \"" + bufferDir + "\\seg_%Y-%m-%d_%H-%M-%S.mp4\"");
        return a.ToString();
    }

    static string RunCapture(string exePath, string args, int timeoutMs)
    {
        ProcessStartInfo psi = new ProcessStartInfo(exePath, args);
        psi.UseShellExecute = false; psi.RedirectStandardError = true; psi.RedirectStandardOutput = true; psi.CreateNoWindow = true;
        psi.StandardErrorEncoding = Encoding.UTF8;
        using (Process p = Process.Start(psi))
        {
            StringBuilder sb = new StringBuilder();
            p.ErrorDataReceived += delegate(object o, DataReceivedEventArgs e) { if (e.Data != null) lock (sb) sb.AppendLine(e.Data); };
            p.OutputDataReceived += delegate(object o, DataReceivedEventArgs e) { };
            p.BeginErrorReadLine(); p.BeginOutputReadLine();
            if (!p.WaitForExit(timeoutMs)) { try { p.Kill(); } catch { } }
            p.WaitForExit(500);
            lock (sb) return sb.ToString();
        }
    }

    public static List<string> ListCameras(string ffmpegPath)
    {
        return FfmpegText.ParseDevices(RunCapture(ffmpegPath, "-hide_banner -list_devices true -f dshow -i dummy", 10000));
    }

    public static List<CameraMode> ListModes(string ffmpegPath, string camera)
    {
        return FfmpegText.ParseModes(RunCapture(ffmpegPath, "-hide_banner -list_options true -f dshow -i video=\"" + camera.Replace("\"", "") + "\"", 10000));
    }

    public void Start()
    {
        if (worker != null) return;
        stop = false;
        worker = new Thread(Run); worker.IsBackground = true; worker.Start();
    }

    public void Stop()
    {
        stop = true;
        Process p = proc;
        Terminate(p, true);
        Thread w = worker;
        if (w != null) { w.Join(8000); worker = null; }
        SetState("stopped");
    }

    public void Dispose() { Stop(); }

    static void Terminate(Process p, bool graceful)
    {
        if (p == null) return;
        try
        {
            if (p.HasExited) return;
            if (graceful)
            {
                try { p.StandardInput.WriteLine("q"); p.StandardInput.Flush(); } catch { }
                if (p.WaitForExit(4000)) return;
            }
            p.Kill(); p.WaitForExit(2000);
        }
        catch { }
    }

    void Run()
    {
        int attempt = 0; bool mjpegIn = true;
        while (!stop)
        {
            long framesAtStart = Interlocked.Read(ref frames);
            DateTime t0 = DateTime.UtcNow;
            bool gracefulEnd = false;
            SetState(attempt == 0 ? "starting" : "recovering");
            Process p = null;
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(exe, BuildArgs(s, bufDir, testSource, mjpegIn));
                psi.UseShellExecute = false; psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true; psi.RedirectStandardError = true; psi.RedirectStandardInput = true;
                Directory.CreateDirectory(bufDir);
                ActualWidth = 0; ActualHeight = 0; ActualFps = 0;
                p = Process.Start(psi); proc = p;
                lastFrameUtc = DateTime.UtcNow;
                p.ErrorDataReceived += OnStderr;
                p.BeginErrorReadLine();
                Timer watchdog = new Timer(delegate
                {
                    if (!stop && (DateTime.UtcNow - lastFrameUtc).TotalSeconds > 8) { Log.Write("ไม่มีภาพใหม่ 8 วินาที ปิด ffmpeg เพื่อเปิดใหม่"); Terminate(p, false); }
                }, null, 1000, 1000);
                JpegSplitter split = new JpegSplitter();
                byte[] buf = new byte[65536];
                Stream so = p.StandardOutput.BaseStream;
                int n;
                while ((n = so.Read(buf, 0, buf.Length)) > 0)
                {
                    foreach (byte[] f in split.Push(buf, n))
                    {
                        Interlocked.Increment(ref frames);
                        lastFrameUtc = DateTime.UtcNow;
                        if (State != "running") SetState("running");
                        Action<byte[]> h = Frame; if (h != null) { try { h(f); } catch (Exception ex) { Log.Write("Frame handler: " + ex.Message); } }
                    }
                }
                watchdog.Dispose();
                gracefulEnd = stop;
            }
            catch (Exception ex) { LastError = ex.Message; Log.Write("ffmpeg: " + ex.Message); }
            finally { Terminate(p, false); proc = null; }
            Action<bool> pe = ProcessEnded; if (pe != null) pe(gracefulEnd);
            if (stop) break;

            bool gotFrames = Interlocked.Read(ref frames) > framesAtStart;
            bool quick = (DateTime.UtcNow - t0).TotalSeconds < 5 && !gotFrames;
            if (quick && !testSource) { mjpegIn = !mjpegIn; Log.Write("เปิดกล้องไม่ติดทันที ลองโหมดอินพุต " + (mjpegIn ? "MJPEG" : "ดิบ")); }
            attempt = gotFrames ? 1 : attempt + 1;
            SetState("recovering");
            int wait = Math.Min(10000, 1500 * (1 << Math.Min(attempt - 1, 3)));
            for (int w = 0; w < wait && !stop; w += 100) Thread.Sleep(100);
        }
    }

    static readonly Regex FpsRx = new Regex(@"fps=\s*([\d.]+)", RegexOptions.Compiled);
    static readonly Regex SizeRx = new Regex(@"Video: .*?, (\d{3,5})x(\d{3,5})", RegexOptions.Compiled);
    static readonly Regex BadRx = new Regex("error|fail|could not|invalid|unable|cannot|no such|not found|denied|timeout", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    void OnStderr(object sender, DataReceivedEventArgs e)
    {
        string line = e.Data;
        if (string.IsNullOrEmpty(line)) return;
        MatchCollection fm = FpsRx.Matches(line);
        if (fm.Count > 0)
        {
            double v; if (double.TryParse(fm[fm.Count - 1].Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out v)) ActualFps = v;
            return;
        }
        Match sm = SizeRx.Match(line);
        if (sm.Success && ActualWidth == 0) { ActualWidth = int.Parse(sm.Groups[1].Value); ActualHeight = int.Parse(sm.Groups[2].Value); }
        if (BadRx.IsMatch(line)) { LastError = line.Trim(); Log.Write("ffmpeg: " + line.Trim()); }
    }
}
```
- [ ] **Step 4: รัน** `run-selftest.ps1` Expected: ผ่านทั้งหมด

- [ ] **Step 5: เขียนและรัน integration แบบ test source** เพิ่ม mode ใน `SelfTest.cs`: ฟังก์ชัน `PipelineIntegration.All()` ลงทะเบียนเฉพาะเมื่อมี `ffmpeg.exe` อยู่ข้างโปรแกรม (ถ้าไม่มีให้ข้ามพร้อมบันทึก `SKIP`)

```csharp
static class PipelineIntegration
{
    public static void All()
    {
        string ff = AppPaths.FfmpegPath;
        if (!File.Exists(ff)) { T.True(true, "SKIP pipeline integration: no ffmpeg.exe"); return; }
        string buf = Path.Combine(Path.GetTempPath(), "rrqc-t-" + Guid.NewGuid().ToString("N"));
        Settings s = new Settings(); s.Width = 640; s.Height = 360; s.Fps = 10; s.CooldownMs = 3000;
        FfmpegPipeline p = new FfmpegPipeline(s, ff, buf, true);
        int frames = 0; bool badJpeg = false; int ended = 0; bool lastGraceful = true; bool sawRecovering = false;
        p.Frame += delegate(byte[] f) { frames++; if (f.Length < 200 || f[0] != 0xFF || f[1] != 0xD8) badJpeg = true; };
        p.ProcessEnded += delegate(bool g) { ended++; lastGraceful = g; };
        p.StateChanged += delegate(string st) { if (st == "recovering") sawRecovering = true; };
        p.Start();
        System.Threading.Thread.Sleep(15000);
        T.True(frames > 50, "frames received: " + frames); T.True(!badJpeg, "jpeg frames valid"); T.Eq("running", p.State, "state running");
        T.True(Directory.Exists(buf) && Directory.GetFiles(buf, "seg_*.mp4").Length >= 1, "segments written");
        // ฆ่า ffmpeg ด้วยมือ → ต้องเปิดใหม่เอง
        foreach (System.Diagnostics.Process x in System.Diagnostics.Process.GetProcessesByName("ffmpeg")) { try { x.Kill(); } catch { } }
        System.Threading.Thread.Sleep(9000);
        T.True(sawRecovering, "went to recovering"); T.Eq("running", p.State, "recovered to running"); T.True(ended >= 1 && !lastGraceful || ended >= 2, "ProcessEnded fired for crash");
        DateTime t0 = DateTime.UtcNow; p.Stop(); double secs = (DateTime.UtcNow - t0).TotalSeconds;
        T.True(secs < 6, "stop took " + secs);
        T.Eq(0, System.Diagnostics.Process.GetProcessesByName("ffmpeg").Length, "no ffmpeg left");
        try { Directory.Delete(buf, true); } catch { }
    }
}
```
**ข้อควรระวัง:** test นี้ฆ่า `ffmpeg` **ทุกตัว** บนเครื่อง ห้ามรันตอนผู้ใช้กำลังใช้ ffmpeg อื่น (แจ้งผู้ใช้ก่อนรัน) ลงทะเบียน `T.Run("pipeline integration", PipelineIntegration.All);` ในตอนท้ายสุดของ `Run`

- [ ] **Step 6: รัน** Expected: ผ่านทั้งหมด (ใช้เวลา ~30 วินาที) ถ้า `segments written` ไม่ผ่าน ตรวจ `Log` ที่ `%APPDATA%\RRQC-Camera\camera.log`

- [ ] **Step 7: Commit** (`feat(camera): ffmpeg pipeline with supervision and device/mode parsing`)

---

### Task 9: CameraEngine และทดสอบเต็มระบบบันทึกคลิป

**Files:**
- Create: `tools/camera/Engine.cs`, `tools/camera/tests/integration.ps1`
- Modify: `tools/camera/Program.cs` (เพิ่ม headless mode `--headless` สำหรับทดสอบ: สร้าง engine + server แล้ววนรอ ไม่เปิดหน้าต่าง)

**Interfaces:**
- Consumes: `FfmpegPipeline`, `ClipRecorder`, `MotionDetector`, `FrameTools`, `FrameHub`, `ClipStore`, `Settings`, `IServerHost`
- Produces: `class CameraEngine : IServerHost, IDisposable { CameraEngine(Settings s, bool testSource); FrameHub Hub; string State /* "stopped"|"starting"|"armed"|"recording"|"recovering" */; int ActualWidth, ActualHeight; double ActualFps; string LastError; event Action StateChanged; void Start(); void Stop(); void Restart(); bool SetRotation(int deg); string StatusJson(); }`
- `StatusJson` รูปแบบ: `{"running":bool,"state":"armed","width":1920,"height":1080,"fps":14.8,"rot":0}` (ตัวเลขทศนิยมใช้จุด InvariantCulture)

**Acceptance Criteria:**
- `Start` ล้างท่อนค้างในโฟลเดอร์พัก เปิด pipeline และเธรด `Tick` ทุก 2 วินาที
- เมื่อ motion เกิด สถานะเป็น `recording` ตลอดช่วง cooldown แล้วกลับ `armed`
- `SetRotation(v)` (v ∈ {0,90,180,270}) บันทึกลง Settings, รีสตาร์ต pipeline, คืน true; ค่าอื่นคืน false และไม่เปลี่ยนอะไร
- ลบคลิปเก่าตามจำนวนวันตอนเริ่มและเมื่อวันเปลี่ยน (เฉพาะ `RetentionDays > 0`)
- Integration (test source ผ่าน `tests/integration.ps1`): รัน 75 วินาทีด้วย cooldown 3 วินาที ได้คลิปอย่างน้อย 2 ไฟล์ ชื่อตรงรูปแบบ ทุกไฟล์ผ่าน `ffmpeg -v error -i <file> -f null -` ไม่มี error, ไม่มีท่อน `seg_*` ค้างในโฟลเดอร์พักที่เก่ากว่า 40 วินาที

- [ ] **Step 1: เขียน `Engine.cs`**

```csharp
using System;
using System.Globalization;
using System.IO;
using System.Threading;

class CameraEngine : IServerHost, IDisposable
{
    readonly Settings s;
    readonly bool testSource;
    readonly FrameHub hub = new FrameHub();
    readonly MotionDetector det = new MotionDetector();
    FfmpegPipeline pipe;
    ClipRecorder rec;
    Thread tickThread;
    volatile bool stop;
    DateTime lastMotion = DateTime.MinValue, lastCheck = DateTime.MinValue, lastPurgeDay = DateTime.MinValue;
    string rawState = "stopped";

    public event Action StateChanged;
    public FrameHub Hub { get { return hub; } }
    public int ActualWidth { get { return pipe == null ? 0 : pipe.ActualWidth; } }
    public int ActualHeight { get { return pipe == null ? 0 : pipe.ActualHeight; } }
    public double ActualFps { get { return pipe == null ? 0 : pipe.ActualFps; } }
    public string LastError { get { return pipe == null ? "" : pipe.LastError; } }

    public CameraEngine(Settings settings, bool useTestSource)
    {
        s = settings; testSource = useTestSource;
        rec = new ClipRecorder(s, AppPaths.BufferDir);
    }

    public string State
    {
        get
        {
            if (rawState == "running") return (DateTime.Now - lastMotion).TotalMilliseconds < s.CooldownMs ? "recording" : "armed";
            return rawState;
        }
    }

    void Raise() { Action h = StateChanged; if (h != null) h(); }

    public void Start()
    {
        if (pipe != null) return;
        stop = false;
        Directory.CreateDirectory(AppPaths.BufferDir);
        Directory.CreateDirectory(s.ClipDir);
        rec.ResetBuffer();
        pipe = new FfmpegPipeline(s, AppPaths.FfmpegPath, AppPaths.BufferDir, testSource);
        pipe.Frame += OnFrame;
        pipe.StateChanged += delegate(string st) { rawState = st; Raise(); };
        pipe.ProcessEnded += delegate(bool graceful) { if (!graceful) rec.DropLatestSegment(); };
        pipe.Start();
        tickThread = new Thread(TickLoop); tickThread.IsBackground = true; tickThread.Start();
        Log.Write("เริ่มกล้อง " + (testSource ? "(test source)" : s.CameraName) + " " + s.Width + "x" + s.Height + "@" + s.Fps);
    }

    public void Stop()
    {
        stop = true;
        FfmpegPipeline p = pipe; pipe = null;
        if (p != null) p.Stop();
        Thread t = tickThread; tickThread = null;
        if (t != null) t.Join(3000);
        rawState = "stopped"; Raise();
    }

    public void Restart() { Stop(); Start(); }
    public void Dispose() { Stop(); }

    void OnFrame(byte[] jpeg)
    {
        hub.Publish(jpeg);
        DateTime now = DateTime.Now;
        if ((now - lastCheck).TotalMilliseconds < 220) return;
        lastCheck = now;
        try
        {
            det.Sensitivity = s.Sensitivity;
            if (det.Update(FrameTools.ToRgb160(jpeg))) { lastMotion = now; rec.NoteMotion(now); }
        }
        catch (Exception ex) { Log.Write("ตรวจเคลื่อนไหวพลาด: " + ex.Message); }
    }

    void TickLoop()
    {
        while (!stop)
        {
            try
            {
                DateTime now = DateTime.Now;
                rec.Tick(now);
                if (s.RetentionDays > 0 && lastPurgeDay.Date != now.Date)
                {
                    lastPurgeDay = now;
                    int n = ClipStore.PurgeOld(s.ClipDir, now, s.RetentionDays);
                    if (n > 0) Log.Write("ลบคลิปเก่า " + n + " ไฟล์");
                }
            }
            catch (Exception ex) { Log.Write("Tick: " + ex.Message); }
            for (int i = 0; i < 20 && !stop; i++) Thread.Sleep(100);
        }
    }

    public bool SetRotation(int deg)
    {
        if (deg != 0 && deg != 90 && deg != 180 && deg != 270) return false;
        s.Rotation = deg; s.Save();
        if (pipe != null) Restart();
        return true;
    }

    public string StatusJson()
    {
        return "{\"running\":" + (pipe != null ? "true" : "false") + ",\"state\":\"" + State + "\",\"width\":" + ActualWidth +
            ",\"height\":" + ActualHeight + ",\"fps\":" + ActualFps.ToString("0.0", CultureInfo.InvariantCulture) + ",\"rot\":" + s.Rotation + "}";
    }
}
```

- [ ] **Step 2: เพิ่ม headless ใน `Program.cs`** แทนที่ stub ด้วย

```csharp
using System;
using System.IO;
using System.Threading;
using System.Windows.Forms;

static class Program
{
    static string Arg(string[] a, string name) { for (int i = 0; i < a.Length - 1; i++) if (a[i] == name) return a[i + 1]; return null; }
    static bool Has(string[] a, string name) { foreach (string x in a) if (x == name) return true; return false; }

    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length >= 2 && args[0] == "--selftest") return SelfTest.Run(args[1]);
        if (args.Length >= 2 && args[0] == "--make-icon") { return 0; }   // Task 11 แทนที่
        string dd = Arg(args, "--data-dir");
        if (dd != null) AppPaths.DataDir = dd;
        bool test = Has(args, "--test-source");
        Settings s = Settings.Load();
        if (Has(args, "--headless"))
        {
            CameraEngine eng = new CameraEngine(s, test);
            eng.Start();
            // Task 10 ผูกเซิร์ฟเวอร์ HTTP ตรงนี้
            Thread.Sleep(Timeout.Infinite);
            return 0;
        }
        MessageBox.Show("RRQCCamera ยังไม่พร้อมใช้งาน (กำลังพัฒนา)");
        return 0;
    }
}
```

- [ ] **Step 3: เขียน `tests/integration.ps1`** (ส่วนคลิป; Task 10 เพิ่มส่วน HTTP)

```powershell
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$exe = Join-Path $here 'RRQCCamera.exe'; $ff = Join-Path $here 'ffmpeg.exe'
if (-not (Test-Path $ff)) { throw 'ต้องมี ffmpeg.exe ข้างโปรแกรมก่อน (Task 1)' }
$root = Join-Path $env:TEMP ('rrqc-int-' + [guid]::NewGuid().ToString('N')); $data = "$root\data"; $clips = "$root\คลิป"
New-Item -ItemType Directory $data, $clips | Out-Null
$code = 'abcd2345'; $port = 18788
[IO.File]::WriteAllLines("$data\settings.ini", @('width=640','height=360','fps=10','cooldownms=3000',"clipdir=$clips","port=$port","code=$code",'retentiondays=0'), (New-Object Text.UTF8Encoding($false)))
$p = Start-Process $exe -ArgumentList '--headless','--test-source','--data-dir',"`"$data`"" -PassThru
try {
  Start-Sleep 75
  $files = Get-ChildItem $clips -Filter 'motion_*.mp4'
  if ($files.Count -lt 2) { throw "ต้องมีคลิปอย่างน้อย 2 ไฟล์ แต่มี $($files.Count)" }
  foreach ($f in $files) {
    if ($f.Name -notmatch '^motion_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.mp4$') { throw "ชื่อคลิปผิดรูปแบบ: $($f.Name)" }
    $err = & $ff -v error -i $f.FullName -f null - 2>&1
    if ($err) { throw "คลิปเสีย $($f.Name): $err" }
  }
  $old = Get-ChildItem "$data\buffer" -Filter 'seg_*.mp4' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddSeconds(-40) }
  if ($old) { throw "มีท่อนพักค้างเก่ากว่า 40 วินาที: $($old.Name -join ',')" }
  "OK clips=$($files.Count): $($files.Name -join ', ')"
  # ---- HTTP section (เติมใน Task 10) ----
} finally {
  if ($p -and -not $p.HasExited) { $p.Kill() }
  Get-Process ffmpeg -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $ff } | Stop-Process -Force
  Start-Sleep 1; Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
}
```

- [ ] **Step 4: Build และรัน** `cmd /c "set NOPAUSE=1&& tools\camera\build.bat"` แล้ว `powershell -File tools\camera\tests\integration.ps1` Expected: `OK clips=N: ...` (N ≥ 2) ถ้าล้ม ดู `$data\camera.log`

- [ ] **Step 5: Commit** (`feat(camera): engine wiring motion, recorder and retention`)

---

### Task 10: HttpServer

**Files:**
- Create: `tools/camera/HttpServer.cs`
- Modify: `tools/camera/SelfTest.cs` (`HttpServerTests`), `tools/camera/Program.cs` (ผูกเซิร์ฟเวอร์ใน `--headless`), `tools/camera/tests/integration.ps1` (ส่วน HTTP)

**Interfaces:**
- Consumes: `Settings`, `IServerHost`, `HttpParse`, `Auth`, `RateLimiter`, `ClipStore`, `FrameHub`
- Produces: `class HttpServer : IDisposable { HttpServer(Settings s, IServerHost host); void Start() /* ขว้าง SocketException ถ้าพอร์ตถูกใช้ */; void Stop(); }`

**เส้นทาง/ผลตอบกลับ (ตามสเปก 3.3):**

| เส้นทาง | ผลลัพธ์ |
|---|---|
| `OPTIONS *` | 204 + CORS (ไม่ต้องมีรหัส) |
| ไม่มี/ผิด `k` | 401 `{"error":"unauthorized"}` (นับผิด); เกินกำหนด 429 |
| `GET /api/status` | 200 JSON จาก `host.StatusJson()` |
| `GET /api/clips?from&to` | 200 `{"clips":[{"name","start","end","size"}]}`; พารามิเตอร์ไม่ใช่ตัวเลข 400 |
| `GET /clips/<ชื่อ>[?dl=1]` | 200/206 ไฟล์ (Range), 404 ถ้าชื่อผิดรูปแบบหรือไม่มี, 416 ถ้า Range ใช้ไม่ได้ |
| `GET /live` | `multipart/x-mixed-replace; boundary=frame` ส่งเฟรมใหม่เรื่อยๆ; เกิน 4 ผู้ชม 503; ไม่มีเฟรมใหม่ 60 วินาทีปิดการเชื่อมต่อ |
| `POST /api/rot?v=N` | 200 `{"ok":true,"rot":N}`; GET → 405; N ไม่ถูกต้อง 400 |
| อื่นๆ | 404 |

**Acceptance Criteria:**
- ผ่านทุกกรณีในตารางด้วย test ใน selftest (เซิร์ฟเวอร์จริงบน `127.0.0.1:18787`, host ปลอม, โฟลเดอร์คลิปชั่วคราว) รวมถึง: `/clips/..%5Csettings.ini` และ `/clips/..%2F..%2Fx` ได้ 404, Range `bytes=0-3` ได้ 206 และ 4 ไบต์ตรงกับไฟล์, header ยาวเกิน 8 KB ถูกปิดโดยไม่ตอบ 200, หลังผิดรหัส 11 ครั้งได้ 429 แม้ครั้งต่อไปใช้รหัสถูก (ภายในหนึ่งนาที)
- `/live` ส่งส่วนที่ขึ้นต้นด้วย `--frame` มี `Content-Type: image/jpeg` และไบต์ JPEG ที่ถอดรหัสได้ตรงกับที่ `Hub.Publish`
- ปิดเซิร์ฟเวอร์ (`Stop`) ปิดการเชื่อมต่อสดที่ค้างอยู่ด้วย ไม่ค้างเธรด

- [ ] **Step 1: เขียน test `HttpServerTests`** (ครอบคลุมตาราง; เซิร์ฟเวอร์จริงบน `127.0.0.1:18787` พร้อมโฮสต์ปลอม)

```csharp
static class HttpServerTests
{
    class FakeHost : IServerHost
    {
        public FrameHub hub = new FrameHub(); public int rot = -1;
        public FrameHub Hub { get { return hub; } }
        public string StatusJson() { return "{\"state\":\"armed\"}"; }
        public bool SetRotation(int d) { if (d % 90 != 0 || d < 0 || d > 270) return false; rot = d; return true; }
    }

    const int Port = 18787;
    const string K = "abcd2345";
    static readonly System.Text.Encoding Latin1 = System.Text.Encoding.GetEncoding(28591);

    // ส่งคำขอดิบแล้วอ่านจนเซิร์ฟเวอร์ปิด คืนรหัสสถานะ (0 ถ้าไม่ได้ตอบ)
    static int Raw(string request, out string headers, out byte[] body)
    {
        headers = ""; body = new byte[0];
        try
        {
            using (System.Net.Sockets.TcpClient c = new System.Net.Sockets.TcpClient("127.0.0.1", Port))
            {
                c.ReceiveTimeout = 5000;
                System.Net.Sockets.NetworkStream ns = c.GetStream();
                byte[] rq = Latin1.GetBytes(request); ns.Write(rq, 0, rq.Length);
                System.IO.MemoryStream all = new System.IO.MemoryStream(); byte[] buf = new byte[8192]; int n;
                try { while ((n = ns.Read(buf, 0, buf.Length)) > 0) all.Write(buf, 0, n); } catch (System.IO.IOException) { }
                byte[] bytes = all.ToArray();
                string text = Latin1.GetString(bytes);
                int end = text.IndexOf("\r\n\r\n", StringComparison.Ordinal);
                if (end < 0) return 0;
                headers = text.Substring(0, end);
                body = new byte[bytes.Length - (end + 4)];
                Array.Copy(bytes, end + 4, body, 0, body.Length);
                string[] first = headers.Split(' ');
                int code;
                return first.Length >= 2 && int.TryParse(first[1], out code) ? code : 0;
            }
        }
        catch (System.IO.IOException) { return 0; }
        catch (System.Net.Sockets.SocketException) { return 0; }
    }

    static int Req(string method, string pathAndQuery, string extraHeaders, out string headers, out byte[] body)
    {
        return Raw(method + " " + pathAndQuery + " HTTP/1.1\r\nHost: x\r\n" + (extraHeaders ?? "") + "\r\n", out headers, out body);
    }

    static System.Net.Sockets.TcpClient OpenLive()
    {
        System.Net.Sockets.TcpClient c = new System.Net.Sockets.TcpClient("127.0.0.1", Port);
        c.ReceiveTimeout = 3000;
        byte[] rq = Latin1.GetBytes("GET /live?k=" + K + " HTTP/1.1\r\nHost: x\r\n\r\n");
        c.GetStream().Write(rq, 0, rq.Length);
        return c;
    }

    static byte[] ReadSome(System.Net.Sockets.TcpClient c, int atLeast, int ms)
    {
        System.IO.MemoryStream all = new System.IO.MemoryStream(); byte[] buf = new byte[8192];
        DateTime until = DateTime.Now.AddMilliseconds(ms);
        while (all.Length < atLeast && DateTime.Now < until)
        {
            try { int n = c.GetStream().Read(buf, 0, buf.Length); if (n <= 0) break; all.Write(buf, 0, n); }
            catch (System.IO.IOException) { break; }
        }
        return all.ToArray();
    }

    static bool Contains(byte[] hay, byte[] needle)
    {
        for (int i = 0; i + needle.Length <= hay.Length; i++)
        {
            int j = 0; while (j < needle.Length && hay[i + j] == needle[j]) j++;
            if (j == needle.Length) return true;
        }
        return false;
    }

    public static void All()
    {
        string root = Path.Combine(Path.GetTempPath(), "rrqc-t-" + Guid.NewGuid().ToString("N"));
        string dir = Path.Combine(root, "clips"); Directory.CreateDirectory(dir);
        string clip = "motion_2026-10-02_09-00-00.mp4";
        File.WriteAllBytes(Path.Combine(dir, clip), Latin1.GetBytes("0123456789"));
        File.WriteAllText(Path.Combine(root, "secret.ini"), "secret");
        Settings s = new Settings(); s.ClipDir = dir; s.Code = K; s.Port = Port; s.LocalOnly = true;
        FakeHost host = new FakeHost();
        HttpServer srv = new HttpServer(s, host);
        srv.Start();
        System.Net.Sockets.TcpClient lv = null;
        try
        {
            string h; byte[] b; int c;
            c = Req("GET", "/api/status", null, out h, out b); T.Eq(401, c, "no key = 401");
            c = Req("GET", "/api/status?k=" + K, null, out h, out b); T.Eq(200, c, "status 200"); T.True(Latin1.GetString(b).Contains("armed"), "status body");
            c = Req("GET", "/api/clips?k=" + K + "&from=0&to=9999999999999", null, out h, out b);
            T.Eq(200, c, "clips 200"); T.True(Latin1.GetString(b).Contains(clip) && Latin1.GetString(b).Contains("\"size\":10"), "clips body");
            c = Req("GET", "/api/clips?k=" + K + "&from=x&to=1", null, out h, out b); T.Eq(400, c, "clips bad params");
            string cp = "/clips/" + clip + "?k=" + K;
            c = Req("GET", cp, null, out h, out b); T.Eq(200, c, "clip 200"); T.Eq("0123456789", Latin1.GetString(b), "clip body");
            c = Req("GET", cp, "Range: bytes=0-3\r\n", out h, out b);
            T.Eq(206, c, "range 206"); T.True(h.Contains("Content-Range: bytes 0-3/10"), "content-range"); T.Eq("0123", Latin1.GetString(b), "range body");
            c = Req("GET", cp, "Range: bytes=50-\r\n", out h, out b); T.Eq(416, c, "range unsatisfiable");
            c = Req("GET", cp + "&dl=1", null, out h, out b); T.True(h.Contains("Content-Disposition: attachment"), "download header");
            c = Req("GET", "/clips/..%5Csecret.ini?k=" + K, null, out h, out b); T.Eq(404, c, "traversal backslash");
            c = Req("GET", "/clips/..%2F..%2Fx?k=" + K, null, out h, out b); T.Eq(404, c, "traversal slash");
            c = Req("GET", "/clips/motion_2099-01-01_00-00-00.mp4?k=" + K, null, out h, out b); T.Eq(404, c, "missing clip");
            c = Req("POST", "/api/rot?k=" + K + "&v=90", null, out h, out b); T.Eq(200, c, "rot ok"); T.Eq(90, host.rot, "host rotated");
            c = Req("POST", "/api/rot?k=" + K + "&v=45", null, out h, out b); T.Eq(400, c, "rot invalid");
            c = Req("GET", "/api/rot?k=" + K + "&v=90", null, out h, out b); T.Eq(405, c, "rot needs POST");
            c = Req("OPTIONS", "/api/status", null, out h, out b); T.Eq(204, c, "options 204"); T.True(h.Contains("Access-Control-Allow-Origin: *"), "cors header");
            c = Req("GET", "/nope?k=" + K, null, out h, out b); T.Eq(404, c, "unknown path");
            c = Raw("GET /api/status?k=" + K + " HTTP/1.1\r\nX: " + new string('a', 9000) + "\r\n\r\n", out h, out b); T.True(c != 200, "oversized header rejected");

            byte[] jpg = FrameTests.Jpg(64, 48, System.Drawing.Color.Red);
            lv = OpenLive();
            System.Threading.Thread.Sleep(300);
            host.hub.Publish(jpg);
            byte[] got = ReadSome(lv, jpg.Length + 100, 4000);
            string gt = Latin1.GetString(got);
            T.True(gt.Contains("multipart/x-mixed-replace") && gt.Contains("--frame") && gt.Contains("image/jpeg"), "live headers");
            T.True(Contains(got, jpg), "live frame bytes");

            System.Collections.Generic.List<System.Net.Sockets.TcpClient> extra = new System.Collections.Generic.List<System.Net.Sockets.TcpClient>();
            for (int i = 0; i < 3; i++) extra.Add(OpenLive());
            System.Threading.Thread.Sleep(300);
            c = Req("GET", "/live?k=" + K, null, out h, out b); T.Eq(503, c, "5th live viewer refused");
            foreach (System.Net.Sockets.TcpClient x in extra) x.Close();

            for (int i = 0; i < 11; i++) Req("GET", "/api/status?k=wrong000", null, out h, out b);
            c = Req("GET", "/api/status?k=" + K, null, out h, out b); T.Eq(429, c, "blocked after repeated failures");

            DateTime t0 = DateTime.Now; srv.Stop();
            ReadSome(lv, int.MaxValue, 3000);
            T.True((DateTime.Now - t0).TotalSeconds < 3, "Stop closes live connection quickly");
        }
        finally
        {
            srv.Stop();
            if (lv != null) lv.Close();
            try { Directory.Delete(root, true); } catch { }
        }
    }
}
```
ลงทะเบียน `T.Run("http server", HttpServerTests.All);` ใน `SelfTest.Run` (ก่อน `PipelineIntegration` ถ้ามีแล้ว)

- [ ] **Step 2: รัน** Expected: BUILD FAILED

- [ ] **Step 3: เขียน `HttpServer.cs`**

```csharp
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

class HttpServer : IDisposable
{
    const int MaxConns = 16, MaxLive = 4, MaxHead = 8192;
    readonly Settings s;
    readonly IServerHost host;
    readonly RateLimiter limiter = new RateLimiter(10, TimeSpan.FromMinutes(1));
    readonly List<TcpClient> open = new List<TcpClient>();
    TcpListener listener;
    Thread acceptThread;
    volatile bool stop;
    int conns, liveConns;

    public HttpServer(Settings settings, IServerHost h) { s = settings; host = h; }

    public void Start()
    {
        listener = new TcpListener(s.LocalOnly ? IPAddress.Loopback : IPAddress.Any, s.Port);
        listener.Start();
        stop = false;
        acceptThread = new Thread(AcceptLoop); acceptThread.IsBackground = true; acceptThread.Start();
    }

    public void Stop()
    {
        stop = true;
        try { listener.Stop(); } catch { }
        lock (open) { foreach (TcpClient c in open) { try { c.Close(); } catch { } } open.Clear(); }
    }
    public void Dispose() { Stop(); }

    void AcceptLoop()
    {
        while (!stop)
        {
            TcpClient c;
            try { c = listener.AcceptTcpClient(); } catch { break; }
            if (Interlocked.Increment(ref conns) > MaxConns) { Interlocked.Decrement(ref conns); try { c.Close(); } catch { } continue; }
            lock (open) open.Add(c);
            Thread t = new Thread(delegate() { Handle(c); }); t.IsBackground = true; t.Start();
        }
    }

    static string Reason(int code)
    {
        switch (code)
        {
            case 200: return "OK"; case 204: return "No Content"; case 206: return "Partial Content";
            case 400: return "Bad Request"; case 401: return "Unauthorized"; case 404: return "Not Found";
            case 405: return "Method Not Allowed"; case 416: return "Range Not Satisfiable"; case 429: return "Too Many Requests";
            case 431: return "Request Header Fields Too Large"; case 503: return "Service Unavailable"; default: return "Error";
        }
    }

    static void Head(Stream st, int code, string ctype, long len, string extra)
    {
        StringBuilder sb = new StringBuilder();
        sb.Append("HTTP/1.1 ").Append(code).Append(' ').Append(Reason(code)).Append("\r\n");
        if (ctype != null) sb.Append("Content-Type: ").Append(ctype).Append("\r\n");
        if (len >= 0) sb.Append("Content-Length: ").Append(len).Append("\r\n");
        sb.Append("Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Private-Network: true\r\n");
        sb.Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nCache-Control: no-store\r\nConnection: close\r\n");
        if (extra != null) sb.Append(extra);
        sb.Append("\r\n");
        byte[] b = Encoding.ASCII.GetBytes(sb.ToString());
        st.Write(b, 0, b.Length);
    }

    static void Json(Stream st, int code, string json)
    {
        byte[] b = Encoding.UTF8.GetBytes(json);
        Head(st, code, "application/json; charset=utf-8", b.Length, null);
        st.Write(b, 0, b.Length);
    }

    static bool ReadHead(NetworkStream ns, out string head)
    {
        head = null;
        byte[] buf = new byte[MaxHead + 4]; int len = 0;
        while (len < MaxHead)
        {
            int n = ns.Read(buf, len, MaxHead - len);
            if (n <= 0) return false;
            len += n;
            string t = Encoding.ASCII.GetString(buf, 0, len);
            int end = t.IndexOf("\r\n\r\n", StringComparison.Ordinal);
            if (end >= 0) { head = t.Substring(0, end); return true; }
        }
        return false;
    }

    void Handle(TcpClient c)
    {
        try
        {
            c.ReceiveTimeout = 10000; c.SendTimeout = 10000;
            NetworkStream ns = c.GetStream();
            string head; HttpReq req;
            if (!ReadHead(ns, out head)) { try { Head(ns, 431, "text/plain", 0, null); } catch { } return; }
            if (!HttpParse.TryParse(head, out req)) { Json(ns, 400, "{\"error\":\"bad request\"}"); return; }
            string ip = ((IPEndPoint)c.Client.RemoteEndPoint).Address.ToString();
            Route(ns, req, ip);
        }
        catch { }
        finally
        {
            try { c.Close(); } catch { }
            lock (open) open.Remove(c);
            Interlocked.Decrement(ref conns);
        }
    }

    void Route(NetworkStream ns, HttpReq req, string ip)
    {
        if (req.Method == "OPTIONS") { Head(ns, 204, null, 0, null); return; }
        DateTime now = DateTime.Now;
        if (limiter.IsBlocked(ip, now)) { Json(ns, 429, "{\"error\":\"too many attempts\"}"); return; }
        string k; req.Query.TryGetValue("k", out k);
        if (!Auth.CodeEquals(k, s.Code)) { limiter.Fail(ip, now); Json(ns, 401, "{\"error\":\"unauthorized\"}"); return; }

        if (req.Path == "/api/status") { if (req.Method != "GET") { Json(ns, 405, "{\"error\":\"method\"}"); return; } Json(ns, 200, host.StatusJson()); return; }
        if (req.Path == "/api/clips") { Clips(ns, req); return; }
        if (req.Path == "/api/rot") { Rot(ns, req); return; }
        if (req.Path == "/live") { Live(ns, req); return; }
        if (req.Path.StartsWith("/clips/")) { ClipFile(ns, req); return; }
        Json(ns, 404, "{\"error\":\"not found\"}");
    }

    void Clips(NetworkStream ns, HttpReq req)
    {
        string a, b; long from, to;
        if (!req.Query.TryGetValue("from", out a) || !req.Query.TryGetValue("to", out b) ||
            !long.TryParse(a, out from) || !long.TryParse(b, out to)) { Json(ns, 400, "{\"error\":\"from/to must be numbers\"}"); return; }
        StringBuilder sb = new StringBuilder("{\"clips\":[");
        bool first = true;
        foreach (ClipInfo c in ClipStore.List(s.ClipDir, from, to))
        {
            if (!first) sb.Append(','); first = false;
            sb.Append("{\"name\":\"").Append(c.Name).Append("\",\"start\":").Append(c.StartMs).Append(",\"end\":").Append(c.EndMs).Append(",\"size\":").Append(c.Size).Append('}');
        }
        sb.Append("]}");
        Json(ns, 200, sb.ToString());
    }

    void Rot(NetworkStream ns, HttpReq req)
    {
        if (req.Method != "POST") { Json(ns, 405, "{\"error\":\"use POST\"}"); return; }
        string v; int deg;
        if (!req.Query.TryGetValue("v", out v) || !int.TryParse(v, out deg) || !host.SetRotation(deg)) { Json(ns, 400, "{\"error\":\"v must be 0, 90, 180 or 270\"}"); return; }
        Json(ns, 200, "{\"ok\":true,\"rot\":" + deg + "}");
    }

    void ClipFile(NetworkStream ns, HttpReq req)
    {
        string name = HttpParse.UrlDecode(req.Path.Substring(7));
        string path = ClipStore.ResolvePath(s.ClipDir, name);
        if (path == null) { Json(ns, 404, "{\"error\":\"not found\"}"); return; }
        using (FileStream fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
        {
            long size = fs.Length, a = 0, b = size - 1; bool partial = false;
            string rh;
            if (req.Headers.TryGetValue("Range", out rh))
            {
                if (!HttpParse.TryRange(rh, size, out a, out b)) { Head(ns, 416, null, 0, "Content-Range: bytes */" + size + "\r\n"); return; }
                partial = true;
            }
            string dl; bool download = req.Query.TryGetValue("dl", out dl) && dl == "1";
            string extra = "Accept-Ranges: bytes\r\n" + (partial ? "Content-Range: bytes " + a + "-" + b + "/" + size + "\r\n" : "") +
                (download ? "Content-Disposition: attachment; filename=\"" + name + "\"\r\n" : "");
            long len = size == 0 ? 0 : b - a + 1;
            Head(ns, partial ? 206 : 200, name.EndsWith(".webm") ? "video/webm" : "video/mp4", len, extra);
            fs.Seek(a, SeekOrigin.Begin);
            byte[] buf = new byte[65536]; long left = len;
            while (left > 0)
            {
                int n = fs.Read(buf, 0, (int)Math.Min(buf.Length, left));
                if (n <= 0) break;
                ns.Write(buf, 0, n); left -= n;
            }
        }
    }

    void Live(NetworkStream ns, HttpReq req)
    {
        if (Interlocked.Increment(ref liveConns) > MaxLive) { Interlocked.Decrement(ref liveConns); Json(ns, 503, "{\"error\":\"too many viewers\"}"); return; }
        try
        {
            Head(ns, 200, "multipart/x-mixed-replace; boundary=frame", -1, null);
            long seq = 0; int idle = 0;
            while (!stop)
            {
                byte[] j; long ns2;
                if (!host.Hub.WaitNext(seq, 3000, out j, out ns2)) { if (++idle >= 20) break; continue; }
                idle = 0; seq = ns2;
                byte[] h = Encoding.ASCII.GetBytes("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + j.Length + "\r\n\r\n");
                ns.Write(h, 0, h.Length); ns.Write(j, 0, j.Length); ns.Write(new byte[] { 13, 10 }, 0, 2);
            }
        }
        finally { Interlocked.Decrement(ref liveConns); }
    }
}
```
หมายเหตุ: `ReadHead` ใช้ `Encoding.ASCII.GetString` ทั้งก้อนซ้ำทุกรอบ (ไม่เกิน 8 KB) ยอมรับได้

- [ ] **Step 4: รัน** `run-selftest.ps1` Expected: ผ่านทั้งหมด (พอร์ต 18787 ต้องว่าง)

- [ ] **Step 5: ผูกเซิร์ฟเวอร์ใน `--headless`** ใน `Program.cs` แทนคอมเมนต์ `// Task 10 ...` ด้วย

```csharp
            HttpServer srv = new HttpServer(s, eng);
            srv.Start();
```

- [ ] **Step 6: ต่อ `tests/integration.ps1` ส่วน HTTP** แทนคอมเมนต์ `# ---- HTTP section ----`

```powershell
  $base = "http://127.0.0.1:$port"
  $st = Invoke-RestMethod "$base/api/status?k=$code"
  if ($st.state -notin 'armed','recording') { throw "สถานะไม่ถูกต้อง: $($st.state)" }
  $list = Invoke-RestMethod "$base/api/clips?k=$code&from=0&to=9999999999999"
  if ($list.clips.Count -ne $files.Count) { throw "จำนวนคลิปจาก API ($($list.clips.Count)) ไม่ตรงกับไฟล์ ($($files.Count))" }
  $c0 = $list.clips[0]
  $r = Invoke-WebRequest "$base/clips/$($c0.name)?k=$code" -Headers @{ Range = 'bytes=0-99' } -UseBasicParsing
  if ($r.StatusCode -ne 206 -or $r.RawContentLength -ne 100) { throw "Range ไม่ทำงาน: $($r.StatusCode) len=$($r.RawContentLength)" }
  try { Invoke-WebRequest "$base/api/status?k=wrong000" -UseBasicParsing | Out-Null; throw 'ต้องได้ 401' } catch { if ($_.Exception.Response.StatusCode.value__ -ne 401) { throw } }
  # ดึงเฟรมสดจริง
  $tcp = New-Object Net.Sockets.TcpClient('127.0.0.1', $port); $ns = $tcp.GetStream(); $ns.ReadTimeout = 8000
  $rq = [Text.Encoding]::ASCII.GetBytes("GET /live?k=$code HTTP/1.1`r`nHost: x`r`n`r`n"); $ns.Write($rq, 0, $rq.Length)
  $buf = New-Object byte[] 200000; $got = 0
  while ($got -lt 30000) { $n = $ns.Read($buf, $got, $buf.Length - $got); if ($n -le 0) { break }; $got += $n }
  $tcp.Close()
  $txt = [Text.Encoding]::ASCII.GetString($buf, 0, [Math]::Min($got, 400))
  if ($txt -notmatch 'multipart/x-mixed-replace' -or $txt -notmatch 'image/jpeg') { throw "/live ไม่ถูกต้อง: $txt" }
  "OK http"
```
Expected: `OK clips=...` และ `OK http`

- [ ] **Step 7: Commit** (`feat(camera): http server for live, clips and rotation`)

---

### Task 11: หน้าต่างโปรแกรม ถาดระบบ เปิดพร้อมวินโดวส์ ไอคอน

**Files:**
- Create: `tools/camera/UI.cs`
- Modify: `tools/camera/Program.cs` (เส้นทางหลัก + `--make-icon`), `tools/camera/build.bat` (เพิ่มขั้นตอนสร้าง/ฝังไอคอน)

**Interfaces:**
- Consumes: `CameraEngine`, `HttpServer`, `Settings`, `FfmpegPipeline.ListCameras/ListModes`, `FrameTools.Decode`
- Produces: `class MainForm : Form { MainForm(Settings s, CameraEngine eng, HttpServer srv, bool startHidden, bool ffmpegMissing) }`, `static class CameraArt { Bitmap Icon(int size); Icon AsIcon(int size); void WriteIcoFile(string path) }`

**Acceptance Criteria:**
- เปิดโปรแกรมแสดงหน้าต่างพร้อม: พรีวิวภาพสด (อัปเดต ~5 ครั้ง/วินาที), ป้ายสถานะ (ยังไม่เริ่ม/กำลังเริ่ม/เฝ้าระวัง/กำลังบันทึก/กล้องค้างกำลังกู้), ข้อความ "1920x1080 @ 14.8 fps", ที่อยู่ `http://<ไอพี>:8787` และรหัส พร้อมปุ่มคัดลอกและสร้างรหัสใหม่ (รหัสใหม่มีผลทันที ผู้ดูเดิมถูกตัดเมื่อเรียกครั้งถัดไป)
- ตั้งค่าได้: กล้อง (รายการจาก dshow + ปุ่มรีเฟรช), ความละเอียด (ตามโหมดที่กล้องรองรับ: 1280x720, 1920x1080, 2560x1440 ที่มีจริง; ถ้าอ่านรายการไม่ได้ ให้ตัวเลือกมาตรฐาน), fps (15/30), ความไว 1-10, หยุดอัด 3/5/10 วินาที, การหมุนภาพ, โฟลเดอร์คลิป (+ปุ่มเลือก), พอร์ต, เก็บคลิปกี่วัน, "ให้เข้าได้เฉพาะเครื่องนี้", ปุ่ม "บันทึกและใช้ค่านี้" (บันทึก Settings แล้ว `Restart` engine; ถ้าพอร์ตเปลี่ยนให้ restart เซิร์ฟเวอร์)
- ปุ่ม เริ่ม/หยุดกล้อง (บันทึก `Running`), ซ่อนไปถาดระบบ, ปิดหน้าต่าง = ซ่อน (ออกจริงจากเมนูถาด), ติ๊ก "เปิดพร้อมวินโดวส์" เขียน `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` ค่า `RRQCCamera` = `"<exe>" --tray`
- เปิดโปรแกรมซ้ำ → ข้อความว่าทำงานอยู่แล้ว (mutex `Global\RRQC_Camera_App`)
- ไม่พบ `ffmpeg.exe` → ข้อความภาษาไทยบอกให้วางไว้ข้างโปรแกรม และไม่เริ่ม engine
- `build.bat` สร้างไอคอนม่วงรูปกล้องและฝังใน exe ได้

- [ ] **Step 1: เขียน `UI.cs`** (สไตล์เดียวกับ `RRQCScanner.cs`: หัวไล่สีม่วง ฟอนต์ Segoe UI)

```csharp
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class CameraArt
{
    public static Bitmap Icon(int size)
    {
        Bitmap bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float pad = size * 0.04f, r = size * 0.22f, sz = size - pad * 2;
            using (GraphicsPath path = new GraphicsPath())
            {
                path.AddArc(pad, pad, r, r, 180, 90); path.AddArc(pad + sz - r, pad, r, r, 270, 90);
                path.AddArc(pad + sz - r, pad + sz - r, r, r, 0, 90); path.AddArc(pad, pad + sz - r, r, r, 90, 90); path.CloseFigure();
                using (LinearGradientBrush br = new LinearGradientBrush(new PointF(0, 0), new PointF(size, size), Color.FromArgb(94, 114, 228), Color.FromArgb(130, 94, 228)))
                    g.FillPath(br, path);
            }
            using (Brush white = new SolidBrush(Color.White))
            {
                g.FillRectangle(white, size * 0.18f, size * 0.32f, size * 0.64f, size * 0.42f);
                g.FillRectangle(white, size * 0.34f, size * 0.24f, size * 0.20f, size * 0.10f);
            }
            using (Brush lens = new SolidBrush(Color.FromArgb(94, 114, 228)))
                g.FillEllipse(lens, size * 0.36f, size * 0.38f, size * 0.28f, size * 0.28f);
            using (Brush dot = new SolidBrush(Color.FromArgb(255, 77, 77)))
                g.FillEllipse(dot, size * 0.70f, size * 0.36f, size * 0.07f, size * 0.07f);
        }
        return bmp;
    }

    public static Icon AsIcon(int size) { using (Bitmap b = Icon(size)) { return System.Drawing.Icon.FromHandle(b.GetHicon()); } }

    public static void WriteIcoFile(string path)
    {
        byte[] png;
        using (Bitmap b = Icon(256)) using (MemoryStream ms = new MemoryStream()) { b.Save(ms, ImageFormat.Png); png = ms.ToArray(); }
        using (FileStream fs = new FileStream(path, FileMode.Create))
        using (BinaryWriter w = new BinaryWriter(fs))
        {
            w.Write((short)0); w.Write((short)1); w.Write((short)1);
            w.Write((byte)0); w.Write((byte)0); w.Write((byte)0); w.Write((byte)0);
            w.Write((short)1); w.Write((short)32); w.Write(png.Length); w.Write(22);
            w.Write(png);
        }
    }
}

class MainForm : Form
{
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string NoCamera = "(ไม่พบกล้อง)", Searching = "กำลังค้นหากล้อง...";
    static readonly Color Ink = Color.FromArgb(50, 50, 93), Purple = Color.FromArgb(94, 114, 228), Muted = Color.FromArgb(136, 152, 170);
    static readonly Color Green = Color.FromArgb(28, 138, 95), Orange = Color.FromArgb(214, 106, 34), Red = Color.FromArgb(196, 31, 66);

    readonly Settings s;
    readonly CameraEngine eng;
    readonly bool ffmpegMissing;
    HttpServer srv;
    bool startHidden, reallyExit, loadingUi;
    NotifyIcon tray;
    ToolStripMenuItem trayToggle;
    PictureBox preview;
    Label pill, info, urlLabel, sensVal;
    TextBox codeBox, clipDirBox;
    ComboBox camBox, resBox, fpsBox, cooldownBox, rotBox;
    TrackBar sensBar;
    NumericUpDown portBox, retentionBox;
    CheckBox localOnlyBox, startupBox;
    Button startStopBtn;
    long lastSeq;
    string urlsText = "";

    public MainForm(Settings settings, CameraEngine engine, HttpServer server, bool hidden, bool noFfmpeg)
    {
        s = settings; eng = engine; srv = server; startHidden = hidden; ffmpegMissing = noFfmpeg;
        Text = "RRQC Camera"; Font = new Font("Segoe UI", 9.5f);
        FormBorderStyle = FormBorderStyle.FixedSingle; MaximizeBox = false;
        ClientSize = new Size(940, 740);
        StartPosition = FormStartPosition.CenterScreen; BackColor = Color.FromArgb(246, 247, 251);
        Icon = CameraArt.AsIcon(32);
        BuildUi(); BuildTray(); FillControls(); RefreshAddresses(); LoadCameras();
        System.Windows.Forms.Timer t = new System.Windows.Forms.Timer(); t.Interval = 200; t.Tick += delegate { RefreshUi(); }; t.Start();
        RefreshUi();
    }

    protected override void SetVisibleCore(bool value)
    {
        if (startHidden) { value = false; if (!IsHandleCreated) CreateControl(); }
        base.SetVisibleCore(value);
    }

    void ShowWindow()
    {
        startHidden = false; Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!reallyExit && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true; Hide();
            tray.ShowBalloonTip(2500, "RRQC Camera", "ยังทำงานอยู่ที่ถาดระบบ (คลิกขวาที่ไอคอนเพื่อออกจากโปรแกรม)", ToolTipIcon.Info);
            return;
        }
        base.OnFormClosing(e);
    }

    void ExitApp()
    {
        reallyExit = true; tray.Visible = false;
        try { srv.Stop(); } catch { }
        eng.Stop();
        Application.Exit();
    }

    Label Lbl(string text, int x, int y, float size, FontStyle style, Color color)
    {
        Label l = new Label(); l.Text = text; l.AutoSize = true; l.ForeColor = color; l.BackColor = Color.Transparent;
        l.Font = new Font("Segoe UI", size, style); l.Location = new Point(x, y);
        return l;
    }

    Button Btn(string text, int x, int y, int w, int h, EventHandler click)
    {
        Button b = new Button(); b.Text = text; b.SetBounds(x, y, w, h); b.Click += click;
        return b;
    }

    ComboBox Combo(int x, int y, int w, params string[] items)
    {
        ComboBox c = new ComboBox(); c.DropDownStyle = ComboBoxStyle.DropDownList; c.SetBounds(x, y, w, 28);
        foreach (string i in items) c.Items.Add(i);
        return c;
    }

    void BuildUi()
    {
        Panel header = new Panel(); header.SetBounds(0, 0, 940, 84);
        header.Paint += delegate(object o, PaintEventArgs e)
        {
            using (LinearGradientBrush br = new LinearGradientBrush(header.ClientRectangle, Ink, Purple, 0f)) e.Graphics.FillRectangle(br, header.ClientRectangle);
            using (Bitmap ico = CameraArt.Icon(52)) e.Graphics.DrawImage(ico, 22, 16, 52, 52);
        };
        header.Controls.Add(Lbl("RRQC Camera", 90, 12, 16f, FontStyle.Bold, Color.White));
        header.Controls.Add(Lbl("เปิดกล้อง ตรวจความเคลื่อนไหว และบันทึกคลิปอัตโนมัติ ดูผ่านเว็บ/มือถือได้", 92, 48, 9.5f, FontStyle.Regular, Color.FromArgb(220, 226, 250)));
        pill = new Label(); pill.AutoSize = false; pill.SetBounds(690, 26, 230, 30); pill.TextAlign = ContentAlignment.MiddleCenter;
        pill.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
        header.Controls.Add(pill);
        Controls.Add(header);

        preview = new PictureBox(); preview.SetBounds(20, 100, 560, 315); preview.BackColor = Color.Black; preview.SizeMode = PictureBoxSizeMode.Zoom;
        Controls.Add(preview);
        info = Lbl("", 20, 420, 9.5f, FontStyle.Regular, Muted); Controls.Add(info);

        Panel card = new Panel(); card.SetBounds(20, 452, 560, 268); card.BackColor = Color.White;
        card.Paint += delegate(object o, PaintEventArgs e) { using (Pen pen = new Pen(Color.FromArgb(226, 230, 240))) e.Graphics.DrawRectangle(pen, 0, 0, card.Width - 1, card.Height - 1); };
        card.Controls.Add(Lbl("ดูจากเว็บ / มือถือ (ต้องอยู่ Wi-Fi เดียวกับเครื่องนี้)", 14, 10, 10.5f, FontStyle.Bold, Ink));
        card.Controls.Add(Lbl("ที่อยู่ (ใส่ในหน้าเว็บ กล้อง CCTV):", 14, 40, 9f, FontStyle.Regular, Muted));
        urlLabel = Lbl("", 14, 60, 11f, FontStyle.Bold, Purple); card.Controls.Add(urlLabel);
        card.Controls.Add(Lbl("รหัสดูกล้อง:", 14, 140, 9f, FontStyle.Regular, Muted));
        codeBox = new TextBox(); codeBox.SetBounds(16, 162, 170, 30); codeBox.ReadOnly = true; codeBox.Font = new Font("Consolas", 14f, FontStyle.Bold);
        card.Controls.Add(codeBox);
        card.Controls.Add(Btn("คัดลอกรหัส", 198, 162, 110, 30, delegate { try { Clipboard.SetText(s.Code); } catch { } }));
        card.Controls.Add(Btn("คัดลอกที่อยู่", 316, 162, 110, 30, delegate { try { Clipboard.SetText(urlsText.Split('\n')[0]); } catch { } }));
        card.Controls.Add(Btn("สร้างรหัสใหม่", 434, 162, 112, 30, delegate
        {
            if (MessageBox.Show("สร้างรหัสใหม่? ผู้ที่ใช้รหัสเดิมจะดูกล้องไม่ได้อีก", "RRQC Camera", MessageBoxButtons.YesNo) != DialogResult.Yes) return;
            s.Code = Settings.NewCode(); s.Save(); codeBox.Text = s.Code;
        }));
        card.Controls.Add(Lbl("ข้อมูลวิ่งแบบไม่เข้ารหัสใน Wi-Fi บ้าน อย่าบอกรหัสกับคนที่ไม่ไว้ใจ", 14, 210, 9f, FontStyle.Regular, Muted));
        Controls.Add(card);

        int x = 600;
        Controls.Add(Lbl("กล้อง", x, 100, 9f, FontStyle.Regular, Muted));
        camBox = Combo(x, 120, 226); camBox.SelectedIndexChanged += delegate { if (!loadingUi) LoadModes(); };
        Controls.Add(camBox);
        Controls.Add(Btn("รีเฟรช", x + 232, 119, 88, 30, delegate { LoadCameras(); }));

        Controls.Add(Lbl("ความละเอียด", x, 156, 9f, FontStyle.Regular, Muted));
        resBox = Combo(x, 176, 150, "1280x720", "1920x1080", "2560x1440"); Controls.Add(resBox);
        Controls.Add(Lbl("fps", x + 170, 156, 9f, FontStyle.Regular, Muted));
        fpsBox = Combo(x + 170, 176, 70, "10", "15", "20", "30"); Controls.Add(fpsBox);

        Controls.Add(Lbl("ความไวจับความเคลื่อนไหว (มาก = ไวขึ้น)", x, 212, 9f, FontStyle.Regular, Muted));
        sensBar = new TrackBar(); sensBar.SetBounds(x - 4, 230, 270, 40); sensBar.Minimum = 1; sensBar.Maximum = 10; sensBar.TickFrequency = 1;
        sensVal = Lbl("5", x + 276, 238, 11f, FontStyle.Bold, Ink);
        sensBar.ValueChanged += delegate { sensVal.Text = sensBar.Value.ToString(); };
        Controls.Add(sensBar); Controls.Add(sensVal);

        Controls.Add(Lbl("หยุดอัดหลังไม่มีเคลื่อนไหว", x, 276, 9f, FontStyle.Regular, Muted));
        cooldownBox = Combo(x, 296, 150, "3 วินาที", "5 วินาที", "10 วินาที"); Controls.Add(cooldownBox);
        Controls.Add(Lbl("การหมุนภาพ", x + 170, 276, 9f, FontStyle.Regular, Muted));
        rotBox = Combo(x + 170, 296, 150, "ปกติ", "หมุนขวา 90°", "กลับหัว 180°", "หมุนซ้าย 90°"); Controls.Add(rotBox);

        Controls.Add(Lbl("โฟลเดอร์เก็บคลิป", x, 332, 9f, FontStyle.Regular, Muted));
        clipDirBox = new TextBox(); clipDirBox.SetBounds(x, 352, 226, 28); Controls.Add(clipDirBox);
        Controls.Add(Btn("เลือก...", x + 232, 351, 88, 30, delegate
        {
            using (FolderBrowserDialog d = new FolderBrowserDialog()) { d.SelectedPath = clipDirBox.Text; if (d.ShowDialog() == DialogResult.OK) clipDirBox.Text = d.SelectedPath; }
        }));

        Controls.Add(Lbl("พอร์ต", x, 388, 9f, FontStyle.Regular, Muted));
        portBox = new NumericUpDown(); portBox.SetBounds(x, 408, 100, 28); portBox.Minimum = 1024; portBox.Maximum = 65535; Controls.Add(portBox);
        Controls.Add(Lbl("เก็บคลิป (วัน, 0 = ไม่ลบ)", x + 120, 388, 9f, FontStyle.Regular, Muted));
        retentionBox = new NumericUpDown(); retentionBox.SetBounds(x + 120, 408, 100, 28); retentionBox.Minimum = 0; retentionBox.Maximum = 3650; Controls.Add(retentionBox);

        localOnlyBox = new CheckBox(); localOnlyBox.Text = "ให้เข้าได้เฉพาะเครื่องนี้ (ปิดการดูจากมือถือ)"; localOnlyBox.AutoSize = true; localOnlyBox.Location = new Point(x, 448); Controls.Add(localOnlyBox);
        startupBox = new CheckBox(); startupBox.Text = "เปิดโปรแกรมอัตโนมัติพร้อมวินโดวส์"; startupBox.AutoSize = true; startupBox.Location = new Point(x, 474);
        startupBox.CheckedChanged += delegate { if (!loadingUi) SetStartup(startupBox.Checked); };
        Controls.Add(startupBox);

        Button apply = Btn("บันทึกและใช้ค่านี้", x, 520, 320, 36, delegate { Apply(); });
        apply.BackColor = Purple; apply.ForeColor = Color.White; apply.FlatStyle = FlatStyle.Flat; apply.FlatAppearance.BorderSize = 0;
        Controls.Add(apply);
        startStopBtn = Btn("", x, 566, 155, 34, delegate { ToggleCamera(); }); Controls.Add(startStopBtn);
        Controls.Add(Btn("ซ่อนไปถาดระบบ", x + 165, 566, 155, 34, delegate { Close(); }));
        Controls.Add(Lbl("ปิดหน้าต่างนี้ โปรแกรมยังทำงานต่อที่ถาดระบบ", x, 612, 9f, FontStyle.Regular, Muted));
    }

    void BuildTray()
    {
        tray = new NotifyIcon(); tray.Icon = CameraArt.AsIcon(32); tray.Text = "RRQC Camera";
        ContextMenuStrip menu = new ContextMenuStrip();
        menu.Items.Add("เปิดหน้าต่าง", null, delegate { ShowWindow(); });
        trayToggle = new ToolStripMenuItem("หยุดกล้อง", null, delegate { ToggleCamera(); });
        menu.Items.Add(trayToggle);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("ออกจากโปรแกรม", null, delegate { ExitApp(); });
        tray.ContextMenuStrip = menu; tray.DoubleClick += delegate { ShowWindow(); }; tray.Visible = true;
    }

    // ---------- ค่าตั้ง <-> ตัวควบคุม ----------
    void EnsureItem(ComboBox c, string v) { if (!c.Items.Contains(v)) c.Items.Add(v); }

    void FillControls()
    {
        loadingUi = true;
        string res = s.Width + "x" + s.Height; EnsureItem(resBox, res); resBox.SelectedItem = res;
        string f = s.Fps.ToString(); EnsureItem(fpsBox, f); fpsBox.SelectedItem = f;
        sensBar.Value = s.Sensitivity; sensVal.Text = s.Sensitivity.ToString();
        cooldownBox.SelectedIndex = s.CooldownMs <= 3000 ? 0 : (s.CooldownMs <= 5000 ? 1 : 2);
        rotBox.SelectedIndex = s.Rotation / 90;
        clipDirBox.Text = s.ClipDir; portBox.Value = s.Port; retentionBox.Value = s.RetentionDays;
        localOnlyBox.Checked = s.LocalOnly; startupBox.Checked = IsStartupOn(); codeBox.Text = s.Code;
        loadingUi = false;
    }

    void ReadSettings()
    {
        string cam = camBox.SelectedItem as string;
        if (!string.IsNullOrEmpty(cam) && camBox.Enabled && cam != NoCamera && cam != Searching) s.CameraName = cam;
        string res = resBox.SelectedItem as string;
        if (res != null) { string[] p = res.Split('x'); s.Width = int.Parse(p[0]); s.Height = int.Parse(p[1]); }
        string fps = fpsBox.SelectedItem as string; if (fps != null) s.Fps = int.Parse(fps);
        s.Sensitivity = sensBar.Value;
        s.CooldownMs = new int[] { 3000, 5000, 10000 }[Math.Max(0, cooldownBox.SelectedIndex)];
        s.Rotation = Math.Max(0, rotBox.SelectedIndex) * 90;
        s.ClipDir = clipDirBox.Text.Trim(); s.Port = (int)portBox.Value; s.RetentionDays = (int)retentionBox.Value; s.LocalOnly = localOnlyBox.Checked;
    }

    void Apply()
    {
        int oldPort = s.Port; bool oldLocal = s.LocalOnly;
        ReadSettings(); s.Clamp(); s.Save();
        if (s.Port != oldPort || s.LocalOnly != oldLocal) RestartServer();
        if (!ffmpegMissing && s.Running) eng.Restart();
        FillControls(); RefreshAddresses();
    }

    void RestartServer()
    {
        try { srv.Stop(); } catch { }
        try { srv = new HttpServer(s, eng); srv.Start(); }
        catch (SocketException ex)
        {
            MessageBox.Show("เปิดเซิร์ฟเวอร์พอร์ต " + s.Port + " ไม่ได้ (มีโปรแกรมอื่นใช้อยู่?)\n" + ex.Message, "RRQC Camera");
        }
    }

    void ToggleCamera()
    {
        if (ffmpegMissing) { MessageBox.Show("ไม่พบ ffmpeg.exe ข้างโปรแกรมนี้ วางไฟล์ไว้ในโฟลเดอร์เดียวกับ RRQCCamera.exe ก่อน", "RRQC Camera"); return; }
        if (eng.State == "stopped") { s.Running = true; s.Save(); eng.Start(); }
        else { s.Running = false; s.Save(); eng.Stop(); }
    }

    // ---------- รายชื่อกล้อง/โหมด (รันบนเธรดพื้นหลัง ไม่บล็อก UI) ----------
    void LoadCameras()
    {
        if (ffmpegMissing) { camBox.Items.Clear(); camBox.Items.Add(NoCamera); camBox.SelectedIndex = 0; camBox.Enabled = false; return; }
        loadingUi = true; camBox.Items.Clear(); camBox.Items.Add(Searching); camBox.SelectedIndex = 0; camBox.Enabled = false; loadingUi = false;
        ThreadPool.QueueUserWorkItem(delegate
        {
            List<string> cams;
            try { cams = FfmpegPipeline.ListCameras(AppPaths.FfmpegPath); } catch { cams = new List<string>(); }
            BeginInvoke(new Action(delegate
            {
                loadingUi = true;
                camBox.Items.Clear();
                foreach (string c in cams) camBox.Items.Add(c);
                if (cams.Count == 0) camBox.Items.Add(s.CameraName != "" ? s.CameraName : NoCamera);
                int idx = camBox.Items.IndexOf(s.CameraName);
                camBox.SelectedIndex = idx >= 0 ? idx : 0;
                camBox.Enabled = true; loadingUi = false;
                LoadModes();
            }));
        });
    }

    static int Area(string wxh) { string[] p = wxh.Split('x'); return int.Parse(p[0]) * int.Parse(p[1]); }

    void LoadModes()
    {
        string cam = camBox.SelectedItem as string;
        if (string.IsNullOrEmpty(cam) || cam == NoCamera || cam == Searching || ffmpegMissing) return;
        ThreadPool.QueueUserWorkItem(delegate
        {
            List<CameraMode> m;
            try { m = FfmpegPipeline.ListModes(AppPaths.FfmpegPath, cam); } catch { m = new List<CameraMode>(); }
            BeginInvoke(new Action(delegate
            {
                List<string> sizes = new List<string>();
                foreach (CameraMode cm in m) { string v = cm.Width + "x" + cm.Height; if (cm.Width >= 640 && !sizes.Contains(v)) sizes.Add(v); }
                if (sizes.Count == 0) { sizes.Add("1280x720"); sizes.Add("1920x1080"); sizes.Add("2560x1440"); }
                string cur = s.Width + "x" + s.Height; if (!sizes.Contains(cur)) sizes.Add(cur);
                sizes.Sort(delegate(string a, string b) { return Area(a).CompareTo(Area(b)); });
                loadingUi = true;
                resBox.Items.Clear(); foreach (string v in sizes) resBox.Items.Add(v);
                resBox.SelectedItem = cur;
                loadingUi = false;
            }));
        });
    }

    // ---------- ที่อยู่ ----------
    void RefreshAddresses()
    {
        List<string> urls = new List<string>();
        if (s.LocalOnly) urls.Add("http://127.0.0.1:" + s.Port);
        else
        {
            try
            {
                foreach (IPAddress ip in Dns.GetHostEntry(Dns.GetHostName()).AddressList)
                    if (ip.AddressFamily == AddressFamily.InterNetwork && !ip.ToString().StartsWith("169.254.")) urls.Add("http://" + ip + ":" + s.Port);
            }
            catch { }
            if (urls.Count == 0) urls.Add("http://127.0.0.1:" + s.Port);
        }
        urlsText = string.Join("\n", urls.ToArray());
        urlLabel.Text = urlsText;
    }

    // ---------- เปิดพร้อมวินโดวส์ ----------
    bool IsStartupOn()
    {
        try { using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey)) return k != null && k.GetValue("RRQCCamera") != null; } catch { return false; }
    }

    void SetStartup(bool on)
    {
        try
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey, true))
            {
                if (on) k.SetValue("RRQCCamera", "\"" + Application.ExecutablePath + "\" --tray");
                else k.DeleteValue("RRQCCamera", false);
            }
        }
        catch (Exception ex) { MessageBox.Show("ตั้งค่าเปิดอัตโนมัติไม่สำเร็จ: " + ex.Message); }
    }

    // ---------- รีเฟรชหน้าจอทุก 200 ms ----------
    void RefreshUi()
    {
        long seq = eng.Hub.Seq;
        byte[] jpg = eng.Hub.Latest();
        if (Visible && jpg != null && seq != lastSeq)
        {
            lastSeq = seq;
            try { Image n = FrameTools.Decode(jpg); Image old = preview.Image; preview.Image = n; if (old != null) old.Dispose(); } catch { }
        }
        string st = ffmpegMissing ? "missing" : eng.State;
        string text; Color bg, fg;
        switch (st)
        {
            case "armed": text = "● เฝ้าระวัง"; bg = Color.FromArgb(222, 247, 236); fg = Green; break;
            case "recording": text = "● กำลังบันทึก"; bg = Color.FromArgb(253, 228, 233); fg = Red; break;
            case "starting": text = "● กำลังเปิดกล้อง..."; bg = Color.FromArgb(255, 240, 224); fg = Orange; break;
            case "recovering": text = "● กล้องค้าง กำลังกู้คืน"; bg = Color.FromArgb(255, 240, 224); fg = Orange; break;
            case "missing": text = "● ไม่พบ ffmpeg.exe"; bg = Color.FromArgb(253, 228, 233); fg = Red; break;
            default: text = "● หยุดอยู่"; bg = Color.FromArgb(235, 238, 245); fg = Muted; break;
        }
        pill.Text = text; pill.BackColor = bg; pill.ForeColor = fg;
        info.Text = eng.ActualWidth > 0 ? "กล้องส่งภาพจริง " + eng.ActualWidth + "x" + eng.ActualHeight + " @ " + eng.ActualFps.ToString("0.0") + " fps" : (st == "stopped" ? "กล้องหยุดอยู่" : "รอภาพจากกล้อง...");
        string toggle = eng.State == "stopped" ? "▶ เริ่มกล้อง" : "■ หยุดกล้อง";
        startStopBtn.Text = toggle; trayToggle.Text = eng.State == "stopped" ? "เริ่มกล้อง" : "หยุดกล้อง";
        tray.Text = "RRQC Camera - " + text.Replace("● ", "");
    }
}
```

- [ ] **Step 2: แก้ `Program.cs` เส้นทางหลัก**

```csharp
        if (args.Length >= 2 && args[0] == "--make-icon") { CameraArt.WriteIcoFile(args[1]); return 0; }
        // ... (หลังอ่าน --data-dir, --test-source) ...
        bool created;
        using (Mutex m = new Mutex(true, "Global\\RRQC_Camera_App", out created))
        {
            if (!created) { MessageBox.Show("RRQC Camera ทำงานอยู่แล้ว ดูที่ไอคอนในถาดระบบมุมขวาล่าง", "RRQC Camera"); return 0; }
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            Directory.CreateDirectory(AppPaths.DataDir);
            Settings s = Settings.Load();
            bool noFfmpeg = !File.Exists(AppPaths.FfmpegPath);
            if (!noFfmpeg && !test && s.CameraName == "")   // ครั้งแรก: เลือกกล้องตัวแรกที่พบให้เอง
            {
                System.Collections.Generic.List<string> cams = FfmpegPipeline.ListCameras(AppPaths.FfmpegPath);
                if (cams.Count > 0) { s.CameraName = cams[0]; s.Save(); }
            }
            CameraEngine eng = new CameraEngine(s, test);
            HttpServer srv = new HttpServer(s, eng);
            try { srv.Start(); }
            catch (System.Net.Sockets.SocketException ex) { MessageBox.Show("เปิดเซิร์ฟเวอร์พอร์ต " + s.Port + " ไม่ได้ (มีโปรแกรมอื่นใช้อยู่?)\n" + ex.Message + "\nเปลี่ยนพอร์ตในหน้าต่างตั้งค่าแล้วกด \"บันทึกและใช้ค่านี้\"", "RRQC Camera"); }
            if (noFfmpeg) MessageBox.Show("ไม่พบ ffmpeg.exe ข้างโปรแกรมนี้\nดาวน์โหลด ffmpeg (build essentials) จาก gyan.dev แล้ววาง ffmpeg.exe ไว้ในโฟลเดอร์เดียวกับ RRQCCamera.exe", "RRQC Camera");
            else if (s.Running) eng.Start();
            bool hidden = Has(args, "--tray");
            Application.Run(new MainForm(s, eng, srv, hidden, noFfmpeg));
        }
        return 0;
```
(ย้ายบล็อก `--headless` ไว้ก่อนเส้นทางนี้ ให้คงเดิม)

- [ ] **Step 3: เพิ่มขั้นตอนไอคอนใน `build.bat`** แทนบรรทัด `echo Built RRQCCamera.exe` ด้วย

```bat
"%~dp0RRQCCamera.exe" --make-icon "%~dp0app.ico"
"%CSC%" /nologo /target:winexe /codepage:65001 /win32icon:app.ico /out:RRQCCamera.exe /r:System.Windows.Forms.dll /r:System.Drawing.dll *.cs
if errorlevel 1 (
  echo Build with icon failed.
  if not defined NOPAUSE pause
  exit /b 1
)
del app.ico
echo Built RRQCCamera.exe
```
แล้วรัน `run-selftest.ps1` Expected: ผ่านทั้งหมด และมี `RRQCCamera.exe` พร้อมไอคอน

- [ ] **Step 4: ทดสอบมือบนเครื่อง** รัน `RRQCCamera.exe --test-source --data-dir <โฟลเดอร์ชั่วคราว>` เห็นหน้าต่าง พรีวิวเป็นสี่เหลี่ยมสีขาวเคลื่อนที่ ป้ายสถานะสลับ เฝ้าระวัง/กำลังบันทึก ตัวเลข fps แสดง ปุ่มคัดลอกรหัสทำงาน ปิดหน้าต่างแล้วไอคอนยังอยู่ที่ถาด เปิดโปรแกรมซ้ำเห็นข้อความ "ทำงานอยู่แล้ว" ถ่ายภาพหน้าจอเก็บเป็นหลักฐาน (ใช้ PowerShell `CopyFromScreen`) เปิดโฟลเดอร์คลิปเห็นไฟล์ที่เกิดขึ้น

- [ ] **Step 5: Commit** (`feat(camera): main window, tray, startup toggle and icon`)

---

### Task 12: หน้าเว็บเป็นฝั่งดูอย่างเดียว

**Files:**
- Modify: `index.html` (บล็อก `<div id="pageCctv" ...>` ทั้งก้อน และเลขเวอร์ชัน `js/cctv.js?v=22` → `?v=23`, `css/style.css?v=23` → `?v=24`)
- Rewrite: `js/cctv.js`
- Modify: `css/style.css` (เพิ่มส่วนท้าย; กฎ `.cctv-host-only/.cctv-viewer-only/.cctv-adjust*/.cctv-role` เดิมปล่อยไว้ได้แต่ไม่ถูกใช้)

**Interfaces:**
- Consumes: `GET /live`, `/api/status`, `/api/clips`, `/clips/<name>`, `POST /api/rot` ของ `RRQCCamera.exe` (Task 10)
- Produces: `window.cctvOnPageShow()` (เรียกจาก `switchPage` เดิมใน `js/script.js`) ไม่เปลี่ยน

**Acceptance Criteria:**
- หน้า CCTV มี: แท็บ "กล้องสด / ดูย้อนหลัง"; การ์ดเชื่อมต่อ (ช่องที่อยู่เครื่องหลัก + ช่องรหัส + ปุ่มเชื่อมต่อ + สถานะ); จอภาพสดแบบ `<img>`; เลือกการหมุนภาพ; ปุ่มเต็มจอ; ดูย้อนหลังครบ (ปุ่มลัด 1 ชม./วันนี้/เมื่อวาน, เลือกวัน-เวลา, ไทม์ไลน์คลิกได้, ก่อนหน้า/ถัดไป, ดาวน์โหลดคลิป/ทั้งช่วง, รายการคลิป)
- ที่อยู่เริ่มต้น: `<hostname ของหน้าเว็บ>:8787` (หน้าเว็บเปิดจาก `localhost` → `localhost:8787`); จำที่อยู่/รหัสใน localStorage; เชื่อมต่ออัตโนมัติเมื่อมีรหัสเก็บไว้
- สถานะจาก `/api/status` ทุก 3 วินาที: "กำลังดูกล้องสด (1920x1080 @ 14.8 fps · เฝ้าระวัง)"; ผิดรหัส (401) → "รหัสไม่ถูกต้อง"; เชื่อมต่อไม่ได้ → "ติดต่อโปรแกรมกล้องไม่ได้ — ตรวจว่าโปรแกรมเปิดอยู่ อยู่ Wi-Fi เดียวกัน และ Firewall อนุญาต" และลองใหม่เองทุก 5 วินาที; หน้าเว็บบน `https://` → ข้อความอธิบายว่าต้องเปิดแบบ `http://`
- ภาพสดขาด (`onerror`) → ต่อใหม่เองภายใน 3 วินาที; เปลี่ยนการหมุน → ส่ง `POST /api/rot` แล้วภาพต่อใหม่เมื่อโปรแกรมเริ่ม ffmpeg ใหม่
- ดูย้อนหลังใช้ `<video src="<base>/clips/<name>?k=<code>">` ตรงๆ (ไม่โหลดทั้งไฟล์เข้าหน่วยความจำ) ดาวน์โหลดผ่านลิงก์ `&dl=1`
- ไม่มีโค้ดเปิดกล้อง/`getUserMedia`/`MediaRecorder`/`showDirectoryPicker`/WebRTC เหลือใน `js/cctv.js` (ตรวจด้วย `Select-String`)
- ตรวจในเบราว์เซอร์: โหลดไม่มี console error; กับโปรแกรมที่รัน `--headless --test-source` เห็นภาพสด สถานะ รายการคลิป เล่นคลิปได้

- [ ] **Step 1: แทนบล็อก `pageCctv` ใน `index.html`** ด้วยโครงนี้ (คงเอกลักษณ์ `id="pageCctv" class="page"` และหัวข้อเดิม)

```html
            <div id="pageCctv" class="page">
                <h2 class="page-title">📹 กล้อง CCTV <span class="cctv-title-sub">ดูกล้องจากโปรแกรม RRQC Camera บนคอมเครื่องหลัก</span></h2>
                <div class="cctv-root">
                    <div class="cctv-tabs">
                        <button type="button" class="active" id="cctvTabLive">🔴 กล้องสด</button>
                        <button type="button" id="cctvTabPb">⏪ ดูย้อนหลัง</button>
                    </div>

                    <div class="cctv-card cctv-conn">
                        <div class="cctv-row">
                            <div><label for="cctvAddr">ที่อยู่เครื่องหลัก</label><span class="cctv-hint">เช่น 192.168.1.68:8787 (ดูได้ในหน้าต่างโปรแกรม RRQC Camera)</span></div>
                            <input type="text" id="cctvAddr" class="cctv-code-input" style="width:210px;max-width:210px" autocomplete="off" spellcheck="false">
                        </div>
                        <div class="cctv-row">
                            <div><label for="cctvCode">รหัสดูกล้อง</label><span class="cctv-hint">รหัส 8 ตัวที่แสดงในโปรแกรม</span></div>
                            <input type="text" id="cctvCode" class="cctv-code-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="รหัส 8 ตัว">
                        </div>
                        <div class="cctv-btnrow"><button type="button" class="cctv-primary" id="cctvConnect">เชื่อมต่อ</button></div>
                        <div class="cctv-status-line">สถานะ: <strong id="cctvConnStatus">ยังไม่ได้เชื่อมต่อ</strong></div>
                    </div>

                    <div id="cctvLiveView">
                        <div class="cctv-monitor" id="cctvMonitor">
                            <img id="cctvLiveImg" alt="กล้องสด">
                            <div class="cctv-hud" id="cctvHud"><span class="cctv-dot"></span><span id="cctvHudText">ยังไม่ได้เชื่อมต่อ</span></div>
                            <div class="cctv-placeholder" id="cctvPlaceholder">ใส่ที่อยู่และรหัส แล้วกด "เชื่อมต่อ"</div>
                        </div>
                        <div class="cctv-card" style="margin-top:12px">
                            <div class="cctv-row">
                                <div><label for="cctvRot">การหมุนภาพ</label><span class="cctv-hint">สั่งหมุนที่กล้องของเครื่องหลัก (คลิปที่บันทึกต่อจากนี้ตั้งตรงด้วย) ภาพจะสะดุดสักครู่ขณะโปรแกรมรีสตาร์ตกล้อง</span></div>
                                <select id="cctvRot"><option value="0">ปกติ</option><option value="90">หมุนขวา 90°</option><option value="180">กลับหัว 180°</option><option value="270">หมุนซ้าย 90°</option></select>
                            </div>
                            <div class="cctv-btnrow"><button type="button" id="cctvFull">⛶ เต็มจอ</button></div>
                        </div>
                    </div>

                    <div id="cctvPbView" hidden>
                        <div class="cctv-card cctv-playback" id="cctvPlayback">
                            <div class="cctv-quick">
                                <span>เลือกช่วงเวลา:</span>
                                <button type="button" data-quick="hour">1 ชม.ล่าสุด</button>
                                <button type="button" data-quick="today">วันนี้</button>
                                <button type="button" data-quick="yesterday">เมื่อวาน</button>
                            </div>
                            <div class="cctv-pb-controls">
                                <label>วันที่ <input type="date" id="cctvPbDate"></label>
                                <label>ตั้งแต่ <input type="time" id="cctvPbFrom" value="00:00"></label>
                                <label>ถึง <input type="time" id="cctvPbTo" value="23:59"></label>
                                <button type="button" class="cctv-primary" id="cctvPbLoad">🔍 ค้นหาคลิป</button>
                                <span class="cctv-hint" id="cctvPbInfo">เลือกวันและช่วงเวลา แล้วกด "ค้นหาคลิป"</span>
                            </div>
                            <div class="cctv-pb-player">
                                <video id="cctvPbVideo" controls playsinline preload="metadata"></video>
                                <div class="cctv-pb-now" id="cctvPbNow">--:--:--</div>
                            </div>
                            <div class="cctv-pb-actions">
                                <button type="button" id="cctvPbPrev" disabled>⏮ คลิปก่อนหน้า</button>
                                <button type="button" id="cctvPbNext" disabled>คลิปถัดไป ⏭</button>
                                <span class="cctv-spacer"></span>
                                <button type="button" id="cctvPbDownload" disabled>⬇ ดาวน์โหลดคลิปนี้</button>
                                <button type="button" id="cctvPbDownloadAll" disabled>⬇ ดาวน์โหลดทั้งช่วง</button>
                            </div>
                            <div class="cctv-tl-wrap">
                                <div class="cctv-tl" id="cctvTl"><div class="cctv-tl-head" id="cctvTlHead" hidden></div></div>
                                <div class="cctv-tl-ticks" id="cctvTlTicks"></div>
                            </div>
                            <ul class="cctv-log cctv-pb-list" id="cctvPbList"></ul>
                        </div>
                    </div>
                </div>
            </div>
```

- [ ] **Step 2: เขียน `js/cctv.js` ใหม่ทั้งไฟล์**

```javascript
// ==========================================================
//  กล้อง CCTV (ฝั่งดู): โปรแกรม RRQC Camera บนคอมเครื่องหลักเป็นคนเปิดกล้อง/บันทึกคลิป
//  หน้านี้ดึงภาพสดและคลิปย้อนหลังจากโปรแกรมผ่าน HTTP ใน LAN (ทุกคำขอต้องมีรหัสดูกล้อง ?k=)
// ==========================================================
(() => {
  const $ = id => document.getElementById(id);
  const img = $('cctvLiveImg');
  if (!img) return;
  const notify = msg => (typeof showAppAlert === 'function' ? showAppAlert(msg) : alert(msg));
  const pad = n => n.toString().padStart(2, '0');
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const ADDR_KEY = 'cctv-addr', CODE_KEY = 'cctv-code';

  const addrEl = $('cctvAddr'), codeEl = $('cctvCode'), connStatus = $('cctvConnStatus');
  const placeholder = $('cctvPlaceholder'), hudText = $('cctvHudText'), hud = $('cctvHud'), rotEl = $('cctvRot');
  let base = '', code = '', statusTimer = null, imgTimer = null, connected = false, rotBusy = false;

  addrEl.value = lsGet(ADDR_KEY) || ((location.hostname || 'localhost') + ':8787');
  codeEl.value = lsGet(CODE_KEY) || '';

  function normalizeAddr(a) {
    a = a.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (!a) return '';
    if (!/:\d+$/.test(a)) a += ':8787';
    return 'http://' + a;
  }
  const url = (path, extra) => `${base}${path}?k=${encodeURIComponent(code)}${extra || ''}`;
  const setConn = (text, ok) => { connStatus.textContent = text; hudText.textContent = ok ? 'ดูสดจากกล้อง' : 'ไม่ได้เชื่อมต่อ'; hud.classList.toggle('recording', false); };

  async function pollStatus() {
    try {
      const r = await fetch(url('/api/status'), { cache: 'no-store' });
      if (r.status === 401) { connected = false; setConn('รหัสไม่ถูกต้อง', false); showPlaceholder('รหัสไม่ถูกต้อง'); return; }
      if (r.status === 429) { setConn('ใส่รหัสผิดบ่อยเกินไป รอสักครู่แล้วลองใหม่', false); return; }
      const st = await r.json();
      const wasConnected = connected;
      connected = true;
      const stateTh = { armed: 'เฝ้าระวัง', recording: 'กำลังบันทึก', starting: 'กำลังเปิดกล้อง', recovering: 'กล้องค้าง กำลังกู้คืน', stopped: 'กล้องปิดอยู่' }[st.state] || st.state;
      setConn(`กำลังดูกล้องสด (${st.width && st.height ? st.width + 'x' + st.height + ' @ ' + st.fps + ' fps · ' : ''}${stateTh})`, true);
      hudText.textContent = stateTh;
      hud.classList.toggle('recording', st.state === 'recording');
      if (!rotBusy) rotEl.value = String(st.rot || 0);
      if (!wasConnected) startImage();
    } catch (e) {
      connected = false;
      const https = location.protocol === 'https:';
      setConn(https ? 'หน้านี้เปิดแบบ https:// จึงเรียกโปรแกรมกล้องใน LAN ไม่ได้ ให้เปิดเว็บแบบ http://' : 'ติดต่อโปรแกรมกล้องไม่ได้ — ตรวจว่าโปรแกรมเปิดอยู่ อยู่ Wi-Fi เดียวกัน และ Firewall อนุญาต', false);
      showPlaceholder('ติดต่อโปรแกรมกล้องไม่ได้ กำลังลองใหม่...');
    }
  }

  function showPlaceholder(t) { placeholder.textContent = t; placeholder.style.display = 'flex'; }

  function startImage() {
    clearTimeout(imgTimer);
    placeholder.style.display = 'none';
    img.src = url('/live', '&t=' + Date.now());
  }
  img.addEventListener('error', () => {
    if (!base) return;
    showPlaceholder('ภาพขาดช่วง กำลังต่อใหม่...');
    clearTimeout(imgTimer);
    imgTimer = setTimeout(() => { if (connected) startImage(); }, 3000);
  });
  img.addEventListener('load', () => { placeholder.style.display = 'none'; });

  function connect() {
    base = normalizeAddr(addrEl.value);
    code = codeEl.value.trim().toLowerCase();
    if (!base) { notify('กรุณาใส่ที่อยู่เครื่องหลัก'); return; }
    if (!/^[a-z2-9]{8}$/.test(code)) { notify('รหัสดูกล้องต้องเป็นตัวอักษร/ตัวเลข 8 ตัว'); return; }
    lsSet(ADDR_KEY, addrEl.value.trim()); lsSet(CODE_KEY, code);
    connected = false; img.removeAttribute('src');
    showPlaceholder('กำลังเชื่อมต่อ...'); connStatus.textContent = 'กำลังเชื่อมต่อ...';
    clearInterval(statusTimer);
    pollStatus(); statusTimer = setInterval(pollStatus, 3000);
  }
  $('cctvConnect').addEventListener('click', connect);
  codeEl.addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });
  $('cctvFull').addEventListener('click', () => { const el = $('cctvMonitor'); (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el); });

  rotEl.addEventListener('change', async () => {
    if (!base) { notify('ยังไม่ได้เชื่อมต่อกับโปรแกรมกล้อง'); return; }
    rotBusy = true;
    try {
      const r = await fetch(url('/api/rot', '&v=' + rotEl.value), { method: 'POST' });
      if (!r.ok) notify('สั่งหมุนภาพไม่สำเร็จ (' + r.status + ')');
    } catch (e) { notify('สั่งหมุนภาพไม่สำเร็จ: ติดต่อโปรแกรมกล้องไม่ได้'); }
    setTimeout(() => { rotBusy = false; }, 6000);
  });

  // ================= ดูย้อนหลัง =================
  const pbDate = $('cctvPbDate'), pbFrom = $('cctvPbFrom'), pbTo = $('cctvPbTo');
  const pbLoad = $('cctvPbLoad'), pbInfo = $('cctvPbInfo'), pbVideo = $('cctvPbVideo'), pbNow = $('cctvPbNow');
  const tl = $('cctvTl'), tlHead = $('cctvTlHead'), tlTicks = $('cctvTlTicks'), pbList = $('cctvPbList');
  let pbClips = [], pbIndex = -1, pbWinStart = 0, pbWinEnd = 0;

  const d0 = new Date();
  pbDate.value = `${d0.getFullYear()}-${pad(d0.getMonth() + 1)}-${pad(d0.getDate())}`;
  const hhmmss = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const clipUrl = (c, extra) => `${base}/clips/${encodeURIComponent(c.name)}?k=${encodeURIComponent(code)}${extra || ''}`;

  function windowRange() {
    const [y, mo, da] = pbDate.value.split('-').map(Number);
    const [fh, fm] = (pbFrom.value || '00:00').split(':').map(Number);
    const [th, tm] = (pbTo.value || '23:59').split(':').map(Number);
    return [new Date(y, mo - 1, da, fh, fm, 0).getTime(), new Date(y, mo - 1, da, th, tm, 59).getTime()];
  }

  async function loadPlayback() {
    if (!base) { notify('ต้องเชื่อมต่อกับโปรแกรมกล้องก่อน (ใส่ที่อยู่และรหัสแล้วกด "เชื่อมต่อ")'); return; }
    if (!pbDate.value) { notify('กรุณาเลือกวันที่'); return; }
    const [ws, we] = windowRange();
    if (we <= ws) { notify('เวลา "ถึง" ต้องมากกว่า "ตั้งแต่"'); return; }
    pbWinStart = ws; pbWinEnd = we;
    pbInfo.textContent = 'กำลังขอรายการคลิปจากโปรแกรมกล้อง...';
    try {
      const r = await fetch(url('/api/clips', `&from=${ws}&to=${we}`), { cache: 'no-store' });
      if (r.status === 401) { pbInfo.textContent = 'รหัสไม่ถูกต้อง'; return; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      pbClips = (await r.json()).clips;
    } catch (e) { pbInfo.textContent = 'ขอรายการคลิปไม่สำเร็จ: ติดต่อโปรแกรมกล้องไม่ได้'; return; }
    pbIndex = -1;
    pbInfo.textContent = pbClips.length ? `พบ ${pbClips.length} คลิป · คลิกที่ไทม์ไลน์หรือรายการเพื่อดู` : 'ไม่พบคลิปในช่วงเวลานี้';
    renderTimeline();
    if (pbClips.length) playClip(0);
  }

  function renderTimeline() {
    tl.querySelectorAll('.cctv-tl-seg').forEach(n => n.remove());
    const span = pbWinEnd - pbWinStart;
    pbClips.forEach((c, i) => {
      const seg = document.createElement('div');
      seg.className = 'cctv-tl-seg';
      const l = Math.max(0, (c.start - pbWinStart) / span) * 100, r = Math.min(1, (c.end - pbWinStart) / span) * 100;
      seg.style.left = l + '%'; seg.style.width = Math.max(0.25, r - l) + '%';
      seg.title = `${hhmmss(c.start)} - ${hhmmss(c.end)}`; seg.dataset.i = i;
      tl.appendChild(seg);
    });
    tlTicks.innerHTML = '';
    for (let i = 0; i <= 8; i++) {
      const t = document.createElement('span');
      t.style.left = (i / 8 * 100) + '%'; t.textContent = hhmmss(pbWinStart + span * i / 8).slice(0, 5);
      tlTicks.appendChild(t);
    }
    pbList.innerHTML = '';
    pbClips.forEach((c, i) => {
      const li = document.createElement('li'); li.dataset.i = i;
      const a = document.createElement('span'); a.textContent = `${hhmmss(c.start)} – ${hhmmss(c.end)}`;
      const b = document.createElement('span'); b.className = 'cctv-badge'; b.textContent = `${(c.size / 1024 / 1024).toFixed(2)} MB `;
      const dl = document.createElement('button'); dl.type = 'button'; dl.className = 'cctv-mini'; dl.dataset.dl = i; dl.textContent = '⬇'; dl.title = 'ดาวน์โหลดคลิปนี้';
      b.appendChild(dl); li.appendChild(a); li.appendChild(b); pbList.appendChild(li);
    });
    $('cctvPbDownload').disabled = !pbClips.length; $('cctvPbDownloadAll').disabled = !pbClips.length;
    updateHead(pbWinStart);
  }

  function updateHead(ms) {
    const span = pbWinEnd - pbWinStart; if (!span) return;
    const p = (ms - pbWinStart) / span;
    tlHead.hidden = p < 0 || p > 1; tlHead.style.left = (p * 100) + '%';
  }

  function playClip(i, offsetMs) {
    if (i < 0 || i >= pbClips.length) return;
    pbIndex = i;
    const c = pbClips[i];
    pbVideo.src = clipUrl(c);
    pbVideo.onloadedmetadata = () => { if (offsetMs > 0) { try { pbVideo.currentTime = offsetMs / 1000; } catch (e) {} } };
    pbVideo.play().catch(() => {});
    tl.querySelectorAll('.cctv-tl-seg').forEach(s => s.classList.toggle('active', +s.dataset.i === i));
    pbList.querySelectorAll('li').forEach(li => li.classList.toggle('active', +li.dataset.i === i));
    pbNow.textContent = hhmmss(c.start); updateHead(c.start);
    $('cctvPbPrev').disabled = i <= 0; $('cctvPbNext').disabled = i >= pbClips.length - 1;
  }

  pbVideo.addEventListener('timeupdate', () => {
    if (pbIndex < 0) return;
    const ms = pbClips[pbIndex].start + pbVideo.currentTime * 1000;
    pbNow.textContent = hhmmss(ms); updateHead(ms);
  });
  pbVideo.addEventListener('ended', () => { if (pbIndex + 1 < pbClips.length) playClip(pbIndex + 1); });

  tl.addEventListener('click', e => {
    if (!pbClips.length) return;
    const r = tl.getBoundingClientRect();
    const t = pbWinStart + (e.clientX - r.left) / r.width * (pbWinEnd - pbWinStart);
    let i = pbClips.findIndex(c => t >= c.start && t <= c.end);
    if (i >= 0) return playClip(i, t - pbClips[i].start);
    i = pbClips.findIndex(c => c.start > t);
    playClip(i >= 0 ? i : pbClips.length - 1);
  });

  function downloadClip(i) {
    const c = pbClips[i]; if (!c) return;
    const a = document.createElement('a'); a.href = clipUrl(c, '&dl=1'); a.download = c.name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  pbList.addEventListener('click', e => {
    const dl = e.target.closest('button[data-dl]');
    if (dl) { downloadClip(+dl.dataset.dl); return; }
    const li = e.target.closest('li[data-i]'); if (li) playClip(+li.dataset.i);
  });
  $('cctvPbDownload').addEventListener('click', () => downloadClip(pbIndex));
  $('cctvPbDownloadAll').addEventListener('click', async () => {
    if (!pbClips.length) return;
    if (!confirm(`ดาวน์โหลดทั้งหมด ${pbClips.length} คลิป? เบราว์เซอร์อาจถามขออนุญาตดาวน์โหลดหลายไฟล์`)) return;
    for (let i = 0; i < pbClips.length; i++) { downloadClip(i); await new Promise(r => setTimeout(r, 600)); }
  });
  pbLoad.addEventListener('click', loadPlayback);
  $('cctvPbPrev').addEventListener('click', () => playClip(pbIndex - 1));
  $('cctvPbNext').addEventListener('click', () => playClip(pbIndex + 1));

  document.querySelectorAll('[data-quick]').forEach(btn => btn.addEventListener('click', () => {
    const now = new Date(), q = btn.dataset.quick;
    const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const tstr = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (q === 'hour') {
      const from = new Date(now.getTime() - 3600 * 1000);
      pbDate.value = dstr(now); pbFrom.value = dstr(from) !== dstr(now) ? '00:00' : tstr(from); pbTo.value = tstr(now);
    } else {
      const d = new Date(now); if (q === 'yesterday') d.setDate(d.getDate() - 1);
      pbDate.value = dstr(d); pbFrom.value = '00:00'; pbTo.value = '23:59';
    }
    loadPlayback();
  }));

  // ================= แท็บ =================
  const tabLive = $('cctvTabLive'), tabPb = $('cctvTabPb'), liveView = $('cctvLiveView'), pbView = $('cctvPbView');
  function showTab(name) {
    const pb = name === 'pb';
    liveView.hidden = pb; pbView.hidden = !pb;
    tabLive.classList.toggle('active', !pb); tabPb.classList.toggle('active', pb);
    if (pb) { img.removeAttribute('src'); clearInterval(statusTimer); if (connected && !pbClips.length) loadPlayback(); }
    else { pbVideo.pause(); if (base) { pollStatus(); statusTimer = setInterval(pollStatus, 3000); connected = false; } }
  }
  tabLive.addEventListener('click', () => showTab('live'));
  tabPb.addEventListener('click', () => showTab('pb'));

  let started = false;
  window.cctvOnPageShow = function () {
    if (started) return;
    started = true;
    if (codeEl.value) connect();
  };
})();
```

- [ ] **Step 3: เพิ่ม CSS ท้าย `css/style.css`**

```css
/* กล้อง CCTV ฝั่งดู: ภาพสดเป็น <img> (MJPEG) */
.cctv-monitor { aspect-ratio: 16/9; }
.cctv-monitor img#cctvLiveImg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; }
.cctv-conn { margin-bottom: 14px; }
```
(`.cctv-monitor` เดิมมี `container-type`/ตัวแปร `--cctv-ar` และกฎ `rot-*` ของวิดีโอ ซึ่งไม่ถูกใช้แล้ว ปล่อยไว้ได้ หากทำให้ภาพเพี้ยน ให้ลบกฎ `.cctv-monitor.rot-*` ออก)

- [ ] **Step 4: ตรวจโค้ดเก่าถูกถอนครบ**

```powershell
Select-String js\cctv.js -Pattern 'getUserMedia|MediaRecorder|showDirectoryPicker|RTCPeerConnection|sbClient' | Measure-Object | % Count
```
Expected: `0`; ตรวจ syntax: `node --check js/cctv.js`; ขยับเลขเวอร์ชันใน `index.html` (`cctv.js?v=23`, `style.css?v=24`) ด้วย `[IO.File]::ReadAllText/WriteAllText` แบบ UTF-8 ไม่มี BOM (ห้ามใช้ `Set-Content`)

- [ ] **Step 5: ตรวจในเบราว์เซอร์** รัน `RRQCCamera.exe --headless --test-source --data-dir <tmp>` (ตั้งพอร์ตและรหัสใน `<tmp>\settings.ini`), สั่ง `preview_start` เว็บ (`wr-static` พอร์ต 5510) เปิด `http://localhost:5510/index.html#cctv` ใส่ `localhost:<port>` กับรหัส กดเชื่อมต่อ Expected: เห็นภาพ (สี่เหลี่ยมขาวเคลื่อนที่ + เวลา), สถานะ "กำลังดูกล้องสด", ไม่มี console error แท็บย้อนหลังเห็นคลิปหลังรอ ~1 นาที เล่นได้ ทดสอบผิดรหัส (ได้ข้อความ "รหัสไม่ถูกต้อง") และปิดโปรแกรมแล้วเห็นข้อความติดต่อไม่ได้ + ลองใหม่เอง ถ่ายภาพหน้าจอเก็บ ลองเปลี่ยนการหมุนเป็น 90° ดูว่าภาพหมุนและเว็บต่อใหม่

- [ ] **Step 6: Commit** (`feat(web): CCTV page is now a viewer for RRQC Camera`) — `git add index.html js/cctv.js css/style.css`

---

### Task 13: เอกสาร ตรวจรับกับกล้องจริง และปิดงาน

**Files:**
- Modify: `README.md`; Create: `tools/camera/README.txt` (วิธีติดตั้ง 5 บรรทัดสำหรับผู้ใช้)

**Acceptance Criteria:**
- `README.md` อัปเดตตารางโครงสร้าง (`tools/camera/`) และวิธีใช้: ดาวน์โหลด ffmpeg วางข้าง exe, `build.bat`, เปิดโปรแกรม, ใส่ที่อยู่/รหัสในหน้าเว็บ, ข้อจำกัด LAN เท่านั้น/HTTP, Firewall
- รันสมบูรณ์: `run-selftest.ps1` ผ่านทั้งหมด, `tests/integration.ps1` พิมพ์ `OK clips=..` และ `OK http`
- ตรวจกับกล้อง EMEET จริง (ถ้าต่ออยู่ที่เครื่องนี้ หรือให้ผู้ใช้ทดสอบแล้วรายงาน): 1080p และ 2K ภาพไม่ขาด สถานะ fps ใกล้ค่าที่ตั้ง ถอดสาย USB แล้วเสียบใหม่ โปรแกรมกู้เองภายใน ~30 วินาที ปิดโปรแกรมแล้ว ffmpeg ไม่ค้าง
- ผู้ใช้เห็นภาพสดบนมือถือผ่าน Wi-Fi เดียวกัน (ยืนยันจากผู้ใช้)

- [ ] **Step 1: อัปเดตเอกสาร** แก้ `README.md` ตามเกณฑ์ (เขียนด้วย Write/Edit) และสร้าง `tools/camera/README.txt` สั้นๆ ภาษาไทย (วาง ffmpeg.exe ข้าง RRQCCamera.exe, ดับเบิลคลิกเปิด, ติ๊กเปิดพร้อมวินโดวส์, อนุญาต Firewall ครั้งแรก, ที่อยู่/รหัสอยู่ในหน้าต่างโปรแกรม)
- [ ] **Step 2: รันชุดทดสอบทั้งหมดอีกครั้ง** (`run-selftest.ps1`, `tests/integration.ps1`) แล้วแปะผลลัพธ์จริง
- [ ] **Step 3: ตรวจกับกล้องจริง** ตามเกณฑ์ ถ้าไม่มีกล้องบนเครื่องนี้ ให้บอกผู้ใช้ชัดเจนว่า "ยังไม่ได้ตรวจกับกล้องจริง" พร้อมรายการที่ผู้ใช้ต้องลอง (720p/1080p/2K, ถอดสาย, ดูจากมือถือ) อย่ารายงานว่าเสร็จสมบูรณ์โดยไม่ได้ตรวจ
- [ ] **Step 4: ตรวจรอบสุดท้าย** `git status` สะอาด (ไม่มี `ffmpeg.exe`, `RRQCCamera.exe`, `app.ico` ถูก stage), `git log --oneline` แสดง commit ของแต่ละ Task
- [ ] **Step 5: Commit เอกสาร** (`docs: document RRQC Camera program`) **ไม่ push** แจ้งผู้ใช้ว่า commit เสร็จ ถ้าต้องการอัปขึ้น GitHub ให้สั่ง (ข้อเตือนเดิม: repo เป็น Public)

---

## ตารางครอบคลุมสเปก

| ข้อกำหนดในสเปก | Task |
|---|---|
| 1 เป้าหมาย: โปรแกรมเปิดกล้อง/ตรวจ/บันทึก, เว็บดูอย่างเดียว, ใช้กับ 1080p/2K | 1, 8, 9, 11, 12 |
| 2 ขอบเขต (exe+ffmpeg, HTTP LAN, แก้เว็บ) | 2–12 |
| 3.1 ffmpeg 1 process 2 เอาต์พุต, MJPEG+fallback, หมุน, ฝังเวลา, กู้เมื่อค้าง | 1, 8 |
| 3.2 ตรวจ motion/เก็บท่อน/pre-roll/cooldown/ย้ายเป็น motion_*.mp4/ล้างตอนเริ่ม | 4, 5, 6, 9 |
| 3.3 เซิร์ฟเวอร์ TcpListener, เส้นทางทั้งหมด, รหัส, rate limit, path traversal, จำกัดการเชื่อมต่อ/header, CORS | 7, 10 |
| 3.4 หน้าต่าง/ตั้งค่า/รหัส-ที่อยู่/ถาด/เปิดพร้อมวินโดวส์/single instance/log/ลบคลิปเก่า | 3, 9, 11 |
| 3.5 ที่อยู่และการจัดการ ffmpeg (ไม่ commit, ตรวจ SHA-256, ข้อความเมื่อไม่พบ) | 1, 11 |
| 4 หน้าเว็บฝั่งดู (ลบโค้ดเก่า, สด/ย้อนหลัง/หมุน, ข้อความผิดพลาด, ข้อจำกัด https) | 12 |
| 5 ข้อมูลเดิม (.webm ยังแสดง, ตั้งค่าใหม่ในโปรแกรม) | 4 (`ClipNames` รับ webm), 5 (`ClipStore.List`), 13 |
| 6 การทดสอบ/ตรวจรับ (test source, อัตโนมัติ, กล้องจริง, เบราว์เซอร์) | 2, 8, 9, 10, 12, 13 |
| 7 ความเสี่ยงและทางออก | 8 (ถอยโหมดดิบ), 11 (แสดง fps), 10/13 (Firewall), 5/9 (ลบคลิปอัตโนมัติ) |
| ตัดสินใจร่วมกับผู้ใช้: แยก exe, ไม่ push, ขออนุญาตก่อนดาวน์โหลด ffmpeg | Global Constraints, 1, 13 |

**ข้อที่ตัดสินโดยไม่ถามผู้ใช้เพิ่ม (แจ้งตอนส่งมอบ):** เวลาพักท่อน 10 วินาที, `crf 26` (ปรับผ่านโค้ดได้), ดูสดที่ 10 fps/กว้างไม่เกิน 1280, ไม่มีตัวเลือก TLS (ตามสเปก 7)
