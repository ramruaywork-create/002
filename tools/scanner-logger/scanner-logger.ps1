# RRQC Scanner Logger
# Runs in the background on Windows and records every barcode-scanner scan (codes starting with TH or SPX),
# no matter which program is in front. It does NOT store normal typing: only fast bursts of keys that end with
# Enter/Tab and start with TH/SPX are kept, everything else is discarded immediately in memory.
# Each scan is sent to Supabase (table scan_log) and also appended to scan-backup.csv next to this script.
# ASCII only on purpose (Windows PowerShell 5.1 reads files without BOM as ANSI).

$SupabaseUrl = 'https://dsekvvygczrvvwnnrkuy.supabase.co'
$SupabaseKey = 'sb_publishable_boz7aOGbmjTHyPwsKhJl0Q_W41e5RXl'
$BackupFile  = Join-Path $PSScriptRoot 'scan-backup.csv'

$mutex = New-Object System.Threading.Mutex($false, 'Global\RRQC_ScannerLogger')
if (-not $mutex.WaitOne(0)) { exit }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$cs = @'
using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

public static class ScanHook
{
    const int WH_KEYBOARD_LL = 13, WM_KEYDOWN = 0x100, WM_SYSKEYDOWN = 0x104;
    const double MAX_GAP_MS = 80, MAX_AVG_GAP_MS = 50, IDLE_FLUSH_MS = 120;
    const int MIN_LEN = 4;

    delegate IntPtr HookProc(int n, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc p, IntPtr h, uint t);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int n, IntPtr w, IntPtr l);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string n);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int k);
    [DllImport("user32.dll")] static extern short GetKeyState(int k);
    [DllImport("user32.dll")] static extern int ToUnicodeEx(uint vk, uint sc, byte[] ks, [Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder buf, int cch, uint flags, IntPtr hkl);
    [DllImport("user32.dll")] static extern IntPtr LoadKeyboardLayout(string id, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);

    [StructLayout(LayoutKind.Sequential)]
    struct KBD { public uint vk, sc, flags, time; public IntPtr extra; }

    class Scan { public string Code; public DateTime Utc; public uint Pid; }

    static readonly Regex Prefix = new Regex("^(th|spx)", RegexOptions.IgnoreCase);
    static readonly object Sync = new object();
    static readonly ConcurrentQueue<Scan> Queue = new ConcurrentQueue<Scan>();
    static readonly StringBuilder Buf = new StringBuilder();
    static double firstT, lastT;
    static uint bufPid;
    static HookProc proc;
    static IntPtr usLayout;
    static string url, key, backup;
    public static int Sent, Failed;

    static double Now() { return Stopwatch.GetTimestamp() * 1000.0 / Stopwatch.Frequency; }

    // set env var RRQC_SCAN_DEBUG=<file> to trace why a scan was accepted or rejected (never logs anything else)
    static void Dbg(string m)
    {
        string f = Environment.GetEnvironmentVariable("RRQC_SCAN_DEBUG");
        if (string.IsNullOrEmpty(f)) return;
        try { File.AppendAllText(f, m + "\r\n"); } catch { }
    }

    public static void Start(string supabaseUrl, string apiKey, string backupFile)
    {
        url = supabaseUrl; key = apiKey; backup = backupFile;
        ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2
        usLayout = LoadKeyboardLayout("00000409", 0); // map keys as US English so a Thai layout does not garble codes
        proc = Callback;
        SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(null), 0);
        new Thread(IdleLoop) { IsBackground = true }.Start();
        new Thread(SendLoop) { IsBackground = true }.Start();
    }

    static IntPtr Callback(int n, IntPtr w, IntPtr l)
    {
        if (n >= 0 && ((int)w == WM_KEYDOWN || (int)w == WM_SYSKEYDOWN))
        {
            try { OnKey((KBD)Marshal.PtrToStructure(l, typeof(KBD))); } catch { }
        }
        return CallNextHookEx(IntPtr.Zero, n, w, l);
    }

    static void OnKey(KBD k)
    {
        if (k.vk == 0x0D || k.vk == 0x09) { Commit(); return; }              // Enter / Tab end a scan
        if ((GetAsyncKeyState(0x11) & 0x8000) != 0 || (GetAsyncKeyState(0x12) & 0x8000) != 0) return; // Ctrl/Alt

        byte[] ks = new byte[256];
        if ((GetAsyncKeyState(0x10) & 0x8000) != 0) ks[0x10] = 0x80;
        if ((GetKeyState(0x14) & 1) != 0) ks[0x14] = 1;
        StringBuilder sb = new StringBuilder(4);
        if (ToUnicodeEx(k.vk, k.sc, ks, sb, 4, 4, usLayout) != 1) return;   // not a printable character
        char c = sb[0];
        if (c < 32) return;

        double t = Now();
        lock (Sync)
        {
            if (Buf.Length > 0 && t - lastT > MAX_GAP_MS) Buf.Clear();      // slow = human typing, discard
            if (Buf.Length == 0) { firstT = t; uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); bufPid = pid; }
            Buf.Append(c);
            lastT = t;
        }
    }

    static void Commit()
    {
        string code; double f, l; uint pid;
        lock (Sync)
        {
            code = Buf.ToString(); f = firstT; l = lastT; pid = bufPid;
            Buf.Clear();
        }
        if (code.Length < MIN_LEN) { Dbg("short: " + code); return; }
        double avg = (l - f) / (code.Length - 1);
        if (avg > MAX_AVG_GAP_MS) { Dbg("too slow avg=" + avg.ToString("F1") + " " + code); return; }
        if (!Prefix.IsMatch(code)) { Dbg("prefix no: " + code); return; }
        Dbg("accepted avg=" + avg.ToString("F1") + " " + code);
        Queue.Enqueue(new Scan { Code = code, Utc = DateTime.UtcNow, Pid = pid });
    }

    static void IdleLoop()   // scanners that send no Enter: finish after a short silence
    {
        while (true)
        {
            Thread.Sleep(40);
            bool due;
            lock (Sync) { due = Buf.Length >= 8 && Now() - lastT > IDLE_FLUSH_MS; }
            if (due) Commit();
        }
    }

    static string AppName(uint pid)
    {
        try { return Process.GetProcessById((int)pid).ProcessName; } catch { return "unknown"; }
    }

    static string Esc(string s) { return s.Replace("\\", "\\\\").Replace("\"", "\\\""); }

    static void SendLoop()
    {
        while (true)
        {
            Scan s;
            if (!Queue.TryPeek(out s)) { Thread.Sleep(200); continue; }
            string app = AppName(s.Pid);
            try { File.AppendAllText(backup, s.Utc.ToString("o") + "," + s.Code.Replace(",", " ") + "," + app + "\r\n", Encoding.UTF8); } catch { }
            string json = "[{\"code\":\"" + Esc(s.Code) + "\",\"kind\":\"scanned\",\"page\":\"app:" + Esc(app) + "\",\"input_id\":null,\"created_at\":\"" + s.Utc.ToString("o") + "\"}]";
            try
            {
                HttpWebRequest r = (HttpWebRequest)WebRequest.Create(url + "/rest/v1/scan_log");
                r.Method = "POST"; r.ContentType = "application/json"; r.Timeout = 10000;
                r.Headers["apikey"] = key; r.Headers["Authorization"] = "Bearer " + key; r.Headers["Prefer"] = "return=minimal";
                byte[] body = Encoding.UTF8.GetBytes(json);
                using (Stream st = r.GetRequestStream()) st.Write(body, 0, body.Length);
                using (r.GetResponse()) { }
                Scan done; Queue.TryDequeue(out done); Sent++;
            }
            catch { Failed++; Thread.Sleep(5000); }   // offline: keep the scan in the queue and retry
        }
    }
}
'@

Add-Type -TypeDefinition $cs
[ScanHook]::Start($SupabaseUrl, $SupabaseKey, $BackupFile)

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$status = $menu.Items.Add('RRQC Scanner Logger is running')
$status.Enabled = $false
$exit = $menu.Items.Add('Exit')
$exit.Add_Click({ [System.Windows.Forms.Application]::Exit() })

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = [System.Drawing.SystemIcons]::Information
$tray.Text = 'RRQC Scanner Logger (TH/SPX)'
$tray.ContextMenuStrip = $menu
$tray.Visible = $true

[System.Windows.Forms.Application]::Run()
$tray.Visible = $false
$tray.Dispose()
