-- เพิ่มช่อง GTIN ที่ 2 และ 3 ให้ตาราง products (รันใน Supabase > SQL Editor ครั้งเดียว)
-- ปลอดภัย: เพิ่มคอลัมน์ว่างเท่านั้น ข้อมูลเดิม (gtin) ไม่ถูกแตะ
alter table public.products
  add column if not exists gtin2 text,
  add column if not exists gtin3 text;
