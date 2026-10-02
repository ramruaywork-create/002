using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Threading;

class JpegSplitter
{
    const int MaxBuf = 16 << 20;
    byte[] buf = new byte[1 << 20];
    int len;

    int Find(byte second, int from)
    {
        for (int i = from; i + 1 < len; i++) if (buf[i] == 0xFF && buf[i + 1] == second) return i;
        return -1;
    }

    public List<byte[]> Push(byte[] data, int count)
    {
        List<byte[]> frames = new List<byte[]>();
        if (len + count > MaxBuf) len = 0;                 // กันบัฟเฟอร์โตไม่หยุดเมื่อสตรีมเสีย
        if (len + count > buf.Length) Array.Resize(ref buf, Math.Max(buf.Length * 2, len + count));
        Buffer.BlockCopy(data, 0, buf, len, count);
        len += count;
        int pos = 0;
        while (true)
        {
            int soi = Find(0xD8, pos);
            if (soi < 0) { pos = Math.Max(pos, len - 1); break; }   // เก็บไบต์ท้ายไว้เผื่อเป็น 0xFF ครึ่งแรกของ marker
            int eoi = Find(0xD9, soi + 2);
            if (eoi < 0) { pos = soi; break; }
            byte[] f = new byte[eoi + 2 - soi];
            Buffer.BlockCopy(buf, soi, f, 0, f.Length);
            frames.Add(f);
            pos = eoi + 2;
        }
        if (pos > 0) { Buffer.BlockCopy(buf, pos, buf, 0, len - pos); len -= pos; }
        return frames;
    }
}

class MotionDetector
{
    public const int W = 160, H = 120;
    public int Sensitivity = 5;
    byte[] prev;

    public void Reset() { prev = null; }

    public bool Update(byte[] rgb)
    {
        bool motion = false;
        if (prev != null)
        {
            int pixelThreshold = 90 - Sensitivity * 6;
            double ratio = 0.012 - Sensitivity * 0.0009;
            int changed = 0;
            for (int i = 0; i + 2 < rgb.Length; i += 3)
            {
                int d = Math.Abs(prev[i] - rgb[i]) + Math.Abs(prev[i + 1] - rgb[i + 1]) + Math.Abs(prev[i + 2] - rgb[i + 2]);
                if (d > pixelThreshold) changed++;
            }
            motion = (double)changed / (W * H) > ratio;
        }
        prev = rgb;
        return motion;
    }
}

static class FrameTools
{
    public static Bitmap Decode(byte[] jpeg)
    {
        using (MemoryStream ms = new MemoryStream(jpeg))
        using (Image img = Image.FromStream(ms)) { return new Bitmap(img); }
    }

    public static byte[] ToRgb160(byte[] jpeg)
    {
        using (MemoryStream ms = new MemoryStream(jpeg))
        using (Image img = Image.FromStream(ms))
        using (Bitmap small = new Bitmap(MotionDetector.W, MotionDetector.H, PixelFormat.Format24bppRgb))
        {
            using (Graphics g = Graphics.FromImage(small))
            {
                g.InterpolationMode = InterpolationMode.Bilinear;
                g.DrawImage(img, 0, 0, MotionDetector.W, MotionDetector.H);
            }
            BitmapData bd = small.LockBits(new Rectangle(0, 0, MotionDetector.W, MotionDetector.H), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
            try
            {
                byte[] res = new byte[MotionDetector.W * MotionDetector.H * 3];
                for (int y = 0; y < MotionDetector.H; y++)
                    System.Runtime.InteropServices.Marshal.Copy(new IntPtr(bd.Scan0.ToInt64() + (long)y * bd.Stride), res, y * MotionDetector.W * 3, MotionDetector.W * 3);
                return res;
            }
            finally { small.UnlockBits(bd); }
        }
    }

    public static byte[] MakeJpeg(Bitmap bmp)
    {
        using (MemoryStream ms = new MemoryStream()) { bmp.Save(ms, ImageFormat.Jpeg); return ms.ToArray(); }
    }
}

class FrameHub
{
    readonly object o = new object();
    byte[] last;
    long seq;

    public long Seq { get { lock (o) { return seq; } } }
    public byte[] Latest() { lock (o) { return last; } }

    public void Publish(byte[] jpeg)
    {
        lock (o) { last = jpeg; seq++; Monitor.PulseAll(o); }
    }

    public bool WaitNext(long after, int timeoutMs, out byte[] jpeg, out long newSeq)
    {
        lock (o)
        {
            if (seq <= after) Monitor.Wait(o, timeoutMs);
            if (seq > after) { jpeg = last; newSeq = seq; return true; }
        }
        jpeg = null; newSeq = after;
        return false;
    }
}
