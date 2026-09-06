// ============================================================
//  إعدادات قاعدة البيانات الإلكترونية (Supabase)
// ============================================================
//  خطوات التهيئة:
//  1) أنشئ مشروعاً مجانياً على https://supabase.com
//  2) افتح قائمة SQL Editor داخل المشروع ونفّذ محتوى ملف setup-supabase.sql
//  3) من Project Settings -> API انسخ:
//     - Project URL        -> ضعه في حقل url أدناه
//     - anon public key    -> ضعه في حقل anonKey أدناه
//  4) احفظ الملف وارفع المشروع إلى GitHub Pages
// ============================================================

window.SUPABASE_CONFIG = {
  url: 'https://mjrrelsrlsfdubdzwrks.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qcnJlbHNybHNmZHViZHp3cmtzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2OTQ1NDUsImV4cCI6MjEwNDI3MDU0NX0.DO4RgofaQ4QHB1rhDKxmMr3pZYHHksTftPJMpjBKQm0'
};

// بيانات دخول صفحة إدارة الموقع (يمكنك تغييرها هنا)
window.ADMIN_CREDENTIALS = {
  user: 'Ahmed',
  pass: '1985@1985'
};

// يتفعّل النظام تلقائياً بعد تعبئة الرابط والمفتاح أعلاه
window.SUPABASE_ENABLED = (function () {
  const cfg = window.SUPABASE_CONFIG || {};
  const url = String(cfg.url || '');
  const key = String(cfg.anonKey || '');
  return !!(url && key && !/YOUR-/.test(url) && !/YOUR-/.test(key));
})();
