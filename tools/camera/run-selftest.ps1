$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:NOPAUSE = '1'
cmd /c "`"$here\build.bat`""
if ($LASTEXITCODE -ne 0) { Write-Host 'BUILD FAILED'; exit 2 }
$out = Join-Path $env:TEMP 'rrqc-camera-selftest.txt'
Remove-Item $out -ErrorAction SilentlyContinue
$p = Start-Process "$here\RRQCCamera.exe" -ArgumentList '--selftest', "`"$out`"" -Wait -PassThru
if (Test-Path $out) { Get-Content $out } else { Write-Host 'selftest did not write a result file' }
exit $p.ExitCode
