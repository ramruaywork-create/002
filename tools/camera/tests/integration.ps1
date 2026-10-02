$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$exe = Join-Path $here 'RRQCCamera.exe'; $ff = Join-Path $here 'ffmpeg.exe'
if (-not (Test-Path $ff)) { throw 'ffmpeg.exe must be next to RRQCCamera.exe (Task 1)' }
$thai = -join ([char]0x0E04, [char]0x0E25, [char]0x0E34, [char]0x0E1B)     # Thai word for "clip": proves the clip folder may contain Thai
$root = Join-Path $env:TEMP ('rrqc-int-' + [guid]::NewGuid().ToString('N')); $data = "$root\data"; $clips = "$root\$thai"
New-Item -ItemType Directory $data, $clips | Out-Null
$code = 'abcd2345'; $port = 18788
[IO.File]::WriteAllLines("$data\settings.ini", @('width=640', 'height=360', 'fps=10', 'cooldownms=3000', "clipdir=$clips", "port=$port", "code=$code", 'retentiondays=0'), (New-Object Text.UTF8Encoding($false)))
$p = Start-Process $exe -ArgumentList '--headless', '--test-source', '--data-dir', "`"$data`"" -PassThru
try {
  Start-Sleep 110
  $files = @(Get-ChildItem $clips -Filter 'motion_*.mp4' | Sort-Object Name)
  if ($files.Count -lt 2) { throw "expected at least 2 clips but found $($files.Count)" }
  # test source moves for 6s every 40s, so some 10s segments must have been dropped: there must be a gap between consecutive clips
  $times = $files | ForEach-Object { [datetime]::ParseExact(($_.Name -replace '^motion_|\.mp4$', ''), 'yyyy-MM-dd_HH-mm-ss', $null) }
  $gap = $false; for ($i = 1; $i -lt $times.Count; $i++) { if (($times[$i] - $times[$i - 1]).TotalSeconds -gt 15) { $gap = $true } }
  if (-not $gap) { throw "no gap between clips: motionless segments were not dropped ($($files.Name -join ', '))" }
  foreach ($f in $files) {
    if ($f.Name -notmatch '^motion_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.mp4$') { throw "bad clip name: $($f.Name)" }
    $err = & $ff -v error -i $f.FullName -f null - 2>&1
    if ($err) { throw "broken clip $($f.Name): $err" }
  }
  $old = @(Get-ChildItem "$data\buffer" -Filter 'seg_*.mp4' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddSeconds(-40) })
  if ($old.Count -gt 0) { throw "stale buffer segments older than 40s: $($old.Name -join ',')" }
  "OK clips=$($files.Count): $($files.Name -join ', ')"
  # ---- HTTP section (added in Task 10) ----
} finally {
  if ($p -and -not $p.HasExited) { $p.Kill() }
  Get-Process ffmpeg -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $ff } | Stop-Process -Force
  Start-Sleep 1; Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
}
