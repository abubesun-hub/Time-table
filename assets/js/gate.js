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

  // سطح المكتب: يفتح مباشرة
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
