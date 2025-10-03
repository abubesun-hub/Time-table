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
    // widen container for timetable view
    const app = qs('#app');
    if (app) app.classList.toggle('wide', target === '#/timetable');
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

  function printHtml(html, opts = {}) {
    const { title = 'طباعة', css = '', afterWrite } = opts;
    const w = window.open('', '_blank');
    const baseCss = `
      @page { size: auto; margin: 12mm; }
      *{ box-sizing: border-box }
      body{ font-family: Tajawal, Segoe UI, Arial; direction: rtl; padding: 0; margin: 0; color: #111827 }
      header.print-header, footer.print-footer{ position: fixed; inset-inline: 0; }
      header.print-header{ top: 0; padding: 10mm 12mm 4mm; border-bottom: 1px solid #ddd; }
      footer.print-footer{ bottom: 0; padding: 6mm 12mm 8mm; border-top: 1px solid #ddd; display:flex; align-items:center; justify-content:space-between; gap:12px }
      /* زيدت المسافة العلوية لتفادي تداخل رأس الصفحة مع المحتوى، خاصة مع العنوان والسنة الدراسية */
      main.print-body{ padding: 46mm 12mm 24mm; }
      table{ width:100%; border-collapse:collapse }
      td,th{ border:1px solid #ccc; padding:6px }
      .muted{ color:#6b7280 }
      .left{ text-align:left }
      .right{ text-align:right }
      img.logo{ height: 52px }
    `;
    w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${title}</title><style>${baseCss}${css}</style></head><body>${html}</body></html>`);
    w.document.close();
    if (typeof afterWrite === 'function') try { afterWrite(w); } catch {}
    w.focus();
    setTimeout(() => w.print(), 350);
  }

  function printDocument({ contentHtml, docTitle, school, orientation = 'portrait', margin = '12mm', fontScale = 1, footerLeftImageUrl = '', footerRightHtml = '', fontFamily = '' , leftHeaderHtml = ''}) {
    const dateStr = new Date().toLocaleString('ar-EG');
    const logoHtml = school?.logo ? `<img class="logo" src="${school.logo}" alt="logo">` : '';
    const headerHtml = `
      <header class="print-header">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <!-- Right: school info -->
          <div style="text-align:right">
            <div style="font-weight:800;font-size:${18*fontScale}px">${school?.name || 'المدرسة'}</div>
            <div class="muted" style="font-size:${12*fontScale}px">${school?.address || ''}</div>
            <div class="muted" style="font-size:${12*fontScale}px">${school?.phone || ''} ${school?.email ? ' • ' + school.email : ''}</div>
          </div>
          <!-- Center: document title + academic year -->
          <div style="text-align:center; flex:1">
            <div style="font-weight:800; letter-spacing:0.25px; font-size:${16*fontScale}px">${docTitle || ''}</div>
            ${school?.year ? `<div class="muted" style="margin-top:2px;font-size:${12*fontScale}px">للعام الدراسي ${school.year}</div>` : ''}
            <div class="muted" style="margin-top:2px;font-size:${11*fontScale}px">التاريخ: ${dateStr}</div>
          </div>
          <!-- Left: optional slot (e.g. class/section) + logo below -->
          <div style="text-align:left; display:flex; align-items:center; gap:8px">
            <div style="font-weight:800;font-size:${16*fontScale}px">${leftHeaderHtml || ''}</div>
            <div>${logoHtml}</div>
          </div>
        </div>
      </header>`;
    const footerHtml = `
      <footer class="print-footer">
        <div>${footerLeftImageUrl ? `<img src="${footerLeftImageUrl}" alt="footer" style="height:${28*fontScale}px">` : ''}</div>
        <div style="margin-inline-start:auto;text-align:right; font-size:${12*fontScale}px">${footerRightHtml || ''}</div>
      </footer>`;
    const html = `${headerHtml}<main class="print-body">${contentHtml}</main>${footerHtml}`;
    const css = `@page{ size: ${orientation}; margin: ${margin}; } body{ font-size:${14*fontScale}px; ${fontFamily ? `font-family:${fontFamily}` : ''} } th{ font-weight:700 }`;
    printHtml(html, { title: docTitle || 'طباعة', css });
  }

  global.UI = { qs, qsa, routeTo, showToast, renderList, printHtml, printDocument };
})(window);
