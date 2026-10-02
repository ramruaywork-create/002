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

static class SelfTest
{
    public static int Run(string outFile)
    {
        T.Run("harness", delegate { T.True(true, "harness works"); });
        T.Run("settings", SettingsTests.All);
        T.Run("clip rules", ClipRulesTests.All);
        T.Run("clip store", ClipStoreTests.All);
        T.Run("clip recorder", ClipRecorderTests.All);
        T.Run("frames", FrameTests.All);
        T.Run("net primitives", NetPrimitivesTests.All);
        T.Run("ffmpeg text", FfmpegTextTests.All);
        T.Run("pipeline integration", PipelineIntegration.All);
        return T.Done(outFile);
    }
}
