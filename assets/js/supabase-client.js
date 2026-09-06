// ============================================================
//  عميل Supabase المشترك بين الصفحات
//  (صفحة الهبوط - صفحة الإدارة - بوابة نظام جدولي)
// ============================================================
(function (global) {
  'use strict';

  const cfg = global.SUPABASE_CONFIG || {};
  const isConfigured = !!global.SUPABASE_ENABLED;
  const SESSION_KEY = 'jadwaly_session';

  let sb = null;
  if (isConfigured && global.supabase && typeof global.supabase.createClient === 'function') {
    sb = global.supabase.createClient(cfg.url, cfg.anonKey);
  }

  const SBSession = {
    configured: isConfigured,
    get client() { return sb; },

    // تجزئة كلمة المرور (SHA-256) قبل حفظها — نعتمد نفس مكتبة crypto.js
    async hash(text) {
      if (global.CryptoLite && typeof global.CryptoLite.sha256 === 'function') {
        return await global.CryptoLite.sha256(String(text || ''));
      }
      // بديل بسيط إذا لم تتوفر المكتبة
      let h = 0;
      const s = String(text || '');
      for (let i = 0; i < s.length; i++) { h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0; }
      return 'h' + h.toString(16);
    },

    // ===== الخطط (الباقات) =====
    async loadPlans() {
      if (!sb) throw new Error('Supabase غير مهيأ');
      const { data, error } = await sb.from('plans').select('*').order('days', { ascending: true });
      if (error) throw error;
      return data || [];
    },

    async savePlans(plans) {
      if (!sb) throw new Error('Supabase غير مهيأ');
      const rows = (plans || []).map((p) => ({
        id: p.id,
        name: p.name,
        price: Number(p.price) || 0,
        days: Number(p.days) || 0,
        features: p.features || ''
      }));
      const { error } = await sb.from('plans').upsert(rows);
      if (error) throw error;
    },

    // ===== العملاء =====
    async listClients() {
      if (!sb) throw new Error('Supabase غير مهيأ');
      const { data, error } = await sb.from('clients').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },

    async createClient(c) {
      if (!sb) throw new Error('Supabase غير مهيأ');
      const passHash = await this.hash(c.password);
      const { data, error } = await sb.from('clients').insert({
        username: String(c.username || '').trim(),
        pass_hash: passHash,
        full_name: String(c.full_name || '').trim(),
        phone: String(c.phone || '').trim(),
        plan: c.plan || 'weekly',
        starts_at: c.starts_at || new Date().toISOString(),
        expires_at: c.expires_at || new Date().toISOString(),
        active: c.active !== false
      }).select().single();
      if (error) throw error;
      return data;
    },

    async updateClient(id, patch) {
      if (!sb) throw new Error('Supabase غير مهيأ');
      const p = { ...patch };
      if (p.password) {
        p.pass_hash = await this.hash(p.password);
        delete p.password;
      }
      delete p.id;
      const { error } = await sb.from('clients').update(p).eq('id', id);
      if (error) throw error;
    },

    async deleteClient(id) {
      if (!sb) throw new Error('Supabase غير مهيأ');
      const { error } = await sb.from('clients').delete().eq('id', id);
      if (error) throw error;
    },

    // ===== تسجيل الدخول والجلسة =====
    async verifyLogin(username, password) {
      if (!sb) throw new Error('قاعدة البيانات الإلكترونية غير مهيأة بعد. راجع ملف supabase-config.js');
      const passHash = await this.hash(password);
      const { data, error } = await sb.from('clients')
        .select('*')
        .eq('username', String(username || '').trim())
        .maybeSingle();
      if (error) throw new Error('تعذر الاتصال بقاعدة البيانات');
      if (!data) throw new Error('اسم المستخدم غير موجود. تواصل مع الإدارة لإنشاء حساب لك.');
      if (data.pass_hash !== passHash) throw new Error('كلمة المرور غير صحيحة.');
      if (!data.active) throw new Error('حسابك موقوف حالياً. تواصل مع الإدارة.');
      const exp = data.expires_at ? new Date(data.expires_at).getTime() : 0;
      if (exp && exp <= Date.now()) throw new Error('انتهى اشتراكك. يرجى التجديد من الإدارة.');
      return data;
    },

    async verifySession(username) {
      if (!sb || !username) return null;
      try {
        const { data, error } = await sb.from('clients')
          .select('*')
          .eq('username', String(username).trim())
          .maybeSingle();
        if (error || !data) return null;
        if (!data.active) return null;
        const exp = data.expires_at ? new Date(data.expires_at).getTime() : 0;
        if (exp && exp <= Date.now()) return null;
        return data;
      } catch { return null; }
    },

    getSession() {
      try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
    },
    setSession(username) {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ username: String(username || '').trim(), at: Date.now() }));
    },
    clearSession() {
      localStorage.removeItem(SESSION_KEY);
    }
  };

  global.SBSession = SBSession;
})(window);
