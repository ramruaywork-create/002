using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

static class AppPaths
{
    public static string DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "RRQC-Camera");
    public static string SettingsFile { get { return Path.Combine(DataDir, "settings.ini"); } }
    public static string BufferDir { get { return Path.Combine(DataDir, "buffer"); } }
    public static string LogFile { get { return Path.Combine(DataDir, "camera.log"); } }
    public static string FfmpegPath { get { return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ffmpeg.exe"); } }
    public static string DefaultClipDir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "RRQC-Clips"); } }
}

static class Log
{
    static readonly object L = new object();
    public static void Write(string msg)
    {
        try
        {
            lock (L)
            {
                Directory.CreateDirectory(AppPaths.DataDir);
                string f = AppPaths.LogFile;
                FileInfo fi = new FileInfo(f);
                if (fi.Exists && fi.Length > 1024 * 1024) { File.Copy(f, f + ".old", true); File.Delete(f); }
                File.AppendAllText(f, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + msg + "\r\n", Encoding.UTF8);
            }
        }
        catch { }
    }
}

class Settings
{
    public const string CodeAlphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    static readonly Regex CodeRx = new Regex("^[abcdefghjkmnpqrstuvwxyz23456789]{8}$");

    public string CameraName = "";
    public int Width = 1920, Height = 1080, Fps = 15;
    public int Sensitivity = 5;
    public int CooldownMs = 5000;
    public int Rotation = 0;
    public string ClipDir = "";
    public int Port = 8787;
    public int RetentionDays = 30;
    public bool LocalOnly = false;
    public string Code = "";
    public bool Running = true;

    static int Clamp(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }

    public void Clamp()
    {
        Width = Clamp(Width, 160, 7680); Height = Clamp(Height, 120, 4320); Fps = Clamp(Fps, 5, 60);
        Sensitivity = Clamp(Sensitivity, 1, 10); CooldownMs = Clamp(CooldownMs, 1000, 60000);
        if (Rotation != 0 && Rotation != 90 && Rotation != 180 && Rotation != 270) Rotation = 0;
        Port = Clamp(Port, 1024, 65535); RetentionDays = Clamp(RetentionDays, 0, 3650);
        CameraName = (CameraName ?? "").Replace("\"", "").Replace("\r", "").Replace("\n", "").Trim();
        ClipDir = (ClipDir ?? "").Replace("\r", "").Replace("\n", "").Trim();
        if (!IsValidCode(Code)) Code = "";
    }

    public static bool IsValidCode(string c) { return c != null && CodeRx.IsMatch(c); }

    public static string NewCode()
    {
        // ตัด byte >= 248 ทิ้ง (31*8) เพื่อไม่ให้เอียงเมื่อ mod 31
        StringBuilder sb = new StringBuilder();
        byte[] one = new byte[1];
        using (RandomNumberGenerator rng = RandomNumberGenerator.Create())
        {
            while (sb.Length < 8)
            {
                rng.GetBytes(one);
                if (one[0] < 248) sb.Append(CodeAlphabet[one[0] % 31]);
            }
        }
        return sb.ToString();
    }

    static int I(string v, int def) { int x; return int.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out x) ? x : def; }

    public static Settings Parse(IEnumerable<string> lines)
    {
        Settings s = new Settings();
        foreach (string line in lines)
        {
            int i = line.IndexOf('=');
            if (i < 0) continue;
            string k = line.Substring(0, i).Trim().ToLowerInvariant(), v = line.Substring(i + 1).Trim();
            switch (k)
            {
                case "cameraname": s.CameraName = v; break;
                case "width": s.Width = I(v, s.Width); break;
                case "height": s.Height = I(v, s.Height); break;
                case "fps": s.Fps = I(v, s.Fps); break;
                case "sensitivity": s.Sensitivity = I(v, s.Sensitivity); break;
                case "cooldownms": s.CooldownMs = I(v, s.CooldownMs); break;
                case "rotation": s.Rotation = I(v, 0); break;
                case "clipdir": s.ClipDir = v; break;
                case "port": s.Port = I(v, s.Port); break;
                case "retentiondays": s.RetentionDays = I(v, s.RetentionDays); break;
                case "localonly": s.LocalOnly = (v == "1"); break;
                case "code": s.Code = v; break;
                case "running": s.Running = (v != "0"); break;
            }
        }
        s.Clamp();
        return s;
    }

    public List<string> ToLines()
    {
        List<string> l = new List<string>();
        l.Add("cameraname=" + CameraName); l.Add("width=" + Width); l.Add("height=" + Height); l.Add("fps=" + Fps);
        l.Add("sensitivity=" + Sensitivity); l.Add("cooldownms=" + CooldownMs); l.Add("rotation=" + Rotation);
        l.Add("clipdir=" + ClipDir); l.Add("port=" + Port); l.Add("retentiondays=" + RetentionDays);
        l.Add("localonly=" + (LocalOnly ? "1" : "0")); l.Add("code=" + Code); l.Add("running=" + (Running ? "1" : "0"));
        return l;
    }

    public static Settings Load()
    {
        Settings s;
        try { s = File.Exists(AppPaths.SettingsFile) ? Parse(File.ReadAllLines(AppPaths.SettingsFile, Encoding.UTF8)) : new Settings(); }
        catch (Exception ex) { Log.Write("อ่านตั้งค่าไม่สำเร็จ: " + ex.Message); s = new Settings(); }
        bool changed = false;
        if (s.Code == "") { s.Code = NewCode(); changed = true; }
        if (s.ClipDir == "") { s.ClipDir = AppPaths.DefaultClipDir; changed = true; }
        if (changed) s.Save();
        return s;
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(AppPaths.DataDir);
            File.WriteAllLines(AppPaths.SettingsFile, ToLines().ToArray(), Encoding.UTF8);
        }
        catch (Exception ex) { Log.Write("บันทึกตั้งค่าไม่สำเร็จ: " + ex.Message); }
    }
}
