using System;
using System.Collections.Generic;
using System.Globalization;

class HttpReq
{
    public string Method, Path;
    public Dictionary<string, string> Query = new Dictionary<string, string>();
    public Dictionary<string, string> Headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
}

interface IServerHost
{
    FrameHub Hub { get; }
    string StatusJson();
    bool SetRotation(int deg);
}

static class HttpParse
{
    public static string UrlDecode(string s) { return s == null ? "" : Uri.UnescapeDataString(s.Replace('+', ' ')).Replace("\u0000", ""); }

    public static bool TryParse(string head, out HttpReq req)
    {
        req = null;
        if (head == null) return false;
        string[] lines = head.Split(new string[] { "\r\n" }, StringSplitOptions.None);
        string[] first = lines[0].Split(' ');
        if (first.Length != 3 || !first[2].StartsWith("HTTP/")) return false;
        foreach (char c in first[0]) if (!(c >= 'A' && c <= 'Z')) return false;
        if (first[0].Length == 0 || first[1].Length == 0 || first[1][0] != '/') return false;
        HttpReq r = new HttpReq();
        r.Method = first[0];
        string target = first[1];
        int q = target.IndexOf('?');
        r.Path = q < 0 ? target : target.Substring(0, q);
        if (q >= 0)
        {
            foreach (string pair in target.Substring(q + 1).Split('&'))
            {
                if (pair.Length == 0) continue;
                int e = pair.IndexOf('=');
                string k = e < 0 ? pair : pair.Substring(0, e), v = e < 0 ? "" : pair.Substring(e + 1);
                r.Query[UrlDecode(k)] = UrlDecode(v);
            }
        }
        for (int i = 1; i < lines.Length; i++)
        {
            int c = lines[i].IndexOf(':');
            if (c <= 0) continue;
            r.Headers[lines[i].Substring(0, c).Trim()] = lines[i].Substring(c + 1).Trim();
        }
        req = r;
        return true;
    }

    // รองรับ Range ช่วงเดียว: a-b, a-, -n (ตามที่ตัวเล่นวิดีโอของเบราว์เซอร์ใช้)
    public static bool TryRange(string header, long size, out long start, out long end)
    {
        start = 0; end = 0;
        if (header == null || size <= 0 || !header.StartsWith("bytes=") || header.IndexOf(',') >= 0) return false;
        string spec = header.Substring(6).Trim();
        int dash = spec.IndexOf('-');
        if (dash < 0) return false;
        string a = spec.Substring(0, dash), b = spec.Substring(dash + 1);
        long x, y;
        if (a.Length == 0)
        {
            if (!long.TryParse(b, NumberStyles.None, CultureInfo.InvariantCulture, out y) || y <= 0) return false;
            start = Math.Max(0, size - y); end = size - 1; return true;
        }
        if (!long.TryParse(a, NumberStyles.None, CultureInfo.InvariantCulture, out x)) return false;
        if (b.Length == 0) y = size - 1;
        else if (!long.TryParse(b, NumberStyles.None, CultureInfo.InvariantCulture, out y)) return false;
        if (x >= size || y < x) return false;
        start = x; end = Math.Min(y, size - 1);
        return true;
    }
}

static class Auth
{
    public static bool CodeEquals(string a, string b)
    {
        if (a == null || b == null || a.Length != b.Length) return false;
        int diff = 0;
        for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
        return diff == 0;
    }
}

class RateLimiter
{
    readonly int max;
    readonly TimeSpan window;
    readonly Dictionary<string, List<DateTime>> fails = new Dictionary<string, List<DateTime>>();
    readonly object o = new object();

    public RateLimiter(int maxFails, TimeSpan win) { max = maxFails; window = win; }

    void Prune(List<DateTime> l, DateTime now) { l.RemoveAll(delegate(DateTime t) { return now - t > window; }); }

    public bool IsBlocked(string ip, DateTime now)
    {
        lock (o)
        {
            List<DateTime> l;
            if (!fails.TryGetValue(ip, out l)) return false;
            Prune(l, now);
            return l.Count > max;
        }
    }

    public void Fail(string ip, DateTime now)
    {
        lock (o)
        {
            List<DateTime> l;
            if (!fails.TryGetValue(ip, out l)) { l = new List<DateTime>(); fails[ip] = l; }
            Prune(l, now);
            l.Add(now);
        }
    }
}
