// وظائف واجهة المستخدم العامة (تبديل المشاهد، التوست، الطباعة، إلخ)
(function (global) {
  'use strict';

  function qs(s, r = document) { return r.querySelector(s); }
  function qsa(s, r = document) { return [...r.querySelectorAll(s)]; }

  function routeTo(hash) {
    const target = hash || '#/dashboard';
    const id = 'view-' + target.replace('#/', '');
    qsa('.view').forEach(v => v.classList.remove('active'));
    const el = qs('#' + id);
    if (el) el.classList.add('active');
    // update nav state
    qsa('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.route === target));
  }

  function showToast(msg, type = 'info', timeout = 3000) {
    const wrap = qs('#toasts');
    const div = document.createElement('div');
    div.className = 'toast';
    div.textContent = msg;
    wrap.appendChild(div);
    setTimeout(() => div.remove(), timeout);
  }

  function renderList(container, items, renderItem) {
    container.innerHTML = '';
    if (!items || !items.length) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'لا توجد بيانات بعد';
      container.appendChild(empty);
      return;
    }
    items.forEach((item, idx) => container.appendChild(renderItem(item, idx)));
  }

  function printHtml(html) {
    const w = window.open('', '_blank');
    w.document.write('<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>طباعة</title><style>body{font-family:Tajawal,Segoe UI,Arial;direction:rtl;padding:24px} table{width:100%;border-collapse:collapse} td,th{border:1px solid #ccc;padding:6px}</style></head><body>' + html + '</body></html>');
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  global.UI = { qs, qsa, routeTo, showToast, renderList, printHtml };
})(window);
