-- ============================================================
--  جدولي — ملف إنشاء قاعدة البيانات في Supabase
--  طريقة الاستخدام:
--  1) افتح مشروعك في Supabase -> SQL Editor -> New query
--  2) الصق هذا الملف كاملاً ثم اضغط Run
-- ============================================================

-- جدول الخطط (الباقات): أسبوعي / شهري / سنوي
create table if not exists plans (
  id text primary key,                 -- weekly | monthly | yearly
  name text not null,
  price numeric not null default 0,    -- بالدينار العراقي
  days integer not null default 0,
  features text not null default ''
);

-- جدول العملاء (حسابات الدخول إلى نظام جدولي)
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  pass_hash text not null,
  full_name text not null default '',
  phone text not null default '',
  plan text not null default 'weekly' references plans(id),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null default now(),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- بيانات أولية للخطط (يمكن تعديل الأسعار لاحقاً من صفحة الإدارة)
insert into plans (id, name, price, days, features) values
  ('weekly',  'اشتراك أسبوعي', 5000,   7,  'استخدام كامل للنظام لمدة أسبوع'),
  ('monthly', 'اشتراك شهري',   15000, 30, 'استخدام كامل للنظام + دعم فني'),
  ('yearly',  'اشتراك سنوي',   120000, 365, 'استخدام كامل + دعم فني + تحديثات مستمرة')
on conflict (id) do nothing;

-- ملاحظة أمنية:
-- لتسهيل التشغيل نعطّل RLS على الجدولين (الإدارة تتم من الواجهة).
-- هذا يكفي لهذا النطاق من الاستخدام؛ يمكن لاحقاً تفعيل RLS وسياسات أكثر صرامة.
alter table plans disable row level security;
alter table clients disable row level security;
