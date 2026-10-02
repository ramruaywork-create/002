using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

class HttpServer : IDisposable
{
    const int MaxConns = 16, MaxLive = 4, MaxHead = 8192;
    readonly Settings s;
    readonly IServerHost host;
    readonly RateLimiter limiter = new RateLimiter(10, TimeSpan.FromMinutes(1));
    readonly List<TcpClient> open = new List<TcpClient>();
    TcpListener listener;
    Thread acceptThread;
    volatile bool stop;
    int conns, liveConns;

    public HttpServer(Settings settings, IServerHost h) { s = settings; host = h; }

    public void Start()
    {
        listener = new TcpListener(s.LocalOnly ? IPAddress.Loopback : IPAddress.Any, s.Port);
        listener.Start();
        stop = false;
        acceptThread = new Thread(AcceptLoop); acceptThread.IsBackground = true; acceptThread.Start();
    }

    public void Stop()
    {
        stop = true;
        try { if (listener != null) listener.Stop(); } catch { }
        lock (open) { foreach (TcpClient c in open) { try { c.Close(); } catch { } } open.Clear(); }
    }
    public void Dispose() { Stop(); }

    void AcceptLoop()
    {
        while (!stop)
        {
            TcpClient c;
            try { c = listener.AcceptTcpClient(); } catch { break; }
            if (Interlocked.Increment(ref conns) > MaxConns) { Interlocked.Decrement(ref conns); try { c.Close(); } catch { } continue; }
            lock (open) open.Add(c);
            Thread t = new Thread(delegate() { Handle(c); }); t.IsBackground = true; t.Start();
        }
    }

    static string Reason(int code)
    {
        switch (code)
        {
            case 200: return "OK"; case 204: return "No Content"; case 206: return "Partial Content";
            case 400: return "Bad Request"; case 401: return "Unauthorized"; case 404: return "Not Found";
            case 405: return "Method Not Allowed"; case 416: return "Range Not Satisfiable"; case 429: return "Too Many Requests";
            case 431: return "Request Header Fields Too Large"; case 503: return "Service Unavailable"; default: return "Error";
        }
    }

    static void Head(Stream st, int code, string ctype, long len, string extra)
    {
        StringBuilder sb = new StringBuilder();
        sb.Append("HTTP/1.1 ").Append(code).Append(' ').Append(Reason(code)).Append("\r\n");
        if (ctype != null) sb.Append("Content-Type: ").Append(ctype).Append("\r\n");
        if (len >= 0) sb.Append("Content-Length: ").Append(len).Append("\r\n");
        sb.Append("Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Private-Network: true\r\n");
        sb.Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nCache-Control: no-store\r\nConnection: close\r\n");
        if (extra != null) sb.Append(extra);
        sb.Append("\r\n");
        byte[] b = Encoding.ASCII.GetBytes(sb.ToString());
        st.Write(b, 0, b.Length);
    }

    static void Json(Stream st, int code, string json)
    {
        byte[] b = Encoding.UTF8.GetBytes(json);
        Head(st, code, "application/json; charset=utf-8", b.Length, null);
        st.Write(b, 0, b.Length);
    }

    static bool ReadHead(NetworkStream ns, out string head)
    {
        head = null;
        byte[] buf = new byte[MaxHead + 4]; int len = 0;
        while (len < MaxHead)
        {
            int n = ns.Read(buf, len, MaxHead - len);
            if (n <= 0) return false;
            len += n;
            string t = Encoding.ASCII.GetString(buf, 0, len);
            int end = t.IndexOf("\r\n\r\n", StringComparison.Ordinal);
            if (end >= 0) { head = t.Substring(0, end); return true; }
        }
        return false;
    }

    void Handle(TcpClient c)
    {
        try
        {
            c.ReceiveTimeout = 10000; c.SendTimeout = 10000;
            NetworkStream ns = c.GetStream();
            string head; HttpReq req;
            if (!ReadHead(ns, out head)) { try { Head(ns, 431, "text/plain", 0, null); } catch { } return; }
            if (!HttpParse.TryParse(head, out req)) { Json(ns, 400, "{\"error\":\"bad request\"}"); return; }
            string ip = ((IPEndPoint)c.Client.RemoteEndPoint).Address.ToString();
            Route(ns, req, ip);
        }
        catch { }
        finally
        {
            try { c.Close(); } catch { }
            lock (open) open.Remove(c);
            Interlocked.Decrement(ref conns);
        }
    }

    void Route(NetworkStream ns, HttpReq req, string ip)
    {
        if (req.Method == "OPTIONS") { Head(ns, 204, null, 0, null); return; }
        DateTime now = DateTime.Now;
        if (limiter.IsBlocked(ip, now)) { Json(ns, 429, "{\"error\":\"too many attempts\"}"); return; }
        string k; req.Query.TryGetValue("k", out k);
        if (!Auth.CodeEquals(k, s.Code)) { limiter.Fail(ip, now); Json(ns, 401, "{\"error\":\"unauthorized\"}"); return; }

        if (req.Path == "/api/status") { if (req.Method != "GET") { Json(ns, 405, "{\"error\":\"method\"}"); return; } Json(ns, 200, host.StatusJson()); return; }
        if (req.Path == "/api/clips") { Clips(ns, req); return; }
        if (req.Path == "/api/rot") { Rot(ns, req); return; }
        if (req.Path == "/live") { Live(ns, req); return; }
        if (req.Path.StartsWith("/clips/")) { ClipFile(ns, req); return; }
        Json(ns, 404, "{\"error\":\"not found\"}");
    }

    void Clips(NetworkStream ns, HttpReq req)
    {
        string a, b; long from, to;
        if (!req.Query.TryGetValue("from", out a) || !req.Query.TryGetValue("to", out b) ||
            !long.TryParse(a, out from) || !long.TryParse(b, out to)) { Json(ns, 400, "{\"error\":\"from/to must be numbers\"}"); return; }
        StringBuilder sb = new StringBuilder("{\"clips\":[");
        bool first = true;
        foreach (ClipInfo c in ClipStore.List(s.ClipDir, from, to))
        {
            if (!first) sb.Append(','); first = false;
            sb.Append("{\"name\":\"").Append(c.Name).Append("\",\"start\":").Append(c.StartMs).Append(",\"end\":").Append(c.EndMs).Append(",\"size\":").Append(c.Size).Append('}');
        }
        sb.Append("]}");
        Json(ns, 200, sb.ToString());
    }

    void Rot(NetworkStream ns, HttpReq req)
    {
        if (req.Method != "POST") { Json(ns, 405, "{\"error\":\"use POST\"}"); return; }
        string v; int deg;
        if (!req.Query.TryGetValue("v", out v) || !int.TryParse(v, out deg) || !host.SetRotation(deg)) { Json(ns, 400, "{\"error\":\"v must be 0, 90, 180 or 270\"}"); return; }
        Json(ns, 200, "{\"ok\":true,\"rot\":" + deg + "}");
    }

    void ClipFile(NetworkStream ns, HttpReq req)
    {
        string name = HttpParse.UrlDecode(req.Path.Substring(7));
        string path = ClipStore.ResolvePath(s.ClipDir, name);
        if (path == null) { Json(ns, 404, "{\"error\":\"not found\"}"); return; }
        using (FileStream fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
        {
            long size = fs.Length, a = 0, b = size - 1; bool partial = false;
            string rh;
            if (req.Headers.TryGetValue("Range", out rh))
            {
                if (!HttpParse.TryRange(rh, size, out a, out b)) { Head(ns, 416, null, 0, "Content-Range: bytes */" + size + "\r\n"); return; }
                partial = true;
            }
            string dl; bool download = req.Query.TryGetValue("dl", out dl) && dl == "1";
            string extra = "Accept-Ranges: bytes\r\n" + (partial ? "Content-Range: bytes " + a + "-" + b + "/" + size + "\r\n" : "") +
                (download ? "Content-Disposition: attachment; filename=\"" + name + "\"\r\n" : "");
            long len = size == 0 ? 0 : b - a + 1;
            Head(ns, partial ? 206 : 200, name.EndsWith(".webm") ? "video/webm" : "video/mp4", len, extra);
            fs.Seek(a, SeekOrigin.Begin);
            byte[] buf = new byte[65536]; long left = len;
            while (left > 0)
            {
                int n = fs.Read(buf, 0, (int)Math.Min(buf.Length, left));
                if (n <= 0) break;
                ns.Write(buf, 0, n); left -= n;
            }
        }
    }

    void Live(NetworkStream ns, HttpReq req)
    {
        if (Interlocked.Increment(ref liveConns) > MaxLive) { Interlocked.Decrement(ref liveConns); Json(ns, 503, "{\"error\":\"too many viewers\"}"); return; }
        try
        {
            Head(ns, 200, "multipart/x-mixed-replace; boundary=frame", -1, null);
            long seq = 0; int idle = 0;
            while (!stop)
            {
                byte[] j; long ns2;
                if (!host.Hub.WaitNext(seq, 3000, out j, out ns2)) { if (++idle >= 20) break; continue; }
                idle = 0; seq = ns2;
                byte[] h = Encoding.ASCII.GetBytes("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + j.Length + "\r\n\r\n");
                ns.Write(h, 0, h.Length); ns.Write(j, 0, j.Length); ns.Write(new byte[] { 13, 10 }, 0, 2);
            }
        }
        finally { Interlocked.Decrement(ref liveConns); }
    }
}
