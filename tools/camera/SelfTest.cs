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

static class SelfTest
{
    public static int Run(string outFile)
    {
        T.Run("harness", delegate { T.True(true, "harness works"); });
        T.Run("settings", SettingsTests.All);
        T.Run("clip rules", ClipRulesTests.All);
        T.Run("clip store", ClipStoreTests.All);
        T.Run("clip recorder", ClipRecorderTests.All);
        return T.Done(outFile);
    }
}
