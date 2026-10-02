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
