using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

class CameraMode { public string Codec; public int Width, Height; public double MinFps, MaxFps; }

// ค่าที่จะส่งให้ ffmpeg เปิดกล้องจริง (ปรับให้ตรงกับโหมดที่กล้องรองรับ ไม่ใช่ค่าที่ผู้ใช้ขอตรงๆ)
class InputPlan { public int Width, Height, Fps; public bool Mjpeg; public string Note; }

static class FfmpegText
{
    static readonly Regex DevRx = new Regex("\"([^\"]+)\"\\s+\\(video\\)", RegexOptions.Compiled);
    static readonly Regex ModeRx = new Regex(@"(vcodec|pixel_format)=(\S+)\s+min s=(\d+)x(\d+) fps=([\d.]+) max s=(\d+)x(\d+) fps=([\d.]+)", RegexOptions.Compiled);

    public static List<string> ParseDevices(string text)
    {
        List<string> res = new List<string>();
        foreach (Match m in DevRx.Matches(text ?? "")) if (!res.Contains(m.Groups[1].Value)) res.Add(m.Groups[1].Value);
        return res;
    }

    public static List<CameraMode> ParseModes(string text)
    {
        List<CameraMode> res = new List<CameraMode>();
        foreach (Match m in ModeRx.Matches(text ?? ""))
        {
            CameraMode c = new CameraMode();
            c.Codec = m.Groups[2].Value;
            c.Width = int.Parse(m.Groups[6].Value); c.Height = int.Parse(m.Groups[7].Value);
            c.MinFps = double.Parse(m.Groups[5].Value, CultureInfo.InvariantCulture);
            c.MaxFps = double.Parse(m.Groups[8].Value, CultureInfo.InvariantCulture);
            bool dup = false;
            foreach (CameraMode x in res) if (x.Codec == c.Codec && x.Width == c.Width && x.Height == c.Height) dup = true;
            if (!dup) res.Add(c);
        }
        return res;
    }
}

class FfmpegPipeline : IDisposable
{
    readonly Settings s;
    readonly string exe, bufDir;
    readonly bool testSource;
    Thread worker;
    volatile bool stop;
    Process proc;
    DateTime lastFrameUtc = DateTime.UtcNow;
    long frames;
    readonly object stateLock = new object();
    string state = "stopped";

    public event Action<byte[]> Frame;
    public event Action<string> StateChanged;
    public event Action<bool> ProcessEnded;
    public int ActualWidth, ActualHeight;
    public double ActualFps;
    public string LastError = "";

    public string State { get { lock (stateLock) { return state; } } }

    public FfmpegPipeline(Settings settings, string ffmpegPath, string bufferDir, bool useTestSource)
    {
        s = settings; exe = ffmpegPath; bufDir = bufferDir; testSource = useTestSource;
    }

    void SetState(string st)
    {
        lock (stateLock) { if (state == st) return; state = st; }
        Action<string> h = StateChanged; if (h != null) h(st);
    }

    // เลือกโหมดของกล้องที่ใกล้ที่สุดกับที่ผู้ใช้ขอ: กล้องหลายรุ่นรับ fps เฉพาะช่วง (เช่น C60E ต่ำสุด 30)
    // และถ้าส่ง video_size/framerate ที่ไม่ตรงโหมด dshow จะเปิดไม่ได้ ("Could not set video options")
    public static InputPlan PlanInput(List<CameraMode> modes, int width, int height, int fps, bool preferMjpeg)
    {
        InputPlan p = new InputPlan(); p.Width = width; p.Height = height; p.Fps = fps; p.Mjpeg = preferMjpeg;
        if (modes == null || modes.Count == 0) return p;
        List<CameraMode> pool = new List<CameraMode>();
        foreach (CameraMode m in modes) if (m.Width == width && m.Height == height) pool.Add(m);
        if (pool.Count == 0)   // ขนาดที่ขอกล้องไม่มี: ใช้ขนาดที่พื้นที่ใกล้ที่สุด
        {
            long want = (long)width * height, bestDiff = long.MaxValue; CameraMode best = null;
            foreach (CameraMode m in modes)
            {
                long d = Math.Abs((long)m.Width * m.Height - want);
                if (d < bestDiff || (d == bestDiff && best != null && m.Codec == "mjpeg" && best.Codec != "mjpeg")) { bestDiff = d; best = m; }
            }
            foreach (CameraMode m in modes) if (m.Width == best.Width && m.Height == best.Height) pool.Add(m);
        }
        CameraMode pick = null;
        foreach (CameraMode m in pool) if ((m.Codec == "mjpeg") == preferMjpeg) { pick = m; break; }
        if (pick == null) pick = pool[0];
        p.Width = pick.Width; p.Height = pick.Height; p.Mjpeg = pick.Codec == "mjpeg";
        int lo = (int)Math.Ceiling(pick.MinFps - 0.001), hi = (int)Math.Floor(pick.MaxFps + 0.001);
        if (hi < lo) hi = lo;
        p.Fps = fps < lo ? lo : (fps > hi ? hi : fps);
        if (p.Width != width || p.Height != height || p.Fps != fps)
            p.Note = "ปรับค่าเปิดกล้องให้ตรงกับที่กล้องรองรับ: ขอ " + width + "x" + height + "@" + fps + " ใช้ " + p.Width + "x" + p.Height + "@" + p.Fps;
        return p;
    }

    public static string BuildArgs(Settings s, string bufferDir, bool testSource, bool mjpegInput)
    {
        InputPlan p = new InputPlan(); p.Width = s.Width; p.Height = s.Height; p.Fps = s.Fps; p.Mjpeg = mjpegInput;
        return BuildArgs(s, bufferDir, testSource, p);
    }

    public static string BuildArgs(Settings s, string bufferDir, bool testSource, InputPlan plan)
    {
        StringBuilder a = new StringBuilder();
        a.Append("-hide_banner -loglevel info -stats ");
        if (testSource)
        {
            a.Append("-re -f lavfi -i \"color=c=0x303030:s=" + plan.Width + "x" + plan.Height + ":r=" + plan.Fps +
                ",drawbox=x='mod(t*150,iw-200)':y=100:w=200:h=200:color=white:t=fill:enable='lt(mod(t,40),6)'\" ");   // เคลื่อนไหว 6 วินาทีทุก 40 วินาที (ให้เห็นท่อนที่ถูกลบ)
        }
        else
        {
            a.Append("-f dshow -rtbufsize 128M -video_size " + plan.Width + "x" + plan.Height + " -framerate " + plan.Fps + " ");
            if (plan.Mjpeg) a.Append("-vcodec mjpeg ");
            a.Append("-i video=\"" + s.CameraName + "\" ");
        }
        string rot = s.Rotation == 90 ? "transpose=1," : s.Rotation == 180 ? "hflip,vflip," : s.Rotation == 270 ? "transpose=2," : "";
        string text = "drawtext=fontfile='C\\:/Windows/Fonts/consola.ttf':text='%{localtime}':x=w-tw-12:y=h-th-12:fontsize=h/28:fontcolor=0x3ddc97:shadowcolor=black:shadowx=1:shadowy=1";
        a.Append("-filter_complex \"[0:v]" + rot + text + ",split=2[rec][live];[live]fps=10,scale='min(1280,iw)':-2[lv]\" ");
        // เอาต์พุตบันทึก (เฟรมเรตเต็มของกล้อง) ต้องมาก่อน เพราะตัวเลข fps= ที่ ffmpeg รายงานอิงเอาต์พุตแรก
        // ถ้าเอาภาพสด (ลดเหลือ 10 fps) ขึ้นก่อน สถานะจะแสดง 10 fps เสมอ ใช้วินิจฉัยเฟรมตกของกล้องไม่ได้
        a.Append("-map \"[rec]\" -an -c:v libx264 -preset veryfast -crf 26 -pix_fmt yuv420p -g " + (plan.Fps * 2) +
            " -force_key_frames \"expr:gte(t,n_forced*10)\" -f segment -segment_time 10 -reset_timestamps 1 -strftime 1 " +
            "-segment_format_options movflags=+faststart \"" + bufferDir + "\\seg_%Y-%m-%d_%H-%M-%S.mp4\" ");
        a.Append("-map \"[lv]\" -an -c:v mjpeg -q:v 6 -pix_fmt yuvj420p -f image2pipe pipe:1");
        return a.ToString();
    }

    static string RunCapture(string exePath, string args, int timeoutMs)
    {
        ProcessStartInfo psi = new ProcessStartInfo(exePath, args);
        psi.UseShellExecute = false; psi.RedirectStandardError = true; psi.RedirectStandardOutput = true; psi.CreateNoWindow = true;
        psi.StandardErrorEncoding = Encoding.UTF8;
        using (Process p = Process.Start(psi))
        {
            StringBuilder sb = new StringBuilder();
            p.ErrorDataReceived += delegate(object o, DataReceivedEventArgs e) { if (e.Data != null) lock (sb) sb.AppendLine(e.Data); };
            p.OutputDataReceived += delegate(object o, DataReceivedEventArgs e) { };
            p.BeginErrorReadLine(); p.BeginOutputReadLine();
            if (!p.WaitForExit(timeoutMs)) { try { p.Kill(); } catch { } }
            p.WaitForExit(500);
            lock (sb) return sb.ToString();
        }
    }

    public static List<string> ListCameras(string ffmpegPath)
    {
        return FfmpegText.ParseDevices(RunCapture(ffmpegPath, "-hide_banner -list_devices true -f dshow -i dummy", 10000));
    }

    public static List<CameraMode> ListModes(string ffmpegPath, string camera)
    {
        return FfmpegText.ParseModes(RunCapture(ffmpegPath, "-hide_banner -list_options true -f dshow -i video=\"" + camera.Replace("\"", "") + "\"", 10000));
    }

    public void Start()
    {
        if (worker != null) return;
        stop = false;
        worker = new Thread(Run); worker.IsBackground = true; worker.Start();
    }

    public void Stop()
    {
        stop = true;
        Process p = proc;
        Terminate(p, true);
        Thread w = worker;
        if (w != null) { w.Join(8000); worker = null; }
        SetState("stopped");
    }

    public void Dispose() { Stop(); }

    static void Terminate(Process p, bool graceful)
    {
        if (p == null) return;
        try
        {
            if (p.HasExited) return;
            if (graceful)
            {
                try { p.StandardInput.WriteLine("q"); p.StandardInput.Flush(); } catch { }
                if (p.WaitForExit(4000)) return;
            }
            p.Kill(); p.WaitForExit(2000);
        }
        catch { }
    }

    void Run()
    {
        int attempt = 0; bool mjpegIn = true;
        List<CameraMode> modes = new List<CameraMode>();
        string lastNote = null;
        while (!stop)
        {
            long framesAtStart = Interlocked.Read(ref frames);
            DateTime t0 = DateTime.UtcNow;
            bool gracefulEnd = false;
            SetState(attempt == 0 ? "starting" : "recovering");
            Process p = null;
            try
            {
                // อ่านโหมดที่กล้องรองรับ (ครั้งแรก และทุกครั้งที่เปิดไม่ติดหลายรอบ เผื่อเสียบกล้องใหม่) แล้วปรับค่าให้ตรง
                InputPlan plan = new InputPlan(); plan.Width = s.Width; plan.Height = s.Height; plan.Fps = s.Fps; plan.Mjpeg = mjpegIn;
                if (!testSource && s.CameraName != "")
                {
                    if (modes.Count == 0 || (attempt > 0 && attempt % 3 == 0))
                    {
                        try { modes = ListModes(exe, s.CameraName); } catch (Exception ex) { Log.Write("อ่านโหมดกล้องไม่สำเร็จ: " + ex.Message); }
                    }
                    plan = PlanInput(modes, s.Width, s.Height, s.Fps, mjpegIn);
                    if (plan.Note != null && plan.Note != lastNote) { Log.Write(plan.Note); lastNote = plan.Note; }
                }
                ProcessStartInfo psi = new ProcessStartInfo(exe, BuildArgs(s, bufDir, testSource, plan));
                psi.UseShellExecute = false; psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true; psi.RedirectStandardError = true; psi.RedirectStandardInput = true;
                Directory.CreateDirectory(bufDir);
                ActualWidth = 0; ActualHeight = 0; ActualFps = 0; specificErr = false;
                p = Process.Start(psi); proc = p;
                lastFrameUtc = DateTime.UtcNow;
                p.ErrorDataReceived += OnStderr;
                p.BeginErrorReadLine();
                Timer watchdog = new Timer(delegate
                {
                    if (!stop && (DateTime.UtcNow - lastFrameUtc).TotalSeconds > 8) { Log.Write("ไม่มีภาพใหม่ 8 วินาที ปิด ffmpeg เพื่อเปิดใหม่"); Terminate(p, false); }
                }, null, 1000, 1000);
                JpegSplitter split = new JpegSplitter();
                byte[] buf = new byte[65536];
                Stream so = p.StandardOutput.BaseStream;
                int n;
                while ((n = so.Read(buf, 0, buf.Length)) > 0)
                {
                    foreach (byte[] f in split.Push(buf, n))
                    {
                        Interlocked.Increment(ref frames);
                        lastFrameUtc = DateTime.UtcNow;
                        if (State != "running") { LastError = ""; SetState("running"); }
                        Action<byte[]> h = Frame; if (h != null) { try { h(f); } catch (Exception ex) { Log.Write("Frame handler: " + ex.Message); } }
                    }
                }
                watchdog.Dispose();
                gracefulEnd = stop;
            }
            catch (Exception ex) { LastError = ex.Message; Log.Write("ffmpeg: " + ex.Message); }
            finally { Terminate(p, false); proc = null; }
            Action<bool> pe = ProcessEnded; if (pe != null) pe(gracefulEnd);
            if (stop) break;

            bool gotFrames = Interlocked.Read(ref frames) > framesAtStart;
            bool quick = (DateTime.UtcNow - t0).TotalSeconds < 5 && !gotFrames;
            if (quick && !testSource) { mjpegIn = !mjpegIn; Log.Write("เปิดกล้องไม่ติดทันที ลองโหมดอินพุต " + (mjpegIn ? "MJPEG" : "ดิบ")); }
            attempt = gotFrames ? 1 : attempt + 1;
            SetState("recovering");
            int wait = Math.Min(10000, 1500 * (1 << Math.Min(attempt - 1, 3)));
            for (int w = 0; w < wait && !stop; w += 100) Thread.Sleep(100);
        }
    }

    static readonly Regex FpsRx = new Regex(@"fps=\s*([\d.]+)", RegexOptions.Compiled);
    static readonly Regex SizeRx = new Regex(@"Video: .*?, (\d{3,5})x(\d{3,5})", RegexOptions.Compiled);
    static readonly Regex SpecificRx = new Regex("already in use|Could not run graph|Could not set video options", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    volatile bool specificErr;
    static readonly Regex BadRx =new Regex("error|fail|could not|invalid|unable|cannot|no such|not found|denied|timeout", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    void OnStderr(object sender, DataReceivedEventArgs e)
    {
        string line = e.Data;
        if (string.IsNullOrEmpty(line)) return;
        MatchCollection fm = FpsRx.Matches(line);
        if (fm.Count > 0)
        {
            double v; if (double.TryParse(fm[fm.Count - 1].Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out v)) ActualFps = v;
            return;
        }
        Match sm = SizeRx.Match(line);
        if (sm.Success && ActualWidth == 0) { ActualWidth = int.Parse(sm.Groups[1].Value); ActualHeight = int.Parse(sm.Groups[2].Value); }
        if (BadRx.IsMatch(line))
        {
            // ffmpeg ปิดท้ายด้วยข้อความกว้างๆ ("I/O error") เสมอ จึงให้ข้อความที่บอกสาเหตุจริงชนะ ไม่ถูกทับ
            bool specific = SpecificRx.IsMatch(line);
            if (specific) { LastError = line.Trim(); specificErr = true; }
            else if (!specificErr) LastError = line.Trim();
            Log.Write("ffmpeg: " + line.Trim());
        }
    }
}
