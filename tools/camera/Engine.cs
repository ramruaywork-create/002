using System;
using System.Globalization;
using System.IO;
using System.Threading;

class CameraEngine : IServerHost, IDisposable
{
    readonly Settings s;
    readonly bool testSource;
    readonly FrameHub hub = new FrameHub();
    readonly MotionDetector det = new MotionDetector();
    FfmpegPipeline pipe;
    ClipRecorder rec;
    Thread tickThread;
    volatile bool stop;
    DateTime lastMotion = DateTime.MinValue, lastCheck = DateTime.MinValue, lastPurgeDay = DateTime.MinValue;
    string rawState = "stopped";

    public event Action StateChanged;
    public FrameHub Hub { get { return hub; } }
    public int ActualWidth { get { FfmpegPipeline p = pipe; return p == null ? 0 : p.ActualWidth; } }
    public int ActualHeight { get { FfmpegPipeline p = pipe; return p == null ? 0 : p.ActualHeight; } }
    public double ActualFps { get { FfmpegPipeline p = pipe; return p == null ? 0 : p.ActualFps; } }
    public string LastError { get { FfmpegPipeline p = pipe; return p == null ? "" : p.LastError; } }

    public CameraEngine(Settings settings, bool useTestSource)
    {
        s = settings; testSource = useTestSource;
        rec = new ClipRecorder(s, AppPaths.BufferDir);
    }

    public string State
    {
        get
        {
            if (rawState == "running") return (DateTime.Now - lastMotion).TotalMilliseconds < s.CooldownMs ? "recording" : "armed";
            return rawState;
        }
    }

    void Raise() { Action h = StateChanged; if (h != null) h(); }

    public void Start()
    {
        if (pipe != null) return;
        stop = false;
        Directory.CreateDirectory(AppPaths.BufferDir);
        Directory.CreateDirectory(s.ClipDir);
        rec.ResetBuffer();
        det.Reset();
        pipe = new FfmpegPipeline(s, AppPaths.FfmpegPath, AppPaths.BufferDir, testSource);
        pipe.Frame += OnFrame;
        pipe.StateChanged += delegate(string st) { rawState = st; Raise(); };
        pipe.ProcessEnded += delegate(bool graceful) { if (!graceful) rec.DropLatestSegment(); };
        pipe.Start();
        tickThread = new Thread(TickLoop); tickThread.IsBackground = true; tickThread.Start();
        Log.Write("เริ่มกล้อง " + (testSource ? "(test source)" : s.CameraName) + " " + s.Width + "x" + s.Height + "@" + s.Fps);
    }

    public void Stop()
    {
        stop = true;
        FfmpegPipeline p = pipe; pipe = null;
        if (p != null) p.Stop();
        Thread t = tickThread; tickThread = null;
        if (t != null) t.Join(3000);
        rawState = "stopped"; Raise();
    }

    public void Restart() { Stop(); Start(); }
    public void Dispose() { Stop(); }

    void OnFrame(byte[] jpeg)
    {
        hub.Publish(jpeg);
        DateTime now = DateTime.Now;
        if ((now - lastCheck).TotalMilliseconds < 220) return;
        lastCheck = now;
        try
        {
            det.Sensitivity = s.Sensitivity;
            if (det.Update(FrameTools.ToRgb160(jpeg))) { lastMotion = now; rec.NoteMotion(now); }
        }
        catch (Exception ex) { Log.Write("ตรวจเคลื่อนไหวพลาด: " + ex.Message); }
    }

    void TickLoop()
    {
        while (!stop)
        {
            try
            {
                DateTime now = DateTime.Now;
                rec.Tick(now);
                if (s.RetentionDays > 0 && lastPurgeDay.Date != now.Date)
                {
                    lastPurgeDay = now;
                    int n = ClipStore.PurgeOld(s.ClipDir, now, s.RetentionDays);
                    if (n > 0) Log.Write("ลบคลิปเก่า " + n + " ไฟล์");
                }
            }
            catch (Exception ex) { Log.Write("Tick: " + ex.Message); }
            for (int i = 0; i < 20 && !stop; i++) Thread.Sleep(100);
        }
    }

    public bool SetRotation(int deg)
    {
        if (deg != 0 && deg != 90 && deg != 180 && deg != 270) return false;
        s.Rotation = deg; s.Save();
        if (pipe != null) Restart();
        return true;
    }

    public string StatusJson()
    {
        return "{\"running\":" + (pipe != null ? "true" : "false") + ",\"state\":\"" + State + "\",\"width\":" + ActualWidth +
            ",\"height\":" + ActualHeight + ",\"fps\":" + ActualFps.ToString("0.0", CultureInfo.InvariantCulture) + ",\"rot\":" + s.Rotation + "}";
    }
}
