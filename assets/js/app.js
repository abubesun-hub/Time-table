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
  window.addEventListener('hashchange', () => { routeTo(location.hash); renderTeacherSidebar(); });
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
    // total periods (school-wide) = sum of allocations per class multiplied by number of sections in that class
    const classes = db.classes || [];
    const totalPeriods = Object.values(db.allocations || {}).reduce((sum, map) => {
      // map: { [classIndex]: weeklyCountPerSection }
      return sum + Object.entries(map || {}).reduce((s, [ciStr, v]) => {
        const ci = parseInt(ciStr, 10);
        const perSection = parseInt(v, 10) || 0;
        const sectionsCount = Math.max(1, (classes[ci]?.sections || []).length || 0);
        return s + perSection * sectionsCount;
      }, 0);
    }, 0);
    const sp = qs('#stat-periods'); if (sp) sp.textContent = totalPeriods;
    qs('#stat-classes').textContent = db.classes.length;
    qs('#stat-teachers').textContent = db.teachers.length;
    qs('#stat-invoices').textContent = db.invoices.length;
    renderTeacherStatsTable();
  }

  // Build teacher stats across assignments
  function computeTeacherStats() {
    const db = Store.getDB();
    const teachers = db.teachers || [];
    const stats = teachers.map((t, ti) => ({ teacherIndex: ti, name: t.name, total: 0, items: [] }));
    const classes = db.classes || [];
    const subjects = db.subjectsCatalog || [];
    Object.entries(db.assignments || {}).forEach(([csKey, subjMap]) => {
      const [cStr, sStr] = csKey.split(':'); const ci = parseInt(cStr, 10), si = parseInt(sStr, 10);
      const className = classes[ci]?.name || '—';
      const sectionName = (classes[ci]?.sections || [])[si]?.name || '—';
      Object.entries(subjMap || {}).forEach(([subjIdxStr, teachMap]) => {
        const subjIdx = parseInt(subjIdxStr, 10); const subjName = subjects[subjIdx]?.name || '—';
        Object.entries(teachMap || {}).forEach(([tStr, cnt]) => {
          const ti = parseInt(tStr, 10); const c = parseInt(cnt, 10) || 0; if (c <= 0) return;
          if (!stats[ti]) return;
          stats[ti].total += c;
          stats[ti].items.push({ classIndex: ci, sectionIndex: si, subjectIndex: subjIdx, className, sectionName, subjectName: subjName, count: c });
        });
      });
    });
    return stats;
  }

  function renderTeacherStatsTable() {
    const host = qs('#teacherStatsTable'); if (!host) return;
    const stats = computeTeacherStats();
    host.innerHTML = '';
    // header
    const head = document.createElement('div'); head.className = 'trow head';
    head.innerHTML = '<div class="tcell">المعلم</div><div class="tcell">إجمالي الحصص</div><div class="tcell">مواد</div><div class="tcell">تفاصيل</div><div class="tcell"></div>';
    host.appendChild(head);
    stats.forEach(st => {
      const row = document.createElement('div'); row.className = 'trow';
      const name = document.createElement('div'); name.className = 'tcell'; name.textContent = st.name || '—';
      const total = document.createElement('div'); total.className = 'tcell'; total.textContent = String(st.total);
      const subjectsSet = [...new Set(st.items.map(it => it.subjectName))];
      const subjCount = document.createElement('div'); subjCount.className = 'tcell'; subjCount.textContent = subjectsSet.length ? subjectsSet.join('، ') : '—';
      const details = document.createElement('div'); details.className = 'tcell';
      if (st.items.length) {
        const wrap = document.createElement('div'); wrap.className = 'tmini';
        const headRow = document.createElement('div'); headRow.className = 'tmini-row head';
        headRow.innerHTML = '<div>المادة</div><div>الصف</div><div class="cnt">الحصص</div>';
        wrap.appendChild(headRow);
        st.items.forEach(it => {
          const r = document.createElement('div'); r.className = 'tmini-row';
          const clsLabel = `${it.className}${it.sectionName ? ' — ' + it.sectionName : ''}`;
          r.innerHTML = `<div>${it.subjectName}</div><div>${clsLabel}</div><div class="cnt">${it.count}</div>`;
          wrap.appendChild(r);
        });
        details.appendChild(wrap);
      } else {
        details.textContent = '—';
      }
      const actions = document.createElement('div'); actions.className = 'tact';
      const editBtn = document.createElement('button'); editBtn.className = 'btn'; editBtn.textContent = 'تعديل';
      editBtn.addEventListener('click', () => {
        if (!st.items.length) return;
        const it = st.items[0];
        routeTo('#/subjects');
        setTimeout(() => {
          openAssignEditBar({ ci: it.classIndex, si: it.sectionIndex, subjIdx: it.subjectIndex, tIdx: st.teacherIndex, cnt: it.count });
        }, 50);
      });
      actions.appendChild(editBtn);
      row.append(name, total, subjCount, details, actions);
      host.appendChild(row);
    });
  }

  // ===== Teacher Sidebar (live summary in تخصيص view) =====
  function renderTeacherSidebar() {
    const side = qs('#teacherSidebar');
    if (!side) return;
    const list = qs('#teacherSidebarList');
    const totalEl = qs('#teacherSidebarTotal');
    const stats = computeTeacherStats();
    // Show only in تخصيص view
    const isAllocViewActive = !!UI.qs('#view-subjects')?.classList.contains('active');
    side.classList.toggle('hidden', !isAllocViewActive || stats.length === 0);
    if (!isAllocViewActive) return;
    // Build
    list.innerHTML = '';
    let total = 0;
    // Sort by total desc then name
    stats.sort((a,b) => (b.total - a.total) || (String(a.name).localeCompare(String(b.name))));
    stats.forEach(st => {
      total += (parseInt(st.total, 10) || 0);
      const item = document.createElement('div'); item.className = 'list-item';
      const left = document.createElement('div'); left.innerHTML = `<div class="list-title">${st.name || '—'}</div><div class="list-sub">مواد: ${new Set(st.items.map(i=>i.subjectName)).size}</div>`;
      const actions = document.createElement('div'); actions.className = 'item-actions';
      const cnt = document.createElement('div'); cnt.className = 'count'; cnt.textContent = String(st.total);
      actions.appendChild(cnt);
      item.append(left, actions);
      list.appendChild(item);
    });
    if (totalEl) totalEl.textContent = String(total);
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
    // new fields
    const yearEl = qs('#schoolYear'); if (yearEl) yearEl.value = db.school.year || '';
    const shiftEl = qs('#schoolShiftType'); if (shiftEl) shiftEl.value = db.school.shiftType || 'صباحي';
    const genderEl = qs('#schoolGender'); if (genderEl) genderEl.value = db.school.gender || 'مختلط';
    const prinSel = qs('#schoolPrincipal');
    if (prinSel) {
      const teachers = db.teachers || [];
      prinSel.innerHTML = '<option value="">— اختر مدير —</option>' + teachers.map((t, i) => `<option value="${i}">${t.name}</option>`).join('');
      if (typeof db.school.principalId === 'number' && teachers[db.school.principalId]) prinSel.value = String(db.school.principalId);
      else prinSel.value = '';
    }
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
      year: (qs('#schoolYear')?.value || '').trim(),
      shiftType: qs('#schoolShiftType')?.value || 'صباحي',
      gender: qs('#schoolGender')?.value || 'مختلط',
      principalId: (() => { const v = qs('#schoolPrincipal')?.value || ''; return v === '' ? undefined : parseInt(v, 10); })(),
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
        // إعادة عرض الجدول والإحصاءات مباشرةً
        renderTimetable();
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
    renderTeacherSidebar();
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
      updateAssignRemaining(true);
    };
    if (subjSel) subjSel.onchange = () => updateAssignRemaining(true);
    if (sectSel) sectSel.onchange = () => updateAssignRemaining(true);
  }

  function keyCS(cIdx, sIdx) { return `${cIdx}:${sIdx}`; }

  function calcAssignedFor(db, cIdx, sIdx, subjIdx) {
    const map = db.assignments?.[keyCS(cIdx, sIdx)]?.[subjIdx] || {};
    return Object.values(map).reduce((a, v) => a + (parseInt(v, 10) || 0), 0);
  }

  function updateAssignRemaining(force = false, preserveInput = false) {
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
    if (periodsInput && !preserveInput) {
      const cur = parseInt(periodsInput.value, 10) || 0;
      // إذا كان التغيير ناتجًا عن تبديل الصف/الشعبة/المادة، حدّثه قسرًا
      if (force) {
        periodsInput.value = remaining;
      } else {
        // وإلا املأ فقط إن كان صفرًا أو قلّم إذا تجاوز المتبقي
        if (cur === 0) periodsInput.value = remaining;
        else if (cur > remaining) periodsInput.value = remaining;
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
        // اجعل البطاقة قابلة للنقر لفتح اللوحة الجانبية
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => openSidePanelFor(ci, si));
      });
    });
  }

  // لوح جانبي: عرض المخصصة وغير المخصصة لصف/شعبة
  function openSidePanelFor(classIndex, sectionIndex) {
    const db = Store.getDB();
    const c = db.classes?.[classIndex]; if (!c) return;
    const s = (c.sections && c.sections.length) ? c.sections[sectionIndex] : { name: '—', _virtual: true };
    const title = `${c.name}${s._virtual ? '' : ' — ' + s.name}`;
    const overlay = qs('#sidepanel-overlay'); const spTitle = qs('#spTitle');
    const assignedList = qs('#spAssignedList'); const unassignedList = qs('#spUnassignedList');
    if (!overlay || !spTitle || !assignedList || !unassignedList) return;
    spTitle.textContent = title;
    assignedList.innerHTML = ''; unassignedList.innerHTML = '';

    // بناء قوائم: المخصصة وغير المخصصة بناءً على allocations و assignments
    const csKey = keyCS(classIndex, sectionIndex);
    const asgForCS = db.assignments?.[csKey] || {};
    const subjects = db.subjectsCatalog || [];
    subjects.forEach((subj, subjIdx) => {
      const alloc = parseInt(db.allocations?.[subjIdx]?.[classIndex], 10) || 0;
      if (alloc <= 0) return; // هذه المادة غير مخصصة للصف
      const teachMap = asgForCS?.[subjIdx] || {};
      const entries = Object.entries(teachMap).map(([tIdx, cnt]) => [parseInt(tIdx,10), parseInt(cnt,10)||0]).filter(([,c])=>c>0);
      if (entries.length > 0) {
        // بحسب منطقنا: معلم واحد فقط لكل مادة، ولكن لو وجد أكثر من واحد قديمًا نعرضهم
        entries.forEach(([tIdx, cnt]) => {
          const tName = db.teachers?.[tIdx]?.name || '—';
          const item = document.createElement('div'); item.className = 'list-item';
          const left = document.createElement('div'); left.innerHTML = `<div class="list-title">${subj.name}</div><div class="list-sub">${tName} • حصص: ${cnt}</div>`;
          item.append(left, document.createElement('div'));
          assignedList.appendChild(item);
        });
      } else {
        const item = document.createElement('div'); item.className = 'list-item';
        const left = document.createElement('div'); left.innerHTML = `<div class="list-title">${subj.name}</div><div class="list-sub">غير مخصصة بعد</div>`;
        const actions = document.createElement('div'); actions.className = 'item-actions';
        const btn = document.createElement('button'); btn.className = 'btn'; btn.textContent = 'تعيين الآن';
        btn.addEventListener('click', () => {
          // الانتقال إلى بطاقة "تخصيص" مع ملء الحقول تلقائيًا
          const classSel = qs('#asClassSelect'); const sectSel = qs('#asSectionSelect');
          const subjSel = qs('#asSubjectSelect'); const teachSel = qs('#asTeacherSelect'); const per = qs('#asPeriods');
          if (classSel) classSel.value = String(classIndex);
          if (sectSel && classSel) { const ev = new Event('change'); classSel.dispatchEvent(ev); sectSel.value = String(sectionIndex); }
          if (subjSel) subjSel.value = String(subjIdx);
          // اضبط الحصص إلى المتبقي تلقائيًا
          if (per) per.value = String(alloc);
          // حدّث المتبقي (مع فرض التعيين من التخصيص الحالي)
          if (typeof updateAssignRemaining === 'function') updateAssignRemaining(true);
          // ركّز على اختيار المعلم لتسريع الإدخال
          if (teachSel) teachSel.focus();
          // أغلق اللوح الجانبي
          const overlay2 = qs('#sidepanel-overlay'); if (overlay2) { overlay2.classList.add('hidden'); overlay2.setAttribute('aria-hidden','true'); }
          // انتقل إلى تبويب التخصيص إن وُجدت آلية توجيه
          if (window.location && window.location.hash !== '#assign') { window.location.hash = '#assign'; }
        });
        actions.appendChild(btn);
        item.append(left, actions);
        unassignedList.appendChild(item);
      }
    });

    overlay.classList.remove('hidden'); overlay.setAttribute('aria-hidden', 'false');
  }

  const spCloseBtn = qs('#spClose'); if (spCloseBtn) spCloseBtn.addEventListener('click', () => {
    const overlay = qs('#sidepanel-overlay'); if (overlay) { overlay.classList.add('hidden'); overlay.setAttribute('aria-hidden','true'); }
  });

  function renderAssignList() {
    const list = qs('#assignList'); if (!list) return;
    const db = Store.getDB(); list.innerHTML = '';
    const q = (qs('#assignSearchInput')?.value || '').trim().toLowerCase();
    let results = 0;
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
            const titleText = `${c.name}${s._virtual ? '' : ' — ' + s.name}`;
            left.innerHTML = `<div class="list-title">${titleText}</div><div class="list-sub">${subjName} • ${teachName} • حصص: ${cnt}</div>`;
            const hay = `${subjName} ${teachName} ${c.name} ${s._virtual ? '' : s.name}`.toLowerCase();
            if (q && !hay.includes(q)) return; // filter out
            results++;
            const actions = document.createElement('div'); actions.className = 'item-actions';
            const edit = document.createElement('button'); edit.className = 'btn'; edit.textContent = 'تعديل';
            const del = document.createElement('button'); del.className = 'btn danger'; del.textContent = 'حذف';
            edit.addEventListener('click', () => openAssignEditBar({ ci, si, subjIdx, tIdx, cnt }));
            del.addEventListener('click', () => {
              if (!confirm('حذف هذا التخصيص؟')) return;
              const db2 = Store.getDB();
              const map = db2.assignments?.[csKey]?.[subjIdx];
              if (map && map[tIdx] != null) delete map[tIdx];
              if (map && Object.keys(map).length === 0) delete db2.assignments[csKey][subjIdx];
              if (db2.assignments[csKey] && Object.keys(db2.assignments[csKey]).length === 0) delete db2.assignments[csKey];
              Store.setDB(db2); renderAssignList(); renderAssignStats(); renderTeacherStatsTable(); updateAssignRemaining(); renderTeacherSidebar();
            });
            actions.append(edit, del); item.append(left, actions); list.appendChild(item);
          });
        });
      });
    });
    const countEl = qs('#assignSearchCount'); if (countEl) countEl.textContent = `النتائج: ${results}`;
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
  // عند الاستبدال بمعلم واحد لكل مادة، نقارن مباشرة بالحد الأقصى المخصص للصف
  if (count > allocForSubject) { showToast('عدد الحصص يتجاوز التخصيص لهذا الصف'); return; }
    db.assignments = db.assignments || {}; const csKey = keyCS(cIdx, sIdx);
    db.assignments[csKey] = db.assignments[csKey] || {};
    // فرض معلم واحد فقط لكل مادة ضمن (صف/شعبة): إزالة أي مخصصات سابقة لنفس المادة ثم تعيين المعلم الحالي
    db.assignments[csKey][subjIdx] = {};
    db.assignments[csKey][subjIdx][tIdx] = count;
    Store.setDB(db);
  renderAssignList(); renderAssignStats(); renderTeacherStatsTable(); updateAssignRemaining(); renderTeacherSidebar();
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

  // البحث في قائمة التخصيصات
  const assignSearchInput = qs('#assignSearchInput');
  const assignSearchClear = qs('#assignSearchClear');
  if (assignSearchInput) {
    let t = null;
    assignSearchInput.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => renderAssignList(), 150);
    });
  }
  if (assignSearchClear) assignSearchClear.addEventListener('click', () => {
    const inp = qs('#assignSearchInput'); if (inp) inp.value = '';
    renderAssignList();
  });

  // ===== شريط تعديل التخصيص =====
  function populateEditBarSelectors() {
    const db = Store.getDB();
    const cSel = qs('#ebClassSelect'); const sSel = qs('#ebSectionSelect');
    const subjSel = qs('#ebSubjectSelect'); const tSel = qs('#ebTeacherSelect');
    if (!cSel || !sSel || !subjSel || !tSel) return;
    cSel.innerHTML = '<option value="">— اختر صف —</option>' + (db.classes||[]).map((c, i) => `<option value="${i}">${c.name}</option>`).join('');
    subjSel.innerHTML = '<option value="">— اختر مادة —</option>' + (db.subjectsCatalog||[]).map((s, i) => `<option value="${i}">${s.name}</option>`).join('');
    tSel.innerHTML = '<option value="">— اختر معلم —</option>' + (db.teachers||[]).map((t, i) => `<option value="${i}">${t.name}</option>`).join('');
    cSel.onchange = () => {
      const ci = cSel.value === '' ? -1 : parseInt(cSel.value, 10);
      const cls = (db.classes||[])[ci];
      const secs = cls && cls.sections && cls.sections.length ? cls.sections : [{ name: '—', _virtual: true }];
      sSel.innerHTML = '<option value="">— اختر شعبة —</option>' + secs.map((s, i) => `<option value="${i}">${s.name}</option>`).join('');
    };
  }

  let editBarState = null; // {from:{ci,si,subjIdx,tIdx}, count}
  function openAssignEditBar({ ci, si, subjIdx, tIdx, cnt }) {
    populateEditBarSelectors();
    editBarState = { from: { ci, si, subjIdx, tIdx }, count: cnt };
    const bar = qs('#assignEditBar'); const ebCount = qs('#ebCount');
    const cSel = qs('#ebClassSelect'); const sSel = qs('#ebSectionSelect'); const subjSel = qs('#ebSubjectSelect'); const tSel = qs('#ebTeacherSelect');
    if (!bar || !cSel || !sSel || !subjSel || !tSel) return;
    cSel.value = String(ci);
    cSel.dispatchEvent(new Event('change'));
    sSel.value = String(si);
    subjSel.value = String(subjIdx);
    tSel.value = String(tIdx);
    if (ebCount) ebCount.textContent = String(cnt);
    bar.classList.remove('hidden');
    // مرر تلقائيًا إلى شريط التعديل وضع التركيز لتجنّب حاجة المستخدم للتمرير يدويًا
    setTimeout(() => {
      try { bar.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' }); } catch (e) { /* متصفح لا يدعم */ }
      const focusEl = tSel || cSel;
      if (focusEl && typeof focusEl.focus === 'function') focusEl.focus();
    }, 0);
  }

  function closeAssignEditBar() {
    const bar = qs('#assignEditBar'); if (bar) bar.classList.add('hidden');
    editBarState = null;
  }

  function saveAssignEditBar() {
    if (!editBarState) return;
    const db = Store.getDB();
    const from = editBarState.from; const oldKey = keyCS(from.ci, from.si);
    const cSel = qs('#ebClassSelect'); const sSel = qs('#ebSectionSelect'); const subjSel = qs('#ebSubjectSelect'); const tSel = qs('#ebTeacherSelect');
    if (!cSel || !sSel || !subjSel || !tSel) return;
    if (cSel.value === '' || sSel.value === '' || subjSel.value === '' || tSel.value === '') { showToast('أكمل اختيارات التعديل: صف، شعبة، مادة، معلم'); return; }
    const nci = parseInt(cSel.value, 10); const nsi = parseInt(sSel.value, 10);
    const nSubj = parseInt(subjSel.value, 10); const nTeach = parseInt(tSel.value, 10);
    const newKey = keyCS(nci, nsi);
    const count = parseInt(editBarState.count, 10) || 0;
    if (count <= 0) { showToast('لا يمكن حفظ تعديل بحصص صفرية'); return; }
    const allocForSubject = (db.allocations?.[nSubj]?.[nci]) || 0;
    if (count > allocForSubject) { showToast('عدد الحصص يتجاوز التخصيص لهذا الصف'); return; }
    // أزل القديم
    const oldMap = db.assignments?.[oldKey]?.[from.subjIdx];
    if (oldMap && oldMap[from.tIdx] != null) delete oldMap[from.tIdx];
    if (oldMap && Object.keys(oldMap).length === 0) delete db.assignments[oldKey][from.subjIdx];
    if (db.assignments[oldKey] && Object.keys(db.assignments[oldKey]).length === 0) delete db.assignments[oldKey];
    // أضف الجديد مع فرض معلم واحد لكل مادة
    db.assignments = db.assignments || {}; db.assignments[newKey] = db.assignments[newKey] || {}; db.assignments[newKey][nSubj] = {};
    db.assignments[newKey][nSubj][nTeach] = count;
    Store.setDB(db);
  normalizeAssignmentsUniquePerSubject();
  renderAssignList(); renderAssignStats(); renderTeacherStatsTable(); renderTeacherSidebar();
    closeAssignEditBar();
    showToast('تم حفظ التعديل');
  }

  const btnEbSave = qs('#btnEbSave'); if (btnEbSave) btnEbSave.addEventListener('click', saveAssignEditBar);
  const btnEbClose = qs('#btnEbClose'); if (btnEbClose) btnEbClose.addEventListener('click', closeAssignEditBar);

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
        // قبل الحذف: نظّف/أعد ترقيم التخصيصات المرتبطة بالصفوف
        dropClassAndRemapAssignments(i);
        db.classes.splice(i, 1);
        Store.setDB(db); renderClasses(); refreshStats();
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
        // احسب فهرس الشعبة المراد حذفها قبل التغيير
        const secIndex = (cls.sections || []).findIndex(s => s.name === name);
        // عالج التخصيصات: إسقاط الشعبة المعنية وإعادة ترقيم ما بعدها
        if (secIndex >= 0) dropSectionAndRemapAssignments(i, secIndex);
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
        // إعادة ترقيم المعلمين في التخصيصات وإسقاط هذا المعلم
        dropTeacherAndRemapAssignments(i);
        db.teachers.splice(i, 1);
        // تحديث مدير المدرسة إذا تأثر
        if (typeof db.school?.principalId === 'number') {
          if (db.school.principalId === i) db.school.principalId = undefined;
          else if (db.school.principalId > i) db.school.principalId = db.school.principalId - 1;
        }
        Store.setDB(db); renderTeachers(); refreshStats();
        // إعادة تحميل نموذج المدرسة لضمان تزامن قائمة المدير
        loadSchoolForm();
      });
      actions.append(edit, del);
      item.append(left, actions);
      return item;
    });
  }

  // ===== أدوات مساعدة لتنظيف/إعادة ترقيم التخصيصات عند الحذف =====
  function parseCSKey(csKey) {
    const parts = String(csKey).split(':');
    const ci = parseInt(parts[0], 10); const si = parseInt(parts[1], 10);
    return { ci, si };
  }

  function rekeyAssignments(mapper) {
    const db = Store.getDB();
    const asg = db.assignments || {};
    const newAsg = {};
    Object.entries(asg).forEach(([csKey, subjMaps]) => {
      const { ci, si } = parseCSKey(csKey);
      const mapped = mapper(ci, si);
      if (!mapped) return; // drop
      const { ci: nci, si: nsi } = mapped;
      const newKey = `${nci}:${nsi}`;
      newAsg[newKey] = newAsg[newKey] || {};
      // دمج خرائط المواد (قد يحدث تضارب — سنطبع لاحقًا ونعيد التطبيع)
      Object.entries(subjMaps || {}).forEach(([subjIdx, teachMap]) => {
        newAsg[newKey][subjIdx] = Object.assign({}, newAsg[newKey][subjIdx] || {}, teachMap || {});
      });
    });
    db.assignments = newAsg;
    Store.setDB(db);
    // إعادة فرض القيد: معلم واحد لكل مادة
    normalizeAssignmentsUniquePerSubject();
  }

  function dropClassAndRemapAssignments(classIndex) {
    rekeyAssignments((ci, si) => {
      if (ci === classIndex) return null; // احذف كل الشعب التابعة لهذا الصف
      if (ci > classIndex) return { ci: ci - 1, si };
      return { ci, si };
    });
  }

  function dropSectionAndRemapAssignments(classIndex, sectionIndex) {
    rekeyAssignments((ci, si) => {
      if (ci !== classIndex) return { ci, si };
      if (si === sectionIndex) return null; // احذف الشعبة المعنية
      if (si > sectionIndex) return { ci, si: si - 1 };
      return { ci, si };
    });
  }

  function dropTeacherAndRemapAssignments(teacherIndex) {
    const db = Store.getDB();
    const asg = db.assignments || {};
    Object.keys(asg).forEach(csKey => {
      const subjMaps = asg[csKey] || {};
      Object.keys(subjMaps).forEach(subjIdx => {
        const teachMap = subjMaps[subjIdx] || {};
        const newTeachMap = {};
        Object.entries(teachMap).forEach(([tStr, cnt]) => {
          const t = parseInt(tStr, 10);
          const c = parseInt(cnt, 10) || 0;
          if (c <= 0) return;
          if (t === teacherIndex) return; // drop
          const nt = t > teacherIndex ? t - 1 : t;
          // في حالة تضارب المفاتيح بعد إعادة الترقيم، اختر الأعلى
          newTeachMap[nt] = Math.max(newTeachMap[nt] || 0, c);
        });
        subjMaps[subjIdx] = newTeachMap;
      });
    });
    db.assignments = asg;
    Store.setDB(db);
    normalizeAssignmentsUniquePerSubject();
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

  // ===== توليد جدول أسبوعي تلقائي وتبديل (Shuffle) =====
  // Helpers: حساب وقت الحصص + محرر سريع للخلايا
  function parseHm(str) {
    const [h, m] = String(str || '08:00').split(':').map(x => parseInt(x, 10) || 0);
    return h * 60 + m;
  }
  function fmtHm(totalMins) {
    // Format as 12-hour with leading zeros (e.g., 13:25 -> 01:25)
    const minsInDay = 24 * 60;
    const t = ((totalMins % minsInDay) + minsInDay) % minsInDay; // normalize
    const h24 = Math.floor(t / 60);
    const m = t % 60;
    let h12 = h24 % 12; if (h12 === 0) h12 = 12;
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return `${pad(h12)}:${pad(m)}`;
  }
  function getBreakAfter(db, idx) {
    const g = db.times?.global || { breakMinutes: 10 };
    const arr = db.times?.breaks || [];
    return Math.max(0, parseInt(arr[idx], 10) || g.breakMinutes || 0);
  }
  function getLessonMinutes(db) { return Math.max(10, parseInt(db.times?.global?.lessonMinutes, 10) || 40); }
  function getPerDayStart(db, day) { return db.times?.perDay?.[day]?.start || '08:00'; }
  function calcSlotTimeRange(db, day, slotIndex) {
    // slotIndex: 0-based
    const startM = parseHm(getPerDayStart(db, day));
    const L = getLessonMinutes(db);
    let cur = startM;
    for (let i = 0; i < slotIndex; i++) cur += L + getBreakAfter(db, i);
    const from = cur; const to = cur + L;
    return `${fmtHm(from)} - ${fmtHm(to)}`;
  }
  function attachCellEditor(el, key, currentText) {
    el.addEventListener('click', () => {
      const val = prompt('اكتب النص (مثال: المادة • المعلم)', currentText || '');
      if (val === null) return;
      const db = Store.getDB();
      db.timetable = db.timetable || {}; db.timetable.grid = db.timetable.grid || {};
      db.timetable.grid[key] = String(val).trim();
      Store.setDB(db);
      renderTimetable();
    });
  }
  function calcDailySlots(db) {
    // احصل على أيام وأسماء الحصص من times
    const allDays = db.timetable.days; // ['الأحد', ...]
    const activeDays = allDays.filter(d => (db.times?.workingDays?.[d]) !== false);
    const slots = db.timetable.slots; // ['1', '2', ...]
    return { days: activeDays, slots };
  }

  function buildAssignmentPool(db) {
    // يبني قائمة من المهام: لكل (صف/شعبة، مادة، معلم) عدد من التكرارات (الحصص) المطلوب توزيعها
    const pool = [];
    const asg = db.assignments || {};
    Object.entries(asg).forEach(([csKey, subjMap]) => {
      Object.entries(subjMap || {}).forEach(([subjIdxStr, teachMap]) => {
        const subjIdx = parseInt(subjIdxStr, 10);
        Object.entries(teachMap || {}).forEach(([tStr, cnt]) => {
          const teacherIdx = parseInt(tStr, 10); const count = parseInt(cnt, 10) || 0; if (count <= 0) return;
          pool.push({ csKey, subjIdx, teacherIdx, remaining: count });
        });
      });
    });
    return pool;
  }

  function generateAutoTimetable() {
    const db = Store.getDB();
    const { days, slots } = calcDailySlots(db);
    if (!days || !days.length || !slots || !slots.length) { showToast('الرجاء ضبط أيام الأسبوع وعدد الحصص أولًا'); return; }
    const grid = {}; // جديد
    const unplaced = []; // عناصر لم نتمكن من وضعها
    const teacherBusy = {}; // teacherIdx -> Set of key 'day|slot'
    const classBusy = {};   // csKey -> Set of key 'day|slot'
    const pool = buildAssignmentPool(db);
    if (!pool.length) { showToast('لا توجد تخصيصات حصص للمعلمين لإنشاء الجدول'); return; }
    // رتب المهام بحيث تُوزع المهام الأكثر عددًا أولًا لتقليل التعارضات
    pool.sort((a, b) => b.remaining - a.remaining);

    // لتفادي التجمع وإضافة عشوائية، أعطِ كل (csKey) إزاحة يومية عشوائية
    const csKeys = [...new Set(pool.map(p => p.csKey))];
    const offsets = Object.fromEntries(csKeys.map((k) => [k, Math.floor(Math.random() * days.length)]));
    // ترتيب حصص اليوم يمكن تدويره عشوائياً
    const slotOrders = days.reduce((acc, d) => {
      const order = [...slots.keys()]; // [0..n-1]
      const pivot = Math.floor(Math.random() * slots.length);
      const rotated = order.slice(pivot).concat(order.slice(0, pivot));
      acc[d] = rotated;
      return acc;
    }, {});

    // هيكل تكراري: لكل مهمة، حاول وضع الحصص عبر الأسبوع مع تدوير الأيام والفترات
    let safety = 0; // حارس لا نهائي
    while (pool.some(p => p.remaining > 0) && safety < 100000) {
      safety++;
      for (const p of pool) {
        if (p.remaining <= 0) continue;
        const startDayIdx = offsets[p.csKey] || 0;
        let placed = false;
        for (let di = 0; di < days.length && !placed; di++) {
          const day = days[(startDayIdx + di) % days.length];
          for (const si of slotOrders[day]) {
            if (placed) break;
            const slot = slots[si];
            const busyKey = day + '|' + slot;
            const tBusy = teacherBusy[p.teacherIdx] || new Set();
            const cBusy = classBusy[p.csKey] || new Set();
            if (tBusy.has(busyKey) || cBusy.has(busyKey)) continue; // تعارض معلم أو صف/شعبة
            // السماح بحصتين متتاليتين لنفس المادة/المعلم في نفس اليوم
            const key = p.csKey + '|' + day + '|' + slot;
            if (grid[key]) continue; // محجوزة بالفعل
            grid[key] = { subjIdx: p.subjIdx, teacherIdx: p.teacherIdx };
            // علّم الانشغال
            (teacherBusy[p.teacherIdx] ||= new Set()).add(busyKey);
            (classBusy[p.csKey] ||= new Set()).add(busyKey);
            p.remaining--;
            placed = true;
          }
        }
        // إذا لم ننجح في وضع هذه الحصة ضمن الدورة الحالية، سنحاول في دورة لاحقة من خلال while
        // عند نهاية الحلقة الخارجية، سنسجل ما لم يوضع.
      }
    }

    // بعد المحاولة المكثفة، أي عناصر لا تزال متبقية تعتبر غير موضوعة
    pool.forEach(p => {
      for (let i = 0; i < p.remaining; i++) unplaced.push({ csKey: p.csKey, subjIdx: p.subjIdx, teacherIdx: p.teacherIdx });
    });

    // حفظ الشبكة بصيغة العرض (اسم المادة • اسم المعلم)
    const showName = (subjIdx, teacherIdx) => {
      const subj = db.subjectsCatalog?.[subjIdx]?.name || '—';
      const t = db.teachers?.[teacherIdx]?.name || '—';
      return `${subj} • ${t}`;
    };
    db.timetable.grid = db.timetable.grid || {};
    Object.keys(db.timetable.grid).forEach(k => delete db.timetable.grid[k]);
    Object.entries(grid).forEach(([k, v]) => { db.timetable.grid[k] = showName(v.subjIdx, v.teacherIdx); });
    db.timetable.unplaced = unplaced; // لخانة العرض أسفل الجدول
    Store.setDB(db);
    // اختر أول صف وشعبة تلقائيًا لعرض النتيجة
    const classSel = qs('#ttClassSelect'); const sectSel = qs('#ttSectionSelect');
    if (classSel && sectSel) {
      let chosen = null;
      (db.classes || []).some((c, ci) => {
        const secs = c.sections || [];
        if (secs.length) { chosen = { ci, si: 0 }; return true; }
        return false;
      });
      if (chosen) {
        classSel.value = String(chosen.ci);
        // trigger population of sections and then set section value
        classSel.dispatchEvent(new Event('change'));
        setTimeout(() => { sectSel.value = String(chosen.si); sectSel.dispatchEvent(new Event('change')); }, 0);
      }
    }
    renderTimetable();
    showToast('تم إنشاء الجدول الأسبوعي تلقائيًا');
  }

  function shuffleTimetable() {
    // إعادة توزيع سريعة بإعادة التوليد مع عشوائية مختلفة
    generateAutoTimetable();
  }

  function currentClassSectionKey() {
    const cIdx = qs('#ttClassSelect').value;
    const sIdx = qs('#ttSectionSelect').value;
    if (cIdx === '' || sIdx === '') return null;
    return `${cIdx}:${sIdx}`;
  }

  function renderTimetable() {
    // عرض شامل: جدول بكل الصفوف/الشعب مقابل الأيام وعدد الحصص حسب الإعدادات (افتراضياً 6)
    const host = qs('#ttGlobalContainer');
    if (!host) return;
    const db = Store.getDB();
    const classes = db.classes || [];
    const allDays = db.timetable?.days || ['السبت','الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس'];
    const days = allDays.filter(d => (db.times?.workingDays?.[d]) !== false);
    const slots = db.timetable?.slots || ['الأولى','الثانية','الثالثة','الرابعة','الخامسة','السادسة'];
    const slotCount = slots.length;
  const grid = db.timetable?.grid || {};

  host.innerHTML = '';
  const table = document.createElement('table'); table.className = 'tt-table';
  table.classList.add('slots-' + slotCount);

    // thead: صف الأيام ثم صف الحصص
    const thead = document.createElement('thead');
    const daysRow = document.createElement('tr'); daysRow.className = 'days-row';
    const thClasses = document.createElement('th'); thClasses.className = 'class-col'; thClasses.rowSpan = 2; thClasses.textContent = 'الصف / الشعبة';
    daysRow.appendChild(thClasses);
    days.forEach((day, di) => {
      const th = document.createElement('th'); th.colSpan = slotCount; th.textContent = day; if (slotCount > 0) th.classList.add('tt-daysep-start'); daysRow.appendChild(th);
    });
    thead.appendChild(daysRow);

    const periodsRow = document.createElement('tr'); periodsRow.className = 'periods-row';
    days.forEach((_, di) => {
      for (let i = 1; i <= slotCount; i++) {
        const th = document.createElement('th'); th.textContent = String(i);
        if (i === 1) th.classList.add('tt-sep');
        periodsRow.appendChild(th);
      }
    });
    thead.appendChild(periodsRow);

    table.appendChild(thead);

    // tbody: لكل صف وشعبة
    const tbody = document.createElement('tbody');
    classes.forEach((cls, ci) => {
      const sections = (cls.sections && cls.sections.length) ? cls.sections : [{ name: '', _virtual: true }];
      sections.forEach((sec, si) => {
        const tr = document.createElement('tr');
        const tdClass = document.createElement('td'); tdClass.className = 'class-col'; tdClass.textContent = `${cls.name}${sec._virtual ? '' : ' — ' + (sec.name || '')}`; tr.appendChild(tdClass);
        days.forEach((day, di) => {
          for (let sIndex = 0; sIndex < slotCount; sIndex++) {
            const td = document.createElement('td'); td.className = 'slot';
            if (sIndex === 0) td.classList.add('tt-sep');
            const box = document.createElement('div'); box.className = 'tt-cell-box';
            const nameKey = `${ci}:${si}|${day}|${slots[sIndex]}`;
            const legacyKey = `${ci}:${si}|${day}|${sIndex + 1}`;
            const val = grid[nameKey] ?? grid[legacyKey] ?? '';
            if (val) { box.textContent = val; box.classList.add('filled'); }
            else { box.textContent = '—'; box.classList.add('tt-empty'); }
            // اجعل الخلية قابلة للنقر والـ DnD
            box.dataset.key = nameKey;
            box.setAttribute('draggable', 'true');
            box.addEventListener('dragstart', (e) => {
              e.dataTransfer.setData('text/plain', nameKey);
            });
            box.addEventListener('dragover', (e) => { e.preventDefault(); });
            box.addEventListener('drop', (e) => {
              e.preventDefault();
              const fromKey = e.dataTransfer.getData('text/plain');
              const toKey = nameKey;
              if (!fromKey || fromKey === toKey) return;
              moveOrSwapCells(fromKey, toKey);
            });
            box.addEventListener('click', () => openTtPickFor(nameKey));
            td.appendChild(box); tr.appendChild(td);
          }
        });
        tbody.appendChild(tr);
      });
    });
    table.appendChild(tbody);

    // Fit/Zoom controls
    const container = host.parentElement?.closest('.tt-container') || qs('.tt-container');
    const fitToggle = qs('#ttFitToggle');
    const zoomRange = qs('#ttZoomRange');
    const zoomVal = qs('#ttZoomVal');
    if (fitToggle && container) {
      container.classList.toggle('tt-fit', !!fitToggle.checked);
    }
    if (zoomRange && zoomVal && container) {
      const z = Math.max(50, Math.min(120, parseInt(zoomRange.value, 10) || 100));
      zoomVal.textContent = z + '%';
      const scale = z / 100;
      // apply scale by wrapping table into a zoom div
      const wrap = document.createElement('div');
      wrap.className = 'tt-zoom';
      wrap.style.transform = `scale(${scale})`;
      wrap.style.width = `${100/scale}%`;
      wrap.appendChild(table);
      host.appendChild(wrap);
    } else {
      host.appendChild(table);
    }
    const guard = qs('#ttGuard'); if (guard) guard.classList.add('hidden');

    // ===== إحصائيات أعلى الجدول =====
    try {
      const statScheduled = Object.values(grid).filter(v => v && String(v).trim()).length;
      // المطلوب من التخصيص للمعلمين (Assignments)
      const assignedTarget = Object.values(Store.getDB().assignments || {}).reduce((acc, subjMap) => {
        return acc + Object.values(subjMap || {}).reduce((s, teachMap) => s + Object.values(teachMap || {}).reduce((a, c) => a + (parseInt(c, 10) || 0), 0), 0);
      }, 0);
      // المطلوب من التخصيص العام (Allocations) مضروباً بعدد الشعب
      const classes = Store.getDB().classes || [];
      const allocTarget = Object.values(Store.getDB().allocations || {}).reduce((sum, map) => {
        return sum + Object.entries(map || {}).reduce((s, [ciStr, v]) => {
          const ci = parseInt(ciStr, 10);
          const perSection = parseInt(v, 10) || 0;
          const sectionsCount = Math.max(1, (classes[ci]?.sections || []).length || 0);
          return s + perSection * sectionsCount;
        }, 0);
      }, 0);
      // سعة الخلايا = عدد الأيام × عدد الحصص × عدد الشعب الكلي
  const allDays2 = Store.getDB().timetable?.days || [];
  const days2 = allDays2.filter(d => (Store.getDB().times?.workingDays?.[d]) !== false);
      const slots = Store.getDB().timetable?.slots || [];
      const sectionsTotal = classes.reduce((s, c) => s + Math.max(1, (c.sections || []).length || 0), 0);
  const capacity = days2.length * slots.length * sectionsTotal;
      const emptyCells = capacity - statScheduled;
      const gap = Math.max(0, assignedTarget - statScheduled);
      const set = (id, val) => { const el = qs('#' + id); if (el) el.textContent = String(val); };
      set('ttStatScheduled', statScheduled);
      set('ttStatAssigned', assignedTarget);
      set('ttStatGap', gap);
      set('ttStatAlloc', allocTarget);
      set('ttStatCapacity', capacity);
      set('ttStatEmptyCells', emptyCells);
    } catch {}

    // Render unplaced bar (two kinds):
    // 1) unplaced from auto-distribution (db.timetable.unplaced)
    // 2) assigned-but-not-yet-scheduled (computed from assignments vs current grid usage)
  const bar = qs('#ttUnplacedBar'); const list = qs('#ttUnplacedList'); const status = qs('#ttUnplacedStatus');
  if (bar && list) {
      const unp = db.timetable?.unplaced || [];
      // compute assigned-but-unscheduled
      const used = {}; // used[csKey][subjIdx][tIdx] = count in grid
      Object.entries(grid).forEach(([k, v]) => {
        if (!v) return;
        const meta = getTeacherAndSubjectByCellValue(db, v);
        if (!meta) return;
        const cs = k.split('|')[0];
        used[cs] = used[cs] || {}; used[cs][meta.subjIdx] = used[cs][meta.subjIdx] || {}; used[cs][meta.subjIdx][meta.teacherIdx] = (used[cs][meta.subjIdx][meta.teacherIdx] || 0) + 1;
      });
      const needs = [];
      Object.entries(db.assignments || {}).forEach(([csKey, subjMap]) => {
        Object.entries(subjMap || {}).forEach(([subjIdxStr, teachMap]) => {
          const subjIdx = parseInt(subjIdxStr, 10);
          Object.entries(teachMap || {}).forEach(([tStr, cnt]) => {
            const tIdx = parseInt(tStr, 10);
            const target = parseInt(cnt, 10) || 0;
            if (target <= 0) return;
            const usedCnt = used[csKey]?.[subjIdx]?.[tIdx] || 0;
            if (target > usedCnt) {
              // parse cs
              const [ciStr, siStr] = csKey.split(':');
              const ci = parseInt(ciStr, 10), si = parseInt(siStr, 10);
              needs.push({ csKey, ci, si, subjIdx, teacherIdx: tIdx, remaining: target - usedCnt });
            }
          });
        });
      });
      // allocation-based deficits per section (ignoring teacher):
      const allocNeeds = [];
      const classes = db.classes || [];
      classes.forEach((cls, ci) => {
        const sections = (cls.sections && cls.sections.length) ? cls.sections : [{ _virtual: true }];
        sections.forEach((_, si) => {
          const csKey = `${ci}:${si}`;
          (db.subjectsCatalog || []).forEach((_, subjIdx) => {
            const alloc = parseInt(db.allocations?.[subjIdx]?.[ci], 10) || 0;
            if (alloc <= 0) return;
            // count placed cells for this (csKey, subject)
            let placed = 0;
            Object.entries(grid).forEach(([k, v]) => {
              if (!v) return;
              const [cs, , ] = k.split('|');
              if (cs !== csKey) return;
              const meta = getTeacherAndSubjectByCellValue(db, v);
              if (meta && meta.subjIdx === subjIdx) placed++;
            });
            if (alloc > placed) allocNeeds.push({ csKey, ci, si, subjIdx, remaining: alloc - placed });
          });
        });
      });
      // Group items by class/section for clearer columns
      list.innerHTML = '';
      const groups = new Map(); // key: ci:si -> { title, chips: [] }
      const addToGroup = (ci, si, chip) => {
        const key = `${ci}:${si}`;
        if (!groups.has(key)) {
          const clsName = db.classes?.[ci]?.name || '—';
          const secName = (db.classes?.[ci]?.sections || [])[si]?.name || '—';
          groups.set(key, { title: `${clsName}${secName ? ' — ' + secName : ''}`, chips: [] });
        }
        groups.get(key).chips.push(chip);
      };
      // from unplaced pool (note: we don't have ci/si in saved item; skip grouping, show in a generic group)
      if (unp.length) {
        const box = document.createElement('div'); box.className = 'unplaced-group';
        const h = document.createElement('div'); h.className = 'title'; h.textContent = 'من مولد التوزيع';
        const chips = document.createElement('div'); chips.className = 'chips';
        unp.forEach((u, idx) => {
          const subj = db.subjectsCatalog?.[u.subjIdx]?.name || '—';
          const t = db.teachers?.[u.teacherIdx]?.name || '—';
          const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = `${subj} • ${t}`;
          chip.title = 'اسحب هذه الحصة إلى خانة مناسبة في الجدول';
          chip.setAttribute('draggable', 'true');
          chip.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', `UNPLACED:${idx}`);
          });
          chips.appendChild(chip);
        });
        box.append(h, chips); list.appendChild(box);
      }
      // assigned-but-not-scheduled grouped per class/section
      needs.forEach((n) => {
        const subj = db.subjectsCatalog?.[n.subjIdx]?.name || '—';
        const t = db.teachers?.[n.teacherIdx]?.name || '—';
        const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = `${subj} • ${t} ×${n.remaining}`;
        chip.title = `مطلوب إدراج (${n.remaining})`;
        chip.setAttribute('draggable', 'true');
        chip.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', `ASSIGNED:${n.ci}:${n.si}:${n.subjIdx}:${n.teacherIdx}`);
        });
        addToGroup(n.ci, n.si, chip);
      });
      // allocation-only deficits (no teacher) grouped per class/section
      allocNeeds.forEach((n) => {
        const subj = db.subjectsCatalog?.[n.subjIdx]?.name || '—';
        const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = `${subj} ×${n.remaining}`;
        chip.title = 'مطلوب تعيين معلّم ثم الإدراج';
        chip.setAttribute('draggable', 'true');
        chip.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', `ALLOC:${n.ci}:${n.si}:${n.subjIdx}`);
        });
        addToGroup(n.ci, n.si, chip);
      });
      groups.forEach((g) => {
        const box = document.createElement('div'); box.className = 'unplaced-group';
        const h = document.createElement('div'); h.className = 'title'; h.textContent = g.title;
        const chips = document.createElement('div'); chips.className = 'chips'; g.chips.forEach(ch => chips.appendChild(ch));
        box.append(h, chips); list.appendChild(box);
      });
      if (status) {
  const total = (unp?.length || 0) + needs.reduce((s,n)=>s+n.remaining,0) + allocNeeds.reduce((s,n)=>s+n.remaining,0);
        status.textContent = total > 0 
          ? `مطلوب إدراج إجمالي: ${total} (التوزيع لم يضع: ${unp.length} • من المخصصة غير المدرجة: ${needs.reduce((s,n)=>s+n.remaining,0)} • من التخصيصات دون معلم: ${allocNeeds.reduce((s,n)=>s+n.remaining,0)})`
          : 'لا توجد عناصر غير مدرجة حالياً.';
      }
    }
  }

  // تحريك/مبادلة الخلايا مع التحقق من التعارض
  function parseGridKey(key) {
    const [cs, day, slot] = String(key).split('|');
    const [ci, si] = cs.split(':').map(x => parseInt(x, 10));
    return { ci, si, day, slot };
  }

  function getTeacherAndSubjectByCellValue(db, val) {
    // صيغة العرض: "المادة • المعلم"
    if (!val) return null;
    const parts = String(val).split('•').map(s => s.trim());
    const subjName = parts[0] || '';
    const teacherName = parts[1] || '';
    const subjIdx = (db.subjectsCatalog || []).findIndex(s => (s.name || '').trim() === subjName);
    const teacherIdx = (db.teachers || []).findIndex(t => (t.name || '').trim() === teacherName);
    if (subjIdx < 0 || teacherIdx < 0) return null;
    return { subjIdx, teacherIdx };
  }

  function isConflict(db, key, subjIdx, teacherIdx, opts = {}) {
    const { ignoreOccupied = false, excludeKey = null } = opts;
    const { day, slot, ci, si } = parseGridKey(key);
    const grid = db.timetable?.grid || {};
    // تعارض معلم: لا يمكن أن يكون المعلم في أكثر من خانة بنفس اليوم والوقت
    const teacherBusy = Object.entries(grid).some(([k, v]) => {
      if (!v) return false;
      const meta = getTeacherAndSubjectByCellValue(db, v);
      if (!meta) return false;
      const { day: d2, slot: s2 } = parseGridKey(k);
      return meta.teacherIdx === teacherIdx && d2 === day && s2 === slot && k !== key && k !== excludeKey;
    });
    if (teacherBusy) return 'تعارض معلم في نفس الوقت';
    // تعارض صف/شعبة: لا يمكن لخانة الصف أن تحتوي حصتين
    const existing = grid[key];
    if (!ignoreOccupied && existing && existing.trim()) return 'الخانة مشغولة';
    // تحقق أن هذه المادة مخصصة لهذا الصف أصلاً
    const alloc = parseInt(db.allocations?.[subjIdx]?.[ci], 10) || 0;
    if (alloc <= 0) return 'هذه المادة غير مخصصة لهذا الصف';
    // تحقق أن المعلم مخصص لهذه المادة لهذه الشعبة
    const csKey = `${ci}:${si}`;
    const teachMap = db.assignments?.[csKey]?.[subjIdx] || {};
    if (!(teacherIdx in teachMap)) return 'هذا المعلم غير مخصص لهذه المادة في هذه الشعبة';
    // عدم تجاوز العدد المخصص لهذا المعلم
    const assignedCount = parseInt(teachMap[teacherIdx], 10) || 0;
    const usedCount = Object.entries(grid).reduce((acc, [k, v]) => {
      if (!v || k === excludeKey) return acc;
      const meta = getTeacherAndSubjectByCellValue(db, v);
      if (!meta) return acc;
      const { ci: ci2, si: si2 } = parseGridKey(k);
      if (ci2 === ci && si2 === si && meta.subjIdx === subjIdx && meta.teacherIdx === teacherIdx) return acc + 1;
      return acc;
    }, 0);
    if (usedCount >= assignedCount) return 'تجاوزت عدد الحصص المخصصة لهذا المعلم لهذه المادة';
    // يُسمح بتتابع نفس المادة في نفس اليوم لنفس الشعبة
    return null;
  }

  function moveOrSwapCells(fromKey, toKey) {
    const db = Store.getDB();
    const grid = db.timetable?.grid || {};
    const fromVal = grid[fromKey] || '';
    if (fromKey.startsWith('UNPLACED:')) {
      // السحب من شريط غير المُدرجة
      const idx = parseInt(fromKey.split(':')[1], 10);
      const item = (db.timetable?.unplaced || [])[idx];
      if (!item) return;
      const conflict = isConflict(db, toKey, item.subjIdx, item.teacherIdx);
      if (conflict) { showToast(conflict); return; }
      const subj = db.subjectsCatalog?.[item.subjIdx]?.name || '—';
      const t = db.teachers?.[item.teacherIdx]?.name || '—';
      grid[toKey] = `${subj} • ${t}`;
      // احذف من غير المُدرجة
      const up = db.timetable.unplaced || [];
      up.splice(idx, 1);
      Store.setDB(db);
      renderTimetable();
      return;
    }
    if (fromKey.startsWith('ASSIGNED:')) {
      // السحب من شريط "المخصصة غير المدرجة" (إضافة حصة واحدة)
      const parts = fromKey.split(':');
      const ci = parseInt(parts[1], 10), si = parseInt(parts[2], 10), subjIdx = parseInt(parts[3], 10), teacherIdx = parseInt(parts[4], 10);
      const conflict = isConflict(db, toKey, subjIdx, teacherIdx);
      if (conflict) { showToast(conflict); return; }
      const subj = db.subjectsCatalog?.[subjIdx]?.name || '—';
      const t = db.teachers?.[teacherIdx]?.name || '—';
      grid[toKey] = `${subj} • ${t}`;
      Store.setDB(db);
      renderTimetable();
      return;
    }
    if (fromKey.startsWith('ALLOC:')) {
      // السحب من شريط التخصيص (بدون اختيار معلم بعد): افتح نافذة الاختيار مهيأة بالمادة
      const parts = fromKey.split(':');
      const subjIdx = parseInt(parts[3], 10);
      openTtPickFor(toKey, subjIdx);
      return;
    }
    const toVal = grid[toKey] || '';
    // إذا كانت الوجهة مشغولة، جرب المقايضة إن لم تخلق تعارضًا جديدًا
    if (toVal) {
      // تحليل المصدر والوجهة
      const metaFrom = getTeacherAndSubjectByCellValue(db, fromVal);
      const metaTo = getTeacherAndSubjectByCellValue(db, toVal);
      if (!metaFrom || !metaTo) return;
  const c1 = isConflict(db, toKey, metaFrom.subjIdx, metaFrom.teacherIdx, { ignoreOccupied: true, excludeKey: fromKey });
      // تفريغ منKey مؤقتًا قبل اختبار c2 حتى لا يحسب تعارضًا مع نفسه
      const tmp = grid[fromKey]; grid[fromKey] = '';
  const c2 = isConflict(db, fromKey, metaTo.subjIdx, metaTo.teacherIdx, { ignoreOccupied: true, excludeKey: toKey });
      grid[fromKey] = tmp;
      if (c1 || c2) { showToast('لا يمكن المقايضة بسبب التعارض'); return; }
      grid[toKey] = fromVal; grid[fromKey] = toVal;
      Store.setDB(db); renderTimetable(); return;
    }
    // وجهة فارغة: انقل إن لم يوجد تعارض
    const meta = getTeacherAndSubjectByCellValue(db, fromVal);
    if (!meta) return;
  const conflict = isConflict(db, toKey, meta.subjIdx, meta.teacherIdx, { excludeKey: fromKey });
    if (conflict) { showToast(conflict); return; }
    grid[toKey] = fromVal; grid[fromKey] = '';
    Store.setDB(db); renderTimetable();
  }

  // فتح نافذة اختيار مادة مباشرة للنقرة على الخلية
  function openTtPickFor(key, preselectSubjIdx = null) {
    const db = Store.getDB();
    const dlg = qs('#modal-tt-pick'); if (!dlg) return;
    const label = qs('#ttPickCellLabel'); if (label) label.textContent = `الخانة: ${key}`;
    const subjSel = qs('#ttPickSubject'); if (!subjSel) return;
    // ابنِ قائمة المواد: فقط المواد المخصصة لهذا الصف والتي لا تزال لها متبقي غير مُجدول
    const { ci, si } = parseGridKey(key); const csKey = `${ci}:${si}`;
    const grid = db.timetable?.grid || {};
    const options = [];
    (db.subjectsCatalog || []).forEach((s, i) => {
      const alloc = parseInt(db.allocations?.[i]?.[ci], 10) || 0; if (alloc <= 0) return;
      // العدّ المُجدول فعليًا لهذا الموضوع في هذه الشعبة
      let placed = 0;
      Object.entries(grid).forEach(([k, v]) => {
        if (!v) return; if (!k.startsWith(csKey + '|')) return;
        const meta = getTeacherAndSubjectByCellValue(db, v); if (meta && meta.subjIdx === i) placed++;
      });
      const remaining = alloc - placed;
      if (remaining > 0 || i === preselectSubjIdx) {
        options.push({ i, label: `${s.name} ×${Math.max(remaining,0)}` });
      }
    });
    if (!options.length) {
      subjSel.innerHTML = '<option value="" disabled>لا توجد مواد متبقية لهذه الشعبة</option>';
    } else {
      subjSel.innerHTML = '<option value="">— اختر مادة —</option>' + options.map(o=>`<option value="${o.i}">${o.label}</option>`).join('');
    }
    // عند اختيار المادة، نحاول تحديد المعلم المخصص لهذه المادة لنفس الصف/الشعبة
    subjSel.onchange = () => {
      const v = subjSel.value; const row = qs('#ttPickTeacherRow'); if (!row) return;
      if (v === '') { row.textContent = '—'; return; }
      const subjIdx = parseInt(v, 10);
      const teachMap = Store.getDB().assignments?.[csKey]?.[subjIdx] || {};
      const pair = Object.entries(teachMap).map(([t,c])=>[parseInt(t,10), parseInt(c,10)||0]).sort((a,b)=>b[1]-a[1])[0];
      if (pair) { const tName = Store.getDB().teachers?.[pair[0]]?.name || '—'; row.textContent = `المعلم: ${tName} • حصص: ${pair[1]}`; row.dataset.tidx = String(pair[0]); }
      else { row.textContent = 'لا يوجد معلم مخصص لهذه المادة لهذا الصف/الشعبة'; row.dataset.tidx = ''; }
    };
    if (preselectSubjIdx != null) {
      subjSel.value = String(preselectSubjIdx);
      subjSel.dispatchEvent(new Event('change'));
    }
    const btnCancel = qs('#btnTtPickCancel'); if (btnCancel) btnCancel.onclick = () => dlg.close('cancel');
    const btnClear = qs('#btnTtPickClear'); if (btnClear) btnClear.onclick = () => { const db2=Store.getDB(); db2.timetable.grid[key] = ''; Store.setDB(db2); renderTimetable(); dlg.close('default'); };
    const form = qs('#form-tt-pick'); if (form) form.onsubmit = (e) => {
      e.preventDefault();
      const v = subjSel.value; if (v === '') { showToast('اختر مادة'); return; }
      const subjIdx = parseInt(v, 10);
      const tRow = qs('#ttPickTeacherRow'); const tIdxStr = tRow?.dataset.tidx || '';
      if (tIdxStr === '') { showToast('لا يوجد معلم لهذه المادة في هذا الصف. عيّن معلمًا من صفحة التخصيص أولًا.'); return; }
      const tIdx = parseInt(tIdxStr, 10);
      // تحقق عدم تجاوز التخصيص العام لهذه الشعبة
      const dbx = Store.getDB(); const { ci, si } = parseGridKey(key);
      const alloc = parseInt(dbx.allocations?.[subjIdx]?.[ci], 10) || 0;
      let placed = 0; Object.entries(dbx.timetable?.grid || {}).forEach(([k, v]) => {
        if (!v) return; if (!k.startsWith(`${ci}:${si}|`)) return; const meta = getTeacherAndSubjectByCellValue(dbx, v); if (meta && meta.subjIdx === subjIdx) placed++;
      });
      if (placed >= alloc) { showToast('لا يوجد متبقي لهذه المادة في هذه الشعبة وفق التخصيص العام'); return; }
      const conflict = isConflict(dbx, key, subjIdx, tIdx);
      if (conflict) { showToast(conflict); return; }
      const subj = Store.getDB().subjectsCatalog?.[subjIdx]?.name || '—';
      const t = Store.getDB().teachers?.[tIdx]?.name || '—';
      const db3 = Store.getDB(); db3.timetable.grid = db3.timetable.grid || {}; db3.timetable.grid[key] = `${subj} • ${t}`; Store.setDB(db3); renderTimetable(); dlg.close('default');
    };
    dlg.returnValue = 'cancel'; dlg.showModal();
  }

  function saveTimetableFromUI() {
    const db = Store.getDB();
    const tt = db.timetable; tt.grid = tt.grid || {};
    qsa('.tt-cell[contenteditable="true"]').forEach(cell => {
      tt.grid[cell.dataset.key] = cell.textContent.trim();
    });
    Store.setDB(db);
  }
  // أزرار توزيع/تدوير/تفريغ
  const btnDistributeTT = qs('#btnDistributeTT'); if (btnDistributeTT) btnDistributeTT.addEventListener('click', generateAutoTimetable);
  const btnShuffleTT = qs('#btnShuffleTT'); if (btnShuffleTT) btnShuffleTT.addEventListener('click', shuffleTimetable);
  const btnResetTT = qs('#btnResetTT'); if (btnResetTT) btnResetTT.addEventListener('click', () => {
    if (!confirm('تفريغ الجدول لجميع الصفوف والشعب؟')) return;
    const db = Store.getDB(); db.timetable = db.timetable || {}; db.timetable.grid = {};
    Store.setDB(db); renderTimetable(); showToast('تم تفريغ الجدول');
  });

  // Preview navigation
  const btnPreviewTT = qs('#btnPreviewTT'); if (btnPreviewTT) btnPreviewTT.addEventListener('click', () => UI.routeTo('#/preview'));
  const btnPreviewBack = qs('#btnPreviewBack'); if (btnPreviewBack) btnPreviewBack.addEventListener('click', () => UI.routeTo('#/timetable'));

  // Preview helpers
  // Note: Header will be rendered by UI.printDocument; keep contentHtml minimal
  function buildPreviewHeader() { return ''; }

  function previewGlobalTable() {
    const db = Store.getDB();
    const grid = db.timetable?.grid || {};
    const classes = db.classes || [];
    const allDays = db.timetable?.days || [];
    const days = allDays.filter(d => (db.times?.workingDays?.[d]) !== false);
    const slots = db.timetable?.slots || [];
    const st = db.settings?.printing?.globalStyle || {};
    const C_DAY_BG = st.dayHeaderBg || '#eef2ff';
    const C_DAY_TX = st.dayHeaderText || '#111827';
    const C_SLOT_BG = st.slotHeaderBg || '#f3f4f6';
    const C_SLOT_TX = st.slotHeaderText || '#111827';
    const C_BORDER = st.border || '#d1d5db';
    const C_CLASS_BG = st.classColBg || '#f9fafb';
    const C_CLASS_TX = st.classColText || '#ef4444';
  const S_SUBJ = st.subjSize || 15;
  const S_TEACH = st.teacherSize || 13;
    // CSS shared across pages
    let html = '';
    html += `<style>
      .gtable{ width:100%; border-collapse:separate; border-spacing:0; table-layout:fixed }
      .gtable th,.gtable td{ border:1px solid ${C_BORDER}; padding:4.5px; word-break: break-word; overflow-wrap: anywhere; white-space: normal; vertical-align: top }
      .gtable thead .row-days th{ background:${C_DAY_BG}; color:${C_DAY_TX}; text-align:center; font-weight:800; font-size:12px }
      .gtable thead .row-slots th{ background:${C_SLOT_BG}; color:${C_SLOT_TX}; text-align:center; font-weight:700; font-size:11px }
      .gtable .class-col{ position:sticky; right:0; background:${C_CLASS_BG}; color:${C_CLASS_TX}; font-weight:800; white-space:nowrap }
      .gtable .cell-subj{ display:block; font-weight:800; font-size:${S_SUBJ}px; line-height:1.22; margin-bottom:2px }
      .gtable .cell-teacher{ display:block; color:#374151; font-size:${S_TEACH}px; line-height:1.15 }
      .gpage{ page-break-after:always }
      .gpage:last-child{ page-break-after:auto }
    </style>`;

    // Flatten rows (class/section pairs)
    const rows = [];
    classes.forEach((cls, ci) => {
      const sections = (cls.sections && cls.sections.length) ? cls.sections : [{ name: '', _virtual: true }];
      sections.forEach((sec, si) => rows.push({ ci, si, label: `${cls.name}${sec._virtual ? '' : ' — ' + (sec.name||'')}` }));
    });
    const perPage = 4; // 4 صفوف لكل صفحة
    for (let start = 0; start < rows.length; start += perPage) {
      const slice = rows.slice(start, start + perPage);
      html += `<section class="gpage"><div class="gfit">`;
      html += `<table class="gtable"><thead>`;
      html += `<tr class="row-days"><th rowspan="2" class="class-col">الصف/الشعبة</th>`;
      days.forEach(day => { html += `<th colspan="${slots.length}">${day}</th>`; });
      html += `</tr>`;
      html += `<tr class="row-slots">`;
      days.forEach(() => { for (let i=0;i<slots.length;i++) html += `<th>${i+1}</th>`; });
      html += `</tr></thead><tbody>`;
      slice.forEach(({ci, si, label}) => {
        html += `<tr><td class="class-col">${label}</td>`;
        days.forEach(day => {
          for (let s=0;s<slots.length;s++) {
            const key = `${ci}:${si}|${day}|${slots[s]}`;
            const legacy = `${ci}:${si}|${day}|${s+1}`;
            const val = grid[key] ?? grid[legacy] ?? '';
            if (!val) { html += `<td>—</td>`; continue; }
            const meta = getTeacherAndSubjectByCellValue(db, val);
            const subj = db.subjectsCatalog?.[meta?.subjIdx || -1]?.name || val.split('•')[0]?.trim() || '';
            const full = db.teachers?.[meta?.teacherIdx || -1]?.name || val.split('•')[1]?.trim() || '';
            const teacher = (full.split(/\s+/)[0] || full);
            html += `<td><span class="cell-subj">${subj}</span>${teacher?`<span class="cell-teacher">${teacher}</span>`:''}</td>`;
          }
        });
        html += `</tr>`;
      });
      html += `</tbody></table></div></section>`;
    }
    // Fit each page to width
    html += `<script>(function(){function fit(){try{var main=document.querySelector('main.print-body');if(!main)return;var avail=main.clientWidth;document.querySelectorAll('.gfit').forEach(function(w){w.style.transform='';w.style.width='';var need=w.scrollWidth;var s=need>avail?Math.max(0.5,avail/need):1;w.style.transformOrigin='top right';w.style.transform='scale('+s+')';w.style.width=(100/s)+'%';});}catch(e){}}if(document.readyState==='complete')setTimeout(fit,30);else window.addEventListener('load',function(){setTimeout(fit,30)});})();</script>`;
    const prn = db.settings?.printing || {};
    UI.printDocument({
      contentHtml: html,
      docTitle: 'الجدول الأسبوعي للصفوف',
      school: db.school,
      orientation: prn.orientations?.global || 'landscape',
      margin: prn.marginGlobal || prn.margin || '10mm 5mm',
      fontScale: prn.fontScale || 1,
      fontFamily: prn.fontFamily || '',
      headerTypography: prn.headerTypography || {},
      footerLeftImageUrl: prn.footer?.leftImageUrl || '',
      footerRightHtml: prn.footer?.rightHtml || ''
    });
  }

  function previewBySections() {
    const db = Store.getDB();
    const grid = db.timetable?.grid || {};
    const allDays = db.timetable?.days || [];
    const days = allDays.filter(d => (db.times?.workingDays?.[d]) !== false);
    const slots = db.timetable?.slots || [];
    const prn = Store.getDB().settings?.printing || {};
    const ht = prn.headerTypography || {};
    // Helper: Arabic ordinals for lesson headers
    const ordinal = (n) => {
      const map = {
        1: 'الأول', 2: 'الثاني', 3: 'الثالث', 4: 'الرابع', 5: 'الخامس', 6: 'السادس',
        7: 'السابع', 8: 'الثامن', 9: 'التاسع', 10: 'العاشر', 11: 'الحادي عشر', 12: 'الثاني عشر'
      };
      return map[n] || String(n);
    };
    const lessonHeader = (i) => `الدرس ${ordinal(i+1)}`;
    // تحويل الجنس لعرضه كنص سليم
    const genderRaw = (db.school?.gender || '').toString();
    const norm = genderRaw.replace(/[\sـ]/g, '');
    let genderDisplay = '';
    if (/(ذكور|للذكور|بنين)/.test(norm)) genderDisplay = 'للبنين';
    else if (/(اناث|إناث|للاناث|للإناث|بنات)/.test(norm)) genderDisplay = 'للبنات';
  else if (/(مختلط|مختلطة|مشترك)/.test(norm)) genderDisplay = 'المختلطة';
    else genderDisplay = genderRaw;

    // Inline CSS to make each class/section fill page and improve look
    const secSt = prn.sectionsStyle || {};
    const C_HEADER_BG = secSt.headerBg || '#eef2ff';
    const C_HEADER_TX = secSt.headerText || '#111827';
    const C_DAY_BG = secSt.dayColBg || '#f9fafb';
    const C_DAY_BG_ALT = secSt.dayColAlt || '#f3f4f6';
    const C_BORDER = secSt.border || '#d1d5db';
    const S_SUBJ = (secSt.subjSize || 16) + 'px';
    const S_TEACH = (secSt.teacherSize || 14) + 'px';
    const S_TIME = (secSt.timeSize || 13) + 'px';
    const DAY_FONT_COLOR = secSt.dayFontColor || '#111827';
    const DAY_FONT_SIZE = (secSt.dayFontSize || 14) + 'px';
    const extraCss = `
      <style>
        .sect-page{ min-height: calc(100vh - 24mm); display:flex; flex-direction:column; }
        .sect-header{ display:flex; align-items:center; justify-content:space-between; gap:12px; border-bottom:1px solid #e5e7eb; padding:10px 0 }
        .sect-table{ width:100%; border-collapse:collapse; table-layout:fixed; height:100%; }
        .sect-table thead th{ background:${C_HEADER_BG}; color:${C_HEADER_TX}; border:1px solid ${C_BORDER}; padding:10px 8px; font-weight:800; font-size:1.05em }
        .sect-table tbody{ height:100% }
        .sect-table tbody tr{ height: calc(100% / var(--days, 6)); }
        .sect-table tbody td{ border:1px solid ${C_BORDER}; padding:14px 10px; vertical-align:middle; text-align:center; height:100% }
  .sect-table th:first-child, .sect-table td:first-child{ width:120px; background:${C_DAY_BG}; font-weight:700; color:${DAY_FONT_COLOR}; font-size:${DAY_FONT_SIZE} }
        .sect-table tbody tr:nth-child(odd) td:first-child{ background:${C_DAY_BG_ALT} }
        .lesson-cell{ line-height:1.35; }
        .lesson-subj{ font-weight:800; font-size:${S_SUBJ}; margin-bottom:4px }
        .lesson-teacher{ color:#374151; margin-bottom:4px; font-size:${S_TEACH} }
        .lesson-time{ color:#6b7280; font-size:${S_TIME} }
        .page-break{ page-break-after:always; height:0 }
      </style>`;

    let bigHtml = extraCss;
    (db.classes || []).forEach((cls, ci) => {
      const sections = (cls.sections && cls.sections.length) ? cls.sections : [{ name: '', _virtual: true }];
      sections.forEach((sec, si) => {
        // هيدر داخل المحتوى لكل شعبة (بدون تاريخ)
        const leftTitle = `${cls.name}${sec._virtual ? '' : ' — ' + (sec.name||'')}`;
        bigHtml += `
          <section class="sect-page" style="--days:${days.length}">
            <div class="sect-header">
              <div style="text-align:center">
                <div style="font-weight:800; ${ht.schoolName?.family ? `font-family:${ht.schoolName.family};` : ''} font-size:${(ht.schoolName?.size??18)}px">${db.school?.name || 'المدرسة'}</div>
                <div class="muted" style="${ht.gender?.family ? `font-family:${ht.gender.family};` : ''} font-size:${(ht.gender?.size??12)}px">${genderDisplay || ''}</div>
              </div>
              <div style="text-align:center;flex:1">
                <div style="font-weight:800; ${ht.docTitle?.family ? `font-family:${ht.docTitle.family};` : ''} font-size:${(ht.docTitle?.size??16)}px">الجدول الأسبوعي للصفوف</div>
                ${db.school?.year ? `<div class="muted" style="${ht.year?.family ? `font-family:${ht.year.family};` : ''} font-size:${(ht.year?.size??12)}px">للعام الدراسي ${db.school.year}</div>` : ''}
              </div>
              <div style="text-align:left">
                <div style="font-weight:800; ${ht.left?.family ? `font-family:${ht.left.family};` : ''} font-size:${(ht.left?.size??16)}px">${leftTitle}</div>
              </div>
            </div>`;
        // جدول الشعبة (يمتد ليملأ الصفحة)
        bigHtml += `<table class="sect-table" style="margin-top:8px"><thead><tr><th>اليوم/الحصة</th>${slots.map((_,i)=>`<th>${lessonHeader(i)}</th>`).join('')}</tr></thead><tbody>`;
        days.forEach(day => {
          bigHtml += `<tr><td>${day}</td>`;
          slots.forEach((slotName, s) => {
            const key = `${ci}:${si}|${day}|${slotName}`;
            const legacy = `${ci}:${si}|${day}|${s+1}`;
            const val = grid[key] ?? grid[legacy] ?? '';
            if (!val) {
              bigHtml += `<td>—</td>`;
            } else {
              // Parse "المادة • المعلم" then render:
              // line1: subject name
              // line2: teacher first name only
              // line3: time range from school times (e.g., 12:00 - 12:40)
              const meta = getTeacherAndSubjectByCellValue(db, val);
              if (!meta) {
                bigHtml += `<td>${val}</td>`;
              } else {
                const subjName = (db.subjectsCatalog?.[meta.subjIdx]?.name || '').trim();
                const teacherFull = (db.teachers?.[meta.teacherIdx]?.name || '').trim();
                const teacherFirst = teacherFull.split(/\s+/)[0] || teacherFull;
                const timeRange = calcSlotTimeRange(db, day, s);
                bigHtml += `<td><div class="lesson-cell"><div class="lesson-subj">${subjName}</div><div class="lesson-teacher">${teacherFirst}</div><div class="lesson-time">${timeRange}</div></div></td>`;
              }
            }
          });
          bigHtml += `</tr>`;
        });
        bigHtml += `</tbody></table>`;
        bigHtml += `</section><div class="page-break"></div>`;
      });
    });
    // Auto-fit script to keep each section within a single page even if fonts are large
    bigHtml += `
      <script>(function(){
        function fit(){
          try{
            var avail = window.innerHeight || document.documentElement.clientHeight || 800;
            var main = document.querySelector('main.print-body');
            if (main){
              var cs = getComputedStyle(main);
              var pt = parseFloat(cs.paddingTop)||0; var pb = parseFloat(cs.paddingBottom)||0;
              avail = avail - pt - pb; // المساحة الفعلية داخل الـ main
            }
            var safety = 6; // هامش أمان صغير لتفادي كسر الصفحة الأولى
            document.querySelectorAll('.sect-page').forEach(function(pg){
              pg.style.transform = '';
              pg.style.width = '';
              var h = pg.scrollHeight;
              if (h > (avail - safety)){
                var scale = Math.max(0.7, Math.min(1, (avail - safety) / h));
                pg.style.transformOrigin = 'top center';
                pg.style.transform = 'scale(' + scale + ')';
                pg.style.width = (100/scale) + '%';
              }
            });
          }catch(e){}
        }
        if (document.readyState === 'complete') setTimeout(fit, 20);
        else window.addEventListener('load', function(){ setTimeout(fit, 20); });
      })();</script>`;
    UI.printDocument({
      contentHtml: bigHtml,
      docTitle: 'الجدول الأسبوعي للصفوف',
      school: Store.getDB().school,
      orientation: prn.orientations?.sections || 'portrait',
      margin: prn.margin || '12mm',
      fontScale: prn.fontScale || 1,
      fontFamily: prn.fontFamily || '',
      headerTypography: prn.headerTypography || {},
      footerLeftImageUrl: prn.footer?.leftImageUrl || '',
      footerRightHtml: prn.footer?.rightHtml || '',
      noFixedHeader: true
    });
  }

  function previewTeachers() {
    const db = Store.getDB();
    const grid = db.timetable?.grid || {};
    const allDays = db.timetable?.days || [];
    const days = allDays.filter(d => (db.times?.workingDays?.[d]) !== false);
    const slots = db.timetable?.slots || [];
    const teachers = db.teachers || [];
    const prn = Store.getDB().settings?.printing || {};
    const tStyle = prn.teachersStyle || {};
  const C_HEADER_BG = tStyle.headerBg || '#eef2ff';
  const C_HEADER_TX = tStyle.headerText || '#111827';
    const C_DAY_BG = tStyle.dayColBg || '#f9fafb';
    const C_DAY_ALT = tStyle.dayColAlt || '#f3f4f6';
    const C_BORDER = tStyle.border || '#d1d5db';
  const S_HEAD = tStyle.headerSize || 14; const B_HEAD = tStyle.headerBold ? 800 : 700;
  const S_CLS = tStyle.clsSize || 16; const COL_CLS = tStyle.clsColor || '#374151'; const B_CLS = tStyle.clsBold ? 700 : 500;
  const S_SUBJ = tStyle.subjSize || 16; const COL_SUBJ = tStyle.subjColor || '#111827'; const B_SUBJ = tStyle.subjBold === false ? 500 : 800;
  const S_TIME = tStyle.timeSize || 13; const COL_TIME = tStyle.timeColor || '#6b7280'; const B_TIME = tStyle.timeBold ? 700 : 500;
    const S_DAY = tStyle.dayFontSize || 14;
    const C_DAY = tStyle.dayFontColor || '#111827';

  // Normalize gender display for header
  const rawGender = (db.school?.gender || '').toString();
  const normG = rawGender.replace(/[\sـ]/g, '');
  let genderDisplay = '';
  if (/(ذكور|للذكور|بنين)/.test(normG)) genderDisplay = 'للبنين';
  else if (/(اناث|إناث|للاناث|للإناث|بنات)/.test(normG)) genderDisplay = 'للبنات';
  else if (/(مختلط|مختلطة|مشترك)/.test(normG)) genderDisplay = 'المختلطة';
  else genderDisplay = rawGender;

  // Build reverse index per teacher
    let html = '';
  // Helper: Arabic ordinals for lesson headers
  const ordinal = (n) => ({1:'الأول',2:'الثاني',3:'الثالث',4:'الرابع',5:'الخامس',6:'السادس',7:'السابع',8:'الثامن',9:'التاسع',10:'العاشر',11:'الحادي عشر',12:'الثاني عشر'})[n] || String(n);
  const lessonHeader = (i) => `الدرس ${ordinal(i+1)}`;

  teachers.forEach((t, ti) => {
      // جدول واحد لكل معلم + ترويسة صفحة خفيفة تحاكي رأس الطباعة لكن بدون تثبيت
      html += `<div class="sect-page" style="page-break-after:always">
        <div class="page-header">
          <div class="sch">
            <div class="n">${db.school?.name || 'المدرسة'}</div>
            <div class="g">${genderDisplay || ''}</div>
          </div>
          <div class="ttl">
            <div class="t">جدول حصص المعلمين</div>
            ${db.school?.year ? `<div class="y">للعام الدراسي ${db.school.year}</div>` : ''}
          </div>
          <div class="l">
            <div class="teacher-name">${t.name}</div>
          </div>
        </div>
        <table class="teach-table" style="margin-top:8px">
          <thead>
            <tr>
              <th>اليوم/الحصة</th>
              ${slots.map((_,i)=>`<th>${lessonHeader(i)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>`;
      days.forEach(day => {
        html += `<tr><td class="day">${day}</td>`;
        slots.forEach((slotName, s) => {
          // scan grid to find a cell with this teacher at day/slot
          let cell = '—';
          Object.entries(grid).some(([k, v]) => {
            if (!v) return false;
            const [cs, d, sl] = k.split('|');
            if (d !== day) return false;
            if (!(sl === slotName || sl === String(s+1))) return false;
            const meta = getTeacherAndSubjectByCellValue(db, v);
            if (meta && meta.teacherIdx === ti) {
              const [ci, si] = cs.split(':').map(n=>parseInt(n,10));
              const clsName = db.classes?.[ci]?.name || '—';
              const secName = (db.classes?.[ci]?.sections || [])[si]?.name || '';
              const subjName = db.subjectsCatalog?.[meta.subjIdx]?.name || '';
              const timeRange = calcSlotTimeRange(db, day, s);
              cell = `
                <div class="cls">${clsName}${secName ? ' — ' + secName : ''}</div>
                <div class="subj">${subjName}</div>
                <div class="time">${timeRange}</div>`;
              return true;
            }
            return false;
          });
          html += `<td>${cell}</td>`;
        });
        html += `</tr>`;
      });
      html += `</tbody></table></div>`;
    });
    // أنماط خاصة بجدول حصص المعلمين
    const css = `
      .page-header{ display:flex; align-items:center; justify-content:space-between; gap:12px; border-bottom:1px solid ${C_BORDER}; padding:8px 0 }
      .page-header .sch{ text-align:center }
      .page-header .sch .n{ font-weight:800 }
      .page-header .sch .g{ color:#6b7280; font-size:0.95em }
      .page-header .ttl{ text-align:center; flex:1 }
  .page-header .ttl .t{ font-weight:${B_HEAD}; font-size:${S_HEAD}px }
      .page-header .ttl .y{ color:#6b7280; font-size:0.95em }
      .page-header .l{ text-align:left }
      .page-header .teacher-name{ font-weight:800 }
      .teach-table{ width:100%; border-collapse:collapse }
      .teach-table th, .teach-table td{ border:1px solid ${C_BORDER}; padding:8px }
      .teach-table thead th{ background:${C_HEADER_BG}; color:${C_HEADER_TX}; font-weight:800 }
  .teach-table td .cls{ font-size:${S_CLS}px; color:${COL_CLS}; font-weight:${B_CLS} }
  .teach-table td .subj{ font-size:${S_SUBJ}px; color:${COL_SUBJ}; font-weight:${B_SUBJ} }
  .teach-table td .time{ font-size:${S_TIME}px; color:${COL_TIME}; font-weight:${B_TIME} }
      .teach-table td.day{ background:${C_DAY_BG}; font-weight:700; color:${C_DAY}; font-size:${S_DAY}px }
      .teach-table tr:nth-child(odd) td.day{ background:${C_DAY_ALT} }
    `;
    UI.printDocument({
      contentHtml: `<style>${css}</style>${html}`,
  docTitle: 'جدول حصص المعلمين',
  // لا نستخدم رأسًا ثابتًا هنا لتجنّب التداخل بين الصفحات
  school: { ...Store.getDB().school, logo: '' },
      orientation: prn.orientations?.teachers || 'portrait',
      margin: prn.margin || '12mm',
      fontScale: prn.fontScale || 1,
      fontFamily: prn.fontFamily || '',
      headerTypography: prn.headerTypography || {},
      footerLeftImageUrl: prn.footer?.leftImageUrl || '',
      footerRightHtml: prn.footer?.rightHtml || '',
      noFixedHeader: true
    });
  }

  const btnPreviewGlobal = qs('#btnPreviewGlobal'); if (btnPreviewGlobal) btnPreviewGlobal.addEventListener('click', previewGlobalTable);
  const btnPreviewBySections = qs('#btnPreviewBySections'); if (btnPreviewBySections) btnPreviewBySections.addEventListener('click', previewBySections);
  const btnPreviewTeachers = qs('#btnPreviewTeachers'); if (btnPreviewTeachers) btnPreviewTeachers.addEventListener('click', previewTeachers);

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
    // Apply theme: if auto, remove attribute to let prefers-color-scheme win
    const t = db.settings.theme || 'auto';
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    document.documentElement.dataset.density = db.settings.density;
    // printing
    const prn = db.settings.printing || {};
    const or = prn.orientations || {};
    const setVal = (id, v, d='') => { const el = qs(id); if (el) el.value = v ?? d; };
    setVal('#prnOrientationGlobal', or.global, 'landscape');
    setVal('#prnOrientationSections', or.sections, 'portrait');
    setVal('#prnOrientationTeachers', or.teachers, 'portrait');
    setVal('#prnMargin', prn.margin, '12mm');
  setVal('#prnMarginGlobal', prn.marginGlobal, '10mm 5mm');
    setVal('#prnFontScale', prn.fontScale, 1);
  setVal('#prnFontFamily', prn.fontFamily || '', '');
    setVal('#prnFooterImage', prn.footer?.leftImageUrl || '', '');
    setVal('#prnFooterRight', prn.footer?.rightHtml || '', '');
  // header typography
  const ht = prn.headerTypography || {};
  setVal('#htSchoolNameFamily', ht.schoolName?.family || '', '');
  setVal('#htSchoolNameSize', ht.schoolName?.size || 18, 18);
  setVal('#htGenderFamily', ht.gender?.family || '', '');
  setVal('#htGenderSize', ht.gender?.size || 12, 12);
  setVal('#htDocTitleFamily', ht.docTitle?.family || '', '');
  setVal('#htDocTitleSize', ht.docTitle?.size || 16, 16);
  setVal('#htYearFamily', ht.year?.family || '', '');
  setVal('#htYearSize', ht.year?.size || 12, 12);
  setVal('#htDateFamily', ht.date?.family || '', '');
  setVal('#htDateSize', ht.date?.size || 11, 11);
  setVal('#htLeftFamily', ht.left?.family || '', '');
  setVal('#htLeftSize', ht.left?.size || 16, 16);
  // sections preview style settings (defaults)
  const sec = prn.sectionsStyle || {};
  // global style
  const gst = prn.globalStyle || {};
  setVal('#prnGlobalDayHeaderBg', gst.dayHeaderBg || '#eef2ff', '#eef2ff');
  setVal('#prnGlobalDayHeaderText', gst.dayHeaderText || '#111827', '#111827');
  setVal('#prnGlobalSlotHeaderBg', gst.slotHeaderBg || '#f3f4f6', '#f3f4f6');
  setVal('#prnGlobalSlotHeaderText', gst.slotHeaderText || '#111827', '#111827');
  setVal('#prnGlobalBorder', gst.border || '#d1d5db', '#d1d5db');
  setVal('#prnGlobalClassColBg', gst.classColBg || '#f9fafb', '#f9fafb');
  setVal('#prnGlobalClassColText', gst.classColText || '#ef4444', '#ef4444');
  setVal('#prnGlobalSubjSize', gst.subjSize || 15, 15);
  setVal('#prnGlobalTeacherSize', gst.teacherSize || 13, 13);
  setVal('#prnGlobalTimeSize', gst.timeSize || 12, 12);
  setVal('#prnSecHeaderBg', sec.headerBg || '#eef2ff', '#eef2ff');
  setVal('#prnSecHeaderText', sec.headerText || '#111827', '#111827');
  setVal('#prnSecDayColBg', sec.dayColBg || '#f9fafb', '#f9fafb');
  setVal('#prnSecDayColAlt', sec.dayColAlt || '#f3f4f6', '#f3f4f6');
  setVal('#prnSecBorder', sec.border || '#d1d5db', '#d1d5db');
  setVal('#prnSecSubjSize', sec.subjSize || 16, 16);
  setVal('#prnSecTeacherSize', sec.teacherSize || 14, 14);
  setVal('#prnSecTimeSize', sec.timeSize || 13, 13);
  setVal('#prnSecDayFontColor', sec.dayFontColor || '#111827', '#111827');
  setVal('#prnSecDayFontSize', sec.dayFontSize || 14, 14);
  // teachers style
  const ts = prn.teachersStyle || {};
  setVal('#prnTeachHeaderBg', ts.headerBg || '#eef2ff', '#eef2ff');
  setVal('#prnTeachHeaderText', ts.headerText || '#111827', '#111827');
  setVal('#prnTeachDayColBg', ts.dayColBg || '#f9fafb', '#f9fafb');
  setVal('#prnTeachDayColAlt', ts.dayColAlt || '#f3f4f6', '#f3f4f6');
  setVal('#prnTeachBorder', ts.border || '#d1d5db', '#d1d5db');
  setVal('#prnTeachHeaderSize', ts.headerSize || 14, 14);
  const setChk = (id, v) => { const el = qs(id); if (el) el.checked = !!v; };
  setChk('#prnTeachHeaderBold', !!ts.headerBold);
  setVal('#prnTeachClsSize', ts.clsSize || 16, 16);
  setVal('#prnTeachClsColor', ts.clsColor || '#374151', '#374151');
  setChk('#prnTeachClsBold', !!ts.clsBold);
  setVal('#prnTeachSubjSize', ts.subjSize || 16, 16);
  setVal('#prnTeachSubjColor', ts.subjColor || '#111827', '#111827');
  setChk('#prnTeachSubjBold', ts.subjBold !== false); // default true
  setVal('#prnTeachTimeSize', ts.timeSize || 13, 13);
  setVal('#prnTeachTimeColor', ts.timeColor || '#6b7280', '#6b7280');
  setChk('#prnTeachTimeBold', !!ts.timeBold);
  setVal('#prnTeachDayFontColor', ts.dayFontColor || '#111827', '#111827');
  setVal('#prnTeachDayFontSize', ts.dayFontSize || 14, 14);
  // render previews after values are populated
  renderHeaderPreview();
  renderTeacherPrintPreview();
  renderGlobalPrintPreview();
  }
  // Live preview on change (without saving)
  const themeSel = qs('#themeSelect'); if (themeSel) themeSel.addEventListener('change', () => {
    const v = themeSel.value;
    if (v === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', v);
  });
  const densitySel = qs('#densitySelect'); if (densitySel) densitySel.addEventListener('change', () => {
    document.documentElement.dataset.density = densitySel.value;
  });

  // Live header preview for print settings
  function renderHeaderPreview() {
    const host = qs('#printHeaderPreviewHost'); if (!host) return;
    const db = Store.getDB();
    const getVal = (sel) => (qs(sel)?.value || '').trim();
    const num = (sel, d) => { const v = parseInt(qs(sel)?.value, 10); return isNaN(v) ? d : v; };
    const ht = {
      schoolName: { family: getVal('#htSchoolNameFamily'), size: num('#htSchoolNameSize', 18) },
      gender: { family: getVal('#htGenderFamily'), size: num('#htGenderSize', 12) },
      docTitle: { family: getVal('#htDocTitleFamily'), size: num('#htDocTitleSize', 16) },
      year: { family: getVal('#htYearFamily'), size: num('#htYearSize', 12) },
      date: { family: getVal('#htDateFamily'), size: num('#htDateSize', 11) },
      left: { family: getVal('#htLeftFamily'), size: num('#htLeftSize', 16) }
    };
    const genderRaw = (db.school?.gender || '').toString();
    const norm = genderRaw.replace(/[\sـ]/g, '');
    let genderDisplay = '';
    if (/(ذكور|للذكور|بنين)/.test(norm)) genderDisplay = 'للبنين';
    else if (/(اناث|إناث|للاناث|للإناث|بنات)/.test(norm)) genderDisplay = 'للبنات';
  else if (/(مختلط|مختلطة|مشترك)/.test(norm)) genderDisplay = 'المختلطة';
    else genderDisplay = genderRaw;
    const scale = parseFloat(qs('#prnFontScale')?.value) || 1;
    const logoHtml = db.school?.logo ? `<img style="height:${52*scale}px" src="${db.school.logo}">` : '';
    host.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px; border-bottom:1px solid #ddd; padding:10px 0">
        <div style="text-align:center">
          <div style="font-weight:800; ${ht.schoolName.family ? `font-family:${ht.schoolName.family};` : ''} font-size:${ht.schoolName.size*scale}px">${db.school?.name || 'المدرسة'}</div>
          <div class="muted" style="${ht.gender.family ? `font-family:${ht.gender.family};` : ''} font-size:${ht.gender.size*scale}px">${genderDisplay || ''}</div>
        </div>
        <div style="text-align:center;flex:1">
          <div style="font-weight:800; ${ht.docTitle.family ? `font-family:${ht.docTitle.family};` : ''} font-size:${ht.docTitle.size*scale}px">الجدول الأسبوعي للصفوف</div>
          ${db.school?.year ? `<div class="muted" style="${ht.year.family ? `font-family:${ht.year.family};` : ''} font-size:${ht.year.size*scale}px">للعام الدراسي ${db.school.year}</div>` : ''}
        </div>
        <div style="text-align:left;display:flex;align-items:center;gap:8px">
          <div style="font-weight:800; ${ht.left.family ? `font-family:${ht.left.family};` : ''} font-size:${ht.left.size*scale}px">الأول — أ</div>
          <div>${logoHtml}</div>
        </div>
      </div>`;
  }
  // Attach input listeners
  ['#htSchoolNameFamily','#htSchoolNameSize','#htGenderFamily','#htGenderSize','#htDocTitleFamily','#htDocTitleSize','#htYearFamily','#htYearSize','#htDateFamily','#htDateSize','#htLeftFamily','#htLeftSize','#prnFontScale']
    .forEach(sel => { const el = qs(sel); if (el) el.addEventListener('input', renderHeaderPreview); });

  // Live teacher table preview
  function renderTeacherPrintPreview() {
    const host = qs('#teacherPrintPreviewHost'); if (!host) return;
    const get = (id, d) => { const v = (qs(id)?.value || '').trim(); return v || d; };
    const num = (id, d) => { const v = parseInt(qs(id)?.value, 10); return isNaN(v) ? d : v; };
    const st = {
      headerBg: get('#prnTeachHeaderBg', '#eef2ff'),
      headerText: get('#prnTeachHeaderText', '#111827'),
      dayColBg: get('#prnTeachDayColBg', '#f9fafb'),
      dayColAlt: get('#prnTeachDayColAlt', '#f3f4f6'),
      border: get('#prnTeachBorder', '#d1d5db'),
      headerSize: num('#prnTeachHeaderSize', 14), headerBold: !!qs('#prnTeachHeaderBold')?.checked,
      clsSize: num('#prnTeachClsSize', 16),
      clsColor: get('#prnTeachClsColor', '#374151'), clsBold: !!qs('#prnTeachClsBold')?.checked,
      subjSize: num('#prnTeachSubjSize', 16),
      subjColor: get('#prnTeachSubjColor', '#111827'), subjBold: !!qs('#prnTeachSubjBold')?.checked,
      timeSize: num('#prnTeachTimeSize', 13),
      timeColor: get('#prnTeachTimeColor', '#6b7280'), timeBold: !!qs('#prnTeachTimeBold')?.checked,
      dayFontColor: get('#prnTeachDayFontColor', '#111827'),
      dayFontSize: num('#prnTeachDayFontSize', 14)
    };
    const css = `
      .tprev{ width:100%; border-collapse:collapse }
      .tprev th, .tprev td{ border:1px solid ${st.border}; padding:6px }
      .tprev thead th{ background:${st.headerBg}; color:${st.headerText}; font-weight:${st.headerBold?'800':'600'}; font-size:${st.headerSize}px }
      .tprev .day{ background:${st.dayColBg}; color:${st.dayFontColor}; font-weight:700; font-size:${st.dayFontSize}px }
      .tprev tr:nth-child(odd) .day{ background:${st.dayColAlt} }
      .tprev .cls{ font-size:${st.clsSize}px; color:${st.clsColor}; font-weight:${st.clsBold?'700':'500'} }
      .tprev .subj{ font-size:${st.subjSize}px; color:${st.subjColor}; font-weight:${st.subjBold?'800':'500'} }
      .tprev .time{ font-size:${st.timeSize}px; color:${st.timeColor}; font-weight:${st.timeBold?'700':'500'} }
    `;
    const sample = `
      <style>${css}</style>
      <table class="tprev">
        <thead><tr><th>اليوم/الحصة</th><th>الدرس الأول</th><th>الدرس الثاني</th><th>الدرس الثالث</th></tr></thead>
        <tbody>
          <tr><td class="day">الأحد</td><td><div class="cls">أ-1</div><div class="subj">رياضيات</div><div class="time">08:00 - 08:40</div></td><td>—</td><td><div class="cls">ج-2</div><div class="subj">عربي</div><div class="time">09:30 - 10:10</div></td></tr>
          <tr><td class="day">الاثنين</td><td>—</td><td><div class="cls">ب-1</div><div class="subj">علوم</div><div class="time">08:50 - 09:30</div></td><td>—</td></tr>
        </tbody>
      </table>`;
    host.innerHTML = sample;
  }
  // Attach listeners for teacher preview
  ['#prnTeachHeaderBg','#prnTeachHeaderText','#prnTeachDayColBg','#prnTeachDayColAlt','#prnTeachBorder','#prnTeachHeaderSize','#prnTeachHeaderBold','#prnTeachClsSize','#prnTeachClsColor','#prnTeachClsBold','#prnTeachSubjSize','#prnTeachSubjColor','#prnTeachSubjBold','#prnTeachTimeSize','#prnTeachTimeColor','#prnTeachTimeBold','#prnTeachDayFontColor','#prnTeachDayFontSize']
    .forEach(sel => { const el = qs(sel); if (el) el.addEventListener('input', renderTeacherPrintPreview); });

  // Live global table preview (compact)
  function renderGlobalPrintPreview() {
    const host = qs('#globalPrintPreviewHost'); if (!host) return;
    const get = (id, d) => (qs(id)?.value || '').trim() || d;
    const num = (id, d) => { const v = parseInt(qs(id)?.value, 10); return isNaN(v) ? d : v; };
    const st = {
      dayHeaderBg: get('#prnGlobalDayHeaderBg', '#eef2ff'), dayHeaderText: get('#prnGlobalDayHeaderText', '#111827'),
      slotHeaderBg: get('#prnGlobalSlotHeaderBg', '#f3f4f6'), slotHeaderText: get('#prnGlobalSlotHeaderText', '#111827'),
      border: get('#prnGlobalBorder', '#d1d5db'),
      classColBg: get('#prnGlobalClassColBg', '#f9fafb'), classColText: get('#prnGlobalClassColText', '#ef4444'),
      subjSize: num('#prnGlobalSubjSize', 15), teacherSize: num('#prnGlobalTeacherSize', 13), timeSize: num('#prnGlobalTimeSize', 12)
    };
    const css = `
      .gprev{ width:100%; border-collapse:separate; border-spacing:0 }
      .gprev th,.gprev td{ border:1px solid ${st.border}; padding:6px }
      .gprev .row-days th{ background:${st.dayHeaderBg}; color:${st.dayHeaderText}; text-align:center; font-weight:800; font-size:13px }
      .gprev .row-slots th{ background:${st.slotHeaderBg}; color:${st.slotHeaderText}; text-align:center; font-weight:700; font-size:12px }
      .gprev .class-col{ background:${st.classColBg}; color:${st.classColText}; font-weight:800; white-space:nowrap }
      .gprev .cell-subj{ font-weight:800; font-size:${st.subjSize}px; line-height:1.1 }
      .gprev .cell-teacher{ color:#374151; font-size:${st.teacherSize}px; line-height:1.05 }
    `;
    const sample = `
      <style>${css}</style>
      <table class="gprev">
        <thead>
          <tr class="row-days"><th rowspan="2" class="class-col">الصف/الشعبة</th><th colspan="3">الأحد</th><th colspan="3">الاثنين</th></tr>
          <tr class="row-slots"><th>1</th><th>2</th><th>3</th><th>1</th><th>2</th><th>3</th></tr>
        </thead>
        <tbody>
          <tr><td class="class-col">الأول — أ</td><td><div class="cell-subj">رياضيات</div><div class="cell-teacher">أحمد</div></td><td>—</td><td><div class="cell-subj">علوم</div><div class="cell-teacher">خالد</div></td><td>—</td><td><div class="cell-subj">عربي</div><div class="cell-teacher">سارة</div></td><td>—</td></tr>
        </tbody>
      </table>`;
    host.innerHTML = sample;
  }
  ['#prnGlobalDayHeaderBg','#prnGlobalDayHeaderText','#prnGlobalSlotHeaderBg','#prnGlobalSlotHeaderText','#prnGlobalBorder','#prnGlobalClassColBg','#prnGlobalClassColText','#prnGlobalSubjSize','#prnGlobalTeacherSize','#prnGlobalTimeSize']
    .forEach(sel => { const el = qs(sel); if (el) el.addEventListener('input', renderGlobalPrintPreview); });

  qs('#btnSaveSettings').addEventListener('click', () => {
    const db = Store.getDB();
    db.settings.theme = qs('#themeSelect').value;
    db.settings.density = qs('#densitySelect').value;
    db.settings.printing = db.settings.printing || {};
    const prn = db.settings.printing;
    prn.orientations = {
      global: qs('#prnOrientationGlobal')?.value || 'landscape',
      sections: qs('#prnOrientationSections')?.value || 'portrait',
      teachers: qs('#prnOrientationTeachers')?.value || 'portrait'
    };
    prn.margin = qs('#prnMargin')?.value || '12mm';
  prn.marginGlobal = qs('#prnMarginGlobal')?.value || '10mm 5mm';
    const fs = parseFloat(qs('#prnFontScale')?.value); prn.fontScale = isNaN(fs) ? 1 : Math.max(0.8, Math.min(1.6, fs));
  prn.fontFamily = (qs('#prnFontFamily')?.value || '').trim();
    prn.footer = prn.footer || {};
    prn.footer.leftImageUrl = qs('#prnFooterImage')?.value || '';
    prn.footer.rightHtml = qs('#prnFooterRight')?.value || '';
    // header typography save
    prn.headerTypography = prn.headerTypography || {};
    const num = (id, d) => { const v = parseInt(qs(id)?.value, 10); return isNaN(v) ? d : v; };
    prn.headerTypography.schoolName = {
      family: (qs('#htSchoolNameFamily')?.value || '').trim(),
      size: num('#htSchoolNameSize', 18)
    };
    prn.headerTypography.gender = {
      family: (qs('#htGenderFamily')?.value || '').trim(),
      size: num('#htGenderSize', 12)
    };
    prn.headerTypography.docTitle = {
      family: (qs('#htDocTitleFamily')?.value || '').trim(),
      size: num('#htDocTitleSize', 16)
    };
    prn.headerTypography.year = {
      family: (qs('#htYearFamily')?.value || '').trim(),
      size: num('#htYearSize', 12)
    };
    prn.headerTypography.date = {
      family: (qs('#htDateFamily')?.value || '').trim(),
      size: num('#htDateSize', 11)
    };
    prn.headerTypography.left = {
      family: (qs('#htLeftFamily')?.value || '').trim(),
      size: num('#htLeftSize', 16)
    };
    // sections preview style save
    prn.sectionsStyle = prn.sectionsStyle || {};
    const getColor = (id, d) => { const v = (qs(id)?.value || '').trim(); return v || d; };
    prn.sectionsStyle.headerBg = getColor('#prnSecHeaderBg', '#eef2ff');
    prn.sectionsStyle.headerText = getColor('#prnSecHeaderText', '#111827');
    prn.sectionsStyle.dayColBg = getColor('#prnSecDayColBg', '#f9fafb');
    prn.sectionsStyle.dayColAlt = getColor('#prnSecDayColAlt', '#f3f4f6');
    prn.sectionsStyle.border = getColor('#prnSecBorder', '#d1d5db');
    prn.sectionsStyle.subjSize = num('#prnSecSubjSize', 16);
    prn.sectionsStyle.teacherSize = num('#prnSecTeacherSize', 14);
    prn.sectionsStyle.timeSize = num('#prnSecTimeSize', 13);
  prn.sectionsStyle.dayFontColor = getColor('#prnSecDayFontColor', '#111827');
  prn.sectionsStyle.dayFontSize = num('#prnSecDayFontSize', 14);
  // global style save
  prn.globalStyle = prn.globalStyle || {};
  prn.globalStyle.dayHeaderBg = getColor('#prnGlobalDayHeaderBg', '#eef2ff');
  prn.globalStyle.dayHeaderText = getColor('#prnGlobalDayHeaderText', '#111827');
  prn.globalStyle.slotHeaderBg = getColor('#prnGlobalSlotHeaderBg', '#f3f4f6');
  prn.globalStyle.slotHeaderText = getColor('#prnGlobalSlotHeaderText', '#111827');
  prn.globalStyle.border = getColor('#prnGlobalBorder', '#d1d5db');
  prn.globalStyle.classColBg = getColor('#prnGlobalClassColBg', '#f9fafb');
  prn.globalStyle.classColText = getColor('#prnGlobalClassColText', '#ef4444');
  prn.globalStyle.subjSize = num('#prnGlobalSubjSize', 15);
  prn.globalStyle.teacherSize = num('#prnGlobalTeacherSize', 13);
  prn.globalStyle.timeSize = num('#prnGlobalTimeSize', 12);
    // teachers style save
    prn.teachersStyle = prn.teachersStyle || {};
  prn.teachersStyle.headerBg = getColor('#prnTeachHeaderBg', '#eef2ff');
  prn.teachersStyle.headerText = getColor('#prnTeachHeaderText', '#111827');
  prn.teachersStyle.dayColBg = getColor('#prnTeachDayColBg', '#f9fafb');
  prn.teachersStyle.dayColAlt = getColor('#prnTeachDayColAlt', '#f3f4f6');
  prn.teachersStyle.border = getColor('#prnTeachBorder', '#d1d5db');
  prn.teachersStyle.headerSize = num('#prnTeachHeaderSize', 14);
  prn.teachersStyle.headerBold = !!qs('#prnTeachHeaderBold')?.checked;
  prn.teachersStyle.clsSize = num('#prnTeachClsSize', 16);
  prn.teachersStyle.clsColor = getColor('#prnTeachClsColor', '#374151');
  prn.teachersStyle.clsBold = !!qs('#prnTeachClsBold')?.checked;
  prn.teachersStyle.subjSize = num('#prnTeachSubjSize', 16);
  prn.teachersStyle.subjColor = getColor('#prnTeachSubjColor', '#111827');
  prn.teachersStyle.subjBold = !!qs('#prnTeachSubjBold')?.checked;
  prn.teachersStyle.timeSize = num('#prnTeachTimeSize', 13);
  prn.teachersStyle.timeColor = getColor('#prnTeachTimeColor', '#6b7280');
  prn.teachersStyle.timeBold = !!qs('#prnTeachTimeBold')?.checked;
    prn.teachersStyle.dayFontColor = getColor('#prnTeachDayFontColor', '#111827');
    prn.teachersStyle.dayFontSize = num('#prnTeachDayFontSize', 14);
    Store.setDB(db);
    loadSettings();
    // ensure previews are up-to-date immediately
    renderHeaderPreview();
    renderTeacherPrintPreview();
    renderGlobalPrintPreview();
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
  // تحديث الشريط الجانبي للمعلمين في هذا الوقت أيضًا
  renderTeacherSidebar();
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
    // ترحيل محتمل لمفاتيح الشبكة القديمة (أرقام الحصص -> أسماء الحصص)
    try {
      const db2 = Store.getDB();
      const grid = db2.timetable?.grid || {};
      const keys = Object.keys(grid);
      // update preview after populating values
      setTimeout(renderHeaderPreview, 0);
      if (keys.length) {
        const sample = keys.slice(0, 20);
        const numericLike = sample.filter(k => {
          const parts = String(k).split('|');
          const last = parts[2] || '';
          return /^\d+$/.test(last);
        }).length;
        if (numericLike > sample.length / 2) {
          const days = db2.timetable.days || [];
          const slots = db2.timetable.slots || [];
          const newGrid = {};
          keys.forEach(k => {
            const [cs, day, slotTok] = String(k).split('|');
            if (/^\d+$/.test(slotTok)) {
              const idx = Math.max(1, Math.min(slots.length, parseInt(slotTok, 10))) - 1;
              const mapped = slots[idx] || slotTok;
              const nk = `${cs}|${day}|${mapped}`;
              // حافظ على أول قيمة، لا ضرر من الكتابة فوق نفس المفتاح بنفس القيمة
              newGrid[nk] = grid[k];
            } else {
              newGrid[k] = grid[k];
            }
          });
          db2.timetable.grid = newGrid;
          Store.setDB(db2);
        }
      }
    } catch {}
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

  // Hook fit/zoom controls if present
  const fitToggle = qs('#ttFitToggle'); if (fitToggle) fitToggle.addEventListener('change', () => renderTimetable());
  const zoomRange = qs('#ttZoomRange'); if (zoomRange) zoomRange.addEventListener('input', () => renderTimetable());
})();
