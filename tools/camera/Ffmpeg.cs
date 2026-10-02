using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

class CameraMode { public string Codec; public int Width, Height; public double MaxFps; }

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

    public static string BuildArgs(Settings s, string bufferDir, bool testSource, bool mjpegInput)
    {
        StringBuilder a = new StringBuilder();
        a.Append("-hide_banner -loglevel info -stats ");
        if (testSource)
        {
            a.Append("-re -f lavfi -i \"color=c=0x303030:s=" + s.Width + "x" + s.Height + ":r=" + s.Fps +
                ",drawbox=x='mod(t*150,iw-200)':y=100:w=200:h=200:color=white:t=fill:enable='lt(mod(t,20),6)'\" ");
        }
        else
        {
            a.Append("-f dshow -rtbufsize 128M -video_size " + s.Width + "x" + s.Height + " -framerate " + s.Fps + " ");
            if (mjpegInput) a.Append("-vcodec mjpeg ");
            a.Append("-i video=\"" + s.CameraName + "\" ");
        }
        string rot = s.Rotation == 90 ? "transpose=1," : s.Rotation == 180 ? "hflip,vflip," : s.Rotation == 270 ? "transpose=2," : "";
        string text = "drawtext=fontfile='C\\:/Windows/Fonts/consola.ttf':text='%{localtime}':x=w-tw-12:y=h-th-12:fontsize=h/28:fontcolor=0x3ddc97:shadowcolor=black:shadowx=1:shadowy=1";
        a.Append("-filter_complex \"[0:v]" + rot + text + ",split=2[rec][live];[live]fps=10,scale='min(1280,iw)':-2[lv]\" ");
        a.Append("-map \"[lv]\" -an -c:v mjpeg -q:v 6 -pix_fmt yuvj420p -f image2pipe pipe:1 ");
        a.Append("-map \"[rec]\" -an -c:v libx264 -preset veryfast -crf 26 -pix_fmt yuv420p -g " + (s.Fps * 2) +
            " -force_key_frames \"expr:gte(t,n_forced*10)\" -f segment -segment_time 10 -reset_timestamps 1 -strftime 1 " +
            "-segment_format_options movflags=+faststart \"" + bufferDir + "\\seg_%Y-%m-%d_%H-%M-%S.mp4\"");
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
        while (!stop)
        {
            long framesAtStart = Interlocked.Read(ref frames);
            DateTime t0 = DateTime.UtcNow;
            bool gracefulEnd = false;
            SetState(attempt == 0 ? "starting" : "recovering");
            Process p = null;
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(exe, BuildArgs(s, bufDir, testSource, mjpegIn));
                psi.UseShellExecute = false; psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true; psi.RedirectStandardError = true; psi.RedirectStandardInput = true;
                Directory.CreateDirectory(bufDir);
                ActualWidth = 0; ActualHeight = 0; ActualFps = 0;
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
                        if (State != "running") SetState("running");
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
    static readonly Regex BadRx = new Regex("error|fail|could not|invalid|unable|cannot|no such|not found|denied|timeout", RegexOptions.IgnoreCase | RegexOptions.Compiled);

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
        if (BadRx.IsMatch(line)) { LastError = line.Trim(); Log.Write("ffmpeg: " + line.Trim()); }
    }
}
