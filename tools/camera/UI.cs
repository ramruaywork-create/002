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
        BuildUi(); BuildTray(); FillControls(); RefreshAddresses();
        IntPtr forceHandle = Handle;   // โหมด --tray ซ่อนหน้าต่างตั้งแต่เริ่ม ต้องสร้าง handle ก่อน เพราะเธรดพื้นหลังเรียก BeginInvoke กลับเข้ามา
        LoadCameras();
        System.Windows.Forms.Timer t = new System.Windows.Forms.Timer(); t.Interval = 200; t.Tick += delegate { RefreshUi(); }; t.Start();
        RefreshUi();
    }

    void UiInvoke(Delegate d)
    {
        if (IsDisposed || !IsHandleCreated) return;
        try { BeginInvoke(d); } catch (InvalidOperationException) { }   // รวม ObjectDisposedException: ฟอร์มปิดไปแล้วระหว่างรอเธรดพื้นหลัง
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
        // เมาส์เลื่อนล้อผ่านช่องตัวเลขแล้วค่าเปลี่ยนเอง (ทำให้พอร์ตตกไปที่ 1024 ได้โดยไม่รู้ตัว) จึงปิดการเปลี่ยนค่าด้วยล้อเมาส์
        portBox.MouseWheel += delegate(object o, MouseEventArgs e) { ((HandledMouseEventArgs)e).Handled = true; };
        retentionBox.MouseWheel += delegate(object o, MouseEventArgs e) { ((HandledMouseEventArgs)e).Handled = true; };

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
            UiInvoke(new Action(delegate
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
            UiInvoke(new Action(delegate
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

    // แปลข้อความ error ของ ffmpeg/DirectShow เป็นคำอธิบายภาษาไทยที่บอกว่าต้องทำอะไร
    static string ExplainError(string e)
    {
        if (string.IsNullOrEmpty(e)) return "";
        if (e.IndexOf("already in use", StringComparison.OrdinalIgnoreCase) >= 0 || e.IndexOf("Could not run graph", StringComparison.OrdinalIgnoreCase) >= 0)
            return "กล้องถูกโปรแกรมอื่นใช้อยู่ — ปิดหน้า Settings > Cameras ของ Windows, แอป Camera, Zoom/Teams/EMEET Studio และแท็บเบราว์เซอร์ที่เปิดกล้อง แล้วรอสักครู่";
        if (e.IndexOf("Could not set video options", StringComparison.OrdinalIgnoreCase) >= 0)
            return "กล้องไม่รับความละเอียด/fps ที่ตั้งไว้ — ลองเลือกความละเอียดอื่นในรายการ";
        if (e.IndexOf("Error opening input", StringComparison.OrdinalIgnoreCase) >= 0 || e.IndexOf("I/O error", StringComparison.OrdinalIgnoreCase) >= 0)
            return "เปิดกล้องไม่ได้ — ตรวจสาย USB และว่าเลือกกล้องถูกตัว";
        return "ปัญหาล่าสุด: " + (e.Length > 120 ? e.Substring(0, 120) + "…" : e);
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
        string problem = (st == "starting" || st == "recovering") ? ExplainError(eng.LastError) : "";
        info.Text = problem != "" ? problem
            : (eng.ActualWidth > 0 ? "กล้องส่งภาพจริง " + eng.ActualWidth + "x" + eng.ActualHeight + " @ " + eng.ActualFps.ToString("0.0") + " fps" : (st == "stopped" ? "กล้องหยุดอยู่" : "รอภาพจากกล้อง..."));
        info.ForeColor = problem != "" ? Red : Muted;
        string toggle = eng.State == "stopped" ? "▶ เริ่มกล้อง" : "■ หยุดกล้อง";
        startStopBtn.Text = toggle; trayToggle.Text = eng.State == "stopped" ? "เริ่มกล้อง" : "หยุดกล้อง";
        tray.Text = "RRQC Camera - " + text.Replace("● ", "");
    }
}
