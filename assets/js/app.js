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
    qs('#stat-subjects').textContent = (db.subjectsCatalog || []).length;
    // total periods = sum of all allocations (all subjects across all classes)
    const totalPeriods = Object.values(db.allocations || {}).reduce((sum, map) => {
      return sum + Object.values(map || {}).reduce((s, v) => s + (parseInt(v, 10) || 0), 0);
    }, 0);
    const sp = qs('#stat-periods'); if (sp) sp.textContent = totalPeriods;
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

  // Times editor (working days + per-day settings)
  function renderDaysList() {
    const host = qs('#daysList'); if (!host) return;
    const db = Store.getDB(); const t = db.times || {}; const wd = t.workingDays || {};
    host.innerHTML = '';
    const days = db.timetable.days || [];
    days.forEach(d => {
      const item = document.createElement('div'); item.className = 'list-item';
      const left = document.createElement('div'); left.innerHTML = `<div class="list-title">${d}</div>`;
      const actions = document.createElement('div'); actions.className = 'item-actions';
      const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = wd[d] !== false; toggle.title = 'يوم عمل';
      actions.append(toggle); item.append(left, actions); host.appendChild(item);
      toggle.addEventListener('change', () => {
        const db2 = Store.getDB(); db2.times = db2.times || {}; db2.times.workingDays = db2.times.workingDays || {};
        db2.times.workingDays[d] = toggle.checked; Store.setDB(db2);
      });
    });
  }

  function renderTimesEditor() {
    const host = qs('#timesEditor'); if (!host) return;
    const db = Store.getDB(); const t = db.times || {};
    const g = t.global || { lessonMinutes: 40, breakMinutes: 10, defaultPeriods: 6 };
    qs('#globalLessonDuration').value = g.lessonMinutes;
    qs('#globalBreakDuration').value = g.breakMinutes;
    qs('#globalPeriods').value = g.defaultPeriods;

    host.innerHTML = '';
    const days = db.timetable.days || [];
    days.forEach(d => {
      const row = document.createElement('div'); row.className = 'list-item';
      const left = document.createElement('div'); left.innerHTML = `<div class="list-title">${d}</div>`;
      const actions = document.createElement('div'); actions.className = 'item-actions'; actions.style.gap = '8px';

      const start = document.createElement('input'); start.type = 'time'; start.className = 'input'; start.style.minWidth = '140px';
      start.value = (t.perDay?.[d]?.start) || '08:00';

      const mode = document.createElement('select'); mode.className = 'input'; mode.style.minWidth = '120px';
      mode.innerHTML = `<option value="صباحي">صباحي</option><option value="مسائي">مسائي</option>`;
      mode.value = (t.perDay?.[d]?.mode) || 'صباحي';

      const periods = document.createElement('input'); periods.type = 'number'; periods.min = '1'; periods.max = '12'; periods.className = 'input'; periods.style.minWidth = '100px';
      periods.value = (t.perDay?.[d]?.periods) || (t.global?.defaultPeriods || 6);

      actions.append(start, mode, periods); row.append(left, actions); host.appendChild(row);

      [start, mode, periods].forEach(ctrl => ctrl.addEventListener('change', () => {
        const db2 = Store.getDB(); db2.times = db2.times || {}; db2.times.perDay = db2.times.perDay || {};
        const cur = db2.times.perDay[d] || { mode: 'صباحي', start: '08:00', periods: 6 };
        cur.start = start.value; cur.mode = mode.value; cur.periods = Math.max(1, Math.min(12, parseInt(periods.value, 10) || 6));
        db2.times.perDay[d] = cur; Store.setDB(db2);
      }));
    });
  }

  function renderBreaksEditor() {
    const host = qs('#breaksEditor'); if (!host) return;
    const db = Store.getDB(); const t = db.times || {}; const g = t.global || { defaultPeriods: 6 };
    const arr = (t.breaks && Array.isArray(t.breaks)) ? t.breaks.slice() : [];
    const count = Math.max(0, (g.defaultPeriods || 6) - 1);
    while (arr.length < count) arr.push(t.global?.breakMinutes ?? 10);
    if (arr.length > count) arr.length = count;
    host.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const item = document.createElement('div'); item.className = 'list-item';
      const left = document.createElement('div'); left.innerHTML = `<div class="list-title">بعد الحصة ${i+1}</div>`;
      const actions = document.createElement('div'); actions.className = 'item-actions';
      const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.className = 'input'; input.style.minWidth = '100px';
      input.value = arr[i] ?? 0; input.setAttribute('data-break-index', String(i));
      actions.append(input); item.append(left, actions); host.appendChild(item);
    }
    // Save on change
    qsa('#breaksEditor input[data-break-index]').forEach(inp => {
      inp.addEventListener('change', () => {
        const db2 = Store.getDB(); db2.times = db2.times || {}; const g2 = db2.times.global || { defaultPeriods: 6 };
        const c = Math.max(0, (g2.defaultPeriods || 6) - 1);
        const arr2 = [];
        for (let j = 0; j < c; j++) {
          const el = qs(`#breaksEditor input[data-break-index="${j}"]`);
          arr2[j] = Math.max(0, parseInt(el.value, 10) || 0);
        }
        db2.times.breaks = arr2; Store.setDB(db2);
      });
    });
  }

  const btnSaveTimes = qs('#btnSaveTimes'); if (btnSaveTimes) btnSaveTimes.addEventListener('click', () => {
    const db = Store.getDB(); db.times = db.times || {}; db.times.global = db.times.global || {};
    db.times.global.lessonMinutes = Math.max(10, parseInt(qs('#globalLessonDuration').value, 10) || 40);
    db.times.global.breakMinutes = Math.max(0, parseInt(qs('#globalBreakDuration').value, 10) || 10);
    db.times.global.defaultPeriods = Math.max(1, Math.min(12, parseInt(qs('#globalPeriods').value, 10) || 6));
    Store.setDB(db);
    renderBreaksEditor();
    showToast('تم حفظ الأوقات');
  });

  const btnResetTimes = qs('#btnResetTimes'); if (btnResetTimes) btnResetTimes.addEventListener('click', () => {
    if (!confirm('إعادة ضبط إعدادات الأوقات إلى القيم الافتراضية؟')) return;
    const db = Store.getDB(); db.times = undefined; // سيُعاد إنشاؤها عند العرض حسب القيم الافتراضية
    Store.setDB(db); renderDaysList(); renderTimesEditor(); renderBreaksEditor(); showToast('تمت إعادة الضبط');
  });

  // Catalog (subjects list used in allocations)
  function renderCatalog() {
    const list = qs('#catalogList'); if (!list) return;
    const db = Store.getDB();
    renderList(list, db.subjectsCatalog || [], (s, i) => {
      const item = document.createElement('div'); item.className = 'list-item';
      const left = document.createElement('div'); left.innerHTML = `<div class="list-title">${s.name}</div>`;
      const actions = document.createElement('div'); actions.className = 'item-actions';
      const up = document.createElement('button'); up.className = 'btn'; up.title = 'نقل للأعلى'; up.innerHTML = '<i class="bi bi-arrow-up"></i>';
      const down = document.createElement('button'); down.className = 'btn'; down.title = 'نقل للأسفل'; down.innerHTML = '<i class="bi bi-arrow-down"></i>';
      const edit = document.createElement('button'); edit.className = 'btn'; edit.textContent = 'تعديل';
      const del = document.createElement('button'); del.className = 'btn danger'; del.textContent = 'حذف';
      up.disabled = i === 0;
      down.disabled = i === (db.subjectsCatalog?.length || 0) - 1;
      up.addEventListener('click', () => moveCatalogSubject(i, i - 1));
      down.addEventListener('click', () => moveCatalogSubject(i, i + 1));
      edit.addEventListener('click', () => openCatalogModal(s, i));
      del.addEventListener('click', () => {
        if (!confirm('حذف المادة من القائمة المعتمدة؟ سيتم حذف تخصيصاتها أيضًا.')) return;
        const db2 = Store.getDB();
        const removedIndex = i;
        db2.subjectsCatalog.splice(i, 1);
        const oldAlloc = db2.allocations || {};
        const newAlloc = {};
        for (let newIdx = 0; newIdx < db2.subjectsCatalog.length; newIdx++) {
          const oldIdx = newIdx < removedIndex ? newIdx : newIdx + 1;
          if (oldAlloc[oldIdx] != null) newAlloc[newIdx] = oldAlloc[oldIdx];
        }
        db2.allocations = newAlloc;
        Store.setDB(db2);
        renderCatalog();
        populateAllocSubjectSelect();
        renderAllocations();
        refreshStats();
      });
      actions.append(up, down, edit, del); item.append(left, actions); return item;
    });
  }

  function moveCatalogSubject(from, to) {
    const db = Store.getDB(); const list = db.subjectsCatalog || [];
    if (from === to || to < 0 || to >= list.length) return;
    // swap subjects
    const tmp = list[from]; list[from] = list[to]; list[to] = tmp;
    // remap allocations keys by swapping entries
    db.allocations = db.allocations || {};
    const a = db.allocations[from];
    const b = db.allocations[to];
    if (a === undefined) delete db.allocations[to]; else db.allocations[to] = a;
    if (b === undefined) delete db.allocations[from]; else db.allocations[from] = b;
    Store.setDB(db);
    // preserve selection in allocations subject select
    const sel = qs('#allocSubjectSelect');
    const beforeVal = sel ? sel.value : null;
    renderCatalog();
    populateAllocSubjectSelect();
    if (sel && beforeVal !== null && beforeVal !== '') {
      const bIdx = parseInt(beforeVal, 10);
      let newIdx = bIdx;
      if (bIdx === from) newIdx = to; else if (bIdx === to) newIdx = from;
      sel.value = String(newIdx);
    }
    renderAllocations();
  }

  function openCatalogModal(s = null, index = -1) {
    const dlg = qs('#modal-catalog'); if (!dlg) return;
    qs('#catalogName').value = s?.name || '';
    dlg.returnValue = 'cancel'; dlg.showModal();
    const cancelBtn = qs('#btnCancelCatalog'); if (cancelBtn) cancelBtn.onclick = () => dlg.close('cancel');
    const form = qs('#form-catalog');
    form.onsubmit = (e) => {
      e.preventDefault(); dlg.returnValue = 'default';
      const name = qs('#catalogName').value.trim(); if (!name) { showToast('أدخل اسم المادة'); return; }
      const db = Store.getDB(); db.subjectsCatalog = db.subjectsCatalog || [];
      const dup = db.subjectsCatalog.some((x, ix) => ix !== index && (x.name || '').trim().toLowerCase() === name.toLowerCase());
      if (dup) { showToast('اسم المادة موجود مسبقًا'); return; }
      const item = { name };
      if (index >= 0) db.subjectsCatalog[index] = item; else db.subjectsCatalog.push(item);
      Store.setDB(db); renderCatalog(); populateAllocSubjectSelect(); renderAllocations(); refreshStats(); dlg.close('default');
    };
  }
  const addCatalogBtn = qs('#btnAddCatalogSubject'); if (addCatalogBtn) addCatalogBtn.addEventListener('click', () => openCatalogModal());

  // Allocations: map subject -> per-class weekly counts
  function populateAllocSubjectSelect() {
    const sel = qs('#allocSubjectSelect'); if (!sel) return;
    const db = Store.getDB(); const subjects = db.subjectsCatalog || [];
    sel.innerHTML = subjects.length ? subjects.map((s, i) => `<option value="${i}">${s.name}</option>`).join('') : '';
  }

  function renderAllocations() {
    const list = qs('#allocationsList'); if (!list) return;
    const sel = qs('#allocSubjectSelect');
    const db = Store.getDB(); const classes = db.classes || [];
    // guards
    const g1 = qs('#allocGuardNoSubjects'); const g2 = qs('#allocGuardNoClasses'); const g3 = qs('#allocGuardNoTeachers');
    const hasSubjects = (db.subjectsCatalog || []).length > 0;
    const hasClasses = classes.length > 0;
    const hasTeachers = (db.teachers || []).length > 0;
    if (g1) g1.classList.toggle('hidden', hasSubjects);
    if (g2) g2.classList.toggle('hidden', hasClasses);
    if (g3) g3.classList.toggle('hidden', hasTeachers);
    if (!hasSubjects || !hasClasses) { list.innerHTML = ''; return; }
    const subjIdx = parseInt(sel.value || '0', 10) || 0;
    const alloc = (db.allocations && db.allocations[subjIdx]) || {};
    list.innerHTML = '';
    classes.forEach((c, ci) => {
      const item = document.createElement('div'); item.className = 'list-item';
      const left = document.createElement('div'); left.innerHTML = `<div class="list-title">${c.name}</div>`;
      const actions = document.createElement('div'); actions.className = 'item-actions';
      const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.className = 'input'; input.style.minWidth = '100px';
      input.value = alloc[ci] != null ? alloc[ci] : 0; input.setAttribute('data-class-index', String(ci));
      actions.append(input); item.append(left, actions); list.appendChild(item);
    });
  }

  const allocSel = qs('#allocSubjectSelect'); if (allocSel) allocSel.addEventListener('change', renderAllocations);
  const btnSaveAllocs = qs('#btnSaveAllocations'); if (btnSaveAllocs) btnSaveAllocs.addEventListener('click', () => {
    const sel = qs('#allocSubjectSelect'); if (!sel) return;
    const subjIdx = parseInt(sel.value || '0', 10) || 0;
    const db = Store.getDB(); db.allocations = db.allocations || {};
    const map = {};
    qsa('#allocationsList input[data-class-index]').forEach(inp => {
      const ci = parseInt(inp.getAttribute('data-class-index'), 10);
      const v = Math.max(0, parseInt(inp.value, 10) || 0);
      if (v > 0) map[ci] = v;
    });
    if (Object.keys(map).length > 0) db.allocations[subjIdx] = map; else delete db.allocations[subjIdx];
    Store.setDB(db); showToast('تم حفظ التخصيص');
  });

  // Assign lessons to teachers per class/section/subject
  function populateAssignSelectors() {
    const db = Store.getDB();
    const classSel = qs('#asClassSelect'); const sectSel = qs('#asSectionSelect');
    const subjSel = qs('#asSubjectSelect'); const teachSel = qs('#asTeacherSelect');
    if (classSel) classSel.innerHTML = '<option value="">— اختر صف —</option>' + (db.classes || []).map((c, i) => `<option value="${i}">${c.name}</option>`).join('');
    if (subjSel) subjSel.innerHTML = '<option value="">— اختر مادة —</option>' + (db.subjectsCatalog || []).map((s, i) => `<option value="${i}">${s.name}</option>`).join('');
    if (teachSel) teachSel.innerHTML = '<option value="">— اختر معلم —</option>' + (db.teachers || []).map((t, i) => `<option value="${i}">${t.name}</option>`).join('');
    if (sectSel) sectSel.innerHTML = '<option value="">— اختر شعبة —</option>';
    if (classSel) classSel.onchange = () => {
      const idx = classSel.value; const sections = idx === '' ? [] : (db.classes[idx].sections || []);
      if (sectSel) sectSel.innerHTML = '<option value="">— اختر شعبة —</option>' + sections.map((s, si) => `<option value="${si}">${s.name}</option>`).join('');
      updateAssignRemaining();
    };
    if (subjSel) subjSel.onchange = updateAssignRemaining;
    if (sectSel) sectSel.onchange = updateAssignRemaining;
  }

  function keyCS(cIdx, sIdx) { return `${cIdx}:${sIdx}`; }

  function calcAssignedFor(db, cIdx, sIdx, subjIdx) {
    const map = db.assignments?.[keyCS(cIdx, sIdx)]?.[subjIdx] || {};
    return Object.values(map).reduce((a, v) => a + (parseInt(v, 10) || 0), 0);
  }

  function updateAssignRemaining() {
    const db = Store.getDB();
    const classSel = qs('#asClassSelect'); const sectSel = qs('#asSectionSelect'); const subjSel = qs('#asSubjectSelect');
    const remainingEl = qs('#asRemaining'); const periodsInput = qs('#asPeriods');
    if (!classSel || !sectSel || !subjSel || !remainingEl) return;
    const cVal = classSel.value; const sVal = sectSel.value; const subVal = subjSel.value;
    if (cVal === '' || sVal === '' || subVal === '') { remainingEl.textContent = 'المتبقي: 0'; if (periodsInput) periodsInput.value = 0; return; }
    const cIdx = parseInt(cVal, 10); const sIdx = parseInt(sVal, 10); const subjIdx = parseInt(subVal, 10);
    const allocForSubject = (db.allocations?.[subjIdx]?.[cIdx]) || 0;
    const already = calcAssignedFor(db, cIdx, sIdx, subjIdx);
    const remaining = Math.max(0, allocForSubject - already);
    remainingEl.textContent = `المتبقي: ${remaining}`;
    if (periodsInput) {
      const cur = parseInt(periodsInput.value, 10) || 0;
      // عند تغيير الاختيارات، املأ تلقائيًا بالقيمة المتبقية إذا كان الحقل ما يزال صفرًا
      if (cur === 0) {
        periodsInput.value = remaining;
      } else if (cur > remaining) {
        // وإلا، قم بتقليمه إذا تجاوز المتبقي
        periodsInput.value = remaining;
      }
    }
  }

  function renderAssignStats() {
    const list = qs('#assignStatsList'); if (!list) return;
    const db = Store.getDB();
    list.innerHTML = '';
    (db.classes || []).forEach((c, ci) => {
      const sections = c.sections && c.sections.length ? c.sections : [{ name: '—', _virtual: true }];
      sections.forEach((s, si) => {
        const row = document.createElement('div'); row.className = 'list-item';
        const left = document.createElement('div');
        const title = `${c.name}${s._virtual ? '' : ' — ' + s.name}`;
        // إجمالي الحصص لهذا الصف عبر كل المواد (من allocations)
        const total = Object.values(db.allocations || {}).reduce((sum, m) => sum + (parseInt(m?.[ci], 10) || 0), 0);
        // المخصصة لهذا الصف/الشعبة عبر جميع المواد والمعلمين
        const assigned = Object.values(db.assignments?.[keyCS(ci, si)] || {}).reduce((subSum, subjMap) => subSum + Object.values(subjMap).reduce((a, v) => a + (parseInt(v, 10) || 0), 0), 0);
        const vacant = Math.max(0, total - assigned);
        left.innerHTML = `<div class="list-title">${title}</div><div class="list-sub">الإجمالي: ${total} • المخصصة: ${assigned} • الشاغر: ${vacant}</div>`;
        list.appendChild(row); row.appendChild(left);
      });
    });
  }

  function renderAssignList() {
    const list = qs('#assignList'); if (!list) return;
    const db = Store.getDB(); list.innerHTML = '';
    (db.classes || []).forEach((c, ci) => {
      const sections = c.sections && c.sections.length ? c.sections : [{ name: '—', _virtual: true }];
      sections.forEach((s, si) => {
        const csKey = keyCS(ci, si);
        const subjMaps = db.assignments?.[csKey] || {};
        Object.entries(subjMaps).forEach(([subjIdxStr, teachMap]) => {
          const subjIdx = parseInt(subjIdxStr, 10);
          Object.entries(teachMap || {}).forEach(([tIdxStr, count]) => {
            const cnt = parseInt(count, 10) || 0;
            if (cnt <= 0) return; // لا تعرض تخصيصات بصفر حصص
            const tIdx = parseInt(tIdxStr, 10);
            const item = document.createElement('div'); item.className = 'list-item';
            const left = document.createElement('div');
            const subjName = db.subjectsCatalog?.[subjIdx]?.name || '—';
            const teachName = db.teachers?.[tIdx]?.name || '—';
            left.innerHTML = `<div class="list-title">${c.name}${s._virtual ? '' : ' — ' + s.name}</div><div class="list-sub">${subjName} • ${teachName} • حصص: ${cnt}</div>`;
            const actions = document.createElement('div'); actions.className = 'item-actions';
            const edit = document.createElement('button'); edit.className = 'btn'; edit.textContent = 'تعديل';
            const del = document.createElement('button'); del.className = 'btn danger'; del.textContent = 'حذف';
            edit.addEventListener('click', () => {
              const classSel = qs('#asClassSelect'); const sectSel = qs('#asSectionSelect'); const subjSel = qs('#asSubjectSelect'); const teachSel = qs('#asTeacherSelect'); const per = qs('#asPeriods');
              if (classSel) classSel.value = String(ci);
              if (sectSel) { const ev = new Event('change'); classSel.dispatchEvent(ev); sectSel.value = String(si); }
              if (subjSel) subjSel.value = String(subjIdx);
              if (teachSel) teachSel.value = String(tIdx);
              if (per) per.value = String(cnt);
              updateAssignRemaining();
            });
            del.addEventListener('click', () => {
              if (!confirm('حذف هذا التخصيص؟')) return;
              const db2 = Store.getDB();
              const map = db2.assignments?.[csKey]?.[subjIdx];
              if (map && map[tIdx] != null) delete map[tIdx];
              if (map && Object.keys(map).length === 0) delete db2.assignments[csKey][subjIdx];
              if (db2.assignments[csKey] && Object.keys(db2.assignments[csKey]).length === 0) delete db2.assignments[csKey];
              Store.setDB(db2); renderAssignList(); renderAssignStats(); updateAssignRemaining();
            });
            actions.append(edit, del); item.append(left, actions); list.appendChild(item);
          });
        });
      });
    });
  }

  // Ensure uniqueness: one teacher per (class, section, subject). Keep the highest-count assignment, drop others and zeros.
  function normalizeAssignmentsUniquePerSubject() {
    const db = Store.getDB();
    const asg = db.assignments || {};
    let changed = false;
    Object.keys(asg).forEach(csKey => {
      const subjMaps = asg[csKey] || {};
      Object.keys(subjMaps).forEach(subjIdx => {
        const teachMap = subjMaps[subjIdx] || {};
        const entries = Object.entries(teachMap).map(([k, v]) => [parseInt(k, 10), parseInt(v, 10) || 0]);
        const nonZero = entries.filter(([, c]) => c > 0);
        if (nonZero.length === 0) {
          delete asg[csKey][subjIdx]; changed = true; return;
        }
        if (nonZero.length > 1) {
          nonZero.sort((a, b) => b[1] - a[1]);
          const [keepT, keepC] = nonZero[0];
          asg[csKey][subjIdx] = { [keepT]: keepC };
          changed = true;
        }
      });
      if (asg[csKey] && Object.keys(asg[csKey]).length === 0) { delete asg[csKey]; changed = true; }
    });
    if (changed) { db.assignments = asg; Store.setDB(db); }
    return changed;
  }

  function saveAssignment() {
    const classSel = qs('#asClassSelect'); const sectSel = qs('#asSectionSelect'); const subjSel = qs('#asSubjectSelect'); const teachSel = qs('#asTeacherSelect'); const per = qs('#asPeriods');
    if (!classSel || !sectSel || !subjSel || !teachSel || !per) return;
    if (classSel.value === '' || sectSel.value === '' || subjSel.value === '' || teachSel.value === '') { showToast('أكمل الاختيارات: صف، شعبة، مادة، معلم'); return; }
    const cIdx = parseInt(classSel.value, 10); const sIdx = parseInt(sectSel.value, 10);
    const subjIdx = parseInt(subjSel.value, 10); const tIdx = parseInt(teachSel.value, 10);
    const count = Math.max(0, parseInt(per.value, 10) || 0);
    if (count <= 0) { showToast('أدخل عدد حصص أكبر من صفر'); return; }
    const db = Store.getDB();
    const allocForSubject = (db.allocations?.[subjIdx]?.[cIdx]) || 0;
    const already = calcAssignedFor(db, cIdx, sIdx, subjIdx);
    const remaining = Math.max(0, allocForSubject - already);
    if (count > remaining) { showToast('عدد الحصص يتجاوز المتبقي'); return; }
    db.assignments = db.assignments || {}; const csKey = keyCS(cIdx, sIdx);
    db.assignments[csKey] = db.assignments[csKey] || {};
    // فرض معلم واحد فقط لكل مادة ضمن (صف/شعبة): إزالة أي مخصصات سابقة لنفس المادة ثم تعيين المعلم الحالي
    db.assignments[csKey][subjIdx] = {};
    db.assignments[csKey][subjIdx][tIdx] = count;
    Store.setDB(db);
    renderAssignList(); renderAssignStats(); updateAssignRemaining();
    showToast('تم حفظ التخصيص للمعلم');
  }

  const btnAsSave = qs('#btnAsSave'); if (btnAsSave) btnAsSave.addEventListener('click', saveAssignment);
  const btnAsClear = qs('#btnAsClear'); if (btnAsClear) btnAsClear.addEventListener('click', () => {
    const classSel = qs('#asClassSelect'); const sectSel = qs('#asSectionSelect'); const subjSel = qs('#asSubjectSelect'); const teachSel = qs('#asTeacherSelect'); const per = qs('#asPeriods');
    if (classSel) classSel.value = '';
    if (sectSel) sectSel.innerHTML = '<option value="">— اختر شعبة —</option>';
    if (subjSel) subjSel.value = '';
    if (teachSel) teachSel.value = '';
    if (per) per.value = '0';
    updateAssignRemaining();
  });

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
    renderDaysList();
    renderTimesEditor();
    renderBreaksEditor();
    renderCatalog();
    renderClasses();
    renderTeachers();
    renderInvoices();
    populateAllocSubjectSelect();
    renderAllocations();
  // Assignments (teachers per class/section/subject)
  const normalized = normalizeAssignmentsUniquePerSubject();
  populateAssignSelectors();
  renderAssignStats();
  renderAssignList();
  updateAssignRemaining();
  if (normalized) { showToast('تم توحيد التخصيص: معلم واحد لكل مادة في كل شعبة'); }
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
