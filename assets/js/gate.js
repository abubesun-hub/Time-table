// ============================================================
//  بوابة الدخول الإلكترونية لنظام جدولي
//  تمنع تصفح النظام (app.html) لأي شخص لا يملك حساباً مفعّلاً
//  من قاعدة البيانات (Supabase).
//  ملاحظة: تطبيق سطح المكتب (Electron) يفتح مباشرة دون البوابة.
// ============================================================
(function () {
  'use strict';

  const isDesktop = !!(window.env && window.env.platform);
  const gate = document.getElementById('online-gate');
  const statusEl = document.getElementById('online-gate-status');

  function allowThrough() {
    if (gate) {
      gate.classList.add('hidden');
      gate.setAttribute('aria-hidden', 'true');
    }
  }

  function showStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  // ===== قائمة معلومات الحساب والاشتراك (تظهر عند الضغط على اسم المستخدم) =====
  const PLAN_NAMES = { weekly: 'اشتراك أسبوعي', monthly: 'اشتراك شهري', yearly: 'اشتراك سنوي' };

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('ar-EG');
  }

  function daysLeft(iso) {
    if (!iso) return null;
    const ms = new Date(iso).getTime() - Date.now();
    return Math.ceil(ms / 86400000);
  }

  function closeAccountMenu() {
    const box = document.getElementById('accountBox');
    const menu = document.getElementById('accountMenu');
    if (box) box.classList.remove('open');
    if (menu) menu.classList.add('hidden');
  }

  function renderAccountMenu(client) {
    const body = document.getElementById('accountMenuBody');
    if (!body) return;
    if (isDesktop || !client) {
      body.innerHTML =
        '<div class="account-menu-row"><span class="am-label">وضع العمل</span><span class="am-value">سطح المكتب (محلي)</span></div>' +
        '<div class="account-menu-row"><span class="am-label">ملاحظة</span><span class="am-value">لا يتطلب اشتراكاً إلكترونياً</span></div>';
      return;
    }
    const left = daysLeft(client.expires_at);
    const active = client.active !== false && left !== null && left > 0;
    const rows = [
      ['الاسم', client.full_name || client.username],
      ['اسم المستخدم', client.username],
      ['الباقة', '<span class="am-value plan-badge">' + (PLAN_NAMES[client.plan] || client.plan) + '</span>'],
      ['بداية الاشتراك', fmtDate(client.starts_at)],
      ['نهاية الاشتراك', fmtDate(client.expires_at)],
      ['المتبقي', left === null ? '—' : (left > 0 ? left + ' يوم' : 'منتهي')],
      ['الحالة', active ? '<span class="am-value ok">مفعّل ✓</span>' : '<span class="am-value bad">منتهي / موقوف</span>']
    ];
    body.innerHTML = rows.map(function (r) {
      return '<div class="account-menu-row"><span class="am-label">' + r[0] + '</span>' + r[1] + '</div>';
    }).join('');
  }

  function toggleAccountMenu() {
    const box = document.getElementById('accountBox');
    const menu = document.getElementById('accountMenu');
    if (!box || !menu) return;
    if (!menu.classList.contains('hidden')) { closeAccountMenu(); return; }
    box.classList.add('open');
    menu.classList.remove('hidden');
    renderAccountMenu(window.__JadwalyClient || null);
    // تحديث فوري من قاعدة البيانات عند كل فتح
    const session = (window.SBSession && window.SBSession.getSession()) || {};
    if (!isDesktop && session.username) {
      try {
        window.SBSession.verifySession(session.username).then(function (fresh) {
          if (fresh) { window.__JadwalyClient = fresh; renderAccountMenu(fresh); }
        }).catch(function () {});
      } catch {}
    }
  }

  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest && e.target.closest('#accountBox')) {
      if (e.target.closest('#btnLogout')) return; // معالج الخروج منفصل
      toggleAccountMenu();
      return;
    }
    closeAccountMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAccountMenu();
  });

  // سطح المكتب: يفتح مباشرة دون بوابة إلكترونية
  if (isDesktop) {
    allowThrough();
    return;
  }

  function redirectToLanding() {
    try { if (window.SBSession) window.SBSession.clearSession(); } catch {}
    location.replace('index.html?gate=login');
  }

  function finishAuth(username) {
    const apply = () => {
      if (window.JadwalyGate && typeof window.JadwalyGate.onAuthorized === 'function') {
        try { window.JadwalyGate.onAuthorized(username); } catch {}
        allowThrough();
      } else {
        // انتظار تعريف الواجهة من app.js
        setTimeout(apply, 100);
      }
    };
    apply();
  }

  async function runGate() {
    if (!window.SUPABASE_ENABLED || !window.SBSession || !window.SBSession.configured) {
      showStatus('خطأ: قاعدة البيانات الإلكترونية غير مهيأة. املأ ملف supabase-config.js ثم أعد النشر.');
      return;
    }
    const session = window.SBSession.getSession();
    if (!session || !session.username) {
      showStatus('لا يمكنك الدخول بدون حساب. جارٍ تحويلك لصفحة الدخول...');
      setTimeout(redirectToLanding, 600);
      return;
    }
    showStatus('جارٍ التحقق من حسابك...');
    let client = null;
    try { client = await window.SBSession.verifySession(session.username); } catch { client = null; }
    if (!client) {
      showStatus('حسابك غير مفعّل أو انتهى اشتراكك. جارٍ تحويلك لصفحة الدخول...');
      setTimeout(redirectToLanding, 900);
      return;
    }
    showStatus('مرحباً بك في جدولي، ' + (client.full_name || client.username));
    window.__JadwalyClient = client;
    renderAccountMenu(client);
    finishAuth(client.username);
  }

  // عند تسجيل الخروج من داخل النظام: مسح الجلسة والعودة لصفحة الدخول
  document.addEventListener('click', function (e) {
    const btn = e.target && e.target.closest ? e.target.closest('#btnLogout') : null;
    if (!btn) return;
    try { if (window.SBSession) window.SBSession.clearSession(); } catch {}
    setTimeout(function () { location.replace('index.html?gate=logout'); }, 80);
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runGate);
  } else {
    runGate();
  }
})();
