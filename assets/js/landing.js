// ============================================================
//  منطق صفحة الهبوط (index.html):
//  - نظام التسعير (الخطط من Supabase مع قيم افتراضية)
//  - نافذة تسجيل الدخول (حسابات صفحة الإدارة)
//  - زر الدخول يتحول لـ "افتح النظام" عند وجود جلسة صالحة
// ============================================================
(function () {
  'use strict';

  const isDesktop = !!(window.env && window.env.platform);
  const supabaseReady = !!(window.SUPABASE_ENABLED && window.SBSession && window.SBSession.configured);

  const DEFAULT_PLANS = [
    { id: 'weekly', name: 'اشتراك أسبوعي', price: 5000, days: 7, features: 'استخدام كامل للنظام لمدة أسبوع' },
    { id: 'monthly', name: 'اشتراك شهري', price: 15000, days: 30, features: 'استخدام كامل للنظام + دعم فني' },
    { id: 'yearly', name: 'اشتراك سنوي', price: 120000, days: 365, features: 'استخدام كامل + دعم فني + تحديثات مستمرة' }
  ];

  const ICONS = {
    weekly: 'fa-calendar-week',
    monthly: 'fa-calendar-days',
    yearly: 'fa-crown'
  };
  const BADGE = {
    weekly: '',
    monthly: 'الأكثر شيوعاً',
    yearly: 'أفضل قيمة'
  };

  // ===== عناصر =====
  const pricingHost = document.getElementById('pricingCards');
  const modal = document.getElementById('loginModal');
  const loginForm = document.getElementById('loginForm');
  const loginError = document.getElementById('loginError');
  const loginSubmit = document.getElementById('loginSubmit');

  function fmtPrice(n) {
    return Number(n || 0).toLocaleString('en-US') + ' د.ع';
  }

  function renderPlans(plans) {
    if (!pricingHost) return;
    pricingHost.innerHTML = (plans || []).map(function (p) {
      const featured = p.id === 'monthly';
      return `
      <div class="feature-card group relative rounded-3xl border ${featured ? 'border-indigo-400 ring-2 ring-indigo-200' : 'border-slate-100'} bg-white p-8 shadow-lg shadow-slate-900/5 ${featured ? 'md:-translate-y-4' : ''}">
        ${BADGE[p.id] ? `<span class="absolute -top-3 right-6 rounded-full bg-gradient-to-l from-indigo-700 to-violet-600 px-4 py-1 text-xs font-bold text-white shadow-lg">${BADGE[p.id]}</span>` : ''}
        <div class="feature-icon mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-50 to-violet-50 text-indigo-700">
          <i class="fa-solid ${ICONS[p.id] || 'fa-tag'} text-2xl"></i>
        </div>
        <h3 class="mb-2 text-xl font-extrabold text-slate-900">${p.name}</h3>
        <div class="mb-4 flex items-end gap-1">
          <span class="text-4xl font-black text-indigo-700">${fmtPrice(p.price)}</span>
          <span class="pb-1 text-sm font-semibold text-slate-500">/ ${p.days} يوم</span>
        </div>
        <p class="mb-6 text-sm leading-relaxed text-slate-600">${p.features || ''}</p>
        <a href="https://wa.me/9647905880479?text=${encodeURIComponent('أرغب بالاشتراك في جدولي — باقة ' + p.name)}"
           target="_blank" rel="noopener"
           class="inline-flex w-full items-center justify-center gap-2 rounded-xl ${featured ? 'bg-gradient-to-l from-indigo-700 to-violet-600 text-white shadow-lg shadow-indigo-600/30' : 'border-2 border-indigo-200 bg-white text-indigo-700'} px-6 py-3 text-sm font-bold transition-all duration-300 hover:-translate-y-0.5">
          <i class="fa-brands fa-whatsapp"></i> اشترك الآن
        </a>
      </div>`;
    }).join('');
  }

  async function loadPlans() {
    if (supabaseReady) {
      try {
        const plans = await window.SBSession.loadPlans();
        if (plans && plans.length) { renderPlans(plans); return; }
      } catch { /* استخدم القيم الافتراضية */ }
    }
    renderPlans(DEFAULT_PLANS);
  }

  // ===== نافذة تسجيل الدخول =====
  function openModal() { if (modal) modal.classList.remove('hidden'); }
  function closeModal() { if (modal) modal.classList.add('hidden'); }

  function setButtons(linkOrNull, username) {
    const btns = [
      document.getElementById('btnLoginDesktop'),
      document.getElementById('btnLoginMobile'),
      document.getElementById('ctaStartBtn')
    ];
    btns.forEach(function (b) {
      if (!b) return;
      if (linkOrNull) {
        b.setAttribute('href', linkOrNull);
        b.classList.remove('js-open-login');
        b.innerHTML = username
          ? '<i class="fa-solid fa-right-to-bracket text-xs"></i> فتح النظام'
          : b.innerHTML;
        if (username) {
          b.innerHTML = '<i class="fa-solid fa-rocket text-xs"></i> فتح النظام (' + username + ')';
        }
      } else {
        b.removeAttribute('href');
        b.classList.add('js-open-login');
      }
    });
  }

  async function refreshHeader() {
    // سطح المكتب: الدخول مباشرة إلى النظام
    if (isDesktop) { setButtons('app.html'); return; }
    if (!supabaseReady) {
      setButtons(null); // يفتح المودال مع رسالة خطأ التهيئة
      return;
    }
    const session = window.SBSession.getSession();
    if (session && session.username) {
      try {
        const client = await window.SBSession.verifySession(session.username);
        if (client) { setButtons('app.html', client.username); return; }
      } catch {}
      window.SBSession.clearSession();
    }
    setButtons(null);
  }

  // توحيد الأرقام العربية مع الإنجليزية (يقي من أخطاء لوحة المفاتيح)
  function normDigits(s) {
    return String(s == null ? '' : s)
      .replace(/[\u0660-\u0669]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48); })
      .replace(/[\u06F0-\u06F9]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 48); })
      .trim();
  }

  // تنظيف قوي لمقارنة بيانات المسؤول: إزالة الحروف الخفية وكل الفراغات
  function cleanInput(s) {
    return String(s == null ? '' : s)
      .replace(/[\u0660-\u0669]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48); })
      .replace(/[\u06F0-\u06F9]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 48); })
      .replace(/[\u200B-\u200F\u2028-\u202E\u2060\uFEFF]/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

  async function handleLogin(e) {
    e.preventDefault();
    if (!loginError || !loginSubmit) return;
    const username = normDigits((document.getElementById('loginUsername') || {}).value);
    const password = normDigits((document.getElementById('loginPassword') || {}).value);
    loginError.classList.add('hidden');

    // 1) بيانات المسؤول → فتح صفحة الإدارة مباشرة
    const creds = window.ADMIN_CREDENTIALS || { user: 'Ahmed', pass: '1985@1985' };
    const adminUser = cleanInput(creds.user).toLowerCase();
    const adminPass = cleanInput(creds.pass);
    if (cleanInput(username).toLowerCase() === adminUser && cleanInput(password) === adminPass) {
      try { sessionStorage.setItem('jadwaly_admin', '1'); } catch {}
      location.href = 'admin.html';
      return;
    }

    // 2) حسابات العملاء عبر قاعدة البيانات الإلكترونية
    if (!supabaseReady) {
      loginError.textContent = 'بيانات الدخول غير صحيحة (استخدم أرقام إنجليزية 1985@1985) — وقاعدة البيانات الإلكترونية غير مهيأة بعد.';
      loginError.classList.remove('hidden');
      return;
    }
    loginSubmit.disabled = true;
    loginSubmit.textContent = 'جارٍ التحقق...';
    try {
      await window.SBSession.verifyLogin(username, password);
      window.SBSession.setSession(username);
      location.href = 'app.html';
    } catch (err) {
      loginError.textContent = (err && err.message) ? err.message : 'تعذر تسجيل الدخول. حاول لاحقاً.';
      loginError.classList.remove('hidden');
      loginSubmit.disabled = false;
      loginSubmit.textContent = 'دخول';
    }
  }

  function bindEvents() {
    document.addEventListener('click', function (e) {
      const t = e.target && e.target.closest ? e.target.closest('.js-open-login') : null;
      if (t) { e.preventDefault(); openModal(); }
      if (e.target && e.target.closest && e.target.closest('#loginModalClose')) closeModal();
    });
    // زر إظهار كلمة المرور
    document.querySelectorAll('.pw-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const inp = btn.parentElement ? btn.parentElement.querySelector('input') : null;
        if (!inp) return;
        const show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        const icon = btn.querySelector('i');
        if (icon) icon.className = show ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
      });
    });
    if (modal) {
      modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
    }
    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  }

  // رسالة خروج من النظام
  function showGateToast() {
    try {
      const params = new URLSearchParams(location.search);
      const gate = params.get('gate');
      if (gate === 'login') {
        openModal();
      } else if (gate === 'logout') {
        const toast = document.createElement('div');
        toast.className = 'fixed bottom-6 right-6 z-[200] rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white shadow-2xl';
        toast.textContent = 'تم تسجيل الخروج بنجاح 👋';
        document.body.appendChild(toast);
        setTimeout(function () { toast.remove(); }, 3000);
      }
    } catch {}
  }

  loadPlans();
  refreshHeader();
  bindEvents();
  showGateToast();
})();
