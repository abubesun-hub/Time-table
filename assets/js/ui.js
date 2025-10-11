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
    // scroll to top when switching views
    window.scrollTo(0, 0);
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
    const { title = 'طباعة', css = '', afterWrite, rasterize = false, rasterScale = 2, preferExternalPreview = true } = opts;
    // If running inside Electron packaged app, prefer opening in external browser for preview and printer selection
    if (preferExternalPreview && window.native && typeof window.native.openInBrowser === 'function' && !/https?:/i.test(location.protocol)) {
      const baseCss = `@page { size: auto; margin: 12mm 5mm 12mm 5mm; } *{ box-sizing: border-box } body{ font-family: Tajawal, Segoe UI, Arial; direction: rtl; padding:0; margin:0; color:#111827 } header.print-header, footer.print-footer{ position:fixed; inset-inline:0 } header.print-header{ top:0; padding:10mm 5mm 4mm; border-bottom:1px solid #ddd } footer.print-footer{ bottom:0; padding:6mm 5mm 8mm; border-top:1px solid #ddd; display:flex; align-items:center; justify-content:space-between; gap:12px } main.print-body{ padding:46mm 7mm 24mm 5mm } table{ width:100%; border-collapse:collapse } td,th{ border:1px solid #ccc; padding:6px } .muted{ color:#6b7280 } img.logo{ height:52px }`;
      const doc = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${baseCss}${css}</style><script>window.addEventListener('load',()=>{setTimeout(()=>{try{window.print();}catch(e){}},150)});</script></head><body>${html}</body></html>`;
      window.native.openInBrowser({ html: doc, fileNameBase: 'Jadwaly', title })
        .then((res) => { if (!res || res.ok === false) console.error('openInBrowser failed', res && res.error); })
        .catch((e) => console.error('openInBrowser error', e));
      return;
    }
    const w = window.open('', '_blank');
    const baseCss = `
      /* اجعل الهوامش الجانبية 5mm افتراضيًا مع إبقاء العلوية/السفلية 12mm */
      @page { size: auto; margin: 12mm 5mm 12mm 5mm; }
      *{ box-sizing: border-box }
      body{ font-family: Tajawal, Segoe UI, Arial; direction: rtl; padding: 0; margin: 0; color: #111827 }
      header.print-header, footer.print-footer{ position: fixed; inset-inline: 0; }
      /* قلّل الحشوات الأفقية للاستفادة من هوامش 5mm */
      header.print-header{ top: 0; padding: 10mm 5mm 4mm; border-bottom: 1px solid #ddd; }
      footer.print-footer{ bottom: 0; padding: 6mm 5mm 8mm; border-top: 1px solid #ddd; display:flex; align-items:center; justify-content:space-between; gap:12px }
      /* زيدت المسافة العلوية لتفادي تداخل رأس الصفحة مع المحتوى، خاصة مع العنوان والسنة الدراسية */
  /* زِد الحافة اليمنى قليلاً لتفادي قص عمود اليمين عند التكبير من اليمين */
  main.print-body{ padding: 46mm 7mm 24mm 5mm; }
      table{ width:100%; border-collapse:collapse }
      td,th{ border:1px solid #ccc; padding:6px }
      .muted{ color:#6b7280 }
      .left{ text-align:left }
      .right{ text-align:right }
      img.logo{ height: 52px }
    `;
  w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${title}</title><style>${baseCss}${css}</style></head><body>${html}</body></html>`);
    w.document.close();
    // اضبط حشوة محتوى الطباعة حسب ارتفاع الرأس/التذييل لمنع التداخل
    try {
      const adjust = () => {
        const doc = w.document;
        const main = doc.querySelector('main.print-body');
        const head = doc.querySelector('header.print-header');
        const foot = doc.querySelector('footer.print-footer');
        if (main && head) main.style.paddingTop = (head.offsetHeight + 8) + 'px';
        if (main && foot) main.style.paddingBottom = (foot.offsetHeight + 8) + 'px';
      };
      // نفّذ مباشرة وبعد تحميل الصور وتغيير المقاس
      w.addEventListener('load', () => setTimeout(adjust, 10));
      setTimeout(adjust, 30);
      Array.from(w.document.images || []).forEach(img => { if (!img.complete) img.addEventListener('load', adjust, { once:true }); });
      w.addEventListener('resize', adjust);
    } catch {}
    if (typeof afterWrite === 'function') try { afterWrite(w); } catch {}
    w.focus();
    // في وضع التحويل إلى صورة: حمّل html2canvas ثم حوّل المحتوى إلى صورة واطبع
    if (rasterize) {
      const loadScript = (win, src) => new Promise((resolve, reject) => {
        const s = win.document.createElement('script'); s.src = src; s.async = true;
        s.onload = () => resolve(); s.onerror = (e) => reject(e); win.document.head.appendChild(s);
      });
      const doRaster = async () => {
        try {
          // حمّل المكتبة من CDN إذا لم تكن موجودة
          if (!w.html2canvas) {
            await loadScript(w, 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
          }
          const root = w.document.body;
          // انتظر دورة رسم لضمان اكتمال التهيئة
          await new Promise(r => setTimeout(r, 50));
          // اضبط مقياس التحويل ديناميكيًا حسب نسبة تكبير الصفحة (A4/A3/A2...)
          const contentW = root.scrollWidth || w.document.documentElement.scrollWidth || w.innerWidth;
          const contentH = root.scrollHeight || w.document.documentElement.scrollHeight || w.innerHeight;
          const availW = w.innerWidth || contentW;
          const availH = w.innerHeight || contentH;
          // إن كانت الصفحة أكبر من المحتوى فسيتم تكبير الصورة لاحقًا، لذا زد scale للحفاظ على الدقة
          const upW = availW / Math.max(1, contentW);
          const upH = availH / Math.max(1, contentH);
          const up = Math.max(1, Math.min(upW, upH));
          const effScale = Math.min(3, Math.max(rasterScale || 2, (rasterScale || 2) * up));
          const canvas = await w.html2canvas(root, {
            scale: effScale,
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#ffffff',
            windowWidth: root.scrollWidth,
            windowHeight: root.scrollHeight
          });
          const dataURL = canvas.toDataURL('image/png');
          // ضع الصورة داخل حاوية تملأ الارتفاع المتاح للصفحة لتكبيرها تلقائيًا دون قص
          w.document.body.innerHTML = `<div style="width:100%;height:100vh;display:block"><img src="${dataURL}" style="width:100%;height:100%;display:block;object-fit:contain"></div>`;
          setTimeout(() => w.print(), 200);
        } catch (e) {
          // فشل التحويل (غالبًا بسبب CORS للصور) → عُد للطباعة العادية
          setTimeout(() => w.print(), 350);
        }
      };
      doRaster();
    } else {
      setTimeout(() => w.print(), 350);
    }
  }

  function printDocument({ contentHtml, docTitle, school, orientation = 'portrait', margin = '12mm', fontScale = 1, footerLeftImageUrl = '', footerRightHtml = '', fontFamily = '' , leftHeaderHtml = '', headerTypography = {}, noFixedHeader = false, rasterize = false, rasterScale = 2, afterWrite }) {
    const dateStr = new Date().toLocaleString('ar-EG');
    const logoHtml = school?.logo ? `<img class="logo" src="${school.logo}" alt="logo">` : '';
    // حقل الجنس يُعرَض بصيغ: ذكور→ للبنين، إناث→ للبنات، مختلط→ المختلطة
    const _rawGender = (school?.gender || '').toString();
    const _normGender = _rawGender.replace(/[\sـ]/g, '');
    let genderDisplay = '';
  if (/(ذكور|للذكور|بنين)/.test(_normGender)) genderDisplay = 'للبنين';
  else if (/(اناث|إناث|للاناث|للإناث|بنات)/.test(_normGender)) genderDisplay = 'للبنات';
  else if (/(مختلط|مختلطة|مشترك)/.test(_normGender)) genderDisplay = 'المختلطة';
    else genderDisplay = _rawGender;

    const headerHtml = `
      <header class="print-header">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <!-- Right: school info -->
          <div style="text-align:center">
            <div style="font-weight:800;${headerTypography?.schoolName?.family ? `font-family:${headerTypography.schoolName.family};` : ''}font-size:${(headerTypography?.schoolName?.size ?? 18)*fontScale}px">${school?.name || 'المدرسة'}</div>
            <div class="muted" style="${headerTypography?.gender?.family ? `font-family:${headerTypography.gender.family};` : ''}font-size:${(headerTypography?.gender?.size ?? 12)*fontScale}px">${genderDisplay || ''}</div>
          </div>
          <!-- Center: document title + academic year -->
          <div style="text-align:center; flex:1">
            <div style="font-weight:800; letter-spacing:0; direction:rtl; unicode-bidi:isolate; ${headerTypography?.docTitle?.family ? `font-family:${headerTypography.docTitle.family};` : ''} font-size:${(headerTypography?.docTitle?.size ?? 16)*fontScale}px">${docTitle || ''}</div>
            ${school?.year ? `<div class="muted" style="margin-top:2px; ${headerTypography?.year?.family ? `font-family:${headerTypography.year.family};` : ''} font-size:${(headerTypography?.year?.size ?? 12)*fontScale}px">للعام الدراسي ${school.year}</div>` : ''}
          </div>
          <!-- Left: optional slot (e.g. class/section) + logo below -->
          <div style="text-align:left; display:flex; align-items:center; gap:8px">
            <div style="font-weight:800; ${headerTypography?.left?.family ? `font-family:${headerTypography.left.family};` : ''} font-size:${(headerTypography?.left?.size ?? 16)*fontScale}px">${leftHeaderHtml || ''}</div>
            <div>${logoHtml}</div>
          </div>
        </div>
      </header>`;
    const footerHtml = `
      <footer class="print-footer">
        <div>${footerLeftImageUrl ? `<img src="${footerLeftImageUrl}" alt="footer" style="height:${28*fontScale}px">` : ''}</div>
        <div style="margin-inline-start:auto;text-align:right; font-size:${12*fontScale}px">${footerRightHtml || ''}</div>
      </footer>`;
    const html = noFixedHeader
      ? `<main class="print-body no-fixed">${contentHtml}</main>`
      : `${headerHtml}<main class="print-body">${contentHtml}</main>${footerHtml}`;
    const o = String(orientation||'portrait');
    // إن تم تمرير مقاس ورق صريح (مثل "A3" أو "A3 landscape") نستخدمه كما هو
    const hasExplicitSize = /(A\d|Letter|Legal|Tabloid|Executive)/i.test(o);
    const pageSize = hasExplicitSize ? o : (/landscape/i.test(o) ? 'landscape' : /portrait/i.test(o) ? 'portrait' : 'auto');
    const css = `@page{ size: ${pageSize}; margin: ${margin}; }
      body{ font-size:${14*fontScale}px; ${fontFamily ? `font-family:${fontFamily}` : ''} }
      th{ font-weight:700 }
      .print-body.no-fixed{ padding: 12mm }`;
    printHtml(html, { title: docTitle || 'طباعة', css, rasterize, rasterScale, afterWrite });
  }

  global.UI = { qs, qsa, routeTo, showToast, renderList, printHtml, printDocument };
})(window);
