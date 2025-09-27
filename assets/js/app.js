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
    const hasUser = (db.auth.users || []).length > 0;
    overlay.classList.toggle('hidden', hasUser);
    overlay.setAttribute('aria-hidden', hasUser ? 'true' : 'false');
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
    const loginOverlay = UI.qs('#login-overlay');
    if (loggedIn) loginOverlay.classList.add('hidden');
    else loginOverlay.classList.remove('hidden');
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
    // Guard: require at least one class before managing subjects
    const guard = qs('#subjectsGuard');
    const hasClasses = (db.classes || []).length > 0;
    if (guard) guard.classList.toggle('hidden', hasClasses);
    const addBtn = qs('#btnAddSubject');
    if (addBtn) addBtn.disabled = !hasClasses;
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
    const cancelBtn = qs('#btnCancelSubject');
    if (cancelBtn) cancelBtn.onclick = () => dlg.close('cancel');
    const form = qs('#form-subject');
    form.onsubmit = (e) => {
      e.preventDefault(); dlg.returnValue = 'default';
      const name = qs('#subjectName').value.trim();
      const weekly = parseInt(qs('#subjectWeekly').value, 10) || 0;
      if (!name) { showToast('أدخل اسم المادة'); return; }
      const db = Store.getDB();
      const item = { name, weekly };
      if (index >= 0) db.subjects[index] = item; else db.subjects.push(item);
      Store.setDB(db); renderSubjects(); refreshStats(); dlg.close('default');
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
      const sections = (c.sections || []).map((s, si) => {
        const tName = (typeof s.teacherId === 'number' && db.teachers[s.teacherId]) ? db.teachers[s.teacherId].name : null;
        const teacherLabel = tName ? ` — ${tName}` : '';
        return `<span class="chip">${s.name}${teacherLabel} <span class="x" title="حذف" data-x="${s.name}">×</span> <span class="x" title="تعديل" data-edit="${si}">✎</span></span>`;
      }).join(' ');
      left.innerHTML = `<div class="list-title">${c.name}</div><div class="list-sub">عدد الطلاب: ${c.students}</div>${sections ? `<div class="chips">${sections}</div>` : ''}`;
      const actions = document.createElement('div');
      actions.className = 'item-actions';
      const edit = document.createElement('button'); edit.className = 'btn'; edit.textContent = 'تعديل';
      const del = document.createElement('button'); del.className = 'btn danger'; del.textContent = 'حذف';
      const addSection = document.createElement('button'); addSection.className = 'btn'; addSection.textContent = 'إضافة شعبة';
      edit.addEventListener('click', () => openClassModal(c, i));
      del.addEventListener('click', () => {
        if (!confirm('حذف الصف؟')) return;
        db.classes.splice(i, 1); Store.setDB(db); renderClasses(); refreshStats();
      });
      addSection.addEventListener('click', () => openSectionModal(i));
      actions.append(addSection, edit, del);
      item.append(left, actions);
      // delete section click handlers
      item.querySelectorAll('.chip .x').forEach(x => x.addEventListener('click', () => {
        const name = x.getAttribute('data-x');
        const editIndexStr = x.getAttribute('data-edit');
        if (editIndexStr !== null) {
          const si = parseInt(editIndexStr, 10);
          const cls = Store.getDB().classes[i];
          openSectionModal(i, cls.sections[si], si);
          return;
        }
        if (!name) return;
        if (!confirm(`حذف الشعبة ${name}؟`)) return;
        const db2 = Store.getDB();
        const cls = db2.classes[i];
        cls.sections = (cls.sections || []).filter(s => s.name !== name);
        Store.setDB(db2); renderClasses();
      }));
      return item;
    });
  }

  function openClassModal(c = null, index = -1) {
    const dlg = qs('#modal-class');
    qs('#className').value = c?.name || '';
    qs('#classStudents').value = c?.students ?? 0;
    dlg.returnValue = 'cancel';
    dlg.showModal();
    const cancelBtn = qs('#btnCancelClass');
    if (cancelBtn) cancelBtn.onclick = () => dlg.close('cancel');
    const form = qs('#form-class');
    form.onsubmit = (e) => {
      e.preventDefault(); dlg.returnValue = 'default';
      const name = qs('#className').value.trim();
      const students = parseInt(qs('#classStudents').value, 10) || 0;
      if (!name) { showToast('أدخل اسم الصف'); return; }
      const db = Store.getDB();
      const item = { name, students };
      if (index >= 0) db.classes[index] = item; else db.classes.push(item);
      Store.setDB(db); renderClasses(); refreshStats(); dlg.close('default');
    };
  }
  qs('#btnAddClass').addEventListener('click', () => openClassModal());

  // Sections (per class)
  function openSectionModal(classIndex, section = null, sectionIndex = -1) {
    const dlg = qs('#modal-section');
    qs('#sectionName').value = section?.name || '';
    qs('#sectionStudents').value = section?.students ?? 0;
    // Populate teachers select
    const dbForSelect = Store.getDB();
    const sel = qs('#sectionTeacher');
    if (sel) {
      sel.innerHTML = '<option value="">— اختر معلم —</option>' + (dbForSelect.teachers || []).map((t, idx) => `<option value="${idx}">${t.name}</option>`).join('');
      if (typeof section?.teacherId === 'number') sel.value = String(section.teacherId);
    }
    dlg.returnValue = 'cancel';
    dlg.showModal();
    const cancelBtn = qs('#btnCancelSection');
    if (cancelBtn) cancelBtn.onclick = () => dlg.close('cancel');
    const form = qs('#form-section');
    form.onsubmit = (e) => {
      e.preventDefault(); dlg.returnValue = 'default';
      const name = qs('#sectionName').value.trim();
      const students = parseInt(qs('#sectionStudents').value, 10) || 0;
      if (!name) { showToast('أدخل اسم الشعبة'); return; }
      const db = Store.getDB();
      const cls = db.classes[classIndex];
      cls.sections = cls.sections || [];
      // Prevent duplicate section names within the same class (case-insensitive)
      const duplicate = cls.sections.some((s, si) => si !== sectionIndex && (s.name || '').trim().toLowerCase() === name.toLowerCase());
      if (duplicate) { showToast('اسم الشعبة موجود مسبقًا لهذا الصف'); return; }
      // Teacher selection
      const selEl = qs('#sectionTeacher');
      const selVal = selEl ? selEl.value : '';
      const teacherId = selVal === '' ? undefined : parseInt(selVal, 10);
      const item = { name, students };
      if (!Number.isNaN(teacherId)) item.teacherId = teacherId;
      if (sectionIndex >= 0) cls.sections[sectionIndex] = item; else cls.sections.push(item);
      Store.setDB(db); renderClasses(); dlg.close('default');
    };
  }

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
    const cancelBtn = qs('#btnCancelTeacher');
    if (cancelBtn) cancelBtn.onclick = () => dlg.close('cancel');
    const form = qs('#form-teacher');
    form.onsubmit = (e) => {
      e.preventDefault(); dlg.returnValue = 'default';
      const name = qs('#teacherName').value.trim();
      if (!name) { showToast('أدخل اسم المعلم'); return; }
      const db = Store.getDB();
      const item = { name, phone: qs('#teacherPhone').value.trim(), email: qs('#teacherEmail').value.trim() };
      if (index >= 0) db.teachers[index] = item; else db.teachers.push(item);
      Store.setDB(db); renderTeachers(); refreshStats(); dlg.close('default');
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
    const cancelBtn = qs('#btnCancelInvoice');
    if (cancelBtn) cancelBtn.onclick = () => dlg.close('cancel');
    const form = qs('#form-invoice');
    form.onsubmit = (e) => {
      e.preventDefault(); dlg.returnValue = 'default';
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
      dlg.close('default');
    };
  }
  qs('#btnAddInvoice').addEventListener('click', openInvoiceModal);

  // Timetable
  function getTimetable() { return Store.getDB().timetable; }

  function currentClassSectionKey() {
    const cIdx = qs('#ttClassSelect').value;
    const sIdx = qs('#ttSectionSelect').value;
    if (cIdx === '' || sIdx === '') return null;
    return `${cIdx}:${sIdx}`;
  }

  function renderTimetable() {
    const host = qs('#timetableGrid');
    const db = Store.getDB();
    const tt = db.timetable;
    const days = tt.days;
    const slots = tt.slots;
    const key = currentClassSectionKey();
    const grid = (tt.grid || {});
    host.innerHTML = '';
    const guard = qs('#ttGuard');
    const hasKey = !!key;
    if (guard) guard.classList.toggle('hidden', hasKey);
    if (!hasKey) return;
    // Determine section's responsible teacher name for suggestion
    let suggestTeacherName = '';
    const cIdx = parseInt(qs('#ttClassSelect').value, 10);
    const sIdx = parseInt(qs('#ttSectionSelect').value, 10);
    if (!Number.isNaN(cIdx) && !Number.isNaN(sIdx)) {
      const sect = (db.classes?.[cIdx]?.sections || [])[sIdx];
      const tId = sect?.teacherId;
      const tObj = (typeof tId === 'number') ? db.teachers?.[tId] : null;
      suggestTeacherName = tObj?.name || '';
    }
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
        const ckey = key + '|' + day + '|' + slot;
        const cell = document.createElement('div'); cell.className = 'tt-cell'; cell.contentEditable = 'true';
        cell.textContent = grid[ckey] || '';
        cell.dataset.key = ckey;
        if (suggestTeacherName) {
          cell.title = `اقتراح: ${suggestTeacherName}`;
          cell.addEventListener('focus', () => {
            if ((cell.textContent || '').trim() === '' && suggestTeacherName) {
              cell.textContent = suggestTeacherName;
            }
          });
        }
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
    const db = Store.getDB();
    const key = currentClassSectionKey();
    if (key) {
      // reset only for selected class-section
      Object.keys(db.timetable.grid || {}).forEach(k => { if (k.startsWith(key + '|')) delete db.timetable.grid[k]; });
    } else {
      db.timetable.grid = {};
    }
    Store.setDB(db); renderTimetable();
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
    // populate class/section selectors
    const db = Store.getDB();
    const classSel = qs('#ttClassSelect');
    const sectSel = qs('#ttSectionSelect');
    if (classSel && sectSel) {
      classSel.innerHTML = '<option value="">— اختر صف —</option>' + db.classes.map((c, i) => `<option value="${i}">${c.name}</option>`).join('');
      const updateSections = () => {
        const idx = classSel.value;
        const sections = idx === '' ? [] : (db.classes[idx].sections || []);
        sectSel.innerHTML = '<option value="">— اختر شعبة —</option>' + sections.map((s, si) => `<option value="${si}">${s.name}</option>`).join('');
        renderTimetable();
      };
      classSel.onchange = updateSections;
      sectSel.onchange = () => renderTimetable();
      updateSections();
    }
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
