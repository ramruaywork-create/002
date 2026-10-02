using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;

static class ClipNames
{
    static readonly Regex ClipRx = new Regex(@"^motion_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.(mp4|webm)$", RegexOptions.Compiled);
    static readonly Regex SegRx = new Regex(@"^seg_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.mp4$", RegexOptions.Compiled);

    static bool Parse(Regex rx, string name, out DateTime t)
    {
        t = DateTime.MinValue;
        if (name == null) return false;
        Match m = rx.Match(name);
        if (!m.Success) return false;
        try
        {
            t = new DateTime(int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value), int.Parse(m.Groups[3].Value),
                int.Parse(m.Groups[4].Value), int.Parse(m.Groups[5].Value), int.Parse(m.Groups[6].Value), DateTimeKind.Local);
            return true;
        }
        catch (ArgumentOutOfRangeException) { return false; }
    }

    public static bool IsClipName(string n) { DateTime t; return Parse(ClipRx, n, out t); }
    public static bool TryParseClip(string n, out DateTime localStart) { return Parse(ClipRx, n, out localStart); }
    public static bool TryParseSeg(string n, out DateTime localStart) { return Parse(SegRx, n, out localStart); }
    public static string ClipNameFor(DateTime t) { return "motion_" + t.ToString("yyyy-MM-dd_HH-mm-ss", CultureInfo.InvariantCulture) + ".mp4"; }
    public static string SegNameFor(DateTime t) { return "seg_" + t.ToString("yyyy-MM-dd_HH-mm-ss", CultureInfo.InvariantCulture) + ".mp4"; }
}

static class KeepPolicy
{
    // เก็บท่อนที่เริ่ม segStart ถ้ามี motion ใน [segStart - cooldown, segStart + 2*segSeconds)
    // (ท่อนนี้ + ท่อนถัดไปเป็น pre-roll + หางหลัง motion ตาม cooldown)
    public static bool Keep(IList<DateTime> motions, DateTime segStart, int segSeconds, int cooldownMs)
    {
        DateTime from = segStart.AddMilliseconds(-cooldownMs), to = segStart.AddSeconds(2 * segSeconds);
        for (int i = 0; i < motions.Count; i++) if (motions[i] >= from && motions[i] < to) return true;
        return false;
    }

    // ตัดสินได้เมื่อท่อนถัดไปจบแล้วบวกเวลาเผื่อปิดไฟล์ 2 วินาที
    public static bool Ready(DateTime now, DateTime segStart, int segSeconds)
    {
        return now >= segStart.AddSeconds(2 * segSeconds + 2);
    }
}

class ClipInfo { public string Name; public long StartMs, EndMs, Size; }

static class ClipStore
{
    static readonly DateTime Epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    public static long ToEpochMs(DateTime local) { return (long)(local.ToUniversalTime() - Epoch).TotalMilliseconds; }

    public static List<ClipInfo> List(string dir, long fromMs, long toMs)
    {
        List<ClipInfo> res = new List<ClipInfo>();
        if (!Directory.Exists(dir)) return res;
        foreach (string path in Directory.GetFiles(dir, "motion_*"))
        {
            string name = Path.GetFileName(path);
            DateTime start;
            if (!ClipNames.TryParseClip(name, out start)) continue;
            FileInfo fi = new FileInfo(path);
            long s = ToEpochMs(start), e = Math.Max(ToEpochMs(fi.LastWriteTime), s + 1000);
            if (e < fromMs || s > toMs) continue;
            ClipInfo c = new ClipInfo(); c.Name = name; c.StartMs = s; c.EndMs = e; c.Size = fi.Length;
            res.Add(c);
        }
        res.Sort(delegate(ClipInfo x, ClipInfo y) { return x.StartMs.CompareTo(y.StartMs); });
        return res;
    }

    public static string ResolvePath(string dir, string name)
    {
        if (!ClipNames.IsClipName(name)) return null;
        string p = Path.Combine(dir, name);
        return File.Exists(p) ? p : null;
    }

    public static int PurgeOld(string dir, DateTime now, int days)
    {
        if (days <= 0 || !Directory.Exists(dir)) return 0;
        DateTime cutoff = now.AddDays(-days);
        int n = 0;
        foreach (string path in Directory.GetFiles(dir, "motion_*"))
        {
            DateTime start;
            if (!ClipNames.TryParseClip(Path.GetFileName(path), out start)) continue;
            if (start < cutoff) { try { File.Delete(path); n++; } catch (IOException) { } }
        }
        return n;
    }
}

class ClipRecorder
{
    public const int SegSeconds = 10;
    readonly Settings s;
    readonly string bufDir;
    readonly List<DateTime> motions = new List<DateTime>();
    readonly object sync = new object();
    public event Action<string> ClipSaved;

    public ClipRecorder(Settings settings, string bufferDir) { s = settings; bufDir = bufferDir; }

    public void NoteMotion(DateTime localNow) { lock (sync) { motions.Add(localNow); } }

    public void ResetBuffer()
    {
        if (!Directory.Exists(bufDir)) return;
        foreach (string f in Directory.GetFiles(bufDir, "seg_*")) { try { File.Delete(f); } catch (IOException) { } }
    }

    // ffmpeg ถูกฆ่ากลางทาง ท่อนล่าสุดอาจเขียนไม่จบ เล่นไม่ได้ จึงทิ้ง
    public void DropLatestSegment()
    {
        if (!Directory.Exists(bufDir)) return;
        string latest = null; DateTime latestT = DateTime.MinValue;
        foreach (string f in Directory.GetFiles(bufDir, "seg_*"))
        {
            DateTime t;
            if (ClipNames.TryParseSeg(Path.GetFileName(f), out t) && t > latestT) { latestT = t; latest = f; }
        }
        if (latest != null) { try { File.Delete(latest); } catch (IOException) { } }
    }

    public void Tick(DateTime now)
    {
        if (!Directory.Exists(bufDir)) return;
        List<DateTime> snap;
        lock (sync)
        {
            motions.RemoveAll(delegate(DateTime m) { return m < now.AddMinutes(-5); });
            snap = new List<DateTime>(motions);
        }
        foreach (string path in Directory.GetFiles(bufDir, "seg_*.mp4"))
        {
            DateTime start;
            if (!ClipNames.TryParseSeg(Path.GetFileName(path), out start)) continue;
            if (!KeepPolicy.Ready(now, start, SegSeconds)) continue;
            try
            {
                FileInfo fi = new FileInfo(path);
                if (fi.Length == 0 || !KeepPolicy.Keep(snap, start, SegSeconds, s.CooldownMs)) { File.Delete(path); continue; }
                Directory.CreateDirectory(s.ClipDir);
                string name = ClipNames.ClipNameFor(start), dest = Path.Combine(s.ClipDir, name);
                if (File.Exists(dest)) { File.Delete(path); continue; }
                File.Move(path, dest);
                Action<string> h = ClipSaved; if (h != null) h(name);
            }
            catch (IOException ex) { Log.Write("ย้ายคลิปไม่สำเร็จ (จะลองใหม่): " + ex.Message); }
            catch (UnauthorizedAccessException ex) { Log.Write("ไม่มีสิทธิ์เขียนโฟลเดอร์คลิป: " + ex.Message); }
        }
    }
}