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
