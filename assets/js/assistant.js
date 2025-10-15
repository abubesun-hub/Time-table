// Assistant (Guide) widget: rule-based helper with voice and quick actions
(function () {
  'use strict';
  if (!window.UI || !window.Store) return; // requires UI and Store
  const { qs, qsa, routeTo, showToast } = UI;

  // Compute setup step (duplicate of app.js logic to avoid coupling)
  function computeSetupStepLocal(db) {
    if (!db.school?.name) return 1;
    if ((db.teachers || []).length < 1) return 2;
    if ((db.classes || []).length < 1) return 3;
    if ((db.subjectsCatalog || []).length < 1) return 4;
    const hasAlloc = Object.values(db.allocations || {}).some(m => Object.keys(m || {}).length > 0);
    if (!hasAlloc) return 5;
    const hasAssign = Object.values(db.assignments || {}).some(subjMap => Object.keys(subjMap || {}).length > 0);
    if (!hasAssign) return 6;
    return 7;
  }
  function stepToRoute(step) {
    return ({1:'#/school',2:'#/teachers',3:'#/classes',4:'#/catalog',5:'#/subjects',6:'#/timetable'}[step] || '#/dashboard');
  }
  function stepToText(step) {
    const isPrim = (window.UI && UI.Terms && UI.Terms.isPrimary());
    const tSingAcc = (window.UI && UI.Terms) ? UI.Terms.get('t-s-acc') : 'معلماً';
    const tPlGen = (window.UI && UI.Terms) ? UI.Terms.get('t-pl-gen-def') : 'المعلمين';
    return ({
      1: 'ابدأ بمعلومات المدرسة: الاسم، العنوان، الأوقات…',
      2: `أضف ${tSingAcc} واحدًا على الأقل.`,
      3: 'أضف صفًا/شعبًا.',
      4: 'أضف المواد المعتمدة.',
      5: 'وزّع الحصص على الصفوف (تخصيص).',
      6: `عيّن ${tPlGen} للمواد لكل صف/شعبة.`,
      7: 'اكتمل الإعداد! يمكنك العمل على الجدول الأسبوعي والطباعة.'
    })[step] || '—';
  }

  // TTS helpers
  const canSpeak = () => typeof window.speechSynthesis !== 'undefined';
  function speak(text) {
    try {
      if (!canSpeak() || !state.voiceOn) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ar-EG';
      window.speechSynthesis.speak(u);
    } catch {}
  }

  // STT (speech to text) via Web Speech API (experimental)
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  function initRecognizer() {
    if (!SpeechRec) return null;
    const r = new SpeechRec();
    try { r.lang = 'ar-EG'; } catch {}
    r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (ev) => {
      const text = (ev.results?.[0]?.[0]?.transcript || '').trim();
      if (text) { setInput(text); sendMessage(); }
    };
    r.onerror = () => { setMicActive(false); };
    r.onend = () => { setMicActive(false); };
    return r;
  }

  const state = { voiceOn: true, micActive: false };
  const ONBOARD_KEY = 'school-timetable:assistant-onboarded:v1';

  // DOM
  function el(id){ return document.getElementById(id); }
  function ensureDOM() {
    if (el('assistant-fab')) return true;
    // create FAB and panel dynamically if not present (fallback)
    const fab = document.createElement('div'); fab.id = 'assistant-fab'; fab.className = 'assistant-fab'; fab.innerHTML = '<i class="bi bi-robot"></i>';
    const panel = document.createElement('div'); panel.id = 'assistant-panel'; panel.className = 'assistant-panel hidden';
    panel.innerHTML = `
      <div class="assistant-header">
        <div class="assistant-title"><i class="bi bi-robot"></i><span>مرشد الجدول</span></div>
        <div class="assistant-controls">
          <button id="assistant-voice" class="assistant-btn" title="تشغيل/إيقاف الصوت"><i class="bi bi-volume-up"></i></button>
          <button id="assistant-mic" class="assistant-btn" title="تحدث"><i class="bi bi-mic"></i></button>
          <button id="assistant-close" class="assistant-btn" title="إغلاق"><i class="bi bi-x-lg"></i></button>
        </div>
      </div>
      <div id="assistant-suggest" class="assistant-suggest"></div>
      <div id="assistant-body" class="assistant-body" aria-live="polite"></div>
      <div class="assistant-input">
        <input id="assistant-input" class="input" placeholder="اسألني: ما الخطوة التالية؟ كيف أطبع؟ أين أضيف المعلمين؟" />
        <button id="assistant-send" class="btn"><i class="bi bi-send"></i></button>
      </div>`;
    document.body.appendChild(panel);
    document.body.appendChild(fab);
    return true;
  }

  function togglePanel(show) {
    const p = el('assistant-panel'); if (!p) return;
    const want = typeof show === 'boolean' ? show : p.classList.contains('hidden');
    p.classList.toggle('hidden', !want);
    if (want) setTimeout(scrollToEnd, 0);
  }
  function openPanel(){ togglePanel(true); }
  function scrollToEnd(){ const b = el('assistant-body'); if (b) b.scrollTop = b.scrollHeight; }
  function addMsg(text, who='bot') {
    const b = el('assistant-body'); if (!b) return;
    const wrap = document.createElement('div'); wrap.className = 'assistant-msg ' + who;
    const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.textContent = text;
    wrap.appendChild(bubble); b.appendChild(wrap); scrollToEnd(); if (who==='bot') speak(text);
  }
  function clearSuggest(){ const s = el('assistant-suggest'); if (s) s.innerHTML=''; }
  function setSuggest(chips){ const s = el('assistant-suggest'); if (!s) return; s.innerHTML=''; (chips||[]).forEach(ch => { const c=document.createElement('div'); c.className='assistant-chip'; c.innerHTML = (ch.icon?`<i class="bi ${ch.icon}"></i> `:'') + ch.text; c.onclick = ch.onClick; s.appendChild(c); }); }
  function setInput(t){ const i = el('assistant-input'); if (i) i.value = t; }

  function updateSuggestions() {
    const db = Store.getDB();
    const step = computeSetupStepLocal(db);
    const done = step >= 7;
    const nextText = stepToText(step);
    const chips = [];
    if (!done) {
      chips.push({ text: 'الانتقال للخطوة التالية', icon: 'bi-arrow-left-circle', onClick: () => { UI.routeTo(stepToRoute(step)); togglePanel(false); } });
    } else {
      chips.push({ text: 'الجدول الأسبوعي', icon: 'bi-calendar-week', onClick: () => { UI.routeTo('#/timetable'); togglePanel(false); } });
      chips.push({ text: 'معاينة قبل الطباعة', icon: 'bi-eye', onClick: () => { UI.routeTo('#/timetable'); setTimeout(()=>{ const btn = UI.qs('#btnPreviewTT'); if (btn) btn.click(); }, 200); togglePanel(false); } });
    }
    chips.push({ text: (window.UI && UI.Terms ? UI.Terms.full('teachers-card-title') : 'المعلمون'), icon: 'bi-people', onClick: () => { UI.routeTo('#/teachers'); togglePanel(false); } });
    chips.push({ text: 'الصفوف', icon: 'bi-grid-3x3-gap', onClick: () => { UI.routeTo('#/classes'); togglePanel(false); } });
    chips.push({ text: 'المواد', icon: 'bi-book', onClick: () => { UI.routeTo('#/catalog'); togglePanel(false); } });
    chips.push({ text: 'تخصيص', icon: 'bi-sliders', onClick: () => { UI.routeTo('#/subjects'); togglePanel(false); } });
    setSuggest(chips);
    // Also show a status banner message once (not in bubbles to avoid spam)
    const body = el('assistant-body'); if (body && !body.__welcomed) {
      addMsg('مرحبًا! أنا مرشدك الإلكتروني. ' + nextText, 'bot');
      body.__welcomed = true;
    }
  }

  function normalize(s){ return (s||'').toString().trim().toLowerCase(); }
  function handleIntent(text) {
    const t = normalize(text);
    const db = Store.getDB();
    const step = computeSetupStepLocal(db);
    // Simple intents
    if (/^(ما )?الخطوة التالية|next|خطوه|خطوة$/i.test(t)) {
      return { reply: stepToText(step), action: () => routeTo(stepToRoute(step)) };
    }
  if (/مدرسة|school/.test(t)) { return { reply: 'سأفتح صفحة المدرسة.', action: () => routeTo('#/school') }; }
  if (/(معلم|مدرس|teachers?)/.test(t)) { return { reply: (window.UI && UI.Terms ? `سأفتح صفحة ${UI.Terms.full('teachers-card-title')}.` : 'سأفتح صفحة المعلمين.'), action: () => routeTo('#/teachers') }; }
    if (/صف|شعب|classes?/.test(t)) { return { reply: 'سأفتح صفحة الصفوف.', action: () => routeTo('#/classes') }; }
    if (/مادة|مواد|catalog|subjects/.test(t)) { return { reply: 'سأفتح صفحة المواد.', action: () => routeTo('#/catalog') }; }
    if (/تخصيص|assign|allocation|وزع/.test(t)) { return { reply: 'سأفتح صفحة التخصيص.', action: () => routeTo('#/subjects') }; }
    if (/جدول|timetable/.test(t)) { return { reply: 'سأفتح الجدول الأسبوعي.', action: () => routeTo('#/timetable') }; }
    if (/طباعة|اطبع|معاينة|print|preview/.test(t)) { return { reply: 'سأفتح الجدول وأعرض المعاينة.', action: () => { routeTo('#/timetable'); setTimeout(()=>{ const btn = UI.qs('#btnPreviewTT'); if (btn) btn.click(); }, 250); } }; }
    if (/نسخ احتياطي|backup/.test(t)) { return { reply: 'سأفتح النسخ الاحتياطي.', action: () => routeTo('#/backup') }; }
    if (/إعدادات|settings?/.test(t)) { return { reply: 'سأفتح الإعدادات.', action: () => routeTo('#/settings') }; }
    if (/تفعيل|license|رخصة/.test(t)) { return { reply: 'سأفتح إدارة التفعيل.', action: () => routeTo('#/activation') }; }
    if (/جديد|reset|ابدأ من جديد/.test(t)) { return { reply: 'يمكنك البدء من جديد من بطاقة "جديد" في الرئيسية. لن نمسّ التفعيل والنسخ الاحتياطية.', action: () => routeTo('#/dashboard') }; }
    // Fallbacks
  if (/(مساعدة|help|\?)/.test(t)) { return { reply: 'اسألني عن: الخطوة التالية، إضافة المعلمين/الصفوف/المواد، التخصيص، الجدول، الطباعة، النسخ الاحتياطي، التفعيل.', action: null }; }
    return { reply: 'أنا مرشد بسيط دون اتصال. اسألني عن الخطوة التالية أو اطلب فتح صفحة محددة (المعلمين، الصفوف، المواد، التخصيص، الجدول، الإعدادات).', action: null };
  }

  function sendMessage() {
    const inp = el('assistant-input'); if (!inp) return;
    const text = (inp.value || '').trim(); if (!text) return;
    inp.value = '';
    addMsg(text, 'user');
    const res = handleIntent(text);
    addMsg(res.reply, 'bot');
    if (typeof res.action === 'function') {
      setTimeout(() => { try { res.action(); } catch {} }, 50);
    }
  }

  function setMicActive(on){ state.micActive = !!on; const btn = el('assistant-mic'); if (btn) btn.classList.toggle('active', state.micActive); }

  function bindEvents() {
    const fab = el('assistant-fab'); if (fab) fab.addEventListener('click', () => togglePanel());
    const close = el('assistant-close'); if (close) close.addEventListener('click', () => togglePanel(false));
    const send = el('assistant-send'); if (send) send.addEventListener('click', sendMessage);
    const input = el('assistant-input'); if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });
    const voice = el('assistant-voice'); if (voice) voice.addEventListener('click', () => { state.voiceOn = !state.voiceOn; showToast(state.voiceOn ? 'تشغيل الصوت' : 'إيقاف الصوت'); });
    const mic = el('assistant-mic'); if (mic) mic.addEventListener('click', () => {
      if (!rec) rec = initRecognizer();
      if (!rec) { showToast('التعرّف على الصوت غير مدعوم في هذا المتصفح'); return; }
      if (state.micActive) { try { rec.stop(); } catch {} return; }
      try { rec.start(); setMicActive(true); } catch {}
    });
    window.addEventListener('hashchange', () => setTimeout(updateSuggestions, 0));
  }

  function isOverlayShown(id){
    const ov = document.getElementById(id);
    return !!(ov && !ov.classList.contains('hidden'));
  }
  function shouldRunOnboarding(){
    if (localStorage.getItem(ONBOARD_KEY)) return false;
    // لا تفتح الجولة إذا كانت نوافذ التفعيل/الدخول/إعداد المشرف ظاهرة
    if (isOverlayShown('activation-overlay')) return false;
    if (isOverlayShown('login-overlay')) return false;
    if (isOverlayShown('setup-overlay')) return false;
    return true;
  }
  function runOnboarding(){
    try {
      const db = Store.getDB();
      const step = computeSetupStepLocal(db);
      const nextText = stepToText(step);
      openPanel();
      const body = el('assistant-body'); if (body) body.__welcomed = true; // تجنّب رسالة الترحيب التلقائية الثانية
      addMsg('مرحبًا! أنا مرشدك الإلكتروني لمساعدتك في إعداد الجدول.', 'bot');
      setTimeout(() => addMsg('أرشدك حسب الأولوية خطوة بخطوة، ويمكنني التنقّل بك مباشرة.', 'bot'), 700);
      setTimeout(() => addMsg('الخطوة التالية الآن: ' + nextText, 'bot'), 1400);
      setTimeout(() => {
        // اعرض اقتراح الانتقال للخطوة التالية بشكل بارز
        updateSuggestions();
        speak('الخطوة التالية الآن');
      }, 2000);
      localStorage.setItem(ONBOARD_KEY, '1');
    } catch {}
  }

  function init() {
    if (!ensureDOM()) return;
    bindEvents();
    updateSuggestions();
    // Refresh guide status periodically (low overhead)
    setInterval(updateSuggestions, 4000);
    // Onboarding tour on first run
    setTimeout(() => { if (shouldRunOnboarding()) runOnboarding(); }, 700);
  }

  // Wait for DOM
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
