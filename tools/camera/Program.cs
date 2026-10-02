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
        if (args.Length >= 2 && args[0] == "--make-icon") { CameraArt.WriteIcoFile(args[1]); return 0; }
        string dd = Arg(args, "--data-dir");
        if (dd != null) AppPaths.DataDir = dd;
        bool test = Has(args, "--test-source");
        AppDomain.CurrentDomain.UnhandledException += delegate(object o, UnhandledExceptionEventArgs e) { Log.Write("Unhandled exception: " + e.ExceptionObject); };

        if (Has(args, "--headless"))   // ใช้ในการทดสอบอัตโนมัติ: ไม่มีหน้าต่าง
        {
            Settings hs = Settings.Load();
            CameraEngine heng = new CameraEngine(hs, test);
            heng.Start();
            HttpServer hsrv = new HttpServer(hs, heng);
            hsrv.Start();
            Thread.Sleep(Timeout.Infinite);
            return 0;
        }

        bool created;
        using (Mutex m = new Mutex(true, "Global\\RRQC_Camera_App", out created))
        {
            if (!created) { MessageBox.Show("RRQC Camera ทำงานอยู่แล้ว ดูที่ไอคอนในถาดระบบมุมขวาล่าง", "RRQC Camera"); return 0; }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
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
            catch (System.Net.Sockets.SocketException ex)
            {
                MessageBox.Show("เปิดเซิร์ฟเวอร์พอร์ต " + s.Port + " ไม่ได้ (มีโปรแกรมอื่นใช้อยู่?)\n" + ex.Message +
                    "\nเปลี่ยนพอร์ตในหน้าต่างตั้งค่าแล้วกด \"บันทึกและใช้ค่านี้\"", "RRQC Camera");
            }
            if (noFfmpeg) MessageBox.Show("ไม่พบ ffmpeg.exe ข้างโปรแกรมนี้\nดาวน์โหลด ffmpeg (build essentials) จาก gyan.dev แล้ววาง ffmpeg.exe ไว้ในโฟลเดอร์เดียวกับ RRQCCamera.exe", "RRQC Camera");
            else if (s.Running) eng.Start();
            bool hidden = Has(args, "--tray");
            Application.Run(new MainForm(s, eng, srv, hidden, noFfmpeg));
        }
        return 0;
    }
}
