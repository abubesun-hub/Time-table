// إدارة التخزين المحلي + النسخ الاحتياطي الدوري + استيراد/تصدير
(function (global) {
  'use strict';

  const LS_KEY = 'school-timetable:data:v1';
  const LS_LICENSE = 'school-timetable:license';
  const LS_BACKUPS = 'school-timetable:backups';
  const BACKUP_INTERVAL_MS = 60 * 60 * 1000; // كل ساعة

  function nowIso() { return new Date().toISOString(); }

  // قاعدة البيانات المحلية (هيكلية)
  const defaultDB = () => ({
    meta: { createdAt: nowIso(), updatedAt: nowIso(), version: 1 },
    auth: { users: [] /* [{user, passHash}] */, currentUser: null },
  school: { name: '', address: '', phone: '', email: '', logo: '', year: '', shiftType: 'صباحي', gender: 'مختلط', principalId: undefined },
  // subjectsCatalog: list of available subjects to use in allocations
  subjectsCatalog: [],
  // allocations: { [subjectId]: { [classIndex]: weeklyCount } }
  allocations: {},
  // assignments: { [classIndex:sectionIndex]: { [subjectIndex]: { [teacherIndex]: periods } } }
  assignments: {},
  // legacy subjects (deprecated, may be empty). Kept for backward compatibility/migration if needed.
  subjects: [],
  classes: [], // each class: { name, students, sections?: [{ name, students, teacherId }] }
    teachers: [],
    timetable: { days: ['السبت','الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس'], slots: ['الأولى','الثانية','الثالثة','الرابعة','الخامسة','السادسة'], grid: {} },
    // new: working days and time settings
    times: {
      workingDays: { 'السبت': true, 'الأحد': true, 'الاثنين': true, 'الثلاثاء': true, 'الأربعاء': true, 'الخميس': false },
      global: { lessonMinutes: 40, breakMinutes: 10, defaultPeriods: 6 },
      // breaks: array of minutes after each lesson index (1-based logical), e.g., [5,10,5,0,...]
      breaks: [5, 10, 5, 10, 5],
      perDay: {
        'السبت':   { mode: 'صباحي', start: '08:00', periods: 6 },
        'الأحد':   { mode: 'صباحي', start: '08:00', periods: 6 },
        'الاثنين': { mode: 'صباحي', start: '08:00', periods: 6 },
        'الثلاثاء':{ mode: 'صباحي', start: '08:00', periods: 6 },
        'الأربعاء':{ mode: 'صباحي', start: '08:00', periods: 6 },
        'الخميس':  { mode: 'صباحي', start: '08:00', periods: 6 },
      }
    },
    invoices: [],
    settings: {
      theme: 'auto',
      density: 'comfortable',
      printing: {
        orientations: { global: 'landscape', sections: 'portrait', teachers: 'portrait' },
        margin: '12mm',
  fontScale: 1,
  fontFamily: '',
        headerTypography: {
          schoolName: { size: 18, family: '' },
          gender: { size: 12, family: '' },
          docTitle: { size: 16, family: '' },
          year: { size: 12, family: '' },
          date: { size: 11, family: '' },
          left: { size: 16, family: '' }
        },
        // تنسيق الطباعة لعرض "حسب الشعب"
        footer: {
          leftImageUrl: '',
          rightHtml: '<div style="text-align:left">Ahmed Hussein Ali<br>📞 790-588-0479<br>✉️ ltechanbar@gmail.com<br>🌐 www.facebook.com/lthtec</div>'
        },
        // تنسيقات إضافية للطباعة
        sectionsStyle: {
          headerBg: '#eef2ff', headerText: '#111827', dayColBg: '#f9fafb', dayColAlt: '#f3f4f6', border: '#d1d5db',
          subjSize: 16, teacherSize: 14, timeSize: 13, dayFontColor: '#111827', dayFontSize: 14
        },
        teachersStyle: {
          headerBg: '#eef2ff', headerText: '#111827', dayColBg: '#f9fafb', dayColAlt: '#f3f4f6', border: '#d1d5db',
          // header size for lesson titles (e.g., الدرس الأول)
          headerSize: 14, headerBold: true,
          // class/section line
          clsSize: 16, clsColor: '#374151', clsBold: false,
          // subject line
          subjSize: 16, subjColor: '#111827', subjBold: true,
          // time line
          timeSize: 13, timeColor: '#6b7280', timeBold: false,
          // day column
          dayFontColor: '#111827', dayFontSize: 14
        }
      }
    },
  });

  function getDB() {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultDB();
    try { return JSON.parse(raw); } catch { return defaultDB(); }
  }

  function setDB(db) {
    db.meta.updatedAt = nowIso();
    localStorage.setItem(LS_KEY, JSON.stringify(db));
  }

  // License
  function getLicenseBlob() { return localStorage.getItem(LS_LICENSE) || null; }
  function setLicenseBlob(blob) { localStorage.setItem(LS_LICENSE, blob); }
  function removeLicense() { localStorage.removeItem(LS_LICENSE); }

  // Device ID (stable per browser profile)
  function getDeviceId() {
    let id = localStorage.getItem('school-timetable:device-id');
    if (!id) {
      id = 'DEV-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
      localStorage.setItem('school-timetable:device-id', id);
    }
    return id;
  }

  // Backups
  function listBackups() {
    const raw = localStorage.getItem(LS_BACKUPS);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }
  function saveBackups(list) { localStorage.setItem(LS_BACKUPS, JSON.stringify(list)); }

  function createBackup() {
    const db = getDB();
    const name = 'backup-' + new Date().toISOString().replace(/[:.]/g, '-');
    const entry = { name, date: nowIso(), size: JSON.stringify(db).length };
    const backups = listBackups();
    // Keep last 50 backups
    backups.unshift({ ...entry, data: db });
    while (backups.length > 50) backups.pop();
    saveBackups(backups);
    return entry;
  }

  function restoreBackup(name) {
    const backups = listBackups();
    const found = backups.find(b => b.name === name);
    if (!found) throw new Error('backup-not-found');
    setDB(found.data);
    return found;
  }

  function scheduleAutoBackup() {
    // Save timestamp to avoid multiple timers after reload
    const last = parseInt(localStorage.getItem('school-timetable:last-backup-ts') || '0', 10);
    const now = Date.now();
    if (now - last > BACKUP_INTERVAL_MS) {
      createBackup();
      localStorage.setItem('school-timetable:last-backup-ts', String(now));
    }
    // Plan next check
    setTimeout(scheduleAutoBackup, 5 * 60 * 1000); // تحقق كل 5 دقائق
  }

  // Import/Export
  function exportData() {
    const db = getDB();
    const json = JSON.stringify(db, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'school-timetable-export.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importData(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    // Basic validation
    if (!data || !data.meta || !data.settings) throw new Error('bad-file');
    setDB(data);
    return data;
  }

  global.Store = {
    getDB, setDB,
    getLicenseBlob, setLicenseBlob, removeLicense,
    getDeviceId,
    listBackups, createBackup, restoreBackup, scheduleAutoBackup,
    exportData, importData,
  };
})(window);
