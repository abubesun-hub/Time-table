// منطق التطبيق: التفعيل، CRUD، الفواتير، النسخ الاحتياطي، الإعدادات
(async function () {
  'use strict';
  const { qs, qsa, routeTo, showToast, renderList, printHtml } = UI;

  // Activation
  const deviceId = Store.getDeviceId();
  const deviceIdField = qs('#deviceIdField');
  if (deviceIdField) deviceIdField.value = deviceId;
  const setupDeviceIdField = qs('#setupDeviceIdField');
  if (setupDeviceIdField) setupDeviceIdField.value = deviceId;
  qs('#copyDeviceIdBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    await navigator.clipboard.writeText(deviceId);
    showToast('تم نسخ معرّف الجهاز');
  });
  const copyDeviceIdSetup = qs('#copyDeviceIdBtnSetup');
  if (copyDeviceIdSetup) copyDeviceIdSetup.addEventListener('click', async (e) => {
    e.preventDefault();
    await navigator.clipboard.writeText(deviceId);
    showToast('تم نسخ معرّف الجهاز');
  });

  async function isActivated() {
    const blob = Store.getLicenseBlob();
    if (!blob) return false;
    try {
      const json = await CryptoLite.unprotect(blob, deviceId);
      const lic = JSON.parse(json);
      // basic checks
      if (lic.deviceId !== deviceId) return false;
      if (lic.expiresAt && Date.now() > lic.expiresAt) return false;
      return true;
    } catch { return false; }
  }

  async function getLicenseInfo() {
    const blob = Store.getLicenseBlob();
    if (!blob) return null;
    try {
      const json = await CryptoLite.unprotect(blob, deviceId);
      return JSON.parse(json);
    } catch { return null; }
  }

  async function updateActivationUI() {
    const ok = await isActivated();
    const overlay = qs('#activation-overlay');
    overlay.classList.toggle('hidden', ok);
    overlay.setAttribute('aria-hidden', ok ? 'true' : 'false');
    const status = qs('#licenseStatus');
    const infoPre = qs('#licenseInfo');
    const info = await getLicenseInfo();
    status.textContent = ok ? 'مُفعّل' : 'غير مُفعّل';
    infoPre.textContent = info ? JSON.stringify({ ...info, deviceId: '***' }, null, 2) : '';
    // lock views if not activated
    qsa('.nav-btn').forEach(btn => {
      const route = btn.dataset.route;
      const allowed = ['#/activation'];
      btn.disabled = !ok && !allowed.includes(route);
    });
    if (!ok) routeTo('#/activation');
  }

  qs('#activateBtn').addEventListener('click', async () => {
    const text = qs('#licenseInput').value.trim();
    if (!text) return showToast('الرجاء لصق نص الرخصة');
    try {
      // Validate structure by trying to decrypt using deviceId as key
      const json = await CryptoLite.unprotect(text, deviceId);
      const lic = JSON.parse(json);
      if (lic.deviceId !== deviceId) throw new Error('wrong-device');
      Store.setLicenseBlob(text);
      showToast('تم التفعيل بنجاح');
      await updateActivationUI();
    } catch (e) {
      showToast('فشل التفعيل. تحقق من الرخصة ومعرّف الجهاز.');
    }
  });

  qs('#pasteLicenseBtn').addEventListener('click', async () => {
    try {
      qs('#licenseInput').value = await navigator.clipboard.readText();
    } catch { showToast('تعذر الوصول إلى الحافظة'); }
  });

  qs('#btnShowActivation').addEventListener('click', () => {
    qs('#activation-overlay').classList.remove('hidden');
  });

  qs('#btnRemoveActivation').addEventListener('click', async () => {
    if (!confirm('هل تريد إلغاء التفعيل؟')) return;
    Store.removeLicense();
    await updateActivationUI();
  });

  // Router
  window.addEventListener('hashchange', () => routeTo(location.hash));
  qsa('[data-route-link]').forEach(a => a.addEventListener('click', (e) => {
    e.preventDefault();
    const r = a.getAttribute('data-route-link');
    location.hash = r;
  }));
  qsa('.nav-btn').forEach(b => b.addEventListener('click', () => location.hash = b.dataset.route));

  // Data helpers
  function refreshStats() {
    const db = Store.getDB();
    qs('#stat-subjects').textContent = db.subjects.length;
    qs('#stat-classes').textContent = db.classes.length;
    qs('#stat-teachers').textContent = db.teachers.length;
    qs('#stat-invoices').textContent = db.invoices.length;
  }

  // Auth (local only)
  async function ensureAdminSetup() {
    const db = Store.getDB();
    const overlay = UI.qs('#setup-overlay');
    const login = UI.qs('#login-overlay');
    const hasUser = (db.auth.users || []).length > 0;
    overlay.classList.toggle('hidden', hasUser);
    overlay.setAttribute('aria-hidden', hasUser ? 'true' : 'false');
    login.classList.toggle('hidden', !hasUser);
    login.setAttribute('aria-hidden', !hasUser ? 'true' : 'false');
  }

  async function updateAccountUI() {
    const db = Store.getDB();
    const user = db.auth.currentUser;
    qs('#currentUser').textContent = user || 'غير مسجل';
    // Lock all views when logged out
    const loggedIn = !!user;
    qsa('.nav-btn').forEach(btn => {
      const route = btn.dataset.route;
      const allowed = ['#/activation', '#/settings'];
      btn.disabled = !loggedIn && !allowed.includes(route);
    });
    if (!loggedIn) UI.qs('#login-overlay').classList.remove('hidden');
  }

  async function login(user, pass) {
    const db = Store.getDB();
    // Normalize Arabic-Indic digits to ASCII
    const normalizeDigits = (s) => s.replace(/[\u0660-\u0669]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48))
                                    .replace(/[\u06F0-\u06F9]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 48));
    const userN = normalizeDigits(user || '').trim();
    const passN = normalizeDigits(pass || '');
    const passHash = await CryptoLite.sha256(passN);
    const ok = (db.auth.users || []).some(u => u.user === userN && u.passHash === passHash);
    if (!ok) return false;
    db.auth.currentUser = userN; Store.setDB(db); return true;
  }

  function logout() {
    const db = Store.getDB();
    db.auth.currentUser = null; Store.setDB(db);
  }

  qs('#btnSetupAdmin').addEventListener('click', async () => {
    const normalizeDigits = (s) => s.replace(/[\u0660-\u0669]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48))
                                    .replace(/[\u06F0-\u06F9]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 48));
    const user = normalizeDigits(qs('#setupUser').value).trim();
    const pass = normalizeDigits(qs('#setupPass').value);
    if (!user || !pass) return showToast('أدخل اسم المستخدم وكلمة المرور');
    const db = Store.getDB();
    if ((db.auth.users || []).find(u => u.user === user)) return showToast('المستخدم موجود بالفعل');
    const passHash = await CryptoLite.sha256(pass);
    db.auth.users.push({ user, passHash });
    db.auth.currentUser = user;
    Store.setDB(db);
    UI.qs('#setup-overlay').classList.add('hidden');
    showToast('تم إنشاء حساب المسؤول');
    updateAccountUI();
  });

  qs('#btnLogin').addEventListener('click', async () => {
    const normalizeDigits = (s) => s.replace(/[\u0660-\u0669]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48))
                                    .replace(/[\u06F0-\u06F9]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 48));
    const user = normalizeDigits(qs('#loginUser').value).trim();
    const pass = normalizeDigits(qs('#loginPass').value);
    const ok = await login(user, pass);
    if (!ok) return showToast('بيانات الدخول غير صحيحة. تأكد من اسم المستخدم وكلمة المرور (استخدم أرقام 0-9).');
    UI.qs('#login-overlay').classList.add('hidden');
    updateAccountUI();
  });

  // Submit on Enter
  ['#loginUser', '#loginPass'].forEach(sel => {
    const el = qs(sel); if (!el) return;
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') qs('#btnLogin').click(); });
  });
  ['#setupUser', '#setupPass'].forEach(sel => {
    const el = qs(sel); if (!el) return;
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') qs('#btnSetupAdmin').click(); });
  });

  qs('#btnLogout').addEventListener('click', () => {
    logout(); updateAccountUI();
  });

  // Reset users to first-run
  const btnResetUsers = qs('#btnResetUsers');
  if (btnResetUsers) btnResetUsers.addEventListener('click', () => {
    if (!confirm('سيتم حذف كل حسابات المستخدمين المحلية وإعادة التطبيق لمرحلة إنشاء المسؤول. المتابعة؟')) return;
    const db = Store.getDB();
    db.auth = { users: [], currentUser: null };
    Store.setDB(db);
    UI.qs('#login-overlay').classList.add('hidden');
    UI.qs('#setup-overlay').classList.remove('hidden');
    showToast('تم حذف المستخدمين. أنشئ حساب المسؤول من جديد.');
  });

  // School form
  function loadSchoolForm() {
    const db = Store.getDB();
    qs('#schoolName').value = db.school.name || '';
    qs('#schoolAddress').value = db.school.address || '';
    qs('#schoolPhone').value = db.school.phone || '';
    qs('#schoolEmail').value = db.school.email || '';
    qs('#schoolLogo').value = db.school.logo || '';
  }
  qs('#form-school').addEventListener('submit', (e) => {
    e.preventDefault();
    const db = Store.getDB();
    db.school = {
      name: qs('#schoolName').value.trim(),
      address: qs('#schoolAddress').value.trim(),
      phone: qs('#schoolPhone').value.trim(),
      email: qs('#schoolEmail').value.trim(),
      logo: qs('#schoolLogo').value.trim(),
    };
    Store.setDB(db);
    showToast('تم حفظ بيانات المدرسة');
  });
  qs('#btnSchoolClear').addEventListener('click', () => {
    if (!confirm('مسح بيانات المدرسة؟')) return;
    const db = Store.getDB();
    db.school = { name: '', address: '', phone: '', email: '', logo: '' };
    Store.setDB(db);
    loadSchoolForm();
  });

  // Subjects CRUD
  function renderSubjects() {
    const list = qs('#subjectsList');
    const db = Store.getDB();
    renderList(list, db.subjects, (s, i) => {
      const item = document.createElement('div');
      item.className = 'list-item';
      const left = document.createElement('div');
      left.innerHTML = `<div class="list-title">${s.name}</div><div class="list-sub">حصص/أسبوع: ${s.weekly}</div>`;
      const actions = document.createElement('div');
      actions.className = 'item-actions';
      const edit = document.createElement('button'); edit.className = 'btn'; edit.textContent = 'تعديل';
      const del = document.createElement('button'); del.className = 'btn danger'; del.textContent = 'حذف';
      edit.addEventListener('click', () => openSubjectModal(s, i));
      del.addEventListener('click', () => {
        if (!confirm('حذف المادة؟')) return;
        db.subjects.splice(i, 1); Store.setDB(db); renderSubjects(); refreshStats();
      });
      actions.append(edit, del);
      item.append(left, actions);
      return item;
    });
  }

  function openSubjectModal(s = null, index = -1) {
    const dlg = qs('#modal-subject');
    qs('#subjectName').value = s?.name || '';
    qs('#subjectWeekly').value = s?.weekly ?? 0;
    dlg.returnValue = 'cancel';
    dlg.showModal();
    dlg.onclose = () => {
      if (dlg.returnValue !== 'default') return;
      const name = qs('#subjectName').value.trim();
      const weekly = parseInt(qs('#subjectWeekly').value, 10) || 0;
      if (!name) return;
      const db = Store.getDB();
      const item = { name, weekly };
      if (index >= 0) db.subjects[index] = item; else db.subjects.push(item);
      Store.setDB(db); renderSubjects(); refreshStats();
    };
  }
  qs('#btnAddSubject').addEventListener('click', () => openSubjectModal());

  // Classes CRUD
  function renderClasses() {
    const list = qs('#classesList');
    const db = Store.getDB();
    renderList(list, db.classes, (c, i) => {
      const item = document.createElement('div');
      item.className = 'list-item';
      const left = document.createElement('div');
      left.innerHTML = `<div class="list-title">${c.name}</div><div class="list-sub">عدد الطلاب: ${c.students}</div>`;
      const actions = document.createElement('div');
      actions.className = 'item-actions';
      const edit = document.createElement('button'); edit.className = 'btn'; edit.textContent = 'تعديل';
      const del = document.createElement('button'); del.className = 'btn danger'; del.textContent = 'حذف';
      edit.addEventListener('click', () => openClassModal(c, i));
      del.addEventListener('click', () => {
        if (!confirm('حذف الصف؟')) return;
        db.classes.splice(i, 1); Store.setDB(db); renderClasses(); refreshStats();
      });
      actions.append(edit, del);
      item.append(left, actions);
      return item;
    });
  }

  function openClassModal(c = null, index = -1) {
    const dlg = qs('#modal-class');
    qs('#className').value = c?.name || '';
    qs('#classStudents').value = c?.students ?? 0;
    dlg.returnValue = 'cancel';
    dlg.showModal();
    dlg.onclose = () => {
      if (dlg.returnValue !== 'default') return;
      const name = qs('#className').value.trim();
      const students = parseInt(qs('#classStudents').value, 10) || 0;
      if (!name) return;
      const db = Store.getDB();
      const item = { name, students };
      if (index >= 0) db.classes[index] = item; else db.classes.push(item);
      Store.setDB(db); renderClasses(); refreshStats();
    };
  }
  qs('#btnAddClass').addEventListener('click', () => openClassModal());

  // Teachers CRUD
  function renderTeachers() {
    const list = qs('#teachersList');
    const db = Store.getDB();
    renderList(list, db.teachers, (t, i) => {
      const item = document.createElement('div');
      item.className = 'list-item';
      const left = document.createElement('div');
      left.innerHTML = `<div class="list-title">${t.name}</div><div class="list-sub">${t.phone || ''} ${t.email ? ' • ' + t.email : ''}</div>`;
      const actions = document.createElement('div');
      actions.className = 'item-actions';
      const edit = document.createElement('button'); edit.className = 'btn'; edit.textContent = 'تعديل';
      const del = document.createElement('button'); del.className = 'btn danger'; del.textContent = 'حذف';
      edit.addEventListener('click', () => openTeacherModal(t, i));
      del.addEventListener('click', () => {
        if (!confirm('حذف المعلم؟')) return;
        db.teachers.splice(i, 1); Store.setDB(db); renderTeachers(); refreshStats();
      });
      actions.append(edit, del);
      item.append(left, actions);
      return item;
    });
  }

  function openTeacherModal(t = null, index = -1) {
    const dlg = qs('#modal-teacher');
    qs('#teacherName').value = t?.name || '';
    qs('#teacherPhone').value = t?.phone || '';
    qs('#teacherEmail').value = t?.email || '';
    dlg.returnValue = 'cancel';
    dlg.showModal();
    dlg.onclose = () => {
      if (dlg.returnValue !== 'default') return;
      const name = qs('#teacherName').value.trim();
      if (!name) return;
      const db = Store.getDB();
      const item = { name, phone: qs('#teacherPhone').value.trim(), email: qs('#teacherEmail').value.trim() };
      if (index >= 0) db.teachers[index] = item; else db.teachers.push(item);
      Store.setDB(db); renderTeachers(); refreshStats();
    };
  }
  qs('#btnAddTeacher').addEventListener('click', () => openTeacherModal());

  // Invoices
  function calcInvoice(items, discountPct) {
    const subtotal = items.reduce((s, it) => s + it.qty * it.price, 0);
    const discount = Math.min(100, Math.max(0, discountPct || 0));
    const discountValue = subtotal * (discount / 100);
    const total = subtotal - discountValue;
    return { subtotal, discount, discountValue, total };
  }

  function parseInvoiceItems(text) {
    const lines = (text || '').split(/\n|\r/).map(l => l.trim()).filter(Boolean);
    return lines.map(l => {
      const [name, qty, price] = l.split(',');
      return { name: name?.trim() || 'بند', qty: parseFloat(qty) || 1, price: parseFloat(price) || 0 };
    });
  }

  function renderInvoices() {
    const list = qs('#invoicesList');
    const db = Store.getDB();
    renderList(list, db.invoices, (inv, i) => {
      const item = document.createElement('div');
      item.className = 'list-item';
      const left = document.createElement('div');
      left.innerHTML = `<div class="list-title">فاتورة #${inv.id} - ${inv.to}</div><div class="list-sub">${new Date(inv.date).toLocaleDateString('ar-EG')} • الإجمالي: ${inv.total.toFixed(2)}</div>`;
      const actions = document.createElement('div');
      actions.className = 'item-actions';
      const print = document.createElement('button'); print.className = 'btn'; print.textContent = 'طباعة';
      const del = document.createElement('button'); del.className = 'btn danger'; del.textContent = 'حذف';
      print.addEventListener('click', () => printInvoice(inv));
      del.addEventListener('click', () => {
        if (!confirm('حذف الفاتورة؟')) return;
        db.invoices.splice(i, 1); Store.setDB(db); renderInvoices(); refreshStats();
      });
      actions.append(print, del);
      item.append(left, actions);
      return item;
    });
  }

  function printInvoice(inv) {
    const db = Store.getDB();
    const logo = db.school.logo ? `<img src="${db.school.logo}" alt="logo" style="height:64px">` : '';
    const rows = inv.items.map(it => `<tr><td>${it.name}</td><td>${it.qty}</td><td>${it.price.toFixed(2)}</td><td>${(it.qty*it.price).toFixed(2)}</td></tr>`).join('');
    const html = `
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div>
            <div style="font-weight:700;font-size:20px">${db.school.name || 'المدرسة'}</div>
            <div style="color:#555">${db.school.address || ''}</div>
            <div style="color:#555">${db.school.phone || ''} ${db.school.email ? ' • ' + db.school.email : ''}</div>
          </div>
          ${logo}
        </div>
        <h2 style="margin:8px 0">فاتورة #${inv.id}</h2>
        <div style="margin-bottom:8px">التاريخ: ${new Date(inv.date).toLocaleDateString('ar-EG')}</div>
        <div style="margin-bottom:8px">المستفيد: ${inv.to}</div>
        <table>
          <thead><tr><th>البند</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:10px;text-align:left">
          <div>المجموع: ${inv.subtotal.toFixed(2)}</div>
          <div>الخصم (${inv.discount}%): -${inv.discountValue.toFixed(2)}</div>
          <div style="font-weight:700">الإجمالي النهائي: ${inv.total.toFixed(2)}</div>
        </div>
      </div>`;
    printHtml(html);
  }

  function openInvoiceModal() {
    const dlg = qs('#modal-invoice');
    qs('#invoiceTo').value = '';
    qs('#invoiceDate').valueAsDate = new Date();
    qs('#invoiceItems').value = '';
    qs('#invoiceDiscount').value = '0';
    qs('#invoiceNotes').value = '';
    dlg.returnValue = 'cancel';
    dlg.showModal();
    dlg.onclose = () => {
      if (dlg.returnValue !== 'default') return;
      const items = parseInvoiceItems(qs('#invoiceItems').value);
      const calc = calcInvoice(items, parseFloat(qs('#invoiceDiscount').value));
      const db = Store.getDB();
      const inv = {
        id: (db.invoices[0]?.id || 1000) + 1,
        to: qs('#invoiceTo').value.trim(),
        date: new Date(qs('#invoiceDate').value).toISOString(),
        items,
        notes: qs('#invoiceNotes').value.trim(),
        ...calc,
      };
      db.invoices.unshift(inv);
      Store.setDB(db);
      renderInvoices();
      refreshStats();
    };
  }
  qs('#btnAddInvoice').addEventListener('click', openInvoiceModal);

  // Timetable
  function getTimetable() { return Store.getDB().timetable; }

  function renderTimetable() {
    const host = qs('#timetableGrid');
    const db = Store.getDB();
    const tt = db.timetable;
    const days = tt.days;
    const slots = tt.slots;
    const grid = tt.grid || {};
    host.innerHTML = '';
    // header row
    const headRow = document.createElement('div');
    headRow.className = 'tt-grid';
    const empty = document.createElement('div'); empty.className = 'tt-cell tt-head'; empty.textContent = 'الحصص/الأيام';
    headRow.appendChild(empty);
    days.forEach(d => { const c = document.createElement('div'); c.className = 'tt-cell tt-head'; c.textContent = d; headRow.appendChild(c); });
    host.appendChild(headRow);
    // rows
    slots.forEach((slot) => {
      const row = document.createElement('div'); row.className = 'tt-grid';
      const sHead = document.createElement('div'); sHead.className = 'tt-cell tt-head'; sHead.textContent = slot; row.appendChild(sHead);
      days.forEach((day) => {
        const key = day + '|' + slot;
        const cell = document.createElement('div'); cell.className = 'tt-cell'; cell.contentEditable = 'true';
        cell.textContent = grid[key] || '';
        cell.dataset.key = key;
        row.appendChild(cell);
      });
      host.appendChild(row);
    });
  }

  function saveTimetableFromUI() {
    const db = Store.getDB();
    const tt = db.timetable; tt.grid = tt.grid || {};
    qsa('.tt-cell[contenteditable="true"]').forEach(cell => {
      tt.grid[cell.dataset.key] = cell.textContent.trim();
    });
    Store.setDB(db);
  }
  qs('#btnSaveTimetable').addEventListener('click', () => { saveTimetableFromUI(); showToast('تم حفظ الجدول'); });
  qs('#btnResetTimetable').addEventListener('click', () => {
    if (!confirm('إعادة تعيين الجدول؟')) return;
    const db = Store.getDB(); db.timetable.grid = {}; Store.setDB(db); renderTimetable();
  });

  // Backup & Import/Export
  function renderBackups() {
    const list = qs('#backupsList');
    const backups = Store.listBackups();
    renderList(list, backups, (b) => {
      const item = document.createElement('div');
      item.className = 'list-item';
      const left = document.createElement('div');
      left.innerHTML = `<div class="list-title">${b.name}</div><div class="list-sub">${new Date(b.date).toLocaleString('ar-EG')} • ${b.size} بايت</div>`;
      const actions = document.createElement('div'); actions.className = 'item-actions';
      const restore = document.createElement('button'); restore.className = 'btn'; restore.textContent = 'استعادة';
      restore.addEventListener('click', () => {
        if (!confirm('استعادة هذه النسخة؟ سيتم استبدال البيانات الحالية.')) return;
        Store.restoreBackup(b.name);
        showToast('تمت الاستعادة');
        hydrate();
      });
      actions.append(restore); item.append(left, actions); return item;
    });
  }

  qs('#btnCreateBackup').addEventListener('click', () => {
    Store.createBackup(); renderBackups(); showToast('تم إنشاء نسخة احتياطية');
  });

  qs('#btnExport').addEventListener('click', () => Store.exportData());
  qs('#fileImport').addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try { await Store.importData(file); showToast('تم الاستيراد'); hydrate(); }
    catch { showToast('فشل الاستيراد. الملف غير صالح.'); }
    e.target.value = '';
  });

  // Settings
  function loadSettings() {
    const db = Store.getDB();
    qs('#themeSelect').value = db.settings.theme || 'auto';
    qs('#densitySelect').value = db.settings.density || 'comfortable';
    document.documentElement.dataset.theme = db.settings.theme;
    document.documentElement.dataset.density = db.settings.density;
  }
  qs('#btnSaveSettings').addEventListener('click', () => {
    const db = Store.getDB();
    db.settings.theme = qs('#themeSelect').value;
    db.settings.density = qs('#densitySelect').value;
    Store.setDB(db);
    loadSettings();
    showToast('تم حفظ الإعدادات');
  });

  qs('#btnResetApp').addEventListener('click', () => {
    if (!confirm('سيتم حذف كل البيانات المحلية وإعادة ضبط التطبيق. هل أنت متأكد؟')) return;
    localStorage.clear();
    location.reload();
  });

  // Hydrate all views
  function hydrate() {
    refreshStats();
    loadSchoolForm();
    renderSubjects();
    renderClasses();
    renderTeachers();
    renderInvoices();
    renderTimetable();
    renderBackups();
    loadSettings();
  }

  // Initialize
  routeTo(location.hash || '#/dashboard');
  hydrate();
  Store.scheduleAutoBackup();
  await updateActivationUI();
  await ensureAdminSetup();
  await updateAccountUI();
})();
