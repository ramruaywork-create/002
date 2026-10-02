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

static class SelfTest
{
    public static int Run(string outFile)
    {
        T.Run("harness", delegate { T.True(true, "harness works"); });
        T.Run("settings", SettingsTests.All);
        return T.Done(outFile);
    }
}
