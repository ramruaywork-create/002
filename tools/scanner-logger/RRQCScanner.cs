// RRQC Scanner Logger - background program that records every barcode-scanner scan
// (codes that start with the configured prefixes, default TH and SPX) no matter which program is in front.
// Only fast bursts of keys ending with Enter/Tab are kept; normal typing is discarded immediately in memory.
// Written in C# 5 so it compiles with the csc.exe that ships with Windows (see build.bat).

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

enum ScanState { Pending, Sent }

class ScanItem
{
    public DateTime Utc;
    public string Code;
    public string App;
    public ScanState State;
    public bool BackedUp;
    public ListViewItem Row;
}

static class Cfg
{
    public const string Url = "https://dsekvvygczrvvwnnrkuy.supabase.co";
    public const string Key = "sb_publishable_boz7aOGbmjTHyPwsKhJl0Q_W41e5RXl";
    public static readonly string Dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "RRQC-Scanner");
    public static string SettingsFile { get { return Path.Combine(Dir, "settings.ini"); } }
    public static string BackupFile { get { return Path.Combine(Dir, "scan-backup.csv"); } }
    public static string PendingFile { get { return Path.Combine(Dir, "pending.txt"); } }
    public static string[] Prefixes = new string[] { "TH", "SPX" };
    public static bool Paused = false;

    public static string[] ParsePrefixes(string s)
    {
        List<string> list = new List<string>();
        foreach (string p in s.Split(new char[] { ',', ';', ' ' }, StringSplitOptions.RemoveEmptyEntries))
            list.Add(p.Trim().ToUpperInvariant());
        if (list.Count == 0) { list.Add("TH"); list.Add("SPX"); }
        return list.ToArray();
    }

    public static void Load()
    {
        try
        {
            Directory.CreateDirectory(Dir);
            if (!File.Exists(SettingsFile)) return;
            foreach (string line in File.ReadAllLines(SettingsFile, Encoding.UTF8))
            {
                int i = line.IndexOf('=');
                if (i < 0) continue;
                string k = line.Substring(0, i).Trim(), v = line.Substring(i + 1).Trim();
                if (k == "prefixes") Prefixes = ParsePrefixes(v);
                if (k == "paused") Paused = (v == "1");
            }
        }
        catch { }
    }

    public static void Save()
    {
        try
        {
            Directory.CreateDirectory(Dir);
            File.WriteAllLines(SettingsFile, new string[] { "prefixes=" + string.Join(",", Prefixes), "paused=" + (Paused ? "1" : "0") }, Encoding.UTF8);
        }
        catch { }
    }
}

static class Engine
{
    const int WH_KEYBOARD_LL = 13, WM_KEYDOWN = 0x100, WM_SYSKEYDOWN = 0x104;
    const double MAX_GAP_MS = 80, MAX_AVG_GAP_MS = 50, IDLE_FLUSH_MS = 120;
    const int MIN_LEN = 4;

    delegate IntPtr HookProc(int n, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc p, IntPtr h, uint t);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr h);
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

    static readonly object Sync = new object();
    static readonly StringBuilder Buf = new StringBuilder();
    static double firstT, lastT;
    static uint bufPid;
    static HookProc proc;
    static IntPtr hook, usLayout;
    static readonly List<ScanItem> queue = new List<ScanItem>();

    public static event Action<ScanItem> Captured;
    public static volatile bool Online = true;
    public static int Sent;

    public static int PendingCount { get { lock (queue) { return queue.Count; } } }

    static void Dbg(string m) { if (Environment.GetEnvironmentVariable("RRQC_SCAN_DEBUG") != null) try { File.AppendAllText(Path.Combine(Cfg.Dir, "debug.log"), m + "\r\n"); } catch { } }
    static double Now() { return Stopwatch.GetTimestamp() * 1000.0 / Stopwatch.Frequency; }

    public static void Start()
    {
        ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2
        usLayout = LoadKeyboardLayout("00000409", 0); // read keys as US English so a Thai layout does not garble codes
        proc = Callback;
        hook = SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(null), 0);
        LoadPending();
        new Thread(IdleLoop) { IsBackground = true }.Start();
        new Thread(SendLoop) { IsBackground = true }.Start();
    }

    public static void Stop() { if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook); hook = IntPtr.Zero; }

    static IntPtr Callback(int n, IntPtr w, IntPtr l)
    {
        if (n >= 0 && ((int)w == WM_KEYDOWN || (int)w == WM_SYSKEYDOWN))
        {
            try { OnKey((KBD)Marshal.PtrToStructure(l, typeof(KBD))); } catch (Exception ex) { Dbg("hook err " + ex.Message); }
        }
        return CallNextHookEx(IntPtr.Zero, n, w, l);
    }

    static void OnKey(KBD k)
    {
        if (k.vk == 0x0D || k.vk == 0x09) { Commit(); return; }                  // Enter / Tab end a scan
        if ((GetAsyncKeyState(0x11) & 0x8000) != 0 || (GetAsyncKeyState(0x12) & 0x8000) != 0) return; // Ctrl / Alt

        byte[] ks = new byte[256];
        if ((GetAsyncKeyState(0x10) & 0x8000) != 0) ks[0x10] = 0x80;
        if ((GetKeyState(0x14) & 1) != 0) ks[0x14] = 1;
        StringBuilder sb = new StringBuilder(4);
        if (ToUnicodeEx(k.vk, k.sc, ks, sb, 4, 4, usLayout) != 1) return;       // not a printable character
        char c = sb[0];
        if (c < 32) return;

        Dbg("key " + c);
        double t = Now();
        lock (Sync)
        {
            if (Buf.Length > 0 && t - lastT > MAX_GAP_MS) Buf.Length = 0;       // slow = human typing, discard
            if (Buf.Length == 0)
            {
                firstT = t;
                uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); bufPid = pid;
            }
            Buf.Append(c);
            lastT = t;
        }
    }

    static bool PrefixOk(string code)
    {
        foreach (string p in Cfg.Prefixes)
            if (code.StartsWith(p, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    static void Commit()
    {
        string code; double f, l; uint pid;
        lock (Sync)
        {
            code = Buf.ToString(); f = firstT; l = lastT; pid = bufPid;
            Buf.Length = 0;
        }
        Dbg("commit [" + code + "] gap " + (code.Length > 1 ? (l - f) / (code.Length - 1) : 0));
        if (Cfg.Paused || code.Length < MIN_LEN) return;
        if ((l - f) / (code.Length - 1) > MAX_AVG_GAP_MS) return;
        if (!PrefixOk(code)) return;

        string app = "unknown";
        try { app = Process.GetProcessById((int)pid).ProcessName; } catch { }
        ScanItem s = new ScanItem { Utc = DateTime.UtcNow, Code = code, App = app, State = ScanState.Pending };
        lock (queue) { queue.Add(s); SavePending(); }
        Action<ScanItem> h = Captured;
        if (h != null) h(s);
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

    // ---- offline queue kept on disk so nothing is lost if the program closes before sending ----
    static void SavePending()
    {
        try
        {
            List<string> lines = new List<string>();
            foreach (ScanItem s in queue) lines.Add(s.Utc.ToString("o") + "|" + s.Code.Replace("|", " ") + "|" + s.App);
            File.WriteAllLines(Cfg.PendingFile, lines.ToArray(), Encoding.UTF8);
        }
        catch { }
    }

    static void LoadPending()
    {
        try
        {
            if (!File.Exists(Cfg.PendingFile)) return;
            foreach (string line in File.ReadAllLines(Cfg.PendingFile, Encoding.UTF8))
            {
                string[] p = line.Split('|');
                if (p.Length < 3) continue;
                DateTime utc;
                if (!DateTime.TryParse(p[0], null, System.Globalization.DateTimeStyles.RoundtripKind, out utc)) continue;
                ScanItem s = new ScanItem { Utc = utc.ToUniversalTime(), Code = p[1], App = p[2], State = ScanState.Pending, BackedUp = true };
                queue.Add(s);
            }
        }
        catch { }
    }

    public static List<ScanItem> SnapshotPending() { lock (queue) { return new List<ScanItem>(queue); } }

    static string Esc(string s) { return s.Replace("\\", "\\\\").Replace("\"", "\\\""); }

    static void SendLoop()
    {
        while (true)
        {
            ScanItem s = null;
            lock (queue) { if (queue.Count > 0) s = queue[0]; }
            if (s == null) { Thread.Sleep(200); continue; }

            if (!s.BackedUp)
            {
                try { File.AppendAllText(Cfg.BackupFile, s.Utc.ToString("o") + "," + s.Code.Replace(",", " ") + "," + s.App + "\r\n", Encoding.UTF8); } catch { }
                s.BackedUp = true;
            }

            string json = "[{\"code\":\"" + Esc(s.Code) + "\",\"kind\":\"scanned\",\"page\":\"app:" + Esc(s.App) + "\",\"input_id\":null,\"created_at\":\"" + s.Utc.ToString("o") + "\"}]";
            try
            {
                HttpWebRequest r = (HttpWebRequest)WebRequest.Create(Cfg.Url + "/rest/v1/scan_log");
                r.Method = "POST"; r.ContentType = "application/json"; r.Timeout = 10000;
                r.Headers["apikey"] = Cfg.Key; r.Headers["Authorization"] = "Bearer " + Cfg.Key; r.Headers["Prefer"] = "return=minimal";
                byte[] body = Encoding.UTF8.GetBytes(json);
                using (Stream st = r.GetRequestStream()) st.Write(body, 0, body.Length);
                using (r.GetResponse()) { }
                lock (queue) { queue.Remove(s); SavePending(); }
                s.State = ScanState.Sent;
                Interlocked.Increment(ref Sent);
                Online = true;
            }
            catch { Online = false; Thread.Sleep(5000); }   // offline: keep in queue and retry
        }
    }
}

static class Art
{
    // App icon: purple gradient rounded square with white barcode bars and a red scan line
    public static Bitmap Icon(int size)
    {
        Bitmap bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float pad = size * 0.04f, r = size * 0.22f, s = size - pad * 2;
            using (GraphicsPath path = new GraphicsPath())
            {
                path.AddArc(pad, pad, r, r, 180, 90);
                path.AddArc(pad + s - r, pad, r, r, 270, 90);
                path.AddArc(pad + s - r, pad + s - r, r, r, 0, 90);
                path.AddArc(pad, pad + s - r, r, r, 90, 90);
                path.CloseFigure();
                using (LinearGradientBrush br = new LinearGradientBrush(new PointF(0, 0), new PointF(size, size), Color.FromArgb(94, 114, 228), Color.FromArgb(130, 94, 228)))
                    g.FillPath(br, path);
            }
            float[] widths = { 0.07f, 0.04f, 0.10f, 0.04f, 0.06f, 0.09f, 0.04f, 0.07f };
            float x = size * 0.20f, top = size * 0.24f, h = size * 0.52f;
            using (Brush white = new SolidBrush(Color.White))
            {
                bool bar = true;
                foreach (float w in widths)
                {
                    float wd = size * w;
                    if (bar) g.FillRectangle(white, x, top, wd, h);
                    x += wd + size * 0.025f;
                    bar = !bar;
                    if (bar == false && wd < 0) break;
                }
            }
            using (Pen red = new Pen(Color.FromArgb(255, 77, 77), Math.Max(2f, size * 0.045f)))
                g.DrawLine(red, size * 0.13f, size * 0.50f, size * 0.87f, size * 0.50f);
        }
        return bmp;
    }

    public static Icon AsIcon(int size)
    {
        using (Bitmap b = Icon(size)) { return System.Drawing.Icon.FromHandle(b.GetHicon()); }
    }

    public static void WriteIcoFile(string path)
    {
        byte[] png;
        using (Bitmap b = Icon(256)) using (MemoryStream ms = new MemoryStream()) { b.Save(ms, ImageFormat.Png); png = ms.ToArray(); }
        using (FileStream fs = new FileStream(path, FileMode.Create))
        using (BinaryWriter w = new BinaryWriter(fs))
        {
            w.Write((short)0); w.Write((short)1); w.Write((short)1);       // ICONDIR
            w.Write((byte)0); w.Write((byte)0); w.Write((byte)0); w.Write((byte)0);
            w.Write((short)1); w.Write((short)32); w.Write(png.Length); w.Write(22);
            w.Write(png);
        }
    }
}

class MainForm : Form
{
    static readonly Color Ink = Color.FromArgb(50, 50, 93), Purple = Color.FromArgb(94, 114, 228), Muted = Color.FromArgb(136, 152, 170);
    static readonly Color Green = Color.FromArgb(28, 138, 95), Orange = Color.FromArgb(214, 106, 34), Red = Color.FromArgb(196, 31, 66);
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

    bool startHidden, reallyExit;
    NotifyIcon tray;
    Label pill, cardToday, cardSent, cardWait;
    ListView list;
    TextBox prefixBox;
    CheckBox startupBox;
    Button pauseBtn;
    ToolStripMenuItem pauseItem;
    int today;
    readonly List<ScanItem> shown = new List<ScanItem>();

    public MainForm(bool hidden)
    {
        startHidden = hidden;
        Text = "RRQC Scanner Logger";
        Font = new Font("Segoe UI", 9.5f);
        ClientSize = new Size(760, 600);
        MinimumSize = new Size(640, 520);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(246, 247, 251);
        Icon = Art.AsIcon(32);
        BuildUi();
        BuildTray();

        Engine.Captured += OnCaptured;
        LoadToday();
        LoadRecent();
        foreach (ScanItem s in Engine.SnapshotPending()) AddRow(s, false);

        System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
        t.Interval = 800;
        t.Tick += delegate { RefreshUi(); };
        t.Start();
        RefreshUi();
    }

    protected override void SetVisibleCore(bool value)
    {
        if (startHidden) { value = false; if (!IsHandleCreated) CreateControl(); }
        base.SetVisibleCore(value);
    }

    void ShowWindow()
    {
        startHidden = false;
        Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!reallyExit && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
            tray.ShowBalloonTip(2500, "RRQC Scanner Logger", "ยังทำงานอยู่ที่ถาดระบบ (คลิกขวาที่ไอคอนเพื่อออกจากโปรแกรม)", ToolTipIcon.Info);
            return;
        }
        base.OnFormClosing(e);
    }

    void ExitApp()
    {
        reallyExit = true;
        tray.Visible = false;
        Engine.Stop();
        Application.Exit();
    }

    void BuildTray()
    {
        tray = new NotifyIcon();
        tray.Icon = Art.AsIcon(32);
        tray.Text = "RRQC Scanner Logger";
        ContextMenuStrip menu = new ContextMenuStrip();
        menu.Items.Add("เปิดหน้าต่าง", null, delegate { ShowWindow(); });
        pauseItem = new ToolStripMenuItem("หยุดชั่วคราว", null, delegate { TogglePause(); });
        menu.Items.Add(pauseItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("ออกจากโปรแกรม", null, delegate { ExitApp(); });
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += delegate { ShowWindow(); };
        tray.Visible = true;
    }

    Label MakeLabel(string text, float size, FontStyle style, Color color)
    {
        Label l = new Label();
        l.Text = text; l.AutoSize = true; l.ForeColor = color; l.BackColor = Color.Transparent;
        l.Font = new Font("Segoe UI", size, style);
        return l;
    }

    Panel Card(string title, out Label value, Color valueColor)
    {
        Panel p = new Panel();
        p.BackColor = Color.White; p.Dock = DockStyle.Fill; p.Margin = new Padding(0, 0, 10, 0);
        p.Paint += delegate(object o, PaintEventArgs e) { using (Pen pen = new Pen(Color.FromArgb(226, 230, 240))) e.Graphics.DrawRectangle(pen, 0, 0, p.Width - 1, p.Height - 1); };
        Label t = MakeLabel(title, 9f, FontStyle.Regular, Muted); t.Location = new Point(14, 10);
        value = MakeLabel("0", 22f, FontStyle.Bold, valueColor); value.Location = new Point(12, 30);
        p.Controls.Add(t); p.Controls.Add(value);
        return p;
    }

    void BuildUi()
    {
        TableLayoutPanel root = new TableLayoutPanel();
        root.Dock = DockStyle.Fill; root.ColumnCount = 1; root.RowCount = 4; root.Padding = new Padding(0);
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 92));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 92));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 118));
        Controls.Add(root);

        // header
        Panel header = new Panel(); header.Dock = DockStyle.Fill; header.Margin = new Padding(0);
        header.Paint += delegate(object o, PaintEventArgs e)
        {
            using (LinearGradientBrush br = new LinearGradientBrush(header.ClientRectangle, Color.FromArgb(50, 50, 93), Color.FromArgb(94, 114, 228), 0f))
                e.Graphics.FillRectangle(br, header.ClientRectangle);
            using (Bitmap ico = Art.Icon(56)) e.Graphics.DrawImage(ico, 22, 18, 56, 56);
        };
        Label title = MakeLabel("RRQC Scanner Logger", 16f, FontStyle.Bold, Color.White); title.Location = new Point(92, 16);
        Label sub = MakeLabel("บันทึกทุกครั้งที่ยิงเครื่องสแกน ไม่ว่าจะอยู่โปรแกรมไหน", 9.5f, FontStyle.Regular, Color.FromArgb(220, 226, 250)); sub.Location = new Point(94, 50);
        pill = new Label(); pill.AutoSize = false; pill.Size = new Size(210, 30); pill.TextAlign = ContentAlignment.MiddleCenter;
        pill.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold); header.Resize += delegate { pill.Location = new Point(header.Width - pill.Width - 22, 31); header.Invalidate(); };
        header.Controls.Add(title); header.Controls.Add(sub); header.Controls.Add(pill);
        root.Controls.Add(header, 0, 0);

        // stat cards
        TableLayoutPanel stats = new TableLayoutPanel();
        stats.Dock = DockStyle.Fill; stats.ColumnCount = 3; stats.RowCount = 1; stats.Padding = new Padding(16, 14, 6, 6); stats.Margin = new Padding(0);
        for (int i = 0; i < 3; i++) stats.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.33f));
        stats.Controls.Add(Card("ยิงวันนี้", out cardToday, Ink), 0, 0);
        stats.Controls.Add(Card("ส่งขึ้นระบบแล้ว (ตั้งแต่เปิดโปรแกรม)", out cardSent, Green), 1, 0);
        stats.Controls.Add(Card("รอส่ง", out cardWait, Orange), 2, 0);
        root.Controls.Add(stats, 0, 1);

        // list
        list = new ListView();
        list.Dock = DockStyle.Fill; list.View = View.Details; list.FullRowSelect = true; list.GridLines = false;
        list.BorderStyle = BorderStyle.None; list.HeaderStyle = ColumnHeaderStyle.Nonclickable; list.Margin = new Padding(16, 6, 16, 6);
        list.Columns.Add("เวลา", 150); list.Columns.Add("รหัสที่ยิง", 230); list.Columns.Add("โปรแกรมที่ยิงอยู่", 170); list.Columns.Add("สถานะ", 110);
        typeof(Control).GetProperty("DoubleBuffered", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).SetValue(list, true, null);
        Panel listWrap = new Panel(); listWrap.Dock = DockStyle.Fill; listWrap.Padding = new Padding(16, 6, 16, 0); listWrap.Margin = new Padding(0);
        listWrap.Controls.Add(list);
        root.Controls.Add(listWrap, 0, 2);

        // controls
        Panel bottom = new Panel(); bottom.Dock = DockStyle.Fill; bottom.Margin = new Padding(0);
        Label pl = MakeLabel("บันทึกเฉพาะรหัสที่ขึ้นต้นด้วย (คั่นด้วยจุลภาค เช่น TH, SPX)", 9f, FontStyle.Regular, Muted); pl.Location = new Point(18, 12);
        prefixBox = new TextBox(); prefixBox.Location = new Point(20, 34); prefixBox.Width = 220; prefixBox.Text = string.Join(", ", Cfg.Prefixes);
        Button saveBtn = new Button(); saveBtn.Text = "บันทึก"; saveBtn.Location = new Point(248, 32); saveBtn.Size = new Size(76, 28);
        saveBtn.Click += delegate { Cfg.Prefixes = Cfg.ParsePrefixes(prefixBox.Text); prefixBox.Text = string.Join(", ", Cfg.Prefixes); Cfg.Save(); };
        startupBox = new CheckBox(); startupBox.Text = "เปิดโปรแกรมอัตโนมัติพร้อมวินโดวส์"; startupBox.AutoSize = true; startupBox.Location = new Point(20, 76);
        startupBox.Checked = IsStartupOn();
        startupBox.CheckedChanged += delegate { SetStartup(startupBox.Checked); };
        pauseBtn = new Button(); pauseBtn.Size = new Size(130, 32);        pauseBtn.Click += delegate { TogglePause(); };
        Button hideBtn = new Button(); hideBtn.Text = "ซ่อนไปที่ถาดระบบ"; hideBtn.Size = new Size(150, 32); bottom.Resize += delegate { hideBtn.Location = new Point(bottom.Width - hideBtn.Width - 22, 72); pauseBtn.Location = new Point(hideBtn.Left - pauseBtn.Width - 10, 72); };
        hideBtn.Click += delegate { Close(); };
        bottom.Controls.AddRange(new Control[] { pl, prefixBox, saveBtn, startupBox, pauseBtn, hideBtn });
        root.Controls.Add(bottom, 0, 3);
    }

    bool IsStartupOn()
    {
        try { using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey)) return k != null && k.GetValue("RRQCScanner") != null; } catch { return false; }
    }

    void SetStartup(bool on)
    {
        try
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey, true))
            {
                if (on) k.SetValue("RRQCScanner", "\"" + Application.ExecutablePath + "\" --tray");
                else k.DeleteValue("RRQCScanner", false);
            }
        }
        catch (Exception ex) { MessageBox.Show("ตั้งค่าเปิดอัตโนมัติไม่สำเร็จ: " + ex.Message); }
    }

    void TogglePause() { Cfg.Paused = !Cfg.Paused; Cfg.Save(); RefreshUi(); }

    void LoadToday()
    {
        try
        {
            if (!File.Exists(Cfg.BackupFile)) return;
            foreach (string line in File.ReadAllLines(Cfg.BackupFile, Encoding.UTF8))
            {
                int i = line.IndexOf(',');
                DateTime utc;
                if (i > 0 && DateTime.TryParse(line.Substring(0, i), null, System.Globalization.DateTimeStyles.RoundtripKind, out utc) && utc.ToLocalTime().Date == DateTime.Today) today++;
            }
        }
        catch { }
    }

    void LoadRecent()   // show the last scans from the local backup log as already sent
    {
        try
        {
            if (!File.Exists(Cfg.BackupFile)) return;
            string[] lines = File.ReadAllLines(Cfg.BackupFile, Encoding.UTF8);
            for (int i = Math.Max(0, lines.Length - 50); i < lines.Length; i++)
            {
                string[] p = lines[i].Split(new char[] { ',' }, 3);
                DateTime utc;
                if (p.Length < 3 || !DateTime.TryParse(p[0], null, System.Globalization.DateTimeStyles.RoundtripKind, out utc)) continue;
                ScanItem s = new ScanItem { Utc = utc.ToUniversalTime(), Code = p[1], App = p[2], State = ScanState.Sent, BackedUp = true };
                AddRow(s, false);
            }
        }
        catch { }
    }

    void OnCaptured(ScanItem s)
    {
        if (IsDisposed) return;
        BeginInvoke(new Action(delegate { today++; AddRow(s, true); RefreshUi(); }));
    }

    void AddRow(ScanItem s, bool fresh)
    {
        ListViewItem row = new ListViewItem(new string[] { s.Utc.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss"), s.Code, s.App, "รอส่ง" });
        s.Row = row;
        list.Items.Insert(0, row);
        shown.Insert(0, s);
        while (list.Items.Count > 300) { list.Items.RemoveAt(list.Items.Count - 1); shown.RemoveAt(shown.Count - 1); }
    }

    void RefreshUi()
    {
        foreach (ScanItem s in shown)
        {
            if (s.Row == null) continue;
            string text = s.State == ScanState.Sent ? "ส่งแล้ว ✓" : "รอส่ง";
            if (s.Row.SubItems[3].Text != text) { s.Row.SubItems[3].Text = text; s.Row.ForeColor = s.State == ScanState.Sent ? Green : Orange; }
        }
        int wait = Engine.PendingCount;
        cardToday.Text = today.ToString();
        cardSent.Text = Engine.Sent.ToString();
        cardWait.Text = wait.ToString();

        string txt; Color bg, fg;
        if (Cfg.Paused) { txt = "● หยุดชั่วคราว"; bg = Color.FromArgb(255, 240, 224); fg = Orange; }
        else if (!Engine.Online && wait > 0) { txt = "● ส่งไม่ได้ (ออฟไลน์) รอส่ง " + wait; bg = Color.FromArgb(253, 228, 233); fg = Red; }
        else { txt = "● กำลังทำงาน"; bg = Color.FromArgb(222, 247, 236); fg = Green; }
        pill.Text = txt; pill.BackColor = bg; pill.ForeColor = fg;
        pauseBtn.Text = Cfg.Paused ? "เริ่มต่อ" : "หยุดชั่วคราว";
        pauseItem.Text = Cfg.Paused ? "เริ่มต่อ" : "หยุดชั่วคราว";
        tray.Text = "RRQC Scanner Logger - " + (Cfg.Paused ? "หยุดชั่วคราว" : "ทำงาน") + " (วันนี้ " + today + ")";
    }
}

static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        if (args.Length >= 2 && args[0] == "--make-icon") { Art.WriteIcoFile(args[1]); return; }

        bool created;
        using (Mutex m = new Mutex(true, "Global\\RRQC_ScannerLogger_App", out created))
        {
            if (!created) { MessageBox.Show("RRQC Scanner Logger ทำงานอยู่แล้ว ดูที่ไอคอนในถาดระบบมุมขวาล่าง", "RRQC Scanner Logger"); return; }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Cfg.Load();
            Directory.CreateDirectory(Cfg.Dir);
            Engine.Start();
            bool hidden = false;
            foreach (string a in args) if (a == "--tray") hidden = true;
            Application.Run(new MainForm(hidden));
        }
    }
}

