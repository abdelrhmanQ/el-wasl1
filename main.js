 // ====================================================================
 // main.js
 // ----------------------------------------------------------------------
 // UI logic: navigation, forms, tables, modals, reports, printing.
 // Uses `data`, the Supabase table refs, and the dbSetDoc/
 // dbAddDoc/dbDeleteDoc/dbSaveCounter/loadData helpers - all defined in
 // server.supabase.js, which must be loaded before this file.
 // ====================================================================

 // ==================== NAVIGATION ====================
 // Current user's role; set on login. Defaults to the most restrictive.
 let currentRole = 'employee';

 // Mobile off-canvas sidebar (drawer). On phones the sidebar slides in from
 // the side; these toggle it and dim the page behind it.
 function toggleSidebar() {
 const sb = document.getElementById('sidebar');
 const bd = document.getElementById('sidebar-backdrop');
 if (!sb) return;
 const open = sb.classList.toggle('open');
 if (bd) bd.classList.toggle('show', open);
 }
 function closeSidebar() {
 const sb = document.getElementById('sidebar');
 const bd = document.getElementById('sidebar-backdrop');
 if (sb) sb.classList.remove('open');
 if (bd) bd.classList.remove('show');
 }

 function showSection(name) {
 // On mobile, picking a section closes the drawer so the content is visible.
 closeSidebar();
 // Block employees from opening admin-only sections (e.g. via console).
 if (currentRole === 'employee' && !EMPLOYEE_SECTIONS.includes(name)) {
 name = EMPLOYEE_SECTIONS[0];
 }
 document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
 document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

 document.getElementById(`section-${name}`).classList.add('active');

 // Highlight the matching sidebar item by its data-section (robust to
 // adding/removing/reordering sections — no brittle index map).
 const navItem = document.querySelector(`.nav-item[data-section="${name}"]`);
 if (navItem) navItem.classList.add('active');

 if (name === 'dashboard') updateDashboard();
 if (name === 'registration') { updateTraineesTable(); populateRegTrainerSelect(); }
 if (name === 'trials') renderTrials();
 // (1) On-demand: these sections pull their history collection the first
 // time they're opened, then render. Later opens use what's already loaded.
 if (name === 'financial') ensureSection('payments', updateFinancial);
 if (name === 'salaries') ensureSection('expenses', updateSalaries);
 if (name === 'attendance') updateAttendanceLog();
 if (name === 'sessions') renderSessionsSection();
 if (name === 'groups') renderGroups();
 if (name === 'coaches') renderCoachesSection();
 if (name === 'staff-attendance') ensureSection('staffAttendance', renderStaffAttendance);
 // (3) Reports and the financial dashboard load only the recent window by
 // default (bounded read cost). The user can widen it with the date-range or
 // "تحميل كل الفترة" buttons in those sections.
 if (name === 'financial-dashboard') {
 ensureRecentHistory().then(renderFinancialDashboard);
 }
 if (name === 'reports') {
 ensureRecentHistory().then(updateReports);
 }
 }

 // ==================== REGISTRATION ====================
 // Note: trials now register in their own section, so this form only ever
 // creates subscriptions.

 // Generates a unique trainee code like "Wasl-0427" using random digits,
 // checking against existing trainees so two players never share an ID.
 function generateID() {
 for (let i = 0; i < 80; i++) {
 const id = `Wasl-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
 if (!data.trainees.some(t => t.id === id)) return id;
 }
 // Fallback if the 4-digit space is unexpectedly crowded.
 return `Wasl-${Date.now().toString().slice(-6)}`;
 }

 // Case-insensitive trainee lookup by code. A player can have several cards
 // (one per sport), so we match the primary id OR any code in their `codes`
 // list. Old records with only an `id` still work.
 function findTraineeByCode(code) {
 const c = (code || '').trim().toLowerCase();
 if (!c) return undefined;
 return data.trainees.find(t =>
 (t.id || '').toLowerCase() === c ||
 (t.codes || []).some(x => (x || '').toLowerCase() === c));
 }

 // All card codes for a player (multi-card aware, backward compatible).
 function traineeCodes(t) {
 return (t.codes && t.codes.length) ? t.codes : [t.id].filter(Boolean);
 }

 // <option> list of all coaches, used for assigning/reassigning a trainee's
 // coach. Preserves the current value even if it isn't a registered coach.
 function coachOptionsHTML(selected) {
 const coaches = getCoaches();
 let html = `<option value="غير محدد" ${(!selected || selected === 'غير محدد') ? 'selected' : ''}>— غير محدد —</option>`;
 let matched = false;
 coaches.forEach(c => {
 const sel = c.name === selected ? 'selected' : '';
 if (sel) matched = true;
 html += `<option value="${esc(c.name)}" ${sel}>${esc(c.name)}</option>`;
 });
 if (selected && selected !== 'غير محدد' && !matched) {
 html += `<option value="${esc(selected)}" selected>${esc(selected)} (غير مسجّل)</option>`;
 }
 return html;
 }

 // Fills the registration form's coach dropdown.
 function populateRegTrainerSelect() {
 const sel = document.getElementById('reg-trainer');
 if (sel) sel.innerHTML = coachOptionsHTML(sel.value);
 const sport = document.getElementById('reg-sport');
 if (sport && !sport.options.length) sport.innerHTML = sportOptionsHTML('');
 const level = document.getElementById('reg-level');
 if (level && !level.options.length) level.innerHTML = levelOptionsHTML('');
 const method = document.getElementById('reg-method');
 if (method && !method.options.length) method.innerHTML = methodOptionsHTML('');
 // Blank-cards printer: one sport per print run (drives the card numbering).
 const cardSport = document.getElementById('blank-cards-sport');
 if (cardSport && !cardSport.options.length) cardSport.innerHTML = sportOptionsHTML('');
 }

 // ---- Multi-sport registration: a player can have more than one sport. ----
 // The chosen sports are kept as chips; the first one is the primary.
 let regSports = [];
 function addRegSport() {
 const sport = document.getElementById('reg-sport').value;
 if (!sport) { showNotification('اختر لعبة أولاً', 'warning'); return; }
 if (!regSports.includes(sport)) regSports.push(sport);
 renderRegSportsChips();
 updateRegLevelVisibility();
 }
 function removeRegSport(i) {
 regSports.splice(i, 1);
 renderRegSportsChips();
 updateRegLevelVisibility();
 }
 function renderRegSportsChips() {
 const box = document.getElementById('reg-sports-list');
 if (!box) return;
 box.innerHTML = chipsHTML(regSports, 'removeRegSport');
 }

 // Show the gymnastics level field if "جمباز فني" is selected OR already added.
 function updateRegLevelVisibility() {
 const grp = document.getElementById('reg-level-group');
 if (!grp) return;
 const has = regSports.includes('جمباز فني') || document.getElementById('reg-sport').value === 'جمباز فني';
 grp.style.display = has ? 'flex' : 'none';
 }
 function toggleSportLevel() { updateRegLevelVisibility(); autofillRegSessions(); }

 // Auto-fills "sessions per month" from the chosen sport/sector (fixed sports
 // only). Stays editable; manual sports keep whatever the user typed.
 function autofillRegSessions() {
 const el = document.getElementById('reg-sessions');
 if (!el) return;
 const def = defaultMonthlySessions(document.getElementById('reg-sport').value, val('reg-level'));
 if (def !== '') el.value = def;
 }

 // ---- Multi-card registration: a player can hold several card codes (one per
 // sport). The codes are kept as chips; the first one becomes the primary id. ----
 let regCodes = [];
 function addRegCode() {
 const input = document.getElementById('reg-card-code');
 const code = (input.value || '').trim();
 if (!code) { showNotification('اكتب الكود أولاً', 'warning'); return; }
 if (regCodes.includes(code)) { showNotification('الكود مضاف بالفعل', 'warning'); return; }
 if (findTraineeByCode(code)) { showNotification('هذا الكود مستخدم بالفعل للاعب آخر', 'warning'); return; }
 regCodes.push(code);
 input.value = '';
 renderRegCodesChips();
 }
 function removeRegCode(i) {
 regCodes.splice(i, 1);
 renderRegCodesChips();
 }
 function renderRegCodesChips() {
 const box = document.getElementById('reg-codes-list');
 if (!box) return;
 box.innerHTML = chipsHTML(regCodes, 'removeRegCode');
 }

 // ---- Multi-sport editing (mirrors the registration chips). ----
 let editSports = [];
 function addEditSport() {
 const sport = document.getElementById('edit-sport').value;
 if (!sport) { showNotification('اختر لعبة أولاً', 'warning'); return; }
 if (!editSports.includes(sport)) editSports.push(sport);
 renderEditSportsChips();
 updateEditLevelVisibility();
 }
 function removeEditSport(i) {
 editSports.splice(i, 1);
 renderEditSportsChips();
 updateEditLevelVisibility();
 }
 function renderEditSportsChips() {
 const box = document.getElementById('edit-sports-list');
 if (!box) return;
 box.innerHTML = chipsHTML(editSports, 'removeEditSport');
 }
 function updateEditLevelVisibility() {
 const grp = document.getElementById('edit-level-group');
 if (!grp) return;
 const has = editSports.includes('جمباز فني') || document.getElementById('edit-sport').value === 'جمباز فني';
 grp.style.display = has ? 'flex' : 'none';
 }
 function toggleEditSportLevel() { updateEditLevelVisibility(); }

 // Unique document id for records stored with an explicit id (payments),
 // so each one can be edited/deleted individually later.
 function genDocId(prefix) {
 return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
 }

 function addDays(dateStr, days) {
 const d = new Date(dateStr);
 d.setDate(d.getDate() + parseInt(days || 0));
 const y = d.getFullYear();
 const m = String(d.getMonth() + 1).padStart(2, '0');
 const day = String(d.getDate()).padStart(2, '0');
 return `${y}-${m}-${day}`;
 }

 // Today as a localized Arabic date string (e.g. "٢٥/٦/٢٠٢٦") — the
 // human-readable date stamp stored on records.
 // Uses entryNow() so that, while the (temporary) backdating mode is on, every
 // record's `date` field is stamped with the chosen past date instead of today.
 function todayAr() { return new Date(entryNow()).toLocaleDateString('ar-EG'); }

 // ============ TEMP: BACKDATING UI (إدخال بأثر رجعي) ============
 // Toggles the bottom bar's override. Pick a month (year+month) and optionally
 // a day; if no day is given it defaults to the 1st. While ON, every record you
 // create (subscription, renewal, payment, expense, attendance...) is dated to
 // that month. Press again to turn off and return to today's date.
 // Remove this function + the #backdate-bar element to drop the feature.
 function toggleBackdate() {
 const status = document.getElementById('backdate-status');
 const toggle = document.getElementById('backdate-toggle');
 const bar = document.getElementById('backdate-bar');
 if (entryDateOverride != null) {
 entryDateOverride = null;
 if (bar) bar.style.background = '#1B2433';
 if (toggle) toggle.textContent = 'تفعيل';
 if (status) status.textContent = 'غير مفعّل — يُستخدم تاريخ اليوم';
 showNotification('تم إيقاف وضع الإدخال بأثر رجعي');
 return;
 }
 const m = document.getElementById('backdate-month').value; // "YYYY-MM"
 if (!m) { showNotification('اختر الشهر أولاً', 'danger'); return; }
 const [y, mo] = m.split('-').map(Number);
 let d = parseInt(document.getElementById('backdate-day').value, 10);
 if (!d || d < 1 || d > 31) d = 1;
 // Noon avoids any timezone edge that could shift the day.
 entryDateOverride = new Date(y, mo - 1, d, 12, 0, 0).getTime();
 if (bar) bar.style.background = '#2c5d4a'; // green = ON, so it's not forgotten
 if (toggle) toggle.textContent = 'إيقاف';
 if (status) status.textContent = '🟢 مفعّل: كل إدخال يُسجَّل بتاريخ ' + new Date(entryDateOverride).toLocaleDateString('ar-EG');
 showNotification('تم تفعيل الإدخال بأثر رجعي — كل ما تدخله الآن يُحسب على الشهر المختار');
 }
 // ==============================================================

 // Today as an ISO "yyyy-mm-dd" string — used for date math and <input type=date>.
 function todayISO() { return new Date().toISOString().slice(0, 10); }

 // Single place that creates an income (payment) record: it assigns a unique
 // doc id, stores the record in the local cache, and writes it to Supabase.
 // Every "money came in" path (registration, add-ons, installments, renewals)
 // goes through here, so the shape and the save logic stay identical.
 function addPayment(fields) {
 const payment = Object.assign({ _docId: genDocId('PAY') }, fields);
 // Stamp the player's CURRENT coach onto the payment, so each coach keeps the
 // money that was collected while they were the coach — changing a player's
 // coach later only moves their future payments. Sales/refunds/private have no
 // player (id '—'), so they carry no coach.
 if (payment.trainer == null && payment.id && payment.id !== '—') {
 const t = data.trainees.find(x => x.id === payment.id);
 if (t) payment.trainer = t.trainer || 'غير محدد';
 }
 data.payments.push(payment);
 dbSetDoc(paymentsCol, payment._docId, payment);
 return payment;
 }

 // Single place that stores an expense (salary, advance, percentage, manual,
 // refund...): caches it locally and writes it to Supabase. The caller builds
 // the object (with its own id prefix); this just persists it the same way.
 function saveExpense(expense) {
 data.expenses.push(expense);
 dbSetDoc(expensesCol, expense.id, expense);
 return expense;
 }

 // Renders a row of removable chips (used by the sports & codes pickers). The
 // remove handler is passed by name so each picker removes from its own list.
 function chipsHTML(items, removeFn) {
 return items.map((v, i) =>
 `<span class="badge badge-info" style="display:inline-flex; align-items:center; gap:6px;">${esc(v)} <span style="cursor:pointer; font-weight:800;" onclick="${removeFn}(${i})">×</span></span>`).join('');
 }

 async function registerTrainee() {
 const name = val('reg-name').trim();
 const phone = val('reg-phone').trim();
 const age = val('reg-age');
 const gender = val('reg-gender');
 // Multi-sport: the chosen sports (chips) plus any sport still selected in the
 // dropdown that wasn't added yet. The first one is the primary (drives the
 // card number/colour, the plan, and the default filter).
 const selectedNow = val('reg-sport');
 const sports = regSports.slice();
 if (selectedNow && !sports.includes(selectedNow)) sports.push(selectedNow);
 const sport = sports[0] || '';
 const level = sports.includes('جمباز فني') ? val('reg-level') : '';
 const trainer = val('reg-trainer').trim();
 const startDate = val('reg-start-date');
 // Every subscription is monthly: it ends by date (duration), never by sessions.
 const duration = val('reg-duration') || 30;
 const sessions = val('reg-sessions'); // sessions PER MONTH (info only)
 const total = val('reg-total');
 const amount = val('reg-amount');
 const method = val('reg-method') || 'نقداً';
 const branch = val('reg-branch');
 const notes = val('reg-notes');
 // How the player found us (social media / referral / walk-in).
 const source = val('reg-source');

 if (!name || !phone) {
 showNotification('يرجى ملء الاسم ورقم الهاتف على الأقل', 'warning');
 return;
 }
 if (!branch) {
 showNotification('يرجى اختيار الفرع', 'warning');
 return;
 }

 // Pre-printed card codes: the chips plus any code still typed but not added.
 // A multi-sport player can hold several (one per sport). Empty -> auto-generate.
 const typedCode = val('reg-card-code').trim();
 const codes = regCodes.slice();
 if (typedCode && !codes.includes(typedCode)) codes.push(typedCode);
 for (const c of codes) {
 if (findTraineeByCode(c)) {
 showNotification(`الكود ${c} مستخدم بالفعل للاعب آخر`, 'warning');
 return;
 }
 }
 if (codes.length === 0) codes.push(generateID());
 const id = codes[0]; // primary id = first code

 const today = todayAr();
 const effectiveStart = startDate || todayISO();
 // Monthly subscription: always gets an expiry date from the duration.
 const expiryDate = addDays(effectiveStart, duration);
 const monthlySessions = sessions ? parseInt(sessions) : null;

 const paidNow = num(amount);
 const subTotal = num(total) > 0 ? num(total) : paidNow;

 // This form only registers subscriptions (free trials register in their own
 // section), so every field here takes the subscription value.
 const trainee = {
 id,
 codes,
 name,
 phone,
 age,
 gender,
 type: 'subscription',
 sport,
 plan: sport,
 sports,
 level,
 trainer: trainer || 'غير محدد',
 startDate: effectiveStart,
 subType: 'days',
 durationDays: parseInt(duration),
 sessionsTotal: monthlySessions, // sessions per month (informational)
 sessionsRemaining: null,
 expiryDate,
 amount: paidNow,
 subTotal,
 subPaid: paidNow,
 notes,
 status: 'نشط',
 trialStatus: null,
 registrationDate: today,
 attendanceCount: 0,
 branch: branch,
 source: source || ''
 };

 data.trainees.push(trainee);
 dbSetDoc(traineesCol, trainee.id, trainee);
 // Note: the counter was already persisted atomically by generateID().

 // Add the first payment record if money was paid now.
 if (paidNow > 0) {
 const remaining = Math.max(0, subTotal - paidNow);
 addPayment({
 id,
 name,
 type: 'اشتراك جديد',
 plan: sportLabel(trainee),
 amount: paidNow,
 method: method,
 date: today,
 status: remaining > 0 ? 'دفعة أولى' : 'مكتمل',
 branch: branch
 });
 }

 // Optional add-on services are stored on the trainee and billed.
 trainee.addons = emptyAddons();
 billAddons(trainee, readAddonInputs('addon'), branch, today);
 dbSetDoc(traineesCol, trainee.id, trainee);

 updateDashboard();
 updateTraineesTable();
 updateBadge();

 // Show ID
 document.getElementById('generated-id').textContent = id;
 document.getElementById('id-result').classList.add('show');

 document.getElementById('reg-card-code').value = '';
 document.getElementById('reg-total').value = '';
 regSports = [];
 renderRegSportsChips();
 regCodes = [];
 renderRegCodesChips();
 resetAddons();
 showNotification(`تم تسجيل ${name} بنجاح!`);
 }

 // The optional add-on services, stored per-trainee as a price each (0 = not taken).
 const ADDON_DEFS = [
 { key: 'test', type: 'اختبار', plan: 'اختبارات', label: 'اختبارات', def: '' },
 { key: 'belt', type: 'اختبار حزام', plan: 'اختبار حزام', label: 'اختبار حزام', def: '' },
 { key: 'tournament', type: 'بطولة', plan: 'بطولات', label: 'بطولات', def: '' },
 { key: 'locker', type: 'لوكر', plan: 'إيجار لوكر', label: 'إيجار لوكر', def: '150' },
 { key: 'internet', type: 'انترنت', plan: 'اشتراك انترنت', label: 'اشتراك انترنت', def: '100' }
 ];

 // A fresh add-ons object (every service at 0), derived from ADDON_DEFS so new
 // add-ons are picked up automatically without touching every initialiser.
 function emptyAddons() {
 const o = {};
 ADDON_DEFS.forEach(d => { o[d.key] = 0; });
 return o;
 }

 // Reads add-on checkbox+price inputs that share the given id prefix
 // (e.g. "addon" -> addon-test / addon-test-price).
 function readAddonInputs(prefix) {
 const result = {};
 ADDON_DEFS.forEach(d => {
 const check = document.getElementById(`${prefix}-${d.key}`);
 const price = document.getElementById(`${prefix}-${d.key}-price`);
 result[d.key] = (check && check.checked) ? num(price ? price.value : 0) : 0;
 });
 return result;
 }

 // Applies new add-on prices to a trainee. Any increase versus what was
 // stored is billed as a new income entry; decreases just update the record
 // (past income is never deleted, keeping the financials honest).
 function billAddons(trainee, newAddons, branch, today) {
 trainee.addons = trainee.addons || emptyAddons();
 ADDON_DEFS.forEach(d => {
 const oldP = num(trainee.addons[d.key]);
 const newP = num(newAddons[d.key]);
 const delta = newP - oldP;
 if (delta > 0) {
 addPayment({
 id: trainee.id,
 name: trainee.name,
 type: d.type,
 plan: d.plan,
 amount: delta,
 method: 'نقداً',
 date: today,
 status: 'مكتمل',
 branch
 });
 }
 trainee.addons[d.key] = newP;
 });
 }

 function resetAddons() {
 ADDON_DEFS.forEach(d => {
 const check = document.getElementById(`addon-${d.key}`);
 const price = document.getElementById(`addon-${d.key}-price`);
 if (check) check.checked = false;
 if (price) price.value = d.def;
 });
 }

 function clearForm() {
 document.getElementById('reg-name').value = '';
 document.getElementById('reg-phone').value = '';
 document.getElementById('reg-age').value = '';
 document.getElementById('reg-sport').value = '';
 document.getElementById('reg-level-group').style.display = 'none';
 document.getElementById('reg-trainer').value = '';
 document.getElementById('reg-sessions').value = '';
 document.getElementById('reg-total').value = '';
 document.getElementById('reg-amount').value = '';
 document.getElementById('reg-notes').value = '';
 document.getElementById('reg-card-code').value = '';
 document.getElementById('id-result').classList.remove('show');
 regSports = [];
 renderRegSportsChips();
 regCodes = [];
 renderRegCodesChips();
 resetAddons();
 }

 function daysLeft(t) {
 if (!t.expiryDate) return null;
 const today = new Date();
 today.setHours(0,0,0,0);
 const exp = new Date(t.expiryDate);
 exp.setHours(0,0,0,0);
 return Math.round((exp - today) / (1000 * 60 * 60 * 24));
 }

 // Flip any subscription whose expiry date has passed from "نشط" to
 // "منتهي". Runs once after data loads so all counts/reports are accurate.
 // Only writes back the records that actually changed (one write per
 // transition), so it doesn't hammer the database on every page load.
 function refreshExpiredStatuses() {
 let changed = 0;
 data.trainees.forEach(t => {
 if (t.type === 'subscription' && t.status === 'نشط') {
 const info = subInfo(t);
 if (info.expired) {
 t.status = 'منتهي';
 dbSetDoc(traineesCol, t.id, t);
 changed++;
 }
 }
 });
 return changed;
 }

 // ==================== ABSENCE TRACKING ====================
 // A trainee who hasn't attended in this many days is flagged as "منقطع".
 // Change this number to make the alert stricter or more lenient.
 const ABSENCE_ALERT_DAYS = 7;

 // How long since a trainee last showed up (in whole days). Measured from
 // their last attendance, or from registration if they never attended.
 function lastAttendanceInfo(t) {
 let lastTs = 0, lastDate = '';
 data.attendance.forEach(a => {
 if (a.id === t.id) {
 const ts = parseDate(a.date);
 if (ts > lastTs) { lastTs = ts; lastDate = a.date; }
 }
 });
 const baseTs = lastTs || parseDate(t.registrationDate);
 if (!baseTs) return { days: null, lastDate: '', neverAttended: !lastTs };
 const today = new Date();
 today.setHours(0, 0, 0, 0);
 const days = Math.floor((today.getTime() - baseTs) / 86400000);
 return { days, lastDate, neverAttended: !lastTs };
 }

 // Active subscribers who have been absent past the threshold — the people
 // most at risk of dropping out, so the gym can follow up with them.
 function getAbsentees() {
 return data.trainees
 .filter(t => t.type === 'subscription' && t.status === 'نشط')
 .map(t => ({ t, info: lastAttendanceInfo(t) }))
 .filter(x => x.info.days !== null && x.info.days >= ABSENCE_ALERT_DAYS)
 .sort((a, b) => b.info.days - a.info.days);
 }

 // Single source of truth for "how much is left" on a subscription, whether
 // it's measured in days or in sessions. Backward compatible: trainees with
 // no subType are treated as days-based (the original behaviour).
 function subInfo(t) {
 if (!t || t.type !== 'subscription') {
 return { kind: 'none', expired: false, near: false, label: '—', remaining: null };
 }
 // A frozen subscription is paused: not expiring, not attendable.
 if (t.frozen) {
 return { kind: 'frozen', frozen: true, expired: false, near: false, label: 'مجمد', remLabel: 'الاشتراك مجمّد', remaining: null };
 }
 if (t.subType === 'sessions') {
 const rem = num(t.sessionsRemaining);
 return {
 kind: 'sessions',
 remaining: rem,
 expired: rem <= 0,
 near: rem > 0 && rem <= 3,
 label: rem <= 0 ? 'منتهي' : `${rem} حصة`,
 remLabel: rem <= 0 ? 'منتهي' : `${rem} حصة متبقية`
 };
 }
 const left = daysLeft(t);
 if (left === null) return { kind: 'none', expired: false, near: false, label: '—', remaining: null };
 return {
 kind: 'days',
 remaining: left,
 expired: left < 0,
 near: left >= 0 && left <= 5,
 label: left < 0 ? 'منتهي' : `${left} يوم`,
 remLabel: left < 0 ? 'منتهي' : `${left} يوم متبقي`
 };
 }

 function expiryCell(t) {
 const info = subInfo(t);
 if (info.frozen) return '<span class="badge badge-info">❄️ مجمّد</span>';
 if (info.kind === 'none') return '<span style="font-size:12px; color: rgba(48,56,65,0.4);">—</span>';
 if (info.expired) return '<span class="badge badge-danger">منتهي</span>';
 if (info.near) return `<span class="badge badge-warning">باقي ${esc(info.label)}</span>`;
 return `<span style="font-size:12px;">${esc(info.label)}</span>`;
 }

 // Single row renderer used by both the full list and the filtered views,
 // so the columns/actions always stay consistent.
 function traineeRowHtml(t) {
 const i = data.trainees.indexOf(t);
 const info = subInfo(t);
 const renewBtn = (info.expired || info.near)
 ? `<button class="btn btn-warning btn-sm" onclick="goRenew('${esc(t.id)}')">تجديد</button>` : '';
 // Freeze/unfreeze is only relevant for subscriptions.
 const freezeBtn = t.type === 'subscription'
 ? (t.frozen
 ? `<button class="btn btn-success btn-sm" onclick="unfreezeTrainee(${i})">إلغاء التجميد</button>`
 : `<button class="btn btn-outline btn-sm" onclick="freezeTrainee(${i})">تجميد</button>`)
 : '';
 const statusClass = t.status === 'نشط' ? 'badge-success'
 : t.status === 'تجريبي' ? 'badge-test'
 : t.status === 'مجمد' ? 'badge-info'
 : 'badge-danger';
 // Outstanding balance for installment subscriptions.
 const remaining = Math.max(0, num(t.subTotal) - num(t.subPaid));
 const installBtn = (t.type === 'subscription' && remaining > 0)
 ? `<button class="btn btn-warning btn-sm" onclick="payInstallment(${i})">دفع قسط (متبقي ${remaining.toLocaleString()})</button>` : '';
 // Refund/cancel request (subscriptions only). Disabled while one is pending.
 const refundBtn = (t.type === 'subscription')
 ? (t.refundRequest && t.refundRequest.status === 'معلّق'
 ? `<button class="btn btn-outline btn-sm" disabled>استرداد معلّق</button>`
 : `<button class="btn btn-outline btn-sm" onclick="requestRefund(${i})">استرداد</button>`)
 : '';
 return `
 <tr>
 <td><code style="color: var(--gold); font-family: monospace;">${esc(t.id)}</code></td>
 <td><strong>${esc(t.name)}</strong></td>
 <td>${esc(t.phone)}</td>
 <td>
 <span class="badge ${t.type === 'subscription' ? 'badge-success' : 'badge-test'}">
 ${t.type === 'subscription' ? 'اشتراك' : 'تجريبي'}
 </span>
 </td>
 <td><span class="badge" style="background: rgba(48,56,65,0.05); color: var(--accent); border: 1px solid rgba(48,56,65,0.2);">${esc(t.branch || 'غير محدد')}</span></td>
 <td style="font-size: 12px;">${esc(sportLabel(t))}</td>
 <td>
 <span class="badge ${statusClass}">${esc(t.status)}</span>
 </td>
 <td>${expiryCell(t)}</td>
 <td style="font-size:11px; color:rgba(48,56,65,0.55);">${esc(t.createdBy || '—')}</td>
 <td>
 ${installBtn}
 ${renewBtn}
 ${freezeBtn}
 ${refundBtn}
 <button class="btn btn-outline btn-sm" onclick="viewTrainee(${i})">عرض</button>
 <button class="btn btn-outline btn-sm" onclick="editTrainee(${i})">تعديل</button>
 <button class="btn btn-outline btn-sm" onclick="printCard(${i})">طباعة</button>
 <button class="btn btn-danger btn-sm" onclick="deleteTrainee(${i})">حذف</button>
 </td>
 </tr>`;
 }

 function updateTraineesTable() {
 populateTraineeFilters();
 filterTrainees();
 }

 // Fill the sport dropdown from the distinct sports in the data, then refresh
 // the (sport-dependent) trainer dropdown.
 function populateTraineeFilters() {
 const sportSel = document.getElementById('filter-sport');
 if (!sportSel) return;
 const prev = sportSel.value;
 const sports = [...new Set(data.trainees.flatMap(t => traineeSports(t)).map(s => s.trim()).filter(Boolean))].sort();
 sportSel.innerHTML = '<option value="الكل">كل الرياضات</option>' +
 sports.map(s => `<option value="${esc(s)}" ${s === prev ? 'selected' : ''}>${esc(s)}</option>`).join('');
 populateTrainerFilter();
 }

 // Trainer options depend on the chosen sport: only trainers who actually
 // have players in that sport are shown (so the filter narrows down).
 function populateTrainerFilter() {
 const sportSel = document.getElementById('filter-sport');
 const trainerSel = document.getElementById('filter-trainer');
 if (!sportSel || !trainerSel) return;
 const sport = sportSel.value;
 const prev = trainerSel.value;
 let pool = data.trainees;
 if (sport && sport !== 'الكل') pool = pool.filter(t => traineeSports(t).includes(sport));
 const trainers = [...new Set(pool.map(t => (t.trainer || 'غير محدد').trim()).filter(Boolean))].sort();
 trainerSel.innerHTML = '<option value="الكل">كل المدربين</option>' +
 trainers.map(tr => `<option value="${esc(tr)}" ${tr === prev ? 'selected' : ''}>${esc(tr)}</option>`).join('');
 }

 // When the sport changes, rebuild the trainer list then re-filter.
 function onSportFilterChange() {
 populateTrainerFilter();
 filterTrainees();
 }

 // Applies the text search + sport + trainer filters and renders the table.
 function filterTrainees() {
 const q = (document.getElementById('search-trainees').value || '').toLowerCase().trim();
 const sportSel = document.getElementById('filter-sport');
 const trainerSel = document.getElementById('filter-trainer');
 const sport = sportSel ? sportSel.value : 'الكل';
 const trainer = trainerSel ? trainerSel.value : 'الكل';

 const list = data.trainees.filter(t => {
 if (t.type === 'test') return false; // trials live in their own section
 const tTrainer = (t.trainer || 'غير محدد').trim();
 const matchSport = !sport || sport === 'الكل' || traineeSports(t).includes(sport);
 const matchTrainer = !trainer || trainer === 'الكل' || tTrainer === trainer;
 const matchText = !q || t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q) || (t.phone || '').includes(q);
 return matchSport && matchTrainer && matchText;
 });

 const tbody = document.getElementById('trainees-table');
 if (data.trainees.length === 0) {
 tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color: rgba(48,56,65,0.3); padding: 30px;">لا يوجد لاعبون مسجلون بعد</td></tr>';
 return;
 }
 if (list.length === 0) {
 tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color: rgba(48,56,65,0.3); padding: 30px;">لا توجد نتائج مطابقة للفلاتر</td></tr>';
 return;
 }
 tbody.innerHTML = list.map(traineeRowHtml).join('');
 }

 function resetTraineeFilters() {
 const search = document.getElementById('search-trainees');
 const sportSel = document.getElementById('filter-sport');
 const trainerSel = document.getElementById('filter-trainer');
 if (search) search.value = '';
 if (sportSel) sportSel.value = 'الكل';
 populateTrainerFilter();
 if (trainerSel) trainerSel.value = 'الكل';
 filterTrainees();
 }

 function viewTrainee(index) {
 const t = data.trainees[index];
 const attendanceCount = data.attendance.filter(a => a.id === t.id).length;

 openModal(`${t.name}`, `
 <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
 <div style="padding: 15px; background: rgba(48,56,65,0.05); border-radius: 10px;">
 <div style="color: rgba(48,56,65,0.4); font-size: 12px;">${traineeCodes(t).length > 1 ? 'الأكواد' : 'الكود'}</div>
 <div style="color: var(--gold); font-family: monospace; font-size: 18px; font-weight: 700;">${esc(traineeCodes(t).join('، '))}</div>
 </div>
 <div style="padding: 15px; background: rgba(48,56,65,0.05); border-radius: 10px;">
 <div style="color: rgba(48,56,65,0.4); font-size: 12px;">الهاتف</div>
 <div style="font-weight: 600;">${esc(t.phone)}</div>
 </div>
 <div style="padding: 15px; background: rgba(48,56,65,0.05); border-radius: 10px;">
 <div style="color: rgba(48,56,65,0.4); font-size: 12px;">نوع الرياضة</div>
 <div style="font-weight: 600;">${esc(sportLabel(t))}</div>
 </div>
 <div style="padding: 15px; background: rgba(48,56,65,0.05); border-radius: 10px;">
 <div style="color: rgba(48,56,65,0.4); font-size: 12px;">المدرب المسؤول</div>
 <div style="font-weight: 600;">${esc(t.trainer || 'غير محدد')}</div>
 </div>
 <div style="padding: 15px; background: rgba(48,56,65,0.05); border-radius: 10px;">
 <div style="color: rgba(48,56,65,0.4); font-size: 12px;">${t.sessionsTotal != null ? 'عدد الحصص في الشهر' : (subInfo(t).kind === 'sessions' ? 'الحصص المتبقية' : 'تاريخ الانتهاء')}</div>
 <div style="font-weight: 600;">${t.sessionsTotal != null ? esc(num(t.sessionsTotal) + ' حصة/شهر') : esc(subInfo(t).kind === 'sessions' ? subInfo(t).remLabel : (t.expiryDate || '-'))}</div>
 </div>
 <div style="padding: 15px; background: rgba(48,56,65,0.05); border-radius: 10px;">
 <div style="color: rgba(48,56,65,0.4); font-size: 12px;">الفرع</div>
 <div style="font-weight: 600;">${esc(t.branch || 'غير محدد')}</div>
 </div>
 <div style="padding: 15px; background: rgba(48,56,65,0.05); border-radius: 10px;">
 <div style="color: rgba(48,56,65,0.4); font-size: 12px;">باقي على انتهاء الاشتراك</div>
 <div style="font-weight: 600;">${expiryCell(t)}</div>
 </div>
 <div style="padding: 15px; background: rgba(48,56,65,0.05); border-radius: 10px;">
 <div style="color: rgba(48,56,65,0.4); font-size: 12px;">مرات الحضور</div>
 <div style="font-weight: 600; color: var(--success);">${attendanceCount} مرة</div>
 </div>
 <div style="padding: 15px; background: rgba(48,56,65,0.05); border-radius: 10px;">
 <div style="color: rgba(48,56,65,0.4); font-size: 12px;">المدفوع</div>
 <div style="font-weight: 600; color: var(--warning);">${num(t.amount).toLocaleString()} ج.م</div>
 </div>
 <div style="padding: 15px; background: rgba(48,56,65,0.05); border-radius: 10px;">
 <div style="color: rgba(48,56,65,0.4); font-size: 12px;">تاريخ التسجيل</div>
 <div style="font-weight: 600;">${esc(t.registrationDate)}</div>
 </div>
 <div style="padding: 15px; background: rgba(48,56,65,0.05); border-radius: 10px;">
 <div style="color: rgba(48,56,65,0.4); font-size: 12px;">مصدر التسجيل</div>
 <div style="font-weight: 600;">${esc(t.source || 'غير محدد')}</div>
 </div>
 </div>
 ${t.frozen ? `<div style="margin-top: 15px; padding: 15px; background: rgba(184,144,31,0.07); border:1px solid rgba(184,144,31,0.3); border-radius: 10px;">
 <div style="color: var(--gold); font-size: 12px; font-weight:700;">❄️ الاشتراك مجمّد</div>
 <div style="font-size:13px; margin-top:4px;">السبب: ${esc(t.freezeReason || '-')}${t.freezeDate ? ' • منذ: ' + esc(t.freezeDate) : ''}</div>
 </div>` : ''}
 ${(() => {
 const active = ADDON_DEFS.filter(d => num((t.addons || {})[d.key]) > 0);
 if (active.length === 0) return '';
 return `<div style="margin-top: 15px; padding: 15px; background: rgba(48,56,65,0.05); border-radius: 10px;">
 <div style="color: rgba(48,56,65,0.4); font-size: 12px; margin-bottom: 8px;">خدمات إضافية</div>
 <div style="display:flex; flex-wrap:wrap; gap:8px;">
 ${active.map(d => `<span class="badge badge-info">${esc(d.label)}: ${num(t.addons[d.key]).toLocaleString()} ج.م</span>`).join('')}
 </div>
 </div>`;
 })()}
 ${t.notes ? `<div style="margin-top: 15px; padding: 15px; background: rgba(48,56,65,0.05); border-radius: 10px;">
 <div style="color: rgba(48,56,65,0.4); font-size: 12px;">ملاحظات</div>
 <div>${esc(t.notes)}</div>
 </div>` : ''}
 <div style="margin-top: 15px; display: flex; gap: 10px;">
 <button class="btn btn-outline btn-sm" onclick="closeModal(); editTrainee(${index})">تعديل البيانات</button>
 <button class="btn btn-outline btn-sm" onclick="printCard(${index})">طباعة البطاقة</button>
 </div>
 `);
 }

 function editTrainee(index) {
 const t = data.trainees[index];
 editSports = traineeSports(t).slice(); // seed the multi-sport chips
 openModal(`تعديل بيانات ${t.name}`, `
 <div class="form-grid">
 <div class="form-group">
 <label>الاسم الكامل</label>
 <input type="text" id="edit-name" value="${esc(t.name)}">
 </div>
 <div class="form-group">
 <label>رقم الهاتف</label>
 <input type="tel" id="edit-phone" value="${esc(t.phone)}">
 </div>
 <div class="form-group">
 <label>نوع الرياضة (يمكن اختيار أكثر من لعبة)</label>
 <div style="display:flex; gap:8px;">
 <select id="edit-sport" onchange="toggleEditSportLevel()" style="flex:1;">${sportOptionsHTML('')}</select>
 <button type="button" class="btn btn-outline btn-sm" onclick="addEditSport()">➕ أضف</button>
 </div>
 <div id="edit-sports-list" style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;"></div>
 </div>
 <div class="form-group" id="edit-level-group" style="display:${traineeSports(t).includes('جمباز فني') ? 'flex' : 'none'};">
 <label>المستوى (جمباز فني)</label>
 <select id="edit-level">${levelOptionsHTML(t.level || '')}</select>
 </div>
 <div class="form-group">
 <label>المدرب المسؤول</label>
 <select id="edit-trainer">${coachOptionsHTML(t.trainer)}</select>
 </div>
 ${t.subType === 'sessions' ? `
 <div class="form-group">
 <label>الحصص المتبقية</label>
 <input type="number" id="edit-sessions" value="${num(t.sessionsRemaining)}">
 </div>` : `
 <div class="form-group">
 <label>تاريخ بداية الاشتراك</label>
 <input type="date" id="edit-start-date" value="${t.startDate || ''}">
 </div>
 <div class="form-group">
 <label>مدة الاشتراك (بالأيام)</label>
 <input type="number" id="edit-duration" value="${t.durationDays || 30}">
 </div>
 <div class="form-group">
 <label>عدد الحصص في الشهر</label>
 <input type="number" id="edit-monthly-sessions" value="${t.sessionsTotal != null ? num(t.sessionsTotal) : ''}" placeholder="اختياري">
 </div>`}
 <div class="form-group">
 <label>المبلغ المدفوع</label>
 <input type="number" id="edit-amount" value="${num(t.amount)}">
 </div>
 <div class="form-group">
 <label>الفرع</label>
 <select id="edit-branch">${branchOptionsHTML(t.branch, true)}</select>
 </div>
 <div class="form-group">
 <label>الحالة</label>
 <select id="edit-status">
 <option value="نشط" ${t.status === 'نشط' ? 'selected' : ''}>نشط</option>
 <option value="منتهي" ${t.status === 'منتهي' ? 'selected' : ''}>منتهي</option>
 <option value="تجريبي" ${t.status === 'تجريبي' ? 'selected' : ''}>تجريبي</option>
 ${t.frozen ? '<option value="مجمد" selected>مجمد</option>' : ''}
 </select>
 </div>
 <div class="form-group">
 <label>ملاحظات</label>
 <input type="text" id="edit-notes" value="${esc(t.notes || '')}">
 </div>
 </div>
 <div style="border-top: 1px solid rgba(48,56,65,0.1); margin-top: 16px; padding-top: 14px;">
 <div style="font-weight: 700; color: var(--accent); margin-bottom: 4px;">خدمات إضافية</div>
 <p style="color: rgba(48,56,65,0.5); font-size: 12px; margin-bottom: 12px;">أي زيادة في السعر تُحتسب كإيراد جديد عند الحفظ.</p>
 <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
 ${ADDON_DEFS.map(d => {
 const cur = num((t.addons || {})[d.key]);
 const checked = cur > 0 ? 'checked' : '';
 const val = cur > 0 ? cur : d.def;
 return `
 <div class="addon-box">
 <label style="display:flex; align-items:center; gap:8px; font-weight:600; margin-bottom:8px;">
 <input type="checkbox" id="edit-addon-${d.key}" ${checked} style="width:18px; height:18px;"> ${esc(d.label)}
 </label>
 <input type="number" id="edit-addon-${d.key}-price" value="${esc(val)}">
 </div>`;
 }).join('')}
 </div>
 </div>
 <button class="btn btn-primary" style="margin-top: 20px; width: 100%;" onclick="saveTraineeEdit(${index})">حفظ التعديلات</button>
 `);
 renderEditSportsChips();
 }

 function saveTraineeEdit(index) {
 const t = data.trainees[index];
 const oldCoach = t.trainer; // capture before the edit so we can detect a coach transfer
 t.name = document.getElementById('edit-name').value.trim() || t.name;
 t.phone = document.getElementById('edit-phone').value.trim() || t.phone;
 // Multi-sport: include any sport still selected but not added as a chip.
 const editSelectedNow = document.getElementById('edit-sport').value;
 const sportsList = editSports.slice();
 if (editSelectedNow && !sportsList.includes(editSelectedNow)) sportsList.push(editSelectedNow);
 t.sports = sportsList;
 t.sport = sportsList[0] || '';
 t.plan = t.sport;
 t.level = sportsList.includes('جمباز فني') ? document.getElementById('edit-level').value : '';
 t.trainer = document.getElementById('edit-trainer').value.trim() || 'غير محدد';
 t.amount = num(document.getElementById('edit-amount').value);
 t.branch = document.getElementById('edit-branch').value;
 t.status = document.getElementById('edit-status').value;
 t.notes = document.getElementById('edit-notes').value.trim();

 if (t.subType === 'sessions') {
 // Session-based: update the remaining-sessions balance directly.
 const sessEl = document.getElementById('edit-sessions');
 if (sessEl) t.sessionsRemaining = num(sessEl.value);
 } else {
 // Days-based: recompute expiry from start date + duration.
 const startEl = document.getElementById('edit-start-date');
 const durEl = document.getElementById('edit-duration');
 t.startDate = (startEl && startEl.value) || t.startDate;
 t.durationDays = (durEl && parseInt(durEl.value)) || t.durationDays || 30;
 if (t.startDate && t.durationDays) {
 t.expiryDate = addDays(t.startDate, t.durationDays);
 }
 // Monthly sessions count (informational, editable).
 const msEl = document.getElementById('edit-monthly-sessions');
 if (msEl) t.sessionsTotal = msEl.value === '' ? null : num(msEl.value);
 }

 // If the responsible coach changed, move the commission value of the
 // not-yet-used part (remaining sessions/days) to the new coach.
 recordCoachTransfer(t, oldCoach, t.trainer);

 // Apply add-on changes (any added/increased service is billed as income).
 const today = todayAr();
 billAddons(t, readAddonInputs('edit-addon'), t.branch, today);

 dbSetDoc(traineesCol, t.id, t);
 updateTraineesTable();
 updateFinancial();
 updateDashboard();
 closeModal();
 showNotification(`تم حفظ تعديلات ${t.name}`);
 }

 function printCard(index) {
 const t = data.trainees[index];
 openCardWindow(t);
 }
 function deleteTrainee(index) {
 const t = data.trainees[index];
 if (confirm(`هل أنت متأكد من حذف "${t.name}"؟\nسيتم حذف سجلات حضوره أيضاً، مع الاحتفاظ بمدفوعاته في التقارير المالية.`)) {
 data.trainees.splice(index, 1);
 dbDeleteDoc(traineesCol, t.id);

 // Clean up attendance records (local + cloud). Payments are intentionally
 // kept so historical revenue stays accurate in the financial reports.
 data.attendance = data.attendance.filter(a => a.id !== t.id);
 dbDeleteWhere(attendanceCol, 'id', t.id);

 updateTraineesTable();
 updateDashboard();
 updateBadge();
 showNotification('تم حذف اللاعب وسجلات حضوره', 'danger');
 }
 }

 // ==================== FREE TRIALS (TEST) ====================
 // A free trial only collects the player's data. It waits in this section for an
 // admit/reject decision: accepted -> full subscription data is added and it
 // moves to the players list; rejected -> auto-removed after one week.
 const TRIAL_KEEP_DAYS = 7;

 // Register a free trial — collects the player's data only (no payment) and
 // files it as "pending" in this section, separate from the real players.
 function registerTrial() {
 const name = val('trial-name').trim();
 const phone = val('trial-phone').trim();
 const branch = val('trial-branch');
 if (!name || !phone) { showNotification('يرجى ملء الاسم ورقم الهاتف', 'warning'); return; }
 if (!branch) { showNotification('يرجى اختيار الفرع', 'warning'); return; }

 const id = generateID();
 const trainee = {
 id, codes: [id], name, phone,
 age: val('trial-age'),
 gender: val('trial-gender'),
 type: 'test',
 sport: 'تجريبي مجاني', plan: 'تجريبي مجاني', sports: [], level: '',
 trainer: 'غير محدد',
 amount: 0, subTotal: 0, subPaid: 0,
 notes: val('trial-notes'),
 status: 'تجريبي',
 trialStatus: 'pending',
 registrationDate: todayAr(),
 attendanceCount: 0,
 branch,
 source: val('trial-source') || ''
 };
 data.trainees.push(trainee);
 dbSetDoc(traineesCol, id, trainee);

 setVal('trial-name', ''); setVal('trial-phone', ''); setVal('trial-age', ''); setVal('trial-notes', '');
 renderTrials();
 updateDashboard();
 showNotification(`تم تسجيل اللاعب التجريبي ${name}`);
 }

 // Delete rejected trials older than a week (runs once after data loads).
 function purgeOldRejectedTrials() {
 const cutoff = Date.now() - TRIAL_KEEP_DAYS * 86400000;
 const stale = data.trainees.filter(t => t.type === 'test' && t.trialStatus === 'rejected' && parseDate(t.rejectedAt) && parseDate(t.rejectedAt) < cutoff);
 stale.forEach(t => { dbDeleteDoc(traineesCol, t.id); });
 if (stale.length) data.trainees = data.trainees.filter(t => !stale.includes(t));
 }

 function renderTrials() {
 const tbody = document.getElementById('trials-table');
 if (!tbody) return;
 const trials = data.trainees.filter(t => t.type === 'test');
 if (trials.length === 0) {
 tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:rgba(48,56,65,0.3); padding:30px;">لا يوجد لاعبون تجريبيون</td></tr>';
 return;
 }
 tbody.innerHTML = trials.map(t => {
 const i = data.trainees.indexOf(t);
 const statusBadge = t.trialStatus === 'rejected'
 ? '<span class="badge badge-danger">مرفوض (يُحذف بعد أسبوع)</span>'
 : '<span class="badge badge-test">معلّق</span>';
 const actions = t.trialStatus === 'rejected'
 ? `<button class="btn btn-outline btn-sm" onclick="viewTrainee(${i})">عرض</button>
 <button class="btn btn-danger btn-sm" onclick="deleteTrainee(${i})">حذف</button>`
 : `<button class="btn btn-success btn-sm" onclick="acceptTrial(${i})">قبول</button>
 <button class="btn btn-danger btn-sm" onclick="rejectTrial(${i})">رفض</button>
 <button class="btn btn-outline btn-sm" onclick="viewTrainee(${i})">عرض</button>`;
 return `<tr>
 <td><code style="color:var(--gold); font-family:monospace;">${esc(t.id)}</code></td>
 <td><strong>${esc(t.name)}</strong></td>
 <td>${esc(t.phone)}</td>
 <td>${branchBadge(t.branch)}</td>
 <td>${esc(t.registrationDate || '-')}</td>
 <td>${statusBadge}</td>
 <td style="font-size:11px; color:rgba(48,56,65,0.55);">${esc(t.createdBy || '—')}</td>
 <td>${actions}</td>
 </tr>`;
 }).join('');
 }

 // Accept: open a popup to enter the subscription details before converting.
 function acceptTrial(index) {
 const t = data.trainees[index];
 if (!t || t.type !== 'test') return;
 openModal(`قبول وتحويل لاشتراك - ${t.name}`, `
 <div class="form-grid">
 <div class="form-group">
 <label>نوع الرياضة</label>
 <select id="accept-sport" onchange="toggleAcceptLevel()">${sportOptionsHTML('')}</select>
 </div>
 <div class="form-group" id="accept-level-group" style="display:none;">
 <label>المستوى (جمباز فني)</label>
 <select id="accept-level" onchange="autofillAcceptSessions()">${levelOptionsHTML('')}</select>
 </div>
 <div class="form-group">
 <label>المدرب المسؤول</label>
 <select id="accept-trainer">${coachOptionsHTML('غير محدد')}</select>
 </div>
 <div class="form-group">
 <label>مدة الاشتراك (بالأيام)</label>
 <input type="number" id="accept-duration" value="30">
 </div>
 <div class="form-group">
 <label>عدد الحصص في الشهر</label>
 <input type="number" id="accept-sessions" placeholder="يُملأ تلقائياً — قابل للتعديل">
 </div>
 <div class="form-group">
 <label>السعر الكامل</label>
 <input type="number" id="accept-total" placeholder="السعر الكامل">
 </div>
 <div class="form-group">
 <label>المبلغ المدفوع</label>
 <input type="number" id="accept-amount" placeholder="المدفوع الآن">
 </div>
 <div class="form-group">
 <label>طريقة الدفع</label>
 <select id="accept-method">${methodOptionsHTML('')}</select>
 </div>
 <div class="form-group">
 <label>كود البطاقة (اختياري)</label>
 <input type="text" id="accept-code" placeholder="كود الكرت المطبوع">
 </div>
 </div>
 <button class="btn btn-success" style="margin-top:18px; width:100%;" onclick="confirmAcceptTrial(${index})">تأكيد القبول والتحويل</button>`);
 }
 function toggleAcceptLevel() {
 const grp = document.getElementById('accept-level-group');
 if (grp) grp.style.display = (document.getElementById('accept-sport').value === 'جمباز فني') ? 'flex' : 'none';
 autofillAcceptSessions();
 }
 // Auto-fills the accept popup's "sessions per month" from the sport/sector.
 function autofillAcceptSessions() {
 const el = document.getElementById('accept-sessions');
 if (!el) return;
 const def = defaultMonthlySessions(val('accept-sport'), val('accept-level'));
 if (def !== '') el.value = def;
 }

 function confirmAcceptTrial(index) {
 const t = data.trainees[index];
 if (!t || t.type !== 'test') return;
 const sport = val('accept-sport');
 if (!sport) { showNotification('اختر الرياضة', 'warning'); return; }
 const sessions = parseInt(val('accept-sessions')) || 0; // sessions per month (info)
 const duration = parseInt(val('accept-duration')) || 30;
 const paid = num(val('accept-amount'));
 const total = num(val('accept-total')) > 0 ? num(val('accept-total')) : paid;
 const method = val('accept-method') || 'نقداً';
 const code = val('accept-code').trim();
 if (code && !traineeCodes(t).includes(code)) {
 if (findTraineeByCode(code)) { showNotification('هذا الكود مستخدم بالفعل', 'warning'); return; }
 t.codes = traineeCodes(t).concat(code);
 }

 // Convert the trial into a full subscription.
 t.type = 'subscription';
 t.sport = sport; t.plan = sport;
 t.sports = [sport];
 t.level = (sport === 'جمباز فني') ? val('accept-level') : '';
 t.trainer = document.getElementById('accept-trainer').value.trim() || 'غير محدد';
 t.subType = 'days';
 t.startDate = todayISO();
 t.durationDays = duration;
 t.sessionsTotal = sessions > 0 ? sessions : null; // sessions per month (info)
 t.sessionsRemaining = null;
 t.expiryDate = addDays(t.startDate, duration);
 t.amount = paid; t.subTotal = total; t.subPaid = paid;
 t.status = 'نشط';
 t.trialStatus = 'accepted';
 t.addons = t.addons || emptyAddons();

 if (paid > 0) {
 const remaining = Math.max(0, total - paid);
 addPayment({
 id: t.id, name: t.name, type: 'اشتراك جديد', plan: sportLabel(t),
 amount: paid, method, date: todayAr(), status: remaining > 0 ? 'دفعة أولى' : 'مكتمل', branch: t.branch
 });
 }
 dbSetDoc(traineesCol, t.id, t);

 closeModal();
 renderTrials();
 updateTraineesTable();
 updateFinancial();
 updateDashboard();
 updateBadge();
 showNotification(`تم قبول ${t.name} وتحويله للاعب مشترك`);
 }

 function rejectTrial(index) {
 const t = data.trainees[index];
 if (!t || t.type !== 'test') return;
 if (!confirm(`رفض اللاعب التجريبي "${t.name}"؟ سيُحذف تلقائيًا بعد أسبوع.`)) return;
 t.trialStatus = 'rejected';
 t.rejectedAt = todayISO();
 dbSetDoc(traineesCol, t.id, t);
 renderTrials();
 updateDashboard();
 showNotification('تم رفض اللاعب التجريبي', 'danger');
 }

 // ==================== FREEZE / PAUSE SUBSCRIPTION ====================
 // Opens a popup to capture the freeze reason, then pauses the subscription.
 function freezeTrainee(index) {
 const t = data.trainees[index];
 if (!t || t.frozen) return;
 openModal(`تجميد اشتراك - ${t.name}`, `
 <p style="color:rgba(48,56,65,0.6); margin-bottom:14px;">سيتم إيقاف الاشتراك مؤقتاً (لا يُحتسب الوقت ولا يُسمح بالحضور) حتى إلغاء التجميد.</p>
 <div class="form-group">
 <label>سبب التجميد *</label>
 <input type="text" id="freeze-reason" placeholder="مثال: سفر / إصابة / ظرف طارئ">
 </div>
 <div style="display:flex; gap:10px; margin-top:18px;">
 <button class="btn btn-primary" style="flex:1;" onclick="confirmFreeze(${index})">تأكيد التجميد</button>
 <button class="btn btn-outline" style="flex:1;" onclick="closeModal()">إلغاء</button>
 </div>`);
 }

 function confirmFreeze(index) {
 const t = data.trainees[index];
 if (!t) return;
 const reason = document.getElementById('freeze-reason').value.trim();
 if (!reason) { showNotification('يرجى كتابة سبب التجميد', 'warning'); return; }

 t.frozen = true;
 t.freezeReason = reason;
 t.freezeDate = todayISO();
 // Preserve the remaining days so they're restored on unfreeze (days-based only).
 if (t.subType !== 'sessions') {
 const left = daysLeft(t);
 t.frozenDaysLeft = (left !== null && left > 0) ? left : 0;
 }
 t.status = 'مجمد';
 dbSetDoc(traineesCol, t.id, t);

 closeModal();
 updateTraineesTable();
 updateDashboard();
 showNotification(`تم تجميد اشتراك ${t.name}`);
 }

 function unfreezeTrainee(index) {
 const t = data.trainees[index];
 if (!t || !t.frozen) return;
 if (!confirm(`إلغاء تجميد اشتراك "${t.name}" واستئنافه؟`)) return;

 // Days-based: resume by extending the expiry from today by the days that
 // were left when it was frozen (so frozen time isn't lost). Session-based
 // keeps its remaining sessions as they are.
 if (t.subType !== 'sessions') {
 const days = num(t.frozenDaysLeft);
 const iso = todayISO();
 t.expiryDate = addDays(iso, days);
 t.startDate = iso;
 }
 t.frozen = false;
 t.freezeReason = '';
 t.frozenDaysLeft = null;
 t.status = 'نشط';
 dbSetDoc(traineesCol, t.id, t);

 updateTraineesTable();
 updateDashboard();
 showNotification(`تم إلغاء تجميد اشتراك ${t.name}`);
 }

 // ==================== INSTALLMENTS ====================
 function payInstallment(index) {
 const t = data.trainees[index];
 if (!t) return;
 const remaining = Math.max(0, num(t.subTotal) - num(t.subPaid));
 openModal(`دفع قسط - ${t.name}`, `
 <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-bottom:16px;">
 ${attRow('السعر الإجمالي', num(t.subTotal).toLocaleString() + ' ج.م')}
 ${attRow('المدفوع', num(t.subPaid).toLocaleString() + ' ج.م')}
 ${attRow('المتبقي', remaining.toLocaleString() + ' ج.م')}
 </div>
 <div class="form-group"><label>مبلغ القسط</label><input type="number" id="install-amount" value="${remaining}"></div>
 <div class="form-group"><label>طريقة الدفع</label><select id="install-method">${methodOptionsHTML('')}</select></div>
 <div style="display:flex; gap:10px; margin-top:18px;">
 <button class="btn btn-success" style="flex:1;" onclick="confirmInstallment(${index})">تأكيد الدفع</button>
 <button class="btn btn-outline" style="flex:1;" onclick="closeModal()">إلغاء</button>
 </div>`);
 }

 function confirmInstallment(index) {
 const t = data.trainees[index];
 if (!t) return;
 const amount = num(document.getElementById('install-amount').value);
 const method = document.getElementById('install-method').value;
 if (amount <= 0) { showNotification('أدخل مبلغاً صالحاً', 'warning'); return; }

 t.subPaid = num(t.subPaid) + amount;
 t.amount = num(t.amount) + amount;
 const remaining = Math.max(0, num(t.subTotal) - num(t.subPaid));
 const today = todayAr();
 addPayment({
 id: t.id, name: t.name, type: 'قسط', plan: sportLabel(t),
 amount, method, date: today, status: remaining > 0 ? 'قسط' : 'مكتمل', branch: t.branch
 });
 dbSetDoc(traineesCol, t.id, t);

 closeModal();
 updateTraineesTable();
 updateFinancial();
 updateDashboard();
 showNotification(`تم دفع قسط ${amount.toLocaleString()} ج.م لـ ${t.name}`);
 }

 // ==================== REFUND / CANCELLATION ====================
 // A player can ask to cancel and get money back. We only refund the value of
 // the UNUSED part (paid × remaining/total) — the days/sessions already taken
 // are deducted. The request stays "معلّق" until an admin approves it; nothing
 // is deducted and the subscription is not cancelled before that approval.

 // Total amount the player has EVER paid us — the sum of all their payment
 // records (subscription, renewals, installments, add-ons, belt exams...).
 function totalPaidByPlayer(t) {
 const fromPayments = data.payments
 .filter(p => p.id === t.id)
 .reduce((s, p) => s + num(p.amount), 0);
 // Fall back to the stored figures for old players who predate per-payment records.
 return fromPayments || num(t.subPaid) || num(t.amount);
 }

 // Suggested refund = value of the UNUSED part, computed on EVERYTHING the
 // player paid: total paid × (remaining ÷ total). Used days/sessions are kept.
 function refundEstimate(t) {
 const paid = totalPaidByPlayer(t);
 let total, remaining;
 if (t.subType === 'sessions') {
 total = num(t.sessionsTotal);
 remaining = Math.max(0, num(t.sessionsRemaining));
 } else {
 total = num(t.durationDays);
 const left = daysLeft(t);
 remaining = Math.max(0, left == null ? 0 : left);
 }
 if (total <= 0) return 0;
 return Math.max(0, Math.round(paid * Math.min(remaining, total) / total));
 }

 function requestRefund(index) {
 const t = data.trainees[index];
 if (!t) return;
 if (t.refundRequest && t.refundRequest.status === 'معلّق') {
 showNotification('يوجد طلب استرداد معلّق لهذا اللاعب بالفعل', 'warning'); return;
 }
 const paid = totalPaidByPlayer(t);
 const suggested = refundEstimate(t);
 const usedNote = t.subType === 'sessions'
 ? `الحصص المتبقية: ${Math.max(0, num(t.sessionsRemaining))} من ${num(t.sessionsTotal)}`
 : `الأيام المتبقية: ${Math.max(0, daysLeft(t) || 0)} من ${num(t.durationDays)}`;
 openModal(`طلب استرداد - ${t.name}`, `
 <p style="color:rgba(48,56,65,0.6); margin-bottom:8px;">${usedNote} • المدفوع: ${paid.toLocaleString()} ج.م</p>
 <p style="color:rgba(48,56,65,0.6); margin-bottom:14px;">المبلغ المقترح (قيمة غير المستهلك): <strong>${suggested.toLocaleString()} ج.م</strong></p>
 <div class="form-group"><label>المبلغ المراد استرداده (ج.م)</label><input type="number" id="refund-amount" value="${suggested}"></div>
 <div class="form-group"><label>سبب الإلغاء *</label><input type="text" id="refund-reason" placeholder="مثال: سفر / عدم الرضا / ظرف طارئ"></div>
 <div style="display:flex; gap:10px; margin-top:18px;">
 <button class="btn btn-warning" style="flex:1;" onclick="submitRefundRequest(${index})">إرسال الطلب (معلّق)</button>
 <button class="btn btn-outline" style="flex:1;" onclick="closeModal()">إلغاء</button>
 </div>`);
 }

 function submitRefundRequest(index) {
 const t = data.trainees[index];
 if (!t) return;
 const amount = num(document.getElementById('refund-amount').value);
 const reason = document.getElementById('refund-reason').value.trim();
 if (amount <= 0) { showNotification('أدخل مبلغاً صالحاً', 'warning'); return; }
 if (!reason) { showNotification('اكتب سبب الإلغاء', 'warning'); return; }
 t.refundRequest = { amount, reason, sport: sportLabel(t), date: todayAr(), status: 'معلّق' };
 dbSetDoc(traineesCol, t.id, t);
 closeModal();
 updateFinancial();
 updateTraineesTable();
 showNotification('تم إرسال طلب الاسترداد، بانتظار موافقة المدير');
 }

 // Admin approves: book the refund as an expense (reduces profit; the original
 // income stays for an honest history) and cancel the subscription.
 function approveRefund(id) {
 if (currentRole !== 'admin') { showNotification('الموافقة متاحة للمدير فقط', 'danger'); return; }
 const t = data.trainees.find(x => x.id === id);
 if (!t || !t.refundRequest || t.refundRequest.status !== 'معلّق') return;
 const r = t.refundRequest;
 const expense = {
 id: `REF-${Date.now()}`,
 type: 'استرداد',
 desc: `استرداد ${t.name} (${r.sport}) - ${r.reason}`,
 amount: num(r.amount),
 branch: t.branch,
 date: todayAr()
 };
 saveExpense(expense);

 r.status = 'تمت الموافقة';
 r.decidedDate = todayAr();
 t.status = 'منتهي';
 if (t.subType === 'sessions') t.sessionsRemaining = 0; else t.expiryDate = todayISO();
 dbSetDoc(traineesCol, t.id, t);

 updateFinancial();
 updateSalaries();
 updateTraineesTable();
 updateDashboard();
 showNotification(`تمت الموافقة على استرداد ${num(r.amount).toLocaleString()} ج.م لـ ${t.name}`);
 }

 function rejectRefund(id) {
 if (currentRole !== 'admin') { showNotification('القرار متاح للمدير فقط', 'danger'); return; }
 const t = data.trainees.find(x => x.id === id);
 if (!t || !t.refundRequest || t.refundRequest.status !== 'معلّق') return;
 if (!confirm(`رفض طلب استرداد "${t.name}"؟`)) return;
 t.refundRequest.status = 'مرفوض';
 t.refundRequest.decidedDate = todayAr();
 dbSetDoc(traineesCol, t.id, t);
 updateFinancial();
 updateTraineesTable();
 showNotification('تم رفض طلب الاسترداد', 'danger');
 }

 // Red counter on the "تجديد الاشتراكات" sidebar item = number of pending
 // refund requests. Lets the admin notice new requests without opening the
 // section. Hidden when there are none. Aliased to window.updateBadge below so
 // refreshHistoryViews (server.supabase.js) re-runs it on every data refresh.
 function updatePendingRefundsBadge() {
 const badge = document.getElementById('refunds-nav-badge');
 if (!badge) return;
 const count = (data.trainees || []).filter(t => t.refundRequest && t.refundRequest.status === 'معلّق').length;
 badge.textContent = count;
 badge.style.display = count > 0 ? 'inline-flex' : 'none';
 }
 window.updateBadge = updatePendingRefundsBadge;

 // Lists players with a pending refund request (for the admin to decide on).
 function renderRefunds() {
 updatePendingRefundsBadge();
 const tbody = document.getElementById('refunds-list');
 if (!tbody) return;
 const pending = data.trainees.filter(t => t.refundRequest && t.refundRequest.status === 'معلّق');
 if (pending.length === 0) {
 tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:rgba(48,56,65,0.3); padding:20px;">لا توجد طلبات استرداد معلّقة</td></tr>';
 return;
 }
 tbody.innerHTML = pending.map(t => {
 const r = t.refundRequest;
 // Responsible coach + that coach's commission rate (so the admin sees who's
 // accountable and the percentage when deciding). Only the admin gets buttons.
 const coachName = t.trainer || 'غير محدد';
 const coach = (data.employees || []).find(e => e.name === coachName);
 const ratePct = (coach && coach.payType === 'percentage') ? `${num(coach.percentageRate)}%`
 : (coach ? 'راتب ثابت' : '—');
 const actions = currentRole === 'admin'
 ? `<button class="btn btn-success btn-sm" onclick="approveRefund('${esc(t.id)}')">موافقة</button>
 <button class="btn btn-danger btn-sm" onclick="rejectRefund('${esc(t.id)}')">رفض</button>`
 : '<span style="color:rgba(48,56,65,0.4);">بانتظار المدير</span>';
 return `<tr>
 <td><code style="color:var(--gold);font-family:monospace;">${esc(t.id)}</code></td>
 <td>${esc(t.name)}</td>
 <td style="font-size:12px;">${esc(r.sport)}</td>
 <td>${esc(coachName)}</td>
 <td>${esc(ratePct)}</td>
 <td>${esc(r.reason)}</td>
 <td style="font-weight:700;color:var(--danger);">${num(r.amount).toLocaleString()} ج.م</td>
 <td>${actions}</td>
 </tr>`;
 }).join('');
 }

 function printID() {
 const id = document.getElementById('generated-id').textContent;
 const trainee = data.trainees.find(t => t.id === id);
 if (trainee) openCardWindow(trainee);
 else openCardWindow({ id, name: '', codes: [id] });
 }

 // Opens a print window with ONE membership card per CARD CODE the player holds
 // (a multi-sport player has several). Each card shows its own code + QR, and is
 // coloured/labelled by the sport whose number block that code belongs to.
 function openCardWindow(t) {
 const logoUrl = new URL('src/logo-after.png', location.href).href;
 const qrUrl = new URL('vendor/qrcode.min.js', location.href).href;
 const name = t.name || '';
 const codes = traineeCodes(t);
 const list = codes.length ? codes : [''];
 const win = window.open('', '_blank');
 if (!win) { showNotification('فعّل السماح بالنوافذ المنبثقة لطباعة البطاقة', 'warning'); return; }

 const cards = list.map(code => {
 const sport = sportForCode(code) || (traineeSports(t)[0] || '');
 const color = sportColor(sport);
 const planText = (sport === 'جمباز فني' && t.level) ? `${sport} (${t.level})` : sport;
 return `
 <div class="card" style="--c:${color};">
 <div class="card-top">
 <div class="brand">
 <div class="club-name">El Wasl <span>Academy</span></div>
 <div class="club-sub">${planText ? esc(planText) : 'Membership Card'}</div>
 </div>
 <img class="brand-logo" src="${logoUrl}" alt="" onerror="this.style.display='none';">
 </div>
 <div class="divider"></div>
 <div class="card-body">
 <div class="card-info">
 <div class="lbl">الاسم</div>
 <div class="member-name">${esc(name)}</div>
 ${planText ? `<div class="member-plan">${esc(planText)}</div>` : ''}
 <div class="lbl">الكود</div>
 <div class="member-code">${esc(code)}</div>
 </div>
 <div class="qr-box"><div class="qr" data-code="${esc(code)}"></div></div>
 </div>
 <div class="card-footer">يُستخدم هذا الكود لتسجيل الحضور عند الدخول</div>
 </div>`;
 }).join('');

 win.document.write(`
 <html dir="rtl" lang="ar"><head><title>بطاقة العضوية - ${esc(t.id)}</title>
 <meta charset="UTF-8">
 <script src="${qrUrl}"><\/script>
 <style>
 @page { size: 90mm 56mm; margin: 0; }
 * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
 html, body { margin: 0; padding: 0; background: #ffffff; }
 /* One card per page, coloured by its sport via the --c variable. */
 .card {
 position: relative; width: 90mm; height: 56mm; overflow: hidden;
 background:
 radial-gradient(60mm 40mm at 88% 8%, color-mix(in srgb, var(--c) 18%, transparent), transparent 60%),
 linear-gradient(135deg, #1B2433 0%, #243049 60%, #18212f 100%);
 border-radius: 8px; padding: 4.5mm 5mm;
 display: flex; flex-direction: column; justify-content: space-between; color: #E9EDF3;
 page-break-after: always;
 }
 .card::before { content: ''; position: absolute; inset: 1.1mm; border: 0.5mm solid var(--c); border-radius: 6px; pointer-events: none; }
 .card::after { content: ''; position: absolute; top: 0; right: 0; left: 0; height: 1.6mm; background: var(--c); }
 .card-top { display: flex; justify-content: space-between; align-items: center; z-index: 1; }
 .brand { line-height: 1.1; }
 .club-name { font-size: 15px; font-weight: 900; letter-spacing: 1px; color: #ffffff; }
 .club-name span { color: var(--c); }
 .club-sub { font-size: 8px; letter-spacing: 1px; color: var(--c); margin-top: 1.5mm; font-weight: 700; }
 .brand-logo { height: 12mm; width: auto; }
 .divider { height: 0.3mm; background: linear-gradient(90deg, transparent, var(--c), transparent); margin: 1mm 0; z-index: 1; }
 .card-body { display: flex; justify-content: space-between; align-items: center; gap: 4mm; z-index: 1; }
 .card-info { flex: 1; min-width: 0; }
 .lbl { font-size: 6.5px; letter-spacing: 1px; color: rgba(233,237,243,0.5); text-transform: uppercase; }
 .member-name { font-size: 15px; font-weight: 800; color: #ffffff; margin-bottom: 1.5mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
 .member-plan { font-size: 9px; color: var(--c); font-weight: 600; margin-bottom: 2mm; }
 .member-code { font-size: 13px; font-family: 'Courier New', monospace; letter-spacing: 1px; color: #E9EDF3; font-weight: 700; }
 .qr-box { background: #ffffff; padding: 1.2mm; border-radius: 1.5mm; line-height: 0; box-shadow: 0 0 0 0.4mm var(--c); }
 .card-footer { font-size: 6.5px; color: var(--c); text-align: center; letter-spacing: 0.5px; z-index: 1; }
 </style>
 </head>
 <body>
 ${cards}
 <script>
 window.onload = function() {
 function render() {
 if (window.QRCode) {
 document.querySelectorAll('.qr').forEach(function(el) {
 new QRCode(el, { text: el.getAttribute('data-code'), width: 96, height: 96, colorDark: "#1B2433", colorLight: "#ffffff" });
 });
 }
 setTimeout(function() { window.print(); }, 400);
 }
 if (window.QRCode) { render(); }
 else { var s = document.createElement('script'); s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"; s.onload = render; s.onerror = render; document.head.appendChild(s); }
 };
 <\/script>
 </body></html>
 `);
 win.document.close();
 }


 // ==================== BATCH CARD PRINTING (A4 sheets) ====================
 // The single-card windows print one 90x56mm page per card, which forces the
 // print shop to guess an N-up layout (and shrinks the cards). These batch
 // printers instead lay many cards, at their true size, onto A4 pages with
 // light dashed cut guides — so "what they see is what prints". QR is loaded
 // from the local vendor file first (works offline), CDN only as a fallback.

 // A4 page + grid shell shared by both sheet printers.
 const SHEET_BASE_CSS = `
 @page { size: A4; margin: 8mm; }
 * { box-sizing: border-box; margin:0; padding:0; font-family:'Segoe UI',Arial,sans-serif; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
 html, body { background:#fff; }
 .sheet { display:flex; flex-wrap:wrap; gap:4mm; align-content:flex-start; }
 .slot { width:90mm; height:56mm; break-inside:avoid; outline:0.2mm dashed #b0b0b0; }
 `;

 // Player card look (same as the single window, minus the per-card page break).
 const TRAINEE_CARD_CSS = `
 .card { position: relative; width: 90mm; height: 56mm; overflow: hidden; background: radial-gradient(60mm 40mm at 88% 8%, color-mix(in srgb, var(--c) 18%, transparent), transparent 60%), linear-gradient(135deg, #1B2433 0%, #243049 60%, #18212f 100%); border-radius: 8px; padding: 4.5mm 5mm; display: flex; flex-direction: column; justify-content: space-between; color: #E9EDF3; }
 .card::before { content: ''; position: absolute; inset: 1.1mm; border: 0.5mm solid var(--c); border-radius: 6px; pointer-events: none; }
 .card::after { content: ''; position: absolute; top: 0; right: 0; left: 0; height: 1.6mm; background: var(--c); }
 .card-top { display: flex; justify-content: space-between; align-items: center; z-index: 1; }
 .brand { line-height: 1.1; }
 .club-name { font-size: 15px; font-weight: 900; letter-spacing: 1px; color: #ffffff; }
 .club-name span { color: var(--c); }
 .club-sub { font-size: 8px; letter-spacing: 1px; color: var(--c); margin-top: 1.5mm; font-weight: 700; }
 .brand-logo { height: 12mm; width: auto; }
 .divider { height: 0.3mm; background: linear-gradient(90deg, transparent, var(--c), transparent); margin: 1mm 0; z-index: 1; }
 .card-body { display: flex; justify-content: space-between; align-items: center; gap: 4mm; z-index: 1; }
 .card-info { flex: 1; min-width: 0; }
 .lbl { font-size: 6.5px; letter-spacing: 1px; color: rgba(233,237,243,0.5); text-transform: uppercase; }
 .member-name { font-size: 15px; font-weight: 800; color: #ffffff; margin-bottom: 1.5mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
 .member-plan { font-size: 9px; color: var(--c); font-weight: 600; margin-bottom: 2mm; }
 .member-code { font-size: 13px; font-family: 'Courier New', monospace; letter-spacing: 1px; color: #E9EDF3; font-weight: 700; }
 .qr-box { background: #ffffff; padding: 1.2mm; border-radius: 1.5mm; line-height: 0; box-shadow: 0 0 0 0.4mm var(--c); }
 .card-footer { font-size: 6.5px; color: var(--c); text-align: center; letter-spacing: 0.5px; z-index: 1; }
 `;

 // Staff card look (deep-gold accent), colours inlined (constant per staff card).
 const STAFF_CARD_CSS = `
 .scard { position: relative; width: 90mm; height: 56mm; overflow: hidden; background: radial-gradient(60mm 40mm at 88% 8%, #C9A22726, transparent 60%), linear-gradient(135deg, #0E141C 0%, #161D2B 60%, #090C12 100%); border-radius: 8px; padding: 4.5mm 5mm; display: flex; flex-direction: column; justify-content: space-between; color: #E9EDF3; }
 .scard::before { content: ''; position: absolute; inset: 1.1mm; border: 0.5mm solid #C9A227; border-radius: 6px; pointer-events: none; }
 .scard::after { content: ''; position: absolute; top: 0; right: 0; left: 0; height: 1.6mm; background: #C9A227; }
 .s-top { display: flex; justify-content: space-between; align-items: center; z-index: 1; }
 .club-name { font-size: 15px; font-weight: 900; color: #fff; letter-spacing: 1px; }
 .club-name span { color: #C9A227; }
 .club-sub { font-size: 8px; letter-spacing: 2px; color: #C9A227; margin-top: 1.5mm; font-weight: 700; }
 .s-logo { height: 12mm; width: auto; }
 .s-divider { height: 0.3mm; background: linear-gradient(90deg, transparent, #C9A227, transparent); margin: 1mm 0; z-index: 1; }
 .s-body { display: flex; justify-content: space-between; align-items: center; gap: 4mm; z-index: 1; }
 .s-info { flex: 1; min-width: 0; }
 .lbl { font-size: 6.5px; letter-spacing: 1px; color: rgba(233,237,243,0.5); text-transform: uppercase; }
 .s-name { font-size: 15px; font-weight: 800; color: #fff; margin-bottom: 1mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
 .s-role { font-size: 9px; color: #C9A227; font-weight: 600; margin-bottom: 1.5mm; }
 .s-code { font-size: 13px; font-family: 'Courier New', monospace; letter-spacing: 1px; color: #E9EDF3; font-weight: 700; }
 .s-qr { background: #fff; padding: 1.2mm; border-radius: 1.5mm; line-height: 0; box-shadow: 0 0 0 0.4mm #C9A227; }
 .s-footer { font-size: 6.5px; color: #C9A227; text-align: center; letter-spacing: 0.5px; z-index: 1; }
 `;

 // One player card (a single code) as an A4-sheet slot.
 function traineeCardSlot(t, code, logoUrl) {
 const sport = sportForCode(code) || (traineeSports(t)[0] || '');
 const color = sportColor(sport);
 const planText = (sport === 'جمباز فني' && t.level) ? `${sport} (${t.level})` : sport;
 return `<div class="slot"><div class="card" style="--c:${color};">
 <div class="card-top"><div class="brand"><div class="club-name">El Wasl <span>Academy</span></div><div class="club-sub">${planText ? esc(planText) : 'Membership Card'}</div></div><img class="brand-logo" src="${logoUrl}" alt="" onerror="this.style.display='none';"></div>
 <div class="divider"></div>
 <div class="card-body"><div class="card-info"><div class="lbl">الاسم</div><div class="member-name">${esc(t.name || '')}</div>${planText ? `<div class="member-plan">${esc(planText)}</div>` : ''}<div class="lbl">الكود</div><div class="member-code">${esc(code)}</div></div><div class="qr-box"><div class="qr" data-code="${esc(code)}"></div></div></div>
 <div class="card-footer">يُستخدم هذا الكود لتسجيل الحضور عند الدخول</div>
 </div></div>`;
 }

 // One staff card as an A4-sheet slot.
 function staffCardSlot(e, logoUrl) {
 const code = e.code || '';
 return `<div class="slot"><div class="scard">
 <div class="s-top"><div class="scard-brand"><div class="club-name">El Wasl <span>Academy</span></div><div class="club-sub">بطاقة موظف</div></div><img class="s-logo" src="${logoUrl}" alt="" onerror="this.style.display='none'"></div>
 <div class="s-divider"></div>
 <div class="s-body"><div class="s-info"><div class="lbl">الاسم</div><div class="s-name">${esc(e.name)}</div><div class="s-role">${esc(e.role || '-')} • ${esc(e.branch || 'غير محدد')}</div><div class="lbl">الكود</div><div class="s-code">${esc(code)}</div></div><div class="s-qr"><div class="qr" data-code="${esc(code)}"></div></div></div>
 <div class="s-footer">امسح الكود لتسجيل الحضور والانصراف</div>
 </div></div>`;
 }

 // Opens a print window that arranges the given card slots on A4 pages and,
 // once the QR library is ready, renders every QR then triggers print.
 function openCardsSheet(title, cardCss, slotsHtml) {
 const qrUrl = new URL('vendor/qrcode.min.js', location.href).href;
 const win = window.open('', '_blank');
 if (!win) { showNotification('فعّل السماح بالنوافذ المنبثقة للطباعة', 'warning'); return; }
 win.document.write(`
 <html dir="rtl" lang="ar"><head><title>${esc(title)}</title><meta charset="UTF-8">
 <script src="${qrUrl}"><\/script>
 <style>${SHEET_BASE_CSS}${cardCss}</style></head>
 <body><div class="sheet">${slotsHtml}</div>
 <script>
 window.onload = function() {
 function render() {
 if (window.QRCode) document.querySelectorAll('.qr').forEach(function(el){ new QRCode(el, { text: el.getAttribute('data-code'), width: 96, height: 96, colorDark: "#1B2433", colorLight: "#ffffff" }); });
 setTimeout(function(){ window.print(); }, 500);
 }
 if (window.QRCode) render();
 else { var s = document.createElement('script'); s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"; s.onload = render; s.onerror = render; document.head.appendChild(s); }
 };
 <\/script>
 </body></html>`);
 win.document.close();
 }

 // Print every active player's card(s) on A4 sheets (optionally one branch).
 function printTraineeCardsSheet(branch) {
 const logoUrl = new URL('src/logo-after.png', location.href).href;
 const list = data.trainees.filter(t => t.type === 'subscription' && (!branch || (t.branch || '') === branch));
 const slots = [];
 list.forEach(t => traineeCodes(t).forEach(code => { if (code) slots.push(traineeCardSlot(t, code, logoUrl)); }));
 if (!slots.length) { showNotification('لا توجد كروت لاعبين للطباعة', 'warning'); return; }
 openCardsSheet('كروت اللاعبين', TRAINEE_CARD_CSS, slots.join(''));
 }

 // Print every staff member's card on A4 sheets (optionally one branch).
 function printStaffCardsSheet(branch) {
 ensureStaffCodes();
 const logoUrl = new URL('src/logo-after.png', location.href).href;
 const list = (data.employees || []).filter(e => e.code && (!branch || (e.branch || '') === branch));
 if (!list.length) { showNotification('لا توجد كروت موظفين للطباعة (تأكد من وجود أكواد)', 'warning'); return; }
 openCardsSheet('كروت الموظفين', STAFF_CARD_CSS, list.map(e => staffCardSlot(e, logoUrl)).join(''));
 }

 // ==================== ATTENDANCE ====================
 // Auto-submit: as soon as the entered/scanned code exactly matches a known
 // trainee, register the attendance — no need to press the button or scan.
 let attendanceInputTimer = null;
 function onAttendanceInput() {
 clearTimeout(attendanceInputTimer);
 attendanceInputTimer = setTimeout(() => {
 const cur = document.getElementById('attendance-code').value.trim();
 if (cur && findTraineeByCode(cur)) {
 recordAttendance();
 }
 }, 150);
 }

 function recordAttendance() {
 const raw = document.getElementById('attendance-code').value.trim();

 if (!raw) {
 showNotification('يرجى إدخال كود اللاعب', 'warning');
 return;
 }

 const trainee = findTraineeByCode(raw);
 if (!trainee) {
 renderAttendanceCard(null, null, { state: 'notfound', code: raw });
 return;
 }
 const code = trainee.id; // canonical stored id for this player
 // Which sport this check-in is for: derived from the SCANNED code's number
 // block, falling back to the player's primary sport.
 const attendedSport = sportForCode(raw) || (traineeSports(trainee)[0] || '');

 const info = subInfo(trainee);

 // Frozen subscription -> paused, entry not allowed.
 if (trainee.frozen) {
 renderAttendanceCard(trainee, info, { state: 'frozen' });
 document.getElementById('attendance-code').value = '';
 return;
 }

 // Expired subscription -> entry forbidden, nothing is recorded.
 if (trainee.type === 'subscription' && info.expired) {
 renderAttendanceCard(trainee, info, { state: 'blocked' });
 document.getElementById('attendance-code').value = '';
 return;
 }

 // Already checked in for THIS sport today -> don't record again (a multi-sport
 // player can still check in for a different sport on the same day).
 const today = todayAr();
 const alreadyCheckedIn = data.attendance.some(a => a.id === code && a.date === today && (a.sport || '') === attendedSport);
 if (alreadyCheckedIn) {
 renderAttendanceCard(trainee, info, { state: 'already', sport: attendedSport });
 document.getElementById('attendance-code').value = '';
 return;
 }

 // Detect a comeback after a long absence (measured BEFORE adding today's record).
 const absBefore = lastAttendanceInfo(trainee);
 const returnedAfter = (!absBefore.neverAttended && absBefore.days >= ABSENCE_ALERT_DAYS) ? absBefore.days : 0;

 const now = new Date();
 const time = now.toLocaleTimeString('ar-EG');
 const attendanceEntry = { id: code, name: trainee.name, date: today, time, status: 'حاضر', branch: trainee.branch || 'غير محدد', sport: attendedSport, code: raw };
 data.attendance.push(attendanceEntry);
 dbAddDoc(attendanceCol, attendanceEntry);

 // Consume one session for session-based subscriptions.
 if (trainee.type === 'subscription' && info.kind === 'sessions') {
 trainee.sessionsRemaining = num(trainee.sessionsRemaining) - 1;
 if (trainee.sessionsRemaining <= 0) trainee.status = 'منتهي';
 dbSetDoc(traineesCol, trainee.id, trainee);
 }

 const after = subInfo(trainee);
 renderAttendanceCard(trainee, after, { state: 'recorded', time, returnedAfter, sport: attendedSport });

 document.getElementById('attendance-code').value = '';
 updateAttendanceLog();
 updateTraineesTable();
 updateDashboard();
 showNotification(`تم تسجيل حضور ${trainee.name}${attendedSport ? ' - ' + attendedSport : ''}`);
 }

 // Builds a small info row for the attendance result card.
 function attRow(label, value) {
 return `<div style="background:rgba(48,56,65,0.04);border-radius:8px;padding:8px 10px;text-align:right;">
 <div style="font-size:11px;color:rgba(48,56,65,0.5);">${esc(label)}</div>
 <div style="font-weight:700;font-size:14px;">${esc(value)}</div>
 </div>`;
 }

 // Renders the full attendance result: trainee details + a status alert.
 function renderAttendanceCard(t, info, opts) {
 const resultDiv = document.getElementById('attendance-result');

 if (opts.state === 'notfound') {
 resultDiv.className = 'attendance-result error';
 resultDiv.innerHTML = `
 <div style="font-size:18px;font-weight:800;color:var(--danger);">كود غير موجود!</div>
 <div style="font-size:13px;color:rgba(48,56,65,0.6);margin-top:6px;">الكود "${esc(opts.code)}" غير مسجل في النظام</div>`;
 return;
 }

 resultDiv.className = 'attendance-result ' + (opts.state === 'blocked' || opts.state === 'frozen' ? 'error' : 'success');

 const typeLabel = info.kind === 'sessions' ? 'بالحصص' : info.kind === 'days' ? 'بالأيام' : '—';
 const details = `
 <div style="font-size:20px;font-weight:800;margin-bottom:4px;">${esc(t.name)}</div>
 <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;">
 ${attRow('الكود', t.id)}
 ${attRow('الرياضة', sportLabel(t))}
 ${attRow('المدرب', t.trainer || 'غير محدد')}
 ${attRow('الفرع', t.branch || 'غير محدد')}
 ${attRow('نوع الاشتراك', typeLabel)}
 ${attRow('المتبقي', info.remLabel || '—')}
 ${info.kind === 'days' ? attRow('تاريخ الانتهاء', t.expiryDate || '-') : ''}
 </div>`;

 let alert = '';
 if (opts.state === 'frozen') {
 alert = `<div class="att-alert att-alert-danger">❄️ الاشتراك مجمّد مؤقتاً — لا يمكن تسجيل الحضور.${t.freezeReason ? '<br>السبب: ' + esc(t.freezeReason) : ''}</div>`;
 } else if (opts.state === 'blocked') {
 alert = `<div class="att-alert att-alert-danger">⛔ ممنوع من الدخول — الاشتراك منتهي.<br>برجاء تجديد الاشتراك قبل الدخول.</div>`;
 } else if (opts.state === 'already') {
 alert = `<div class="att-alert att-alert-info">تم تسجيل حضور هذا اللاعب${opts.sport ? ' في ' + esc(opts.sport) : ''} مسبقاً اليوم.</div>`;
 if (info.near) alert += `<div class="att-alert att-alert-warning">⚠️ الاشتراك قارب على الانتهاء (${esc(info.remLabel)}). برجاء التجديد.</div>`;
 } else {
 alert = `<div class="att-alert att-alert-success">✅ تم تسجيل الحضور${opts.sport ? ' في ' + esc(opts.sport) : ''} بنجاح${opts.time ? ' - ' + esc(opts.time) : ''}.</div>`;
 if (opts.returnedAfter) alert += `<div class="att-alert att-alert-info">👋 عاد بعد انقطاع ${opts.returnedAfter} يوم — أهلاً بعودته!</div>`;
 if (info.expired) alert += `<div class="att-alert att-alert-warning">⚠️ تم استهلاك آخر حصة في الاشتراك. برجاء التجديد قبل الحضور القادم.</div>`;
 else if (info.near) alert += `<div class="att-alert att-alert-warning">⚠️ الاشتراك قارب على الانتهاء (${esc(info.remLabel)}). برجاء تجديد الاشتراك.</div>`;
 }

 // Offer a one-click renewal whenever the subscription is expired or close.
 const renewBtn = (info.expired || info.near)
 ? `<button class="btn btn-warning" style="width:100%; margin-top:10px;" onclick="goRenew('${esc(t.id)}')">تجديد الاشتراك الآن</button>`
 : '';

 resultDiv.innerHTML = details + alert + renewBtn;
 }

 function updateAttendanceLog() {
 const today = todayAr();
 const todayAttendance = data.attendance.filter(a => a.date === today);

 document.getElementById('today-present').textContent = todayAttendance.length;

 const totalActive = data.trainees.filter(t => t.status === 'نشط').length;
 const absent = Math.max(0, totalActive - todayAttendance.length);
 document.getElementById('today-absent').textContent = absent;

 const rate = totalActive > 0 ? Math.round((todayAttendance.length / totalActive) * 100) : 0;
 document.getElementById('attendance-rate').textContent = `${rate}%`;

 const tbody = document.getElementById('attendance-log');
 if (todayAttendance.length === 0) {
 tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: rgba(48,56,65,0.3); padding: 30px;">لا توجد سجلات حضور لليوم</td></tr>';
 return;
 }

 tbody.innerHTML = todayAttendance.map((a, i) => `
 <tr>
 <td>${i + 1}</td>
 <td><code style="color: var(--gold); font-family: monospace;">${esc(a.id)}</code></td>
 <td>${esc(a.name)}</td>
 <td>${esc(a.time)}</td>
 <td><span class="badge badge-success">حاضر</span></td>
 </tr>
 `).join('');
 }

 // ==================== FINANCIAL ====================
 function searchTraineeForRenewal() {
 const trainee = findTraineeByCode(document.getElementById('renew-code').value);
 document.getElementById('renew-name').value = trainee ? trainee.name : '';
 // Adapt the duration field's label to the trainee's subscription type.
 const label = document.getElementById('renew-duration-label');
 if (label) {
 label.textContent = (trainee && trainee.subType === 'sessions')
 ? 'عدد الحصص المضافة'
 : 'مدة التجديد (بالأيام)';
 }
 }

 function renewSubscription() {
 const rawCode = val('renew-code').trim();
 const duration = val('renew-duration') || 30;
 const amount = val('renew-amount');
 const method = val('renew-method');
 const branch = val('renew-branch');
 const date = val('renew-date');

 if (!rawCode || !amount || !branch) {
 showNotification('يرجى ملء جميع البيانات', 'warning');
 return;
 }

 const trainee = findTraineeByCode(rawCode);
 if (!trainee) {
 showNotification('الكود غير موجود', 'danger');
 return;
 }

 const today = todayAr();

 addPayment({
 id: trainee.id,
 name: trainee.name,
 type: 'تجديد',
 plan: trainee.sport || trainee.plan,
 amount: parseInt(amount),
 method,
 date: date || today,
 status: 'مكتمل',
 branch: branch
 });

 if (trainee.subType === 'sessions') {
 // Add the entered number of sessions to the remaining balance.
 const add = parseInt(duration) || 0;
 trainee.sessionsTotal = num(trainee.sessionsTotal) + add;
 trainee.sessionsRemaining = num(trainee.sessionsRemaining) + add;
 } else {
 // Extend from current expiry if still active, otherwise from today.
 const base = (trainee.expiryDate && new Date(trainee.expiryDate) > new Date()) ? trainee.expiryDate : todayISO();
 trainee.expiryDate = addDays(base, duration);
 trainee.durationDays = parseInt(duration);
 }
 trainee.status = 'نشط';
 // New period starts fully paid (renewal amount), clearing any old balance.
 trainee.subTotal = parseInt(amount);
 trainee.subPaid = parseInt(amount);
 dbSetDoc(traineesCol, trainee.id, trainee);
 updateFinancial();
 updateTraineesTable();
 updateDashboard();

 setVal('renew-code', ''); setVal('renew-name', ''); setVal('renew-amount', '');

 showNotification(`تم تجديد اشتراك ${trainee.name} بنجاح!`);
 }

 function updateFinancial() {
 const totalIncome = data.payments.reduce((sum, p) => sum + num(p.amount), 0);
 const totalExpenses = data.expenses.reduce((sum, e) => sum + num(e.amount), 0);

 document.getElementById('fin-income').textContent = `${totalIncome.toLocaleString()} ج.م`;
 document.getElementById('fin-expenses').textContent = `${totalExpenses.toLocaleString()} ج.م`;
 document.getElementById('fin-profit').textContent = `${(totalIncome - totalExpenses).toLocaleString()} ج.م`;

 renderRefunds(); // pending refund requests live in the financial section too

 const tbody = document.getElementById('payments-table');
 if (data.payments.length === 0) {
 tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; color: rgba(48,56,65,0.3); padding: 30px;">لا توجد مدفوعات مسجلة</td></tr>';
 return;
 }

 tbody.innerHTML = data.payments.map(p => {
 const actions = currentRole === 'admin' && p._docId ? `
 <button class="btn btn-outline btn-sm" onclick="editPayment('${esc(p._docId)}')">تعديل</button>
 <button class="btn btn-danger btn-sm" onclick="deletePayment('${esc(p._docId)}')">حذف</button>` : '—';
 return `
 <tr>
 <td><code style="color: var(--gold); font-family: monospace;">${esc(p.id)}</code></td>
 <td>${esc(p.name)}</td>
 <td><span class="badge ${p.type === 'تجديد' ? 'badge-info' : 'badge-success'}">${esc(p.type)}</span></td>
 <td style="font-size: 12px;">${esc(p.plan)}</td>
 <td>${branchBadge(p.branch)}</td>
 <td style="color: var(--success); font-weight: 700;">${num(p.amount).toLocaleString()} ج.م</td>
 <td>${esc(p.method)}</td>
 <td>${esc(p.date)}</td>
 <td><span class="badge badge-success">${esc(p.status)}</span></td>
 <td style="font-size:11px; color:rgba(48,56,65,0.55);">${esc(p.createdBy || '—')}</td>
 <td>${actions}</td>
 </tr>
 `;
 }).join('');
 }

 // ==================== SALARIES ====================
 function addEmployee() {
 const name = val('emp-name').trim();
 const role = val('emp-role');
 const salary = val('emp-salary');
 const branch = val('emp-branch');

 if (!name || !salary || !branch) {
 showNotification('يرجى ملء جميع البيانات', 'warning');
 return;
 }

 const employee = {
 id: `EMP-${Date.now()}`,
 code: generateStaffCode(),
 name,
 role,
 salary: parseInt(salary),
 branch: branch,
 status: 'نشط',
 joinDate: todayAr()
 };
 data.employees.push(employee);
 dbSetDoc(employeesCol, employee.id, employee);
 updateSalaries();

 setVal('emp-name', ''); setVal('emp-salary', '');
 showNotification(`تم إضافة ${name} بنجاح!`);
 }

 function addExpense() {
 const type = val('expense-type');
 const desc = val('expense-desc');
 const amount = val('expense-amount');
 const branch = val('expense-branch');

 if (!amount || !branch) {
 showNotification('يرجى ملء جميع البيانات', 'warning');
 return;
 }

 const expense = {
 id: `EXP-${Date.now()}`,
 type,
 desc,
 amount: parseInt(amount),
 branch: branch,
 date: todayAr()
 };
 saveExpense(expense);
 updateSalaries();
 updateFinancial();

 setVal('expense-desc', ''); setVal('expense-amount', '');
 showNotification('تم تسجيل المصروف بنجاح!');
 }

 function updateSalaries() {
 const empTbody = document.getElementById('employees-table');
 // Coaches have their own dedicated section, so exclude them here. Keep the
 // original index so paySalary/deleteEmployee still point to the right record.
 const nonCoaches = data.employees.map((e, i) => ({ e, i })).filter(x => !(x.e.role && x.e.role.indexOf('مدرب') !== -1));
  if (nonCoaches.length === 0) {
  empTbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color: rgba(48,56,65,0.3); padding: 30px;">لا يوجد موظفون مسجلون</td></tr>';
  } else {
 empTbody.innerHTML = nonCoaches.map(({ e, i }, rowNum) => `
 <tr>
 <td>${rowNum + 1}</td>
 <td><strong>${esc(e.name)}</strong></td>
  <td>${esc(e.role)}</td>
  <td>${branchBadge(e.branch)}</td>
  <td style="color: var(--warning); font-weight: 700;">${num(e.salary).toLocaleString()} ج.م</td>
 <td><span class="badge badge-success">${esc(e.status)}</span></td>
 <td style="font-size:11px; color:rgba(48,56,65,0.55);">${esc(e.createdBy || '—')}</td>
 <td>
 <button class="btn btn-success btn-sm" onclick="paySalary(${i})">صرف</button>
 <button class="btn btn-warning btn-sm" onclick="openStaffAdvance('${esc(e.id)}')">سلفة</button>
 <button class="btn btn-warning btn-sm" onclick="openStaffDeduction('${esc(e.id)}')">خصم</button>
 <button class="btn btn-danger btn-sm" onclick="deleteEmployee(${i})">حذف</button>
 </td>
 </tr>
 `).join('');
 }

 const expTbody = document.getElementById('expenses-table');
 if (data.expenses.length === 0) {
 expTbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color: rgba(48,56,65,0.3); padding: 30px;">لا توجد مصروفات مسجلة</td></tr>';
 } else {
 expTbody.innerHTML = data.expenses.map((e, i) => `
 <tr>
 <td>${i + 1}</td>
 <td><span class="badge badge-warning">${esc(e.type)}</span></td>
 <td>${esc(e.desc || '-')}</td>
 <td>${branchBadge(e.branch)}</td>
 <td style="color: ${num(e.amount) < 0 ? 'var(--success)' : 'var(--danger)'}; font-weight: 700;">${num(e.amount).toLocaleString()} ج.م</td>
 <td>${esc(e.date)}</td>
 <td style="font-size:11px; color:rgba(48,56,65,0.55);">${esc(e.createdBy || '—')}</td>
 <td>
 <button class="btn btn-outline btn-sm" onclick="editExpense('${esc(e.id)}')">تعديل</button>
 <button class="btn btn-danger btn-sm" onclick="deleteExpense('${esc(e.id)}')">حذف</button>
 </td>
 </tr>
 `).join('');
 }
 }

 // Opens a styled confirmation popup (not a native confirm dialog).
 function paySalary(index) {
 const emp = data.employees[index];
 if (!emp) return;
 openModal(`صرف راتب - ${emp.name}`, `
 <p style="margin-bottom:18px; font-size:15px;">تأكيد صرف راتب <strong>${esc(emp.name)}</strong> بمبلغ <strong style="color:var(--warning);">${num(emp.salary).toLocaleString()} ج.م</strong>؟</p>
 <div style="display:flex; gap:10px;">
 <button class="btn btn-success" style="flex:1;" onclick="doPaySalary(${index})">تأكيد الصرف</button>
 <button class="btn btn-outline" style="flex:1;" onclick="closeModal()">إلغاء</button>
 </div>
 `);
 }

 function doPaySalary(index) {
 const emp = data.employees[index];
 if (!emp) return;
 const today = todayAr();
 const expense = {
 id: `SAL-${Date.now()}`,
 type: 'مرتب',
 desc: `راتب ${emp.name} (${emp.role})`,
 amount: emp.salary,
 branch: emp.branch,
 date: today,
 staffId: emp.id
 };
 saveExpense(expense);
 updateSalaries();
 updateFinancial();
 updateReports();
 closeModal();
 showNotification(`تم صرف راتب ${emp.name}: ${num(emp.salary).toLocaleString()} ج.م`);
 }

 function deleteEmployee(index) {
 if (confirm('هل تريد حذف هذا الموظف؟')) {
 const emp = data.employees[index];
 data.employees.splice(index, 1);
 dbDeleteDoc(employeesCol, emp.id);
 updateSalaries();
 }
 }

 // ==================== EDIT / DELETE FINANCIAL RECORDS ====================
 // Editing/deleting payments and expenses is restricted to admins, both in
 // the UI here and enforced server-side by Supabase row-level security.

 function deletePayment(docId) {
 if (currentRole !== 'admin') return;
 const p = data.payments.find(x => x._docId === docId);
 if (!p) return;
 if (!confirm(`حذف عملية الدفع لـ "${p.name}" بمبلغ ${num(p.amount).toLocaleString()} ج.م؟`)) return;
 data.payments = data.payments.filter(x => x._docId !== docId);
 dbDeleteDoc(paymentsCol, docId);
 updateFinancial();
 updateDashboard();
 showNotification('تم حذف عملية الدفع', 'danger');
 }

 function editPayment(docId) {
 if (currentRole !== 'admin') return;
 const p = data.payments.find(x => x._docId === docId);
 if (!p) return;
 openModal(`تعديل عملية دفع - ${p.name}`, `
 <div class="form-grid">
 <div class="form-group">
 <label>المبلغ المدفوع (ج.م)</label>
 <input type="number" id="edit-pay-amount" value="${esc(num(p.amount))}">
 </div>
 <div class="form-group">
 <label>طريقة الدفع</label>
 <select id="edit-pay-method">
 <option ${p.method === 'نقداً' ? 'selected' : ''}>نقداً</option>
 <option ${p.method === 'تحويل بنكي' ? 'selected' : ''}>تحويل بنكي</option>
 <option ${p.method === 'فودافون كاش' ? 'selected' : ''}>فودافون كاش</option>
 <option ${p.method === 'انستا باي' ? 'selected' : ''}>انستا باي</option>
 </select>
 </div>
 <div class="form-group">
 <label>التاريخ</label>
 <input type="text" id="edit-pay-date" value="${esc(p.date)}">
 </div>
 </div>
 <button class="btn btn-primary" style="margin-top: 20px; width: 100%;" onclick="savePaymentEdit('${esc(docId)}')">حفظ التعديلات</button>
 `);
 }

 function savePaymentEdit(docId) {
 if (currentRole !== 'admin') return;
 const p = data.payments.find(x => x._docId === docId);
 if (!p) return;
 p.amount = num(document.getElementById('edit-pay-amount').value);
 p.method = document.getElementById('edit-pay-method').value;
 p.date = document.getElementById('edit-pay-date').value.trim() || p.date;
 dbSetDoc(paymentsCol, docId, p);
 closeModal();
 updateFinancial();
 updateDashboard();
 showNotification('تم تعديل عملية الدفع');
 }

 function deleteExpense(id) {
 if (currentRole !== 'admin') return;
 const e = data.expenses.find(x => x.id === id);
 if (!e) return;
 if (!confirm(`حذف هذا المصروف "${e.type}" بمبلغ ${num(e.amount).toLocaleString()} ج.م؟`)) return;
 data.expenses = data.expenses.filter(x => x.id !== id);
 dbDeleteDoc(expensesCol, id);
 updateSalaries();
 updateFinancial();
 updateReports();
 showNotification('تم حذف المصروف', 'danger');
 }

 function editExpense(id) {
 if (currentRole !== 'admin') return;
 const e = data.expenses.find(x => x.id === id);
 if (!e) return;
 openModal(`تعديل مصروف`, `
 <div class="form-grid">
 <div class="form-group">
 <label>الوصف</label>
 <input type="text" id="edit-exp-desc" value="${esc(e.desc || '')}">
 </div>
 <div class="form-group">
 <label>المبلغ (ج.م)</label>
 <input type="number" id="edit-exp-amount" value="${esc(num(e.amount))}">
 </div>
 <div class="form-group">
 <label>التاريخ</label>
 <input type="text" id="edit-exp-date" value="${esc(e.date)}">
 </div>
 </div>
 <button class="btn btn-primary" style="margin-top: 20px; width: 100%;" onclick="saveExpenseEdit('${esc(id)}')">حفظ التعديلات</button>
 `);
 }

 function saveExpenseEdit(id) {
 if (currentRole !== 'admin') return;
 const e = data.expenses.find(x => x.id === id);
 if (!e) return;
 e.desc = document.getElementById('edit-exp-desc').value.trim();
 e.amount = num(document.getElementById('edit-exp-amount').value);
 e.date = document.getElementById('edit-exp-date').value.trim() || e.date;
 dbSetDoc(expensesCol, id, e);
 closeModal();
 updateSalaries();
 updateFinancial();
 updateReports();
 showNotification('تم تعديل المصروف');
 }

 // ==================== GROUPS & COACHES ====================
 // Coaches are simply the employees whose role mentions "مدرب".
 function getCoaches() {
 return (data.employees || []).filter(e => e.role && e.role.indexOf('مدرب') !== -1);
 }

 // Jump to the renewal form with the trainee's code pre-filled.
 function goRenew(code) {
 closeModal();
 showSection('financial');
 const input = document.getElementById('renew-code');
 if (input) {
 input.value = code;
 searchTraineeForRenewal();
 input.scrollIntoView({ behavior: 'smooth', block: 'center' });
 }
 }

 function renderGroups() {
 populateGroupTrainerSelect();
 renderStudentAlerts();

 const wrap = document.getElementById('groups-list');
 const groups = data.groups || [];
 if (groups.length === 0) {
 wrap.innerHTML = '<p style="color:rgba(48,56,65,0.4); padding:20px; text-align:center;">لا توجد جروبات بعد — أنشئ أول جروب من الأعلى</p>';
 return;
 }
 wrap.innerHTML = groups.map(g => {
 const count = (g.memberIds || []).length;
 return `
 <div class="group-card">
 <div class="group-card-head">
 <div class="group-card-name">${esc(g.name)}</div>
 ${branchBadge(g.branch)}
 </div>
 <div class="group-card-meta">المدرب: <strong>${esc(g.trainer || 'غير محدد')}</strong> • ${count} لاعب</div>
 <div style="display:flex; gap:8px; margin-top:14px;">
 <button class="btn btn-primary btn-sm" onclick="openGroup('${esc(g._docId)}')">إدارة وتحضير</button>
 <button class="btn btn-danger btn-sm" onclick="deleteGroup('${esc(g._docId)}')">حذف</button>
 </div>
 </div>`;
 }).join('');
 }

 // All student-related alerts in one place: expired subscriptions, ones about
 // to expire, and players who stopped coming. One row per student, with the
 // relevant badges plus quick renew/view actions.
 function renderStudentAlerts() {
 const box = document.getElementById('student-alerts');
 if (!box) return;

 const byTrainee = new Map();
 const add = (t, label, cls, renewable) => {
 if (!byTrainee.has(t.id)) byTrainee.set(t.id, { t, badges: [], renew: false });
 const entry = byTrainee.get(t.id);
 entry.badges.push({ label, cls });
 if (renewable) entry.renew = true;
 };

 data.trainees.forEach(t => {
 if (t.type !== 'subscription') return;
 const info = subInfo(t);
 if (info.expired) add(t, 'منتهي الاشتراك', 'badge-danger', true);
 else if (info.near) add(t, `قارب على الانتهاء (${info.label})`, 'badge-warning', true);
 });
 getAbsentees().forEach(({ t, info }) => add(t, `غائب منذ ${info.days} يوم`, 'badge-danger', false));

 const items = [...byTrainee.values()];
 if (items.length === 0) {
 box.innerHTML = '<p style="color:rgba(48,56,65,0.4); padding:12px;">لا توجد تنبيهات حالياً ✅</p>';
 return;
 }

 box.innerHTML = items.map(({ t, badges, renew }) => {
 const idx = data.trainees.indexOf(t);
 const badgeHtml = badges.map(b => `<span class="badge ${b.cls}">${esc(b.label)}</span>`).join(' ');
 const renewBtn = renew ? `<button class="btn btn-warning btn-sm" onclick="goRenew('${esc(t.id)}')">تجديد</button>` : '';
 return `
 <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 14px; background:rgba(48,56,65,0.03); border-radius:10px; flex-wrap:wrap;">
 <div>
 <strong>${esc(t.name)}</strong>
 <span style="font-size:12px; color:rgba(48,56,65,0.5);">${esc(t.id)}</span>
 </div>
 <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
 ${badgeHtml}
 ${renewBtn}
 <button class="btn btn-outline btn-sm" onclick="viewTrainee(${idx})">عرض</button>
 </div>
 </div>`;
 }).join('');
 }

 function populateGroupTrainerSelect() {
 const sel = document.getElementById('group-trainer');
 if (!sel) return;
 const coaches = getCoaches();
 sel.innerHTML = coaches.length
 ? coaches.map(c => `<option value="${esc(c.name)}">${esc(c.name)} (${esc(c.role)})</option>`).join('')
 : '<option value="">— أضف مدربين من قسم الشؤون المالية أولاً —</option>';
 }

 function createGroup() {
 const name = document.getElementById('group-name').value.trim();
 const trainer = document.getElementById('group-trainer').value;
 const branch = document.getElementById('group-branch').value;
 if (!name) { showNotification('يرجى إدخال اسم الجروب', 'warning'); return; }
 if (!branch) { showNotification('يرجى اختيار الفرع', 'warning'); return; }

 const docId = genDocId('GRP');
 const group = {
 _docId: docId,
 id: docId,
 name,
 trainer: trainer || 'غير محدد',
 branch,
 memberIds: [],
 createdDate: todayAr()
 };
 data.groups.push(group);
 dbSetDoc(groupsCol, docId, group);

 document.getElementById('group-name').value = '';
 renderGroups();
 showNotification(`تم إنشاء جروب "${name}"`);
 }

 function deleteGroup(groupId) {
 const g = (data.groups || []).find(x => x._docId === groupId);
 if (!g) return;
 if (!confirm(`حذف جروب "${g.name}"؟\n(اللاعبون أنفسهم لن يُحذفوا، فقط الجروب)`)) return;
 data.groups = data.groups.filter(x => x._docId !== groupId);
 dbDeleteDoc(groupsCol, groupId);
 renderGroups();
 showNotification('تم حذف الجروب', 'danger');
 }

 // Modal to manage a group's members and take group attendance.
 function openGroup(groupId) {
 const g = (data.groups || []).find(x => x._docId === groupId);
 if (!g) return;
 g.memberIds = g.memberIds || [];

 const members = g.memberIds.map(id => data.trainees.find(t => t.id === id)).filter(Boolean);
 const nonMembers = data.trainees.filter(t => !g.memberIds.includes(t.id));
 const addOptions = nonMembers.length
 ? '<option value="">اختر لاعباً لإضافته...</option>' + nonMembers.map(t => `<option value="${esc(t.id)}">${esc(t.id)} — ${esc(t.name)}</option>`).join('')
 : '<option value="">لا يوجد لاعبون متاحون للإضافة</option>';

 const rows = members.length ? members.map(t => {
 const info = subInfo(t);
 const badge = info.expired
 ? '<span class="badge badge-danger">منتهي</span>'
 : info.near
 ? `<span class="badge badge-warning">${esc(info.label)}</span>`
 : `<span class="badge badge-success">${esc(info.label)}</span>`;
 const renewBtn = (info.expired || info.near)
 ? `<button class="btn btn-warning btn-sm" onclick="goRenew('${esc(t.id)}')">تجديد</button>` : '';
 return `
 <tr>
 <td style="text-align:center;"><input type="checkbox" id="grp-present-${esc(t.id)}" ${info.expired ? 'disabled' : 'checked'} style="width:18px; height:18px;"></td>
 <td><code style="color: var(--gold); font-family: monospace;">${esc(t.id)}</code></td>
 <td>${esc(t.name)}</td>
 <td>${badge}</td>
 <td>${renewBtn}<button class="btn btn-outline btn-sm" onclick="removeMemberFromGroup('${esc(g._docId)}','${esc(t.id)}')">إزالة</button></td>
 </tr>`;
 }).join('') : '<tr><td colspan="5" style="text-align:center; color:rgba(48,56,65,0.4); padding:20px;">لا يوجد لاعبون في الجروب بعد</td></tr>';

 openModal(`جروب: ${g.name}`, `
 <div style="margin-bottom:14px; color:rgba(48,56,65,0.6);">المدرب: <strong>${esc(g.trainer || 'غير محدد')}</strong> • الفرع: ${esc(g.branch || 'غير محدد')}</div>
 <div style="display:flex; gap:8px; margin-bottom:16px;">
 <select id="group-add-select" style="flex:1; padding:9px 12px; border-radius:8px; border:1px solid var(--secondary);">${addOptions}</select>
 <button class="btn btn-primary btn-sm" onclick="addMemberToGroup('${esc(g._docId)}')">إضافة لاعب</button>
 </div>
 <div class="table-container">
 <table>
 <thead><tr><th>حاضر</th><th>الكود</th><th>الاسم</th><th>الاشتراك</th><th>إجراءات</th></tr></thead>
 <tbody>${rows}</tbody>
 </table>
 </div>
 <p style="font-size:12px; color:rgba(48,56,65,0.5); margin-top:10px;">أزل علامة "حاضر" عن أي لاعب لتسجيله غائباً. اللاعب منتهي الاشتراك لا يمكن تحضيره.</p>
 <button class="btn btn-success" style="width:100%; margin-top:12px;" onclick="recordGroupAttendance('${esc(g._docId)}')">تسجيل حضور الجروب</button>
 `);
 }

 function addMemberToGroup(groupId) {
 const g = (data.groups || []).find(x => x._docId === groupId);
 if (!g) return;
 const code = document.getElementById('group-add-select').value;
 if (!code) return;
 g.memberIds = g.memberIds || [];
 if (!g.memberIds.includes(code)) {
 g.memberIds.push(code);
 dbSetDoc(groupsCol, g._docId, g);
 }
 openGroup(groupId);
 renderGroups();
 }

 function removeMemberFromGroup(groupId, code) {
 const g = (data.groups || []).find(x => x._docId === groupId);
 if (!g) return;
 g.memberIds = (g.memberIds || []).filter(id => id !== code);
 dbSetDoc(groupsCol, g._docId, g);
 openGroup(groupId);
 renderGroups();
 }

 // Records attendance for every "present"-checked member at once. Skips
 // members already checked in today and blocks expired subscriptions.
 function recordGroupAttendance(groupId) {
 const g = (data.groups || []).find(x => x._docId === groupId);
 if (!g) return;
 const today = todayAr();
 let present = 0, absent = 0, blocked = 0, dup = 0;

 (g.memberIds || []).forEach(mid => {
 const t = data.trainees.find(x => x.id === mid);
 if (!t) return;
 const cb = document.getElementById(`grp-present-${mid}`);
 const isPresent = cb ? cb.checked : false;
 const info = subInfo(t);

 if (t.type === 'subscription' && info.expired) { blocked++; return; }
 if (!isPresent) { absent++; return; }
 if (data.attendance.some(a => a.id === mid && a.date === today)) { dup++; return; }

 const time = new Date().toLocaleTimeString('ar-EG');
 const entry = { id: mid, name: t.name, date: today, time, status: 'حاضر', branch: t.branch || 'غير محدد' };
 data.attendance.push(entry);
 dbAddDoc(attendanceCol, entry);

 if (t.type === 'subscription' && info.kind === 'sessions') {
 t.sessionsRemaining = num(t.sessionsRemaining) - 1;
 if (t.sessionsRemaining <= 0) t.status = 'منتهي';
 dbSetDoc(traineesCol, t.id, t);
 }
 present++;
 });

 updateAttendanceLog();
 updateTraineesTable();
 updateDashboard();
 openGroup(groupId);

 let msg = `تم تحضير الجروب: ${present} حاضر، ${absent} غياب`;
 if (blocked) msg += `، ${blocked} منتهي الاشتراك`;
 if (dup) msg += `، ${dup} مسجّل مسبقاً`;
 showNotification(msg);
 }

 // ==================== COACHES MANAGEMENT ====================
 // Coaches are stored in the employees collection (role contains "مدرب")
 // but get a dedicated screen with flexible pay: a fixed monthly salary or
 // a percentage/commission, plus mid-month advances (سلف). Every payout is
 // recorded as an expense (tagged with staffId) so it flows into the reports.

 function toggleCoachPayType() {
 const type = document.getElementById('coach-pay-type').value;
 document.getElementById('coach-salary-group').style.display = type === 'monthly' ? 'flex' : 'none';
 document.getElementById('coach-rate-group').style.display = type === 'percentage' ? 'flex' : 'none';
 }

 function addCoach() {
 const name = val('coach-name').trim();
 const phone = val('coach-phone').trim();
 const specialty = val('coach-specialty').trim();
 const branch = val('coach-branch');
 const payType = val('coach-pay-type');
 const salary = val('coach-salary');
 const rate = val('coach-rate');

 if (!name || !branch) { showNotification('يرجى إدخال اسم المدرب والفرع', 'warning'); return; }
 if (payType === 'monthly' && (!salary || parseInt(salary) <= 0)) { showNotification('يرجى إدخال الراتب الشهري', 'warning'); return; }
 if (payType === 'percentage' && (!rate || parseFloat(rate) <= 0)) { showNotification('يرجى إدخال النسبة', 'warning'); return; }

 const coach = {
 id: `CO-${Date.now()}`,
 code: generateStaffCode(),
 name, phone,
 role: 'مدرب',
 specialty,
 branch,
 payType,
 salary: payType === 'monthly' ? parseInt(salary) : 0,
 percentageRate: payType === 'percentage' ? parseFloat(rate) : 0,
 status: 'نشط',
 joinDate: todayAr()
 };
 data.employees.push(coach);
 dbSetDoc(employeesCol, coach.id, coach);
 renderCoachesSection();

 setVal('coach-name', ''); setVal('coach-phone', ''); setVal('coach-specialty', '');
 setVal('coach-salary', ''); setVal('coach-rate', '');
 showNotification(`تم إضافة المدرب ${name}`);
 }

 // Total ever collected from a coach's players — the sum of every payment that
 // was stamped with this coach's name (see addPayment), PLUS/MINUS any
 // commission transfers recorded when a player moved between coaches. When a
 // player is transferred, the value of the not-yet-used part (remaining
 // sessions/days) is moved from the old coach's base to the new coach's base,
 // so each coach's percentage reflects the part he actually serves. Income is
 // never touched — only this commission base.
 function collectedForCoach(coachName) {
 let sum = data.payments.reduce((s, p) => p.trainer === coachName ? s + num(p.amount) : s, 0);
 (data.trainees || []).forEach(t => (t.commissionMoves || []).forEach(m => {
 if (m.to === coachName) sum += num(m.amount);
 if (m.from === coachName) sum -= num(m.amount);
 }));
 return Math.max(0, Math.round(sum));
 }

 // Records a commission transfer when a player's coach changes mid-subscription.
 // The value of the unconsumed part (same formula as a refund estimate) leaves
 // the old coach's base and joins the new coach's base. Stored on the player
 // record itself (t.commissionMoves), so it persists and is removed with them.
 function recordCoachTransfer(t, oldCoach, newCoach) {
 oldCoach = (oldCoach || '').trim();
 newCoach = (newCoach || '').trim();
 if (!oldCoach || !newCoach || oldCoach === newCoach) return;
 if (oldCoach === 'غير محدد' || newCoach === 'غير محدد') return;
 if (t.type !== 'subscription') return;
 const value = refundEstimate(t); // value of the not-yet-used sessions/days
 if (value <= 0) return;
 t.commissionMoves = t.commissionMoves || [];
 t.commissionMoves.push({ from: oldCoach, to: newCoach, amount: value, date: todayAr() });
 showNotification(`تم نقل ${value.toLocaleString()} ج.م من نسبة ${oldCoach} إلى ${newCoach} (قيمة الحصص المتبقية)`);
 }

 // Total paid to a staff member within the current calendar month.
 function paidThisMonthForStaff(staffId, positiveOnly) {
 const now = new Date();
 const y = now.getFullYear(), m = now.getMonth();
 return data.expenses.reduce((sum, e) => {
 if (e.staffId !== staffId) return sum;
 if (positiveOnly && num(e.amount) < 0) return sum; // ignore deductions for "remaining to pay"
 const ts = parseDate(e.date);
 if (!ts) return sum;
 const d = new Date(ts);
 return (d.getFullYear() === y && d.getMonth() === m) ? sum + num(e.amount) : sum;
 }, 0);
 }

 function renderCoachesSection() {
 const tbody = document.getElementById('coaches-table');
 if (!tbody) return;
 const coaches = getCoaches();
 if (coaches.length === 0) {
 tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color: rgba(48,56,65,0.3); padding: 30px;">لا يوجد مدربون مسجلون</td></tr>';
 return;
 }
 tbody.innerHTML = coaches.map(c => {
 const paid = paidThisMonthForStaff(c.id);
 const contract = c.payType === 'percentage'
 ? `<span class="badge badge-info">نسبة ${num(c.percentageRate)}%</span>`
 : `<span class="badge badge-success">شهري ${num(c.salary).toLocaleString()} ج.م</span>`;
 const groupCount = (data.groups || []).filter(g => g.trainer === c.name).length;
 const payBtn = c.payType === 'percentage'
 ? `<button class="btn btn-success btn-sm" onclick="payCoachPercentage('${esc(c.id)}')">صرف نسبة</button>`
 : `<button class="btn btn-success btn-sm" onclick="payCoachMonthly('${esc(c.id)}')">صرف الراتب</button>`;
 return `
 <tr>
 <td><strong>${esc(c.name)}</strong>${c.phone ? `<div style="font-size:11px; color:rgba(48,56,65,0.5);">${esc(c.phone)}</div>` : ''}</td>
 <td>${esc(c.specialty || '-')}</td>
 <td>${branchBadge(c.branch)}</td>
 <td>${contract}</td>
 <td style="font-weight:700; color: var(--danger);">${paid.toLocaleString()} ج.م</td>
 <td>${groupCount}</td>
 <td style="font-size:11px; color:rgba(48,56,65,0.55);">${esc(c.createdBy || '—')}</td>
 <td>
 ${payBtn}
 <button class="btn btn-warning btn-sm" onclick="payCoachAdvance('${esc(c.id)}')">سلفة</button>
 <button class="btn btn-warning btn-sm" onclick="openStaffDeduction('${esc(c.id)}')">خصم</button>
 <button class="btn btn-outline btn-sm" onclick="editCoach('${esc(c.id)}')">تعديل</button>
 <button class="btn btn-danger btn-sm" onclick="deleteCoach('${esc(c.id)}')">حذف</button>
 </td>
 </tr>`;
 }).join('');
 }

 // Records a coach payout as an expense tagged with the coach's id.
 function recordCoachExpense(coach, type, amount, desc) {
 const prefix = type === 'سلفة' ? 'ADV' : type === 'نسبة' ? 'PCT' : 'SAL';
 const expense = {
 id: `${prefix}-${Date.now()}`,
 type, desc, amount,
 branch: coach.branch,
 date: todayAr(),
 staffId: coach.id
 };
 saveExpense(expense);
 updateSalaries();
 updateFinancial();
 updateReports();
 renderCoachesSection();
 }

 // ---- Deduction (خصم): a penalty that lowers a staff member's net pay AND the
 // academy's net cost. Stored as a NEGATIVE expense tagged with staffId. Works
 // for both coaches and regular employees (both live in data.employees). ----
 function openStaffDeduction(id) {
 const e = data.employees.find(x => x.id === id);
 if (!e) return;
 openModal(`خصم - ${e.name}`, `
 <p style="color:rgba(48,56,65,0.6); margin-bottom:16px;">خصم مبلغ من مستحقات <strong>${esc(e.name)}</strong> — يقلّل صافي ما يتقاضاه وصافي مصروف الأكاديمية.</p>
 <div class="form-group"><label>مبلغ الخصم (ج.م)</label><input type="number" id="ded-amount-input" placeholder="المبلغ"></div>
 <div class="form-group"><label>السبب</label><input type="text" id="ded-reason-input" placeholder="مثال: غياب / تأخير / مخالفة"></div>
 <div style="display:flex; gap:10px; margin-top:18px;">
 <button class="btn btn-danger" style="flex:1;" onclick="confirmStaffDeduction('${esc(id)}')">تأكيد الخصم</button>
 <button class="btn btn-outline" style="flex:1;" onclick="closeModal()">إلغاء</button>
 </div>`);
 }
 function confirmStaffDeduction(id) {
 const e = data.employees.find(x => x.id === id);
 if (!e) return;
 const amount = num(document.getElementById('ded-amount-input').value);
 const reason = document.getElementById('ded-reason-input').value.trim();
 if (amount <= 0) { showNotification('أدخل مبلغاً صالحاً', 'warning'); return; }
 saveExpense({
 id: `DED-${Date.now()}`,
 type: 'خصم',
 desc: `خصم ${e.name}${reason ? ' - ' + reason : ''}`,
 amount: -amount, // negative -> reduces academy net expense + staff net pay
 branch: e.branch,
 date: todayAr(),
 staffId: e.id
 });
 updateSalaries();
 updateFinancial();
 updateReports();
 renderCoachesSection();
 closeModal();
 showNotification(`تم خصم ${amount.toLocaleString()} ج.م من ${e.name}`);
 }

 // ---- Advance (سلفة) for any staff member (employee or coach): a mid-month
 // payout recorded as a positive expense tagged with staffId (counts toward
 // what they've been paid, so it lowers the "remaining salary" to disburse). ----
 function openStaffAdvance(id) {
 const e = data.employees.find(x => x.id === id);
 if (!e) return;
 openModal(`صرف سلفة - ${e.name}`, `
 <p style="color:rgba(48,56,65,0.6); margin-bottom:16px;">سحب مبلغ في نص الشهر (سلفة) للموظف <strong>${esc(e.name)}</strong>.</p>
 <div class="form-group"><label>مبلغ السلفة (ج.م)</label><input type="number" id="adv-amount-input" placeholder="المبلغ"></div>
 <div class="form-group"><label>ملاحظة (اختياري)</label><input type="text" id="adv-note-input" placeholder="مثال: سلفة منتصف الشهر"></div>
 <div style="display:flex; gap:10px; margin-top:18px;">
 <button class="btn btn-warning" style="flex:1;" onclick="confirmStaffAdvance('${esc(id)}')">تأكيد صرف السلفة</button>
 <button class="btn btn-outline" style="flex:1;" onclick="closeModal()">إلغاء</button>
 </div>`);
 }
 function confirmStaffAdvance(id) {
 const e = data.employees.find(x => x.id === id);
 if (!e) return;
 const amount = num(document.getElementById('adv-amount-input').value);
 const note = document.getElementById('adv-note-input').value.trim();
 if (amount <= 0) { showNotification('أدخل مبلغاً صالحاً', 'warning'); return; }
 saveExpense({
 id: `ADV-${Date.now()}`,
 type: 'سلفة',
 desc: `سلفة ${e.name}${note ? ' - ' + note : ''}`,
 amount: amount,
 branch: e.branch,
 date: todayAr(),
 staffId: e.id
 });
 updateSalaries();
 updateFinancial();
 updateReports();
 renderCoachesSection();
 closeModal();
 showNotification(`تم صرف سلفة ${amount.toLocaleString()} ج.م لـ ${e.name}`);
 }

 // All coach payouts open a styled popup (the app modal) instead of the
 // browser's native prompt/confirm dialogs.
 function payCoachMonthly(id) {
 const c = data.employees.find(e => e.id === id);
 if (!c) return;
 const paid = paidThisMonthForStaff(id, true); // count positive payouts only (deductions don't raise "remaining")
 const remaining = Math.max(0, num(c.salary) - paid);
 openModal(`صرف راتب - ${c.name}`, `
 <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-bottom:18px;">
 ${attRow('الراتب الشهري', num(c.salary).toLocaleString() + ' ج.م')}
 ${attRow('مصروف هذا الشهر', paid.toLocaleString() + ' ج.م')}
 ${attRow('المتبقي', remaining.toLocaleString() + ' ج.م')}
 </div>
 <div class="form-group">
 <label>المبلغ المراد صرفه (ج.م)</label>
 <input type="number" id="pay-amount-input" value="${remaining}">
 </div>
 <div style="display:flex; gap:10px; margin-top:18px;">
 <button class="btn btn-success" style="flex:1;" onclick="confirmCoachPayment('${esc(id)}','مرتب')">تأكيد الصرف</button>
 <button class="btn btn-outline" style="flex:1;" onclick="closeModal()">إلغاء</button>
 </div>
 `);
 }

 function payCoachAdvance(id) {
 const c = data.employees.find(e => e.id === id);
 if (!c) return;
 openModal(`صرف سلفة - ${c.name}`, `
 <p style="color:rgba(48,56,65,0.6); margin-bottom:16px;">سحب مبلغ في نص الشهر (سلفة) للمدرب <strong>${esc(c.name)}</strong>.</p>
 <div class="form-group">
 <label>مبلغ السلفة (ج.م)</label>
 <input type="number" id="pay-amount-input" placeholder="المبلغ">
 </div>
 <div style="display:flex; gap:10px; margin-top:18px;">
 <button class="btn btn-warning" style="flex:1;" onclick="confirmCoachPayment('${esc(id)}','سلفة')">تأكيد صرف السلفة</button>
 <button class="btn btn-outline" style="flex:1;" onclick="closeModal()">إلغاء</button>
 </div>
 `);
 }

 function payCoachPercentage(id) {
 const c = data.employees.find(e => e.id === id);
 if (!c) return;
 const rate = num(c.percentageRate);
 const collected = collectedForCoach(c.name); // auto base = total collected from his players
 openModal(`صرف نسبة - ${c.name}`, `
 <p style="color:rgba(48,56,65,0.6); margin-bottom:8px;">النسبة المتفق عليها: <strong>${rate}%</strong></p>
 <p style="color:rgba(48,56,65,0.6); margin-bottom:16px;">إجمالي المحصّل من لاعبيه: <strong>${collected.toLocaleString()} ج.م</strong></p>
 <div class="form-group">
 <label>إجمالي المبلغ المحصّل (ج.م)</label>
 <input type="number" id="pay-base-input" oninput="updatePercentPreview('${esc(id)}')" value="${collected}" placeholder="المبلغ المحصّل">
 </div>
 <div id="percent-preview" style="font-weight:800; color:var(--success); font-size:18px; margin:14px 0;">النسبة المستحقة: ${Math.round(collected * rate / 100).toLocaleString()} ج.م</div>
 <div style="display:flex; gap:10px;">
 <button class="btn btn-success" style="flex:1;" onclick="confirmCoachPayment('${esc(id)}','نسبة')">تأكيد الصرف</button>
 <button class="btn btn-outline" style="flex:1;" onclick="closeModal()">إلغاء</button>
 </div>
 `);
 }

 function updatePercentPreview(id) {
 const c = data.employees.find(e => e.id === id);
 if (!c) return;
 const base = num(document.getElementById('pay-base-input').value);
 const amount = Math.round(base * num(c.percentageRate) / 100);
 document.getElementById('percent-preview').textContent = `النسبة المستحقة: ${amount.toLocaleString()} ج.م`;
 }

 // Shared confirm handler for all three coach payout popups.
 function confirmCoachPayment(id, type) {
 const c = data.employees.find(e => e.id === id);
 if (!c) return;
 let amount, desc;
 if (type === 'نسبة') {
 const base = num(document.getElementById('pay-base-input').value);
 if (base <= 0) { showNotification('أدخل مبلغاً صالحاً', 'warning'); return; }
 const rate = num(c.percentageRate);
 amount = Math.round(base * rate / 100);
 desc = `نسبة ${rate}% من ${base.toLocaleString()} - ${c.name}`;
 } else {
 amount = num(document.getElementById('pay-amount-input').value);
 if (amount <= 0) { showNotification('أدخل مبلغاً صالحاً', 'warning'); return; }
 desc = type === 'سلفة' ? `سلفة - ${c.name}` : `راتب ${c.name}`;
 }
 recordCoachExpense(c, type, amount, desc);
 closeModal();
 showNotification(`تم صرف ${amount.toLocaleString()} ج.م لـ ${c.name}`);
 }

 function editCoach(id) {
 const c = data.employees.find(e => e.id === id);
 if (!c) return;
 openModal(`تعديل المدرب ${c.name}`, `
 <div class="form-grid">
 <div class="form-group"><label>الاسم</label><input type="text" id="edit-coach-name" value="${esc(c.name)}"></div>
 <div class="form-group"><label>الهاتف</label><input type="tel" id="edit-coach-phone" value="${esc(c.phone || '')}"></div>
 <div class="form-group"><label>التخصص</label><input type="text" id="edit-coach-specialty" value="${esc(c.specialty || '')}"></div>
 <div class="form-group"><label>الفرع</label>
 <select id="edit-coach-branch">${branchOptionsHTML(c.branch)}</select>
 </div>
 <div class="form-group"><label>نوع التعاقد</label>
 <select id="edit-coach-pay-type" onchange="toggleEditCoachPayType()">
 <option value="monthly" ${c.payType !== 'percentage' ? 'selected' : ''}>راتب شهري</option>
 <option value="percentage" ${c.payType === 'percentage' ? 'selected' : ''}>نسبة</option>
 </select>
 </div>
 <div class="form-group" id="edit-coach-salary-group" style="display:${c.payType === 'percentage' ? 'none' : 'flex'};"><label>الراتب الشهري</label><input type="number" id="edit-coach-salary" value="${num(c.salary)}"></div>
 <div class="form-group" id="edit-coach-rate-group" style="display:${c.payType === 'percentage' ? 'flex' : 'none'};"><label>النسبة (%)</label><input type="number" id="edit-coach-rate" value="${num(c.percentageRate)}"></div>
 </div>
 <button class="btn btn-primary" style="margin-top:20px; width:100%;" onclick="saveCoachEdit('${esc(c.id)}')">حفظ التعديلات</button>
 `);
 }

 function toggleEditCoachPayType() {
 const type = document.getElementById('edit-coach-pay-type').value;
 document.getElementById('edit-coach-salary-group').style.display = type === 'monthly' ? 'flex' : 'none';
 document.getElementById('edit-coach-rate-group').style.display = type === 'percentage' ? 'flex' : 'none';
 }

 function saveCoachEdit(id) {
 const c = data.employees.find(e => e.id === id);
 if (!c) return;
 const oldName = c.name;
 c.name = document.getElementById('edit-coach-name').value.trim() || c.name;
 c.phone = document.getElementById('edit-coach-phone').value.trim();
 c.specialty = document.getElementById('edit-coach-specialty').value.trim();
 c.branch = document.getElementById('edit-coach-branch').value;
 c.payType = document.getElementById('edit-coach-pay-type').value;
 c.salary = c.payType === 'monthly' ? num(document.getElementById('edit-coach-salary').value) : 0;
 c.percentageRate = c.payType === 'percentage' ? num(document.getElementById('edit-coach-rate').value) : 0;
 dbSetDoc(employeesCol, c.id, c);

 // Keep groups in sync if the coach was renamed (groups store the name).
 if (oldName !== c.name) {
 (data.groups || []).forEach(g => {
 if (g.trainer === oldName) { g.trainer = c.name; dbSetDoc(groupsCol, g._docId, g); }
 });
 }

 closeModal();
 renderCoachesSection();
 renderGroups();
 showNotification('تم حفظ بيانات المدرب');
 }

 function deleteCoach(id) {
 const c = data.employees.find(e => e.id === id);
 if (!c) return;
 if (!confirm(`حذف المدرب "${c.name}"؟\n(مصروفاته السابقة ستبقى في التقارير المالية)`)) return;
 data.employees = data.employees.filter(e => e.id !== id);
 dbDeleteDoc(employeesCol, id);
 renderCoachesSection();
 renderGroups();
 showNotification('تم حذف المدرب', 'danger');
 }

 // ==================== SESSIONS ====================
 // Live training sessions, managed per branch (pick a branch first so the
 // lists from different branches never get mixed up).

 function renderSessionsSection() {
 renderSessionsList();
 }

 // Distinct sports across all trainees (for the session sport dropdown).
 function distinctSports() {
 return [...new Set(data.trainees.flatMap(t => traineeSports(t)).map(s => s.trim()).filter(Boolean))].sort();
 }

 // Fill the create-session dropdowns based on the chosen branch.
 function populateSessionForm(branch) {
 const sportSel = document.getElementById('session-sport');
 if (sportSel) {
 sportSel.innerHTML = '<option value="">— اختر الرياضة —</option>' +
 distinctSports().map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
 }
 const coachSel = document.getElementById('session-coach');
 if (coachSel) coachSel.innerHTML = coachOptionsHTML('');
 const groupSel = document.getElementById('session-group');
 if (groupSel) {
 const groups = (data.groups || []).filter(g => g.branch === branch);
 groupSel.innerHTML = '<option value="">— بدون جروب —</option>' +
 groups.map(g => `<option value="${esc(g._docId)}">${esc(g.name)} (${esc(g.trainer || 'غير محدد')})</option>`).join('');
 }
 }

 // Picking a group auto-fills its coach (and sport if the group's players share one).
 function onSessionGroupChange() {
 const gid = document.getElementById('session-group').value;
 if (!gid) return;
 const g = (data.groups || []).find(x => x._docId === gid);
 if (!g) return;
 const coachSel = document.getElementById('session-coach');
 if (coachSel && g.trainer) coachSel.value = g.trainer;
 // If all the group's members share one sport, pre-select it.
 const members = (g.memberIds || []).map(id => data.trainees.find(t => t.id === id)).filter(Boolean);
 const sports = [...new Set(members.map(t => (t.sport || t.plan || '').trim()).filter(Boolean))];
 const sportSel = document.getElementById('session-sport');
 if (sportSel && sports.length === 1) sportSel.value = sports[0];
 }

 function renderSessionsList() {
 const branch = document.getElementById('session-branch-filter').value;
 const createCard = document.getElementById('session-create-card');
 const listCard = document.getElementById('session-list-card');
 if (!branch) {
 createCard.style.display = 'none';
 listCard.style.display = 'none';
 return;
 }
 createCard.style.display = 'block';
 listCard.style.display = 'block';
 populateSessionForm(branch);

 const list = document.getElementById('sessions-list');
 // Sort by manual order (set when reordering / "sort by time"); fall back to time.
 const sessions = (data.sessions || [])
 .filter(s => s.branch === branch)
 .sort((a, b) => (num(a.order) - num(b.order)) || String(a.time || '').localeCompare(String(b.time || '')));

 if (sessions.length === 0) {
 list.innerHTML = '<p style="color:rgba(48,56,65,0.4); padding:20px; text-align:center;">لا توجد جلسات في هذا الفرع — ابدأ جلسة من الأعلى</p>';
 return;
 }
 list.innerHTML = sessions.map((s, i) => {
 const count = (s.attendees || []).length;
 const active = s.status === 'active';
 const statusBadge = active ? '<span class="badge badge-success">نشطة الآن</span>' : '<span class="badge badge-test">منتهية</span>';
 const actions = active
 ? `<button class="btn btn-success btn-sm" onclick="openSession('${esc(s._docId)}')">تحضير</button>
 <button class="btn btn-warning btn-sm" onclick="endSession('${esc(s._docId)}')">إنهاء</button>`
 : `<button class="btn btn-outline btn-sm" onclick="openSession('${esc(s._docId)}')">عرض</button>`;
 const grp = s.groupName ? ' • جروب: ' + esc(s.groupName) : '';
 const privateBadge = s.private ? '<span class="badge badge-info">برايفت</span>' : '';
 const priceMeta = (s.private && num(s.price) > 0) ? ` • السعر: <strong>${num(s.price).toLocaleString()} ج.م</strong>` : '';
 return `
 <div class="group-card" style="display:flex; align-items:center; gap:14px;">
 <div style="display:flex; flex-direction:column; gap:4px;">
 <button class="btn btn-outline btn-sm" style="padding:2px 8px;" onclick="moveSession('${esc(s._docId)}',-1)" ${i === 0 ? 'disabled' : ''}>▲</button>
 <button class="btn btn-outline btn-sm" style="padding:2px 8px;" onclick="moveSession('${esc(s._docId)}',1)" ${i === sessions.length - 1 ? 'disabled' : ''}>▼</button>
 </div>
 <div style="flex:1;">
 <div class="group-card-head">
 <div class="group-card-name">${s.time ? `<span style="color:var(--gold);">${esc(s.time)}</span> · ` : ''}${esc(s.name)}</div>
 ${privateBadge} ${statusBadge}
 </div>
 <div class="group-card-meta">${esc(s.sport || 'بدون رياضة')} • المدرب: <strong>${esc(s.coach || 'غير محدد')}</strong>${grp}${priceMeta}</div>
 <div class="group-card-meta">${count} حاضر</div>
 <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;">
 ${actions}
 <button class="btn btn-danger btn-sm" onclick="deleteSession('${esc(s._docId)}')">حذف</button>
 </div>
 </div>
 </div>`;
 }).join('');
 }

 function createSession() {
 const branch = val('session-branch-filter');
 if (!branch) { showNotification('اختر الفرع أولاً', 'warning'); return; }
 const sport = val('session-sport');
 const coach = val('session-coach');
 const gid = val('session-group');
 const time = val('session-time');
 let name = val('session-name').trim();
 // Session type: 'private' (تمرين برايفت بسعر) or '' for a normal group session.
 const isPrivate = val('session-type') === 'private';
 const price = isPrivate ? num(val('session-price')) : 0;

 const group = (data.groups || []).find(x => x._docId === gid);
 // Auto-name from sport/group/time if no name was typed (prefix private ones).
 if (!name) {
 name = [sport || group && group.name || 'جلسة', time].filter(Boolean).join(' - ') || 'جلسة';
 }
 if (isPrivate) name = `برايفت - ${name}`;

 data.sessions = data.sessions || [];
 const branchOrders = data.sessions.filter(s => s.branch === branch).map(s => num(s.order));
 const nextOrder = (branchOrders.length ? Math.max(...branchOrders) : 0) + 1;

 const docId = genDocId('SES');
 const session = {
 _docId: docId, id: docId, name, branch,
 sport: sport || '',
 coach: coach || 'غير محدد',
 groupId: gid || '',
 groupName: group ? group.name : '',
 time: time || '',
 order: nextOrder,
 date: todayAr(),
 status: 'active',
 private: isPrivate,
 price: price,
 attendees: []
 };
 data.sessions.push(session);
 dbSetDoc(sessionsCol, docId, session);

 // A private session's fee is booked as income straight away.
 if (isPrivate && price > 0) {
 addPayment({
 id: '—', name: name, type: 'برايفت', plan: sport ? `برايفت - ${sport}` : 'تمرين برايفت',
 amount: price, method: 'نقداً', date: todayAr(), status: 'مكتمل', branch
 });
 updateFinancial();
 updateDashboard();
 }

 setVal('session-name', ''); setVal('session-time', ''); setVal('session-price', '');
 renderSessionsList();
 showNotification(`تم بدء جلسة "${name}"`);
 }

 // Show the private-session price field only when type "برايفت" is selected.
 function onSessionTypeChange() {
 const isPrivate = document.getElementById('session-type').value === 'private';
 const grp = document.getElementById('session-price-group');
 if (grp) grp.style.display = isPrivate ? 'flex' : 'none';
 }

 // Move a session up (-1) or down (+1) within its branch list by swapping
 // its order value with the adjacent session.
 function moveSession(id, dir) {
 const branch = document.getElementById('session-branch-filter').value;
 const ordered = (data.sessions || [])
 .filter(s => s.branch === branch)
 .sort((a, b) => (num(a.order) - num(b.order)) || String(a.time || '').localeCompare(String(b.time || '')));
 const idx = ordered.findIndex(s => s._docId === id);
 const swapWith = idx + dir;
 if (idx < 0 || swapWith < 0 || swapWith >= ordered.length) return;
 const a = ordered[idx], b = ordered[swapWith];
 const tmp = num(a.order); a.order = num(b.order); b.order = tmp;
 dbSetDoc(sessionsCol, a._docId, a);
 dbSetDoc(sessionsCol, b._docId, b);
 renderSessionsList();
 }

 // Re-number the branch's sessions in chronological order of their times.
 function sortSessionsByTime() {
 const branch = document.getElementById('session-branch-filter').value;
 if (!branch) return;
 const ordered = (data.sessions || [])
 .filter(s => s.branch === branch)
 .sort((a, b) => String(a.time || '~').localeCompare(String(b.time || '~')));
 ordered.forEach((s, i) => { s.order = i + 1; dbSetDoc(sessionsCol, s._docId, s); });
 renderSessionsList();
 showNotification('تم ترتيب الجلسات حسب الموعد');
 }

 function openSession(id) {
 const s = (data.sessions || []).find(x => x._docId === id);
 if (!s) return;
 s.attendees = s.attendees || [];

 const branchTrainees = data.trainees.filter(t => (t.branch || 'غير محدد') === s.branch);
 const nonAttendees = branchTrainees.filter(t => !s.attendees.includes(t.id));
 const addOptions = (s.status === 'active' && nonAttendees.length)
 ? '<option value="">اختر لاعباً لتحضيره...</option>' + nonAttendees.map(t => `<option value="${esc(t.id)}">${esc(t.id)} — ${esc(t.name)}</option>`).join('')
 : '<option value="">لا يوجد لاعبون متاحون</option>';

 const attendees = s.attendees.map(code => data.trainees.find(t => t.id === code)).filter(Boolean);
 const rows = attendees.length ? attendees.map(t => `
 <tr>
 <td><code style="color: var(--gold); font-family: monospace;">${esc(t.id)}</code></td>
 <td>${esc(t.name)}</td>
 <td>${s.status === 'active' ? `<button class="btn btn-outline btn-sm" onclick="removeSessionAttendee('${esc(s._docId)}','${esc(t.id)}')">إزالة</button>` : '—'}</td>
 </tr>`).join('') : '<tr><td colspan="3" style="text-align:center; color:rgba(48,56,65,0.4); padding:20px;">لا يوجد حاضرون بعد</td></tr>';

 const addRow = s.status === 'active' ? `
 <div style="display:flex; gap:8px; margin-bottom:16px;">
 <select id="session-add-select" style="flex:1; padding:9px 12px; border-radius:8px; border:1px solid var(--secondary);">${addOptions}</select>
 <button class="btn btn-success btn-sm" onclick="addSessionAttendee('${esc(s._docId)}')">تحضير اللاعب</button>
 </div>` : '';

 openModal(`جلسة: ${s.name}`, `
 <div style="margin-bottom:14px; color:rgba(48,56,65,0.6);">الفرع: <strong>${esc(s.branch)}</strong> • المدرب: <strong>${esc(s.coach || 'غير محدد')}</strong>${s.sport ? ' • ' + esc(s.sport) : ''}${s.time ? ' • الموعد: ' + esc(s.time) : ''}${s.groupName ? ' • جروب: ' + esc(s.groupName) : ''}</div>
 ${addRow}
 <div class="table-container"><table>
 <thead><tr><th>الكود</th><th>الاسم</th><th>إجراء</th></tr></thead>
 <tbody>${rows}</tbody>
 </table></div>
 `);
 }

 // Adds a player to the session and records their attendance (blocking
 // expired subscriptions and consuming a session for session-based plans).
 function addSessionAttendee(id) {
 const s = (data.sessions || []).find(x => x._docId === id);
 if (!s || s.status !== 'active') return;
 const code = document.getElementById('session-add-select').value;
 if (!code) return;
 const t = data.trainees.find(x => x.id === code);
 if (!t) return;

 const info = subInfo(t);
 if (t.type === 'subscription' && info.expired) {
 showNotification(`${t.name}: الاشتراك منتهي — ممنوع الدخول`, 'danger');
 return;
 }

 const today = todayAr();
 if (!data.attendance.some(a => a.id === code && a.date === today)) {
 const time = new Date().toLocaleTimeString('ar-EG');
 const entry = { id: code, name: t.name, date: today, time, status: 'حاضر', branch: t.branch || 'غير محدد' };
 data.attendance.push(entry);
 dbAddDoc(attendanceCol, entry);
 if (t.type === 'subscription' && info.kind === 'sessions') {
 t.sessionsRemaining = num(t.sessionsRemaining) - 1;
 if (t.sessionsRemaining <= 0) t.status = 'منتهي';
 dbSetDoc(traineesCol, t.id, t);
 }
 }

 s.attendees = s.attendees || [];
 if (!s.attendees.includes(code)) s.attendees.push(code);
 dbSetDoc(sessionsCol, s._docId, s);

 openSession(id);
 renderSessionsList();
 updateAttendanceLog();
 updateDashboard();
 showNotification(`تم تحضير ${t.name}`);
 }

 function removeSessionAttendee(id, code) {
 const s = (data.sessions || []).find(x => x._docId === id);
 if (!s) return;
 s.attendees = (s.attendees || []).filter(a => a !== code);
 dbSetDoc(sessionsCol, s._docId, s);
 openSession(id);
 renderSessionsList();
 }

 function endSession(id) {
 const s = (data.sessions || []).find(x => x._docId === id);
 if (!s) return;
 if (!confirm(`إنهاء جلسة "${s.name}"؟`)) return;
 s.status = 'ended';
 s.endTime = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
 dbSetDoc(sessionsCol, s._docId, s);
 renderSessionsList();
 showNotification('تم إنهاء الجلسة');
 }

 function deleteSession(id) {
 const s = (data.sessions || []).find(x => x._docId === id);
 if (!s) return;
 if (!confirm(`حذف جلسة "${s.name}"؟\n(سجلات الحضور تبقى محفوظة)`)) return;
 data.sessions = data.sessions.filter(x => x._docId !== id);
 dbDeleteDoc(sessionsCol, id);
 renderSessionsList();
 showNotification('تم حذف الجلسة', 'danger');
 }

 // ==================== STAFF ATTENDANCE ====================
 // Staff = all employees (which includes coaches). Each one gets a code (ID)
 // used to clock in/out; a daily per-branch PDF can be printed.

 function generateStaffCode() {
 const used = new Set((data.employees || []).map(e => (e.code || '').toLowerCase()));
 for (let i = 0; i < 300; i++) {
 const c = `Staff-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
 if (!used.has(c.toLowerCase())) return c;
 }
 return `Staff-${Date.now().toString().slice(-6)}`;
 }

 // Backfill codes for staff created before this feature. Writing to the
 // employees collection is admin-only (per the security rules), so this only
 // runs for admins.
 function ensureStaffCodes() {
 if (currentRole !== 'admin') return;
 (data.employees || []).forEach(e => {
 if (!e.code) { e.code = generateStaffCode(); dbSetDoc(employeesCol, e.id, e); }
 });
 }

 function findStaffByCode(code) {
 const c = (code || '').trim().toLowerCase();
 if (!c) return null;
 return (data.employees || []).find(e => (e.code || '').toLowerCase() === c || (e.id || '').toLowerCase() === c);
 }

 function staffTodayKey() {
 const d = new Date();
 return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
 }

 function staffRecordFor(empId, dayKey) {
 return (data.staffAttendance || []).find(r => r.empId === empId && dateKey(r.date) === dayKey);
 }

 function renderStaffAttendance() {
 ensureStaffCodes();
 const dateInput = document.getElementById('staff-report-date');
 if (dateInput && !dateInput.value) dateInput.valueAsDate = new Date();

 const tbody = document.getElementById('staff-attendance-table');
 const staff = data.employees || [];
 if (staff.length === 0) {
 tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color: rgba(48,56,65,0.3); padding: 30px;">لا يوجد موظفون — أضفهم من قسمي الموظفين والمدربين</td></tr>';
 return;
 }
 const tk = staffTodayKey();
 tbody.innerHTML = staff.map(e => {
 const rec = staffRecordFor(e.id, tk);
 const checkIn = (rec && rec.checkIn) ? rec.checkIn : '—';
 const checkOut = (rec && rec.checkOut) ? rec.checkOut : '—';
 const inBtn = (!rec || !rec.checkIn) ? `<button class="btn btn-success btn-sm" onclick="checkInStaff('${esc(e.id)}')">حضور</button>` : '';
 const outBtn = (rec && rec.checkIn && !rec.checkOut) ? `<button class="btn btn-warning btn-sm" onclick="checkOutStaff('${esc(e.id)}')">انصراف</button>` : '';
 const done = (rec && rec.checkIn && rec.checkOut) ? '<span class="badge badge-test">مكتمل</span>' : '';
 const cardBtn = `<button class="btn btn-outline btn-sm" onclick="printStaffCard('${esc(e.id)}')">طباعة كرت</button>`;
 return `
 <tr>
 <td><code style="color:var(--gold); font-family:monospace;">${esc(e.code || '—')}</code></td>
 <td><strong>${esc(e.name)}</strong></td>
 <td>${esc(e.role || '-')}</td>
 <td>${branchBadge(e.branch)}</td>
 <td style="color:var(--success); font-weight:700;">${esc(checkIn)}</td>
 <td style="color:var(--warning); font-weight:700;">${esc(checkOut)}</td>
 <td style="font-size:11px; color:rgba(48,56,65,0.55);">${esc((rec && rec.createdBy) || '—')}</td>
 <td>${inBtn}${outBtn}${done} ${cardBtn}</td>
 </tr>`;
 }).join('');
 }

 function checkInStaff(empId) {
 const e = (data.employees || []).find(x => x.id === empId);
 if (!e) return;
 const tk = staffTodayKey();
 if (staffRecordFor(empId, tk)) { showNotification(`${e.name}: مسجّل حضور بالفعل اليوم`, 'warning'); return; }
 const time = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
 const docId = genDocId('SATT');
 const rec = {
 _docId: docId, empId, code: e.code || '', name: e.name, role: e.role || '',
 branch: e.branch || 'غير محدد', date: todayAr(),
 checkIn: time, checkOut: ''
 };
 data.staffAttendance = data.staffAttendance || [];
 data.staffAttendance.push(rec);
 dbSetDoc(staffAttendanceCol, docId, rec);
 renderStaffAttendance();
 showNotification(`تم تسجيل حضور ${e.name} - ${time}`);
 }

 function checkOutStaff(empId) {
 const e = (data.employees || []).find(x => x.id === empId);
 if (!e) return;
 const rec = staffRecordFor(empId, staffTodayKey());
 if (!rec || !rec.checkIn) { showNotification('سجّل الحضور أولاً', 'warning'); return; }
 if (rec.checkOut) { showNotification(`${e.name}: مسجّل انصراف بالفعل`, 'warning'); return; }
 rec.checkOut = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
 dbSetDoc(staffAttendanceCol, rec._docId, rec);
 renderStaffAttendance();
 showNotification(`تم تسجيل انصراف ${e.name} - ${rec.checkOut}`);
 }

 let staffCodeTimer = null;
 function onStaffCodeInput() {
 clearTimeout(staffCodeTimer);
 staffCodeTimer = setTimeout(() => {
 const cur = document.getElementById('staff-code').value.trim();
 if (cur && findStaffByCode(cur)) recordStaffByCode();
 }, 200);
 }

 // First scan/entry of the day = check-in, second = check-out.
 function recordStaffByCode() {
 const raw = document.getElementById('staff-code').value.trim();
 if (!raw) { showNotification('أدخل كود الموظف', 'warning'); return; }
 const e = findStaffByCode(raw);
 if (!e) { showNotification(`الكود "${raw}" غير موجود`, 'danger'); return; }
 const rec = staffRecordFor(e.id, staffTodayKey());
 if (!rec || !rec.checkIn) checkInStaff(e.id);
 else if (!rec.checkOut) checkOutStaff(e.id);
 else showNotification(`${e.name}: مكتمل اليوم (حضور وانصراف)`, 'warning');
 document.getElementById('staff-code').value = '';
 }

 // Prints a STAFF card in the same style as the players' cards but DARKER (deep
 // navy + deep-gold accent), so staff cards read as a darker variant of the
 // brand card. The staff code is a QR — scanning it into the "staff-code" box
 // clocks the employee in (first scan) / out (second scan).
 function printStaffCard(empId) {
 const e = (data.employees || []).find(x => x.id === empId);
 if (!e) return;
 ensureStaffCodes(); // make sure this employee has a code
 const code = e.code || '';
 if (!code) { showNotification('لا يوجد كود لهذا الموظف (يحتاج صلاحية مدير)', 'warning'); return; }
 const color = '#C9A227'; // deep gold accent (darker than the players' gold)
 const logoUrl = new URL('src/logo-after.png', location.href).href;
 const qrUrl = new URL('vendor/qrcode.min.js', location.href).href;
 const win = window.open('', '_blank');
 if (!win) { showNotification('فعّل السماح بالنوافذ المنبثقة لطباعة الكرت', 'warning'); return; }
 win.document.write(`
 <html dir="rtl" lang="ar"><head><title>بطاقة موظف - ${esc(e.name)}</title>
 <meta charset="UTF-8">
 <script src="${qrUrl}"><\/script>
 <style>
 @page { size: 90mm 56mm; margin: 0; }
 * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
 html, body { margin: 0; padding: 0; background: #ffffff; }
 /* Staff card = the players' brand card, but a DARKER navy + deep-gold accent. */
 .scard {
 position: relative; width: 90mm; height: 56mm; overflow: hidden;
 background:
 radial-gradient(60mm 40mm at 88% 8%, ${color}26, transparent 60%),
 linear-gradient(135deg, #0E141C 0%, #161D2B 60%, #090C12 100%);
 border-radius: 8px; padding: 4.5mm 5mm;
 display: flex; flex-direction: column; justify-content: space-between; color: #E9EDF3;
 }
 .scard::before { content: ''; position: absolute; inset: 1.1mm; border: 0.5mm solid ${color}; border-radius: 6px; pointer-events: none; }
 .scard::after { content: ''; position: absolute; top: 0; right: 0; left: 0; height: 1.6mm; background: ${color}; }
 .s-top { display: flex; justify-content: space-between; align-items: center; z-index: 1; }
 .club-name { font-size: 15px; font-weight: 900; color: #fff; letter-spacing: 1px; }
 .club-name span { color: ${color}; }
 .club-sub { font-size: 8px; letter-spacing: 2px; color: ${color}; margin-top: 1.5mm; font-weight: 700; }
 .s-logo { height: 12mm; width: auto; }
 .s-divider { height: 0.3mm; background: linear-gradient(90deg, transparent, ${color}, transparent); margin: 1mm 0; z-index: 1; }
 .s-body { display: flex; justify-content: space-between; align-items: center; gap: 4mm; z-index: 1; }
 .s-info { flex: 1; min-width: 0; }
 .lbl { font-size: 6.5px; letter-spacing: 1px; color: rgba(233,237,243,0.5); text-transform: uppercase; }
 .s-name { font-size: 15px; font-weight: 800; color: #fff; margin-bottom: 1mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
 .s-role { font-size: 9px; color: ${color}; font-weight: 600; margin-bottom: 1.5mm; }
 .s-code { font-size: 13px; font-family: 'Courier New', monospace; letter-spacing: 1px; color: #E9EDF3; font-weight: 700; }
 .s-qr { background: #fff; padding: 1.2mm; border-radius: 1.5mm; line-height: 0; box-shadow: 0 0 0 0.4mm ${color}; }
 .s-footer { font-size: 6.5px; color: ${color}; text-align: center; letter-spacing: 0.5px; z-index: 1; }
 </style>
 </head>
 <body>
 <div class="scard">
 <div class="s-top">
 <div class="scard-brand">
 <div class="club-name">El Wasl <span>Academy</span></div>
 <div class="club-sub">بطاقة موظف</div>
 </div>
 <img class="s-logo" src="${logoUrl}" alt="" onerror="this.style.display='none'">
 </div>
 <div class="s-divider"></div>
 <div class="s-body">
 <div class="s-info">
 <div class="lbl">الاسم</div>
 <div class="s-name">${esc(e.name)}</div>
 <div class="s-role">${esc(e.role || '-')} • ${esc(e.branch || 'غير محدد')}</div>
 <div class="lbl">الكود</div>
 <div class="s-code">${esc(code)}</div>
 </div>
 <div class="s-qr"><div id="qrcode"></div></div>
 </div>
 <div class="s-footer">امسح الكود لتسجيل الحضور والانصراف</div>
 </div>
 <script>
 window.onload = function() {
 function render() {
 if (window.QRCode) { new QRCode(document.getElementById("qrcode"), { text: "${esc(code)}", width: 92, height: 92, colorDark: "#0E141C", colorLight: "#ffffff" }); }
 setTimeout(function() { window.print(); }, 350);
 }
 if (window.QRCode) { render(); }
 else { var s = document.createElement('script'); s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"; s.onload = render; s.onerror = render; document.head.appendChild(s); }
 };
 <\/script>
 </body></html>
 `);
 win.document.close();
 }

 // Daily PDF: one page per branch, listing each staff member's check-in/out.
 function printStaffAttendance() {
 const dateVal = document.getElementById('staff-report-date').value || staffTodayKey();
 const dayRecords = (data.staffAttendance || []).filter(r => dateKey(r.date) === dateVal);

 const body = BRANCHES.map((b, i) => {
 const recs = dayRecords.filter(r => (r.branch || 'غير محدد') === b);
 const rows = recs.length
 ? recs.map((r, idx) => `<tr><td>${idx + 1}</td><td>${esc(r.code || '-')}</td><td>${esc(r.name)}</td><td>${esc(r.role || '-')}</td><td>${esc(r.checkIn || '-')}</td><td>${esc(r.checkOut || '-')}</td></tr>`).join('')
 : '<tr><td colspan="6" style="text-align:center; color:#9aa1ab;">لا يوجد حضور مسجّل</td></tr>';
 return `
 <div style="${i > 0 ? 'page-break-before: always;' : ''}">
 <div style="font-size:22px; font-weight:800; color:#B8901F; border-bottom:3px solid #B8901F; padding-bottom:10px; margin:0 0 12px;">حضور الموظفين — ${esc(b)}</div>
 <div style="font-size:12px; color:#6b7280; margin-bottom:14px;">التاريخ: ${esc(dateVal)} • عدد الحاضرين: ${recs.length}</div>
 <table>
 <thead><tr><th>#</th><th>الكود</th><th>الاسم</th><th>الوظيفة</th><th>الحضور</th><th>الانصراف</th></tr></thead>
 <tbody>${rows}</tbody>
 </table>
 </div>`;
 }).join('');
 reportDoc('تقرير حضور الموظفين - ' + dateVal, body);
 }

 // ==================== DASHBOARD ====================
 function updateDashboard() {
 // Trials live in their own section — exclude them from the players dashboard.
 const players = data.trainees.filter(t => t.type !== 'test');
 const total = players.length;
 const active = players.filter(t => t.status === 'نشط').length;
 const totalSubs = players.filter(t => t.type === 'subscription').length;
 // (5) Total revenue comes from the running aggregate (meta/stats) so the
 // dashboard never has to read every payment. When the full history is
 // loaded (reports view) we sum it directly for an exact figure.
 const revenue = historyFullyLoaded
 ? data.payments.reduce((sum, p) => sum + num(p.amount), 0)
 : (stats.revenue || 0);

 document.getElementById('dash-total').textContent = total;
 document.getElementById('dash-active').textContent = active;
 document.getElementById('dash-subs').textContent = totalSubs;
 document.getElementById('dash-revenue').textContent = revenue.toLocaleString();

 // Expiry alerts
 const expiring = data.trainees.filter(t => {
 if (t.type !== 'subscription' || t.status !== 'نشط') return false;
 const left = daysLeft(t);
 return left !== null && left <= 5;
 }).sort((a, b) => daysLeft(a) - daysLeft(b));

 const alertsCard = document.getElementById('alerts-card');
 const alertsBox = document.getElementById('expiry-alerts');
 if (expiring.length === 0) {
 alertsCard.style.display = 'none';
 } else {
 alertsCard.style.display = 'block';
 alertsBox.innerHTML = expiring.map(t => {
 const left = daysLeft(t);
 const msg = left < 0 ? 'منتهي الاشتراك' : (left === 0 ? 'ينتهي اليوم' : `باقي ${left} يوم على الانتهاء`);
 const cls = left < 0 ? 'badge-danger' : 'badge-warning';
 return `
 <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 15px; background: rgba(48,56,65,0.04); border-radius:10px;">
 <div>
 <strong>${esc(t.name)}</strong>
 <span style="font-size:12px; color: rgba(48,56,65,0.5); margin-right:8px;">${esc(t.id)}</span>
 </div>
 <span class="badge ${cls}">${msg}</span>
 </div>`;
 }).join('');
 }

 // Absence alerts: active subscribers who stopped showing up
 const absentees = getAbsentees();
 const absCard = document.getElementById('absentees-card');
 const absBox = document.getElementById('absentees-list');
 if (absentees.length === 0) {
 absCard.style.display = 'none';
 } else {
 absCard.style.display = 'block';
 absBox.innerHTML = absentees.map(({ t, info }) => {
 const lastTxt = info.neverAttended
 ? 'لم يسجّل حضوراً منذ التسجيل'
 : `آخر حضور: ${esc(info.lastDate)}`;
 const phone = t.phone ? ` • ${esc(t.phone)}` : '';
 return `
 <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 15px; background: rgba(181,69,60,0.05); border-radius:10px; flex-wrap:wrap; gap:10px;">
 <div>
 <strong>${esc(t.name)}</strong>
 <span style="font-size:12px; color: rgba(48,56,65,0.5); margin-right:8px;">${esc(t.id)}</span>
 <div style="font-size:12px; color: rgba(48,56,65,0.5);">${lastTxt}${phone}</div>
 </div>
 <div style="display:flex; align-items:center; gap:8px;">
 <span class="badge badge-danger">غائب منذ ${info.days} يوم</span>
 <button class="btn btn-outline btn-sm" onclick="viewTrainee(${data.trainees.indexOf(t)})">عرض</button>
 </div>
 </div>`;
 }).join('');
 }

 // Recent registrations
 const recent = players.slice(-5).reverse();
 const tbody = document.getElementById('recent-registrations');

 if (recent.length === 0) {
 tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: rgba(48,56,65,0.3); padding: 30px;">لا توجد تسجيلات بعد</td></tr>';
 } else {
 tbody.innerHTML = recent.map(t => `
 <tr>
 <td><code style="color: var(--gold); font-family: monospace; font-size: 12px;">${esc(t.id)}</code></td>
 <td>${esc(t.name)}</td>
 <td><span class="badge ${t.type === 'subscription' ? 'badge-success' : 'badge-test'}">${t.type === 'subscription' ? 'اشتراك' : 'تجريبي'}</span></td>
 <td><span class="badge badge-success">${esc(t.status)}</span></td>
 <td>${expiryCell(t)}</td>
 </tr>
 `).join('');
 }

 // Always refresh branch financials — expenses/salaries can exist with zero trainees.
 filterBranchDashboard();
 }

 function filterBranchDashboard() {
 const filterSelect = document.getElementById('dashboard-branch-filter');
 if (!filterSelect) return;
 const branch = filterSelect.value;
 const allBranches = !branch || branch === 'الكل';

 // Totals come from the SQL aggregates (stats / statsByBranch), so each branch
 // shows its OWN revenue, and "كل الفروع" shows the sum — accurate even though
 // the dashboard doesn't load every payment into memory.
 const agg = allBranches ? stats : (statsByBranch[branch] || { revenue: 0, expenses: 0 });
 const totalIncome = num(agg.revenue);
 const totalExpenses = num(agg.expenses);
 const profit = totalIncome - totalExpenses;

 const incEl = document.getElementById('branch-fin-income');
 const expEl = document.getElementById('branch-fin-expenses');
 const profEl = document.getElementById('branch-fin-profit');
 if(incEl) incEl.textContent = `${totalIncome.toLocaleString()} ج.م`;
 if(expEl) expEl.textContent = `${totalExpenses.toLocaleString()} ج.م`;
 if(profEl) profEl.textContent = `${profit.toLocaleString()} ج.م`;

 // The top "إيرادات الشهر" card follows the selected branch (sum for "الكل").
 const dashRev = document.getElementById('dash-revenue');
 if (dashRev) dashRev.textContent = totalIncome.toLocaleString();

 const tbody = document.getElementById('branch-transactions-table');
 if (!tbody) return;

 // Recent transactions list from whatever history is currently loaded, scoped.
 let incomePayments = data.payments;
 let expenses = data.expenses;
 if (!allBranches) {
 incomePayments = data.payments.filter(p => p.branch === branch);
 expenses = data.expenses.filter(e => e.branch === branch);
 }
 const transactions = [
 ...incomePayments.map(p => ({ type: 'إيراد', desc: p.type + ' (' + p.plan + ')', branch: p.branch, amount: p.amount, date: p.date, createdBy: p.createdBy, rawDate: parseDate(p.date) })),
 ...expenses.map(e => ({ type: 'مصروف', desc: e.type + ' (' + (e.desc || '') + ')', branch: e.branch, amount: e.amount, date: e.date, createdBy: e.createdBy, rawDate: parseDate(e.date) }))
 ].sort((a, b) => b.rawDate - a.rawDate);
 
 if (transactions.length === 0) {
 tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: rgba(48,56,65,0.3); padding: 20px;">لا توجد معاملات مالية مسجلة</td></tr>';
 return;
 }
 
 tbody.innerHTML = transactions.map(t => `
 <tr>
 <td><span class="badge ${t.type === 'إيراد' ? 'badge-success' : 'badge-danger'}">${esc(t.type)}</span></td>
 <td>${esc(t.desc)}</td>
 <td>${branchBadge(t.branch)}</td>
 <td style="font-weight: 700; color: ${t.type === 'إيراد' ? 'var(--success)' : 'var(--danger)'};">${num(t.amount).toLocaleString()} ج.م</td>
 <td>${esc(t.date)}</td>
 <td style="font-size:11px; color:rgba(48,56,65,0.55);">${esc(t.createdBy || '—')}</td>
 </tr>
 `).join('');
 }

 // Normalize Arabic/Persian-Indic digits to ASCII and strip the hidden
 // bidirectional control marks that toLocaleDateString('ar-EG') injects.
 // Without this, dates stored as "٢٢‏/٦‏/٢٠٢٦" break every numeric parse.
 function normalizeDigits(str) {
 if (str == null) return '';
 const map = {'٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
 '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9'};
 return String(str)
 .replace(/[٠-٩۰-۹]/g, d => map[d] || d)
 .replace(/[‎‏؜‪-‮⁦-⁩]/g, '')
 .trim();
 }

 // Coerce any stored amount (number or legacy string) to a safe number.
 function num(v) {
 const n = parseFloat(normalizeDigits(v));
 return isNaN(n) ? 0 : n;
 }

 // Staff-cost expense types: monthly salary, mid-month advance, and
 // percentage/commission payouts. All count as "salaries" in the reports.
 const SALARY_TYPES = ['مرتب', 'سلفة', 'نسبة', 'خصم'];
 function isSalaryType(type) {
 return SALARY_TYPES.indexOf(type) !== -1;
 }

 // The branches, used by the per-branch report pages.
 const BRANCHES = ['فرع المريوطيه 1', 'فرع المريوطيه 2', 'فرع الحدايق'];

 // The sports offered, and the levels that only apply to "جمباز فني".
 const SPORTS = ['جمباز فني', 'جمباز ايروبك', 'كاراتيه', 'كونغ فو ساندا', 'كيك بوكس', 'تيكوندو', 'كونغ فو اساليب', 'ملاكمه', 'موياي تاي', 'كالستانكس'];
 const GYM_LEVELS = ['قطاع مدارس', 'قطاع تجهيزي', 'قطاع فريق'];

 // Every subscription is monthly (it ends by date, not by sessions). The number
 // of sessions per month is fixed per sport/sector and only auto-fills the form
 // (still editable). Sports NOT listed here (ملاكمة / كونغ فو أساليب / كالستانكس
 // / جمباز أيروبك) have no fixed count and are entered manually.
 const COMBAT_MONTHLY_SESSIONS = { 'كاراتيه': 8, 'كونغ فو ساندا': 8, 'كيك بوكس': 8, 'تيكوندو': 8, 'موياي تاي': 8 };
 const GYM_SECTOR_SESSIONS = { 'قطاع مدارس': 8, 'قطاع تجهيزي': 12, 'قطاع فريق': 16 };
 // Returns the fixed monthly sessions for a sport (+ gym sector), or '' if the
 // sport is one of the manual ones.
 function defaultMonthlySessions(sport, level) {
 if (sport === 'جمباز فني') return GYM_SECTOR_SESSIONS[level] || '';
 return COMBAT_MONTHLY_SESSIONS[sport] || '';
 }
 const PAYMENT_METHODS = ['نقداً', 'تحويل بنكي', 'فودافون كاش', 'انستا باي'];

 function sportOptionsHTML(selected) {
 return '<option value="">— اختر الرياضة —</option>' +
 SPORTS.map(s => `<option value="${esc(s)}" ${s === selected ? 'selected' : ''}>${esc(s)}</option>`).join('');
 }
 function levelOptionsHTML(selected) {
 return GYM_LEVELS.map(l => `<option value="${esc(l)}" ${l === selected ? 'selected' : ''}>${esc(l)}</option>`).join('');
 }
 function methodOptionsHTML(selected) {
 return PAYMENT_METHODS.map(m => `<option value="${esc(m)}" ${m === selected ? 'selected' : ''}>${esc(m)}</option>`).join('');
 }
 // Builds <option>s for a branch dropdown from the BRANCHES list above.
 // Pass includeNone=true to also offer a "غير محدد" (unspecified) choice,
 // which is selected when the record has no branch set.
 function branchOptionsHTML(selected, includeNone) {
 let html = BRANCHES.map(b => `<option value="${esc(b)}" ${b === selected ? 'selected' : ''}>${esc(b)}</option>`).join('');
 if (includeNone) {
 html += `<option value="غير محدد" ${(!selected || selected === 'غير محدد') ? 'selected' : ''}>غير محدد</option>`;
 }
 return html;
 }
 // Sport label including the gymnastics level when present.
 // All sports a player practises — multi-sport aware, backward compatible with
 // old records that only had a single `sport`/`plan`.
 function traineeSports(t) {
 if (t.sports && t.sports.length) return t.sports;
 const s = t.sport || t.plan;
 return s ? [s] : [];
 }
 function sportLabel(t) {
 const list = traineeSports(t);
 const base = list.length ? list.join('، ') : '-';
 return t.level ? `${base} (${t.level})` : base;
 }

 // ==================== CARD NUMBERING & COLOURS ====================
 // Each sport owns its own 1000-number block on the printed cards, fixed in code
 // (NOT editable from the UI): SPORTS order gives 1000, 2000 ... 9000, then we
 // skip 10000 and continue 11000, 12000... To change a sport's code, edit here.
 function sportCardBase(sport) {
 const i = SPORTS.indexOf(sport);
 if (i === -1) return null;
 const n = i + 1;                     // 1-based position in SPORTS
 return (n <= 9 ? n : n + 1) * 1000;  // 1000..9000, skip 10000 -> 11000,12000...
 }

 // Which sport a card code belongs to — the sport whose block (base..base+999)
 // contains the number. Lets each card show its own sport's name + colour.
 function sportForCode(code) {
 const v = parseInt(normalizeDigits(code), 10);
 if (isNaN(v)) return '';
 for (const s of SPORTS) {
 const base = sportCardBase(s);
 if (base != null && v >= base && v <= base + 999) return s;
 }
 return '';
 }

 // A distinct accent colour per sport, so every sport's cards look different.
 // Unknown sports fall back to the classic gold.
 const SPORT_COLORS = {
 'جمباز فني': '#C0392B', 'جمباز ايروبك': '#E67E22', 'كاراتيه': '#2980B9',
 'كونغ فو ساندا': '#8E44AD', 'كيك بوكس': '#16A085', 'تيكوندو': '#27AE60',
 'كونغ فو اساليب': '#B7950B', 'ملاكمه': '#7B241C', 'موياي تاي': '#BA4A00',
 'كالستانكس': '#E84393'
 };
 function sportColor(sport) { return SPORT_COLORS[(sport || '').trim()] || '#D4AF37'; }

 // Generates `n` sequential card numbers for a sport, continuing after the
 // highest number already used in that sport's block (registered players + a
 // per-block high-water mark so repeated prints keep advancing). If the block
 // fills, the rest roll into the shared reserve pool so numbers never repeat.
 const CARD_OVERFLOW_BASE = 90000; // shared pool used only if a sport's block fills up
 function generateSportCodes(sport, n) {
 const base = sportCardBase(sport);
 if (base == null) return null; // no code for this sport
 const blockEnd = base + 999;
 const usedNum = id => parseInt(normalizeDigits(id), 10);
 const usedInBlock = data.trainees.map(t => usedNum(t.id)).filter(v => !isNaN(v) && v >= base && v <= blockEnd);
 const hwKey = `card-serial-${base}`;
 const hw = parseInt(localStorage.getItem(hwKey) || '0', 10);
 let next = Math.max(base - 1, hw, ...usedInBlock) + 1;

 const codes = [];
 while (codes.length < n && next <= blockEnd) { codes.push(String(next)); next++; }
 localStorage.setItem(hwKey, String(Math.min(next - 1, blockEnd)));

 if (codes.length < n) {
 const rKey = 'card-serial-reserve';
 const usedReserve = data.trainees.map(t => usedNum(t.id)).filter(v => !isNaN(v) && v >= CARD_OVERFLOW_BASE);
 let r = Math.max(CARD_OVERFLOW_BASE - 1, parseInt(localStorage.getItem(rKey) || '0', 10), ...usedReserve);
 while (codes.length < n) { r++; codes.push(String(r)); }
 localStorage.setItem(rKey, String(r));
 }
 return codes;
 }

 // Prints branded blank cards for ONE sport: each card carries a sequential
 // number from that sport's block (so the number itself says which sport), the
 // sport name, a QR, and the sport's own colour. Laid out 8 per A4 page (2×4).
 // You write the player's name by hand, then enter the card's number in
 // "كود البطاقة" when you register that player.
 function printBlankCards() {
 const sport = document.getElementById('blank-cards-sport').value;
 if (!sport || sportCardBase(sport) == null) { showNotification('اختر الرياضة أولاً', 'warning'); return; }
 const qty = Math.min(parseInt(document.getElementById('blank-cards-qty').value) || 0, 1000);
 if (qty <= 0) { showNotification('أدخل عدد الكروت', 'warning'); return; }

 const logoUrl = new URL('src/logo-after.png', location.href).href;
 const codes = generateSportCodes(sport, qty);
 const color = sportColor(sport);

 const cardEls = codes.map(code => `
 <div class="card">
 <div class="card-top">
 <div class="brand">
 <div class="club-name">El Wasl <span>Academy</span></div>
 <div class="club-sub">${esc(sport)}</div>
 </div>
 <img class="brand-logo" src="${logoUrl}" alt="" onerror="this.style.display='none'">
 </div>
 <div class="divider"></div>
 <div class="card-body">
 <div class="card-info">
 <div class="lbl">الرياضة</div>
 <div class="member-plan">${esc(sport)}</div>
 <div class="lbl">الكود</div>
 <div class="member-code">${esc(code)}</div>
 </div>
 <div class="qr-box"><div class="qr" data-code="${esc(code)}"></div></div>
 </div>
 <div class="card-footer">يُستخدم هذا الكود لتسجيل الحضور عند الدخول</div>
 </div>`);

 // 8 cards per A4 page (2 columns × 4 rows), page break after each eight.
 let pages = '';
 for (let i = 0; i < cardEls.length; i += 8) {
 pages += `<div class="print-page">${cardEls.slice(i, i + 8).join('')}</div>`;
 }

 const qrUrl = new URL('vendor/qrcode.min.js', location.href).href;
 const win = window.open('', '_blank');
 if (!win) { showNotification('فعّل السماح بالنوافذ المنبثقة لطباعة الكروت', 'warning'); return; }
 win.document.write(`
 <html dir="rtl" lang="ar"><head><title>كروت ${esc(sport)} (${qty})</title>
 <meta charset="UTF-8">
 <script src="${qrUrl}"><\/script>
 <style>
 @page { size: A4; margin: 8mm; }
 * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
 body { background: #ffffff; }
 /* 8 cards per page: a 2×4 grid, with a page break after each page. */
 .print-page { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; align-content: start; page-break-after: always; }
 .print-page:last-child { page-break-after: auto; }
 .card {
 position: relative; width: 90mm; height: 56mm; overflow: hidden;
 background:
 radial-gradient(60mm 40mm at 88% 8%, ${color}33, transparent 60%),
 linear-gradient(135deg, #1B2433 0%, #243049 60%, #18212f 100%);
 border-radius: 8px; padding: 4.5mm 5mm;
 display: flex; flex-direction: column; justify-content: space-between; color: #E9EDF3;
 }
 .card::before { content: ''; position: absolute; inset: 1.1mm; border: 0.5mm solid ${color}; border-radius: 6px; }
 .card::after { content: ''; position: absolute; top: 0; right: 0; left: 0; height: 1.6mm; background: ${color}; }
 .card-top { display: flex; justify-content: space-between; align-items: center; z-index: 1; }
 .club-name { font-size: 15px; font-weight: 900; color: #fff; letter-spacing: 1px; }
 .club-name span { color: ${color}; }
 .club-sub { font-size: 8px; letter-spacing: 1px; color: ${color}; margin-top: 1.5mm; font-weight: 700; }
 .brand-logo { height: 12mm; width: auto; }
 .divider { height: 0.3mm; background: linear-gradient(90deg, transparent, ${color}, transparent); margin: 1mm 0; }
 .card-body { display: flex; justify-content: space-between; align-items: center; gap: 4mm; z-index: 1; }
 .card-info { flex: 1; min-width: 0; }
 .lbl { font-size: 7px; letter-spacing: 1px; color: rgba(233,237,243,0.5); text-transform: uppercase; }
 .member-plan { font-size: 11px; color: ${color}; font-weight: 700; margin: 0.5mm 0 1.5mm; }
 .member-code { font-size: 18px; font-family: 'Courier New', monospace; letter-spacing: 2px; color: ${color}; font-weight: 800; margin-top: 1mm; }
 .qr-box { background: #ffffff; padding: 1.2mm; border-radius: 1.5mm; line-height: 0; box-shadow: 0 0 0 0.4mm ${color}; }
 .card-footer { font-size: 6.5px; color: ${color}; text-align: center; z-index: 1; }
 </style>
 </head>
 <body>
 ${pages}
 <script>
 window.onload = function() {
 function render() {
 if (window.QRCode) {
 document.querySelectorAll('.qr').forEach(function(el) {
 new QRCode(el, { text: el.getAttribute('data-code'), width: 64, height: 64, colorDark: '#1B2433', colorLight: '#ffffff' });
 });
 }
 setTimeout(function() { window.print(); }, 500);
 }
 if (window.QRCode) { render(); }
 else { var s = document.createElement('script'); s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"; s.onload = render; s.onerror = render; document.head.appendChild(s); }
 };
 <\/script>
 </body></html>
 `);
 win.document.close();
 }

 // Normalize any stored date (Arabic or ISO) to a "YYYY-MM-DD" key, so a
 // single calendar day can be matched reliably regardless of stored format.
 function dateKey(dateStr) {
 const ts = parseDate(dateStr);
 if (!ts) return '';
 const d = new Date(ts);
 const y = d.getFullYear();
 const m = String(d.getMonth() + 1).padStart(2, '0');
 const day = String(d.getDate()).padStart(2, '0');
 return `${y}-${m}-${day}`;
 }

 // Escape user-supplied text before inserting it into innerHTML, so a name
 // or note containing HTML/quotes can't break the layout or inject script.
 // Safe for both element content and double-quoted attribute values.
 function esc(v) {
 return String(v == null ? '' : v)
 .replace(/&/g, '&amp;')
 .replace(/</g, '&lt;')
 .replace(/>/g, '&gt;')
 .replace(/"/g, '&quot;')
 .replace(/'/g, '&#39;');
 }

 // ---- Small DOM helpers (cut the repeated getElementById noise) ----
 // Current value of an input/select by id ('' if it doesn't exist).
 function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }
 // Set an element's value by id (no-op if it doesn't exist).
 function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
 // The standard grey "branch" pill shown in every table. One place so the
 // styling and the "غير محدد" fallback stay identical everywhere.
 function branchBadge(branch) {
 return `<span class="badge" style="background: rgba(48,56,65,0.05); border: 1px solid rgba(48,56,65,0.2);">${esc(branch || 'غير محدد')}</span>`;
 }
 // Opens the shared modal with a title + body HTML, then reveals the overlay.
 function openModal(title, html) {
 document.getElementById('modal-title-text').textContent = title;
 document.getElementById('modal-body').innerHTML = html;
 document.getElementById('modal-overlay').classList.add('show');
 }

 // Robust date parser: handles Arabic-locale "day/month/year" (with Arabic
 // digits + direction marks) AND ISO "YYYY-MM-DD". Always returns a number,
 // never NaN, so sorting and range filters stay correct for mixed formats.
 function parseDate(dateStr) {
 const s = normalizeDigits(dateStr);
 if (!s) return 0;
 const parts = s.split('/');
 if (parts.length === 3) {
 const d = parseInt(parts[0], 10);
 const m = parseInt(parts[1], 10);
 const y = parseInt(parts[2], 10);
 const t = new Date(y, m - 1, d).getTime();
 if (!isNaN(t)) return t;
 }
 const t = new Date(s).getTime();
 return isNaN(t) ? 0 : t;
 }

  // ==================== FINANCIAL DASHBOARD ====================
  // Delegates to the shared robust parser so both dashboards agree.
  function fdParseDate(dateStr) {
  return parseDate(dateStr);
  }

  function fdFilterByDateRange(items, dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return items;
  const from = dateFrom ? new Date(dateFrom).setHours(0,0,0,0) : 0;
  const to = dateTo ? new Date(dateTo).setHours(23,59,59,999) : Infinity;
  return items.filter(item => {
  const d = fdParseDate(item.date);
  return d >= from && d <= to;
  });
  }

  function fdGroupBy(arr, key) {
  const map = {};
  arr.forEach(item => {
  const k = item[key] || 'غير محدد';
  if (!map[k]) map[k] = [];
  map[k].push(item);
  });
  return map;
  }

  function fdBreakdownHTML(grouped, valueColor) {
  return Object.entries(grouped).map(([label, items]) => {
  const total = items.reduce((s, i) => s + num(i.amount), 0);
  return `
  <div class="fd-breakdown-item">
  <div class="fd-bd-label">${esc(label)}</div>
  <div class="fd-bd-value" style="color: ${valueColor};">${total.toLocaleString()} ج.م</div>
  <div class="fd-bd-count">${items.length} عملية</div>
  </div>`;
  }).join('');
  }

  function fdEmptyRow(cols) {
  return `<tr><td colspan="${cols}" style="text-align:center; color: rgba(48,56,65,0.3); padding: 25px;">لا توجد بيانات</td></tr>`;
  }

  // ===== Monthly targets per branch (forecast from existing data) =====
  // Revenue (paid) for a branch in a given calendar month.
  function branchMonthRevenue(branch, y, m) {
  return data.payments.reduce((s, p) => {
  if (p.branch !== branch) return s;
  const ts = parseDate(p.date);
  if (!ts) return s;
  const d = new Date(ts);
  return (d.getFullYear() === y && d.getMonth() === m) ? s + num(p.amount) : s;
  }, 0);
  }

  // Forecast target for THIS month = average of the last 3 completed months for
  // the branch, adjusted by the recent trend (rate of change). Returns 0 if the
  // branch has no history yet.
  function branchTarget(branch) {
  const now = new Date();
  const revs = [];
  for (let k = 3; k >= 1; k--) {
  const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
  revs.push(branchMonthRevenue(branch, d.getFullYear(), d.getMonth()));
  }
  const nonzero = revs.filter(v => v > 0);
  if (nonzero.length === 0) return 0;
  const avg = nonzero.reduce((a, b) => a + b, 0) / nonzero.length;
  const trend = (revs[revs.length - 1] - revs[0]) / (revs.length - 1); // avg monthly change
  return Math.max(0, Math.round(avg + trend));
  }

  // Renders the per-branch "target vs achieved this month" card.
  function renderBranchTargets() {
  const box = document.getElementById('fd-targets-content');
  if (!box) return;
  const now = new Date();
  box.innerHTML = BRANCHES.map(b => {
  const target = branchTarget(b);
  const actual = branchMonthRevenue(b, now.getFullYear(), now.getMonth());
  const pct = target > 0 ? Math.round((actual / target) * 100) : 0;
  const col = pct >= 100 ? 'var(--success)' : (pct >= 60 ? 'var(--gold)' : 'var(--danger)');
  return `
  <div class="fd-branch-row">
  <div class="fd-branch-name">${esc(b)}</div>
  <div class="fd-branch-bar-container"><div class="fd-branch-bar" style="width:${Math.min(100, pct)}%; background:${col};"></div></div>
  <div class="fd-branch-val">المستهدف: ${target.toLocaleString()} ج.م</div>
  <div class="fd-branch-val income-val">المحقّق: ${actual.toLocaleString()} ج.م</div>
  <div class="fd-branch-val" style="color:${col}; font-weight:800;">${pct}%</div>
  </div>`;
  }).join('');
  }

  function renderFinancialDashboard() {
  const branch = document.getElementById('fd-branch-filter').value;
  const dateFrom = document.getElementById('fd-date-from').value;
  const dateTo = document.getElementById('fd-date-to').value;

  // Filter data
  let payments = [...data.payments];
  let expenses = [...data.expenses];

  if (branch !== 'الكل') {
  payments = payments.filter(p => p.branch === branch);
  expenses = expenses.filter(e => e.branch === branch);
  }

  payments = fdFilterByDateRange(payments, dateFrom, dateTo);
  expenses = fdFilterByDateRange(expenses, dateFrom, dateTo);

  // Calculations
  const totalIncome = payments.reduce((s, p) => s + num(p.amount), 0);
  const totalExpenses = expenses.reduce((s, e) => s + num(e.amount), 0);
  const salaryExpenses = expenses.filter(e => isSalaryType(e.type));
  const nonSalaryExpenses = expenses.filter(e => !isSalaryType(e.type));
  const totalSalaries = salaryExpenses.reduce((s, e) => s + num(e.amount), 0);
  const netProfit = totalIncome - totalExpenses;
  const profitMargin = totalIncome > 0 ? Math.round((netProfit / totalIncome) * 100) : 0;

  const newSubs = payments.filter(p => p.type === 'اشتراك جديد');
  const renewals = payments.filter(p => p.type === 'تجديد');
  const newSubsTotal = newSubs.reduce((s, p) => s + num(p.amount), 0);
  const renewalsTotal = renewals.reduce((s, p) => s + num(p.amount), 0);

  // KPI Cards
  document.getElementById('fd-total-income').textContent = `${totalIncome.toLocaleString()} ج.م`;
  document.getElementById('fd-income-count').textContent = `${payments.length} عملية`;
  document.getElementById('fd-total-expenses').textContent = `${totalExpenses.toLocaleString()} ج.م`;
  document.getElementById('fd-expense-count').textContent = `${expenses.length} عملية`;
  document.getElementById('fd-total-salaries').textContent = `${totalSalaries.toLocaleString()} ج.م`;
  document.getElementById('fd-salary-count').textContent = `${salaryExpenses.length} عملية صرف`;
  document.getElementById('fd-net-profit').textContent = `${netProfit.toLocaleString()} ج.م`;
  document.getElementById('fd-profit-margin').textContent = `هامش الربح: ${profitMargin}%`;
  document.getElementById('fd-new-subs').textContent = `${newSubsTotal.toLocaleString()} ج.م`;
  document.getElementById('fd-new-subs-count').textContent = `${newSubs.length} اشتراك`;
  document.getElementById('fd-renewals').textContent = `${renewalsTotal.toLocaleString()} ج.م`;
  document.getElementById('fd-renewals-count').textContent = `${renewals.length} تجديد`;

  // Color the profit card
  const profitEl = document.getElementById('fd-net-profit');
  profitEl.style.color = netProfit >= 0 ? 'var(--success)' : 'var(--danger)';

  // Badges
  document.getElementById('fd-income-badge').textContent = `${totalIncome.toLocaleString()} ج.م`;
  document.getElementById('fd-expense-badge').textContent = `${totalExpenses.toLocaleString()} ج.م`;
  document.getElementById('fd-salary-badge').textContent = `${totalSalaries.toLocaleString()} ج.م`;

  // === Monthly targets per branch (forecast) ===
  renderBranchTargets();

  // === Branch Comparison ===
  const compCard = document.getElementById('fd-branch-comparison-card');
  if (branch === 'الكل') {
  compCard.style.display = 'block';
  let branchData = BRANCHES.map(b => {
  let bp = fdFilterByDateRange(data.payments.filter(p => p.branch === b), dateFrom, dateTo);
  let be = fdFilterByDateRange(data.expenses.filter(e => e.branch === b), dateFrom, dateTo);
  const inc = bp.reduce((s, p) => s + num(p.amount), 0);
  const exp = be.reduce((s, e) => s + num(e.amount), 0);
  return { name: b, income: inc, expenses: exp, profit: inc - exp };
  });
  const maxIncome = Math.max(...branchData.map(b => b.income), 1);

  document.getElementById('fd-branch-comparison-content').innerHTML = `
  <div style="margin-bottom: 8px;">
  <div class="fd-branch-row" style="font-weight: 600; font-size: 12px; color: rgba(48,56,65,0.5); border-bottom: 2px solid rgba(48,56,65,0.1);">
  <div>الفرع</div>
  <div>نسبة الإيرادات</div>
  <div style="text-align:center;">الإيرادات</div>
  <div style="text-align:center;">المصروفات</div>
  <div style="text-align:center;">صافي الربح</div>
  </div>
  ${branchData.map(b => `
  <div class="fd-branch-row">
  <div class="fd-branch-name">${b.name}</div>
  <div class="fd-branch-bar-container">
  <div class="fd-branch-bar profit-bar" style="width: ${Math.round((b.income / maxIncome) * 100)}%;"></div>
  </div>
  <div class="fd-branch-val income-val">${b.income.toLocaleString()} ج.م</div>
  <div class="fd-branch-val expense-val">${b.expenses.toLocaleString()} ج.م</div>
  <div class="fd-branch-val profit-val">${b.profit.toLocaleString()} ج.م</div>
  </div>
  `).join('')}
  </div>`;
  } else {
  compCard.style.display = 'none';
  }

  // === Income Breakdown by Type ===
  const incomeByType = fdGroupBy(payments, 'type');
  document.getElementById('fd-income-breakdown').innerHTML = fdBreakdownHTML(incomeByType, 'var(--success)') || '<div style="color: rgba(48,56,65,0.3); padding: 12px;">لا توجد إيرادات</div>';

  // === Income by Payment Method ===
  const incomeByMethod = fdGroupBy(payments, 'method');
  document.getElementById('fd-income-by-method').innerHTML = fdBreakdownHTML(incomeByMethod, 'var(--gold)') || '<div style="color: rgba(48,56,65,0.3); padding: 12px;">لا توجد بيانات</div>';

  // === Full Income Table ===
  const incTbody = document.getElementById('fd-income-table');
  if (payments.length === 0) {
  incTbody.innerHTML = fdEmptyRow(10);
  } else {
  incTbody.innerHTML = payments.map((p, i) => `
  <tr>
  <td>${i + 1}</td>
  <td><code style="color: var(--gold); font-family: monospace;">${esc(p.id)}</code></td>
  <td>${esc(p.name)}</td>
  <td><span class="badge ${p.type === 'تجديد' ? 'badge-info' : 'badge-success'}">${esc(p.type)}</span></td>
  <td style="font-size: 12px;">${esc(p.plan || '-')}</td>
  <td>${branchBadge(p.branch)}</td>
  <td style="color: var(--success); font-weight: 700;">${num(p.amount).toLocaleString()} ج.م</td>
  <td>${esc(p.method || '-')}</td>
  <td>${esc(p.date)}</td>
  <td style="font-size:11px; color:rgba(48,56,65,0.55);">${esc(p.createdBy || '—')}</td>
  </tr>
  `).join('');
  }

  // === Expense Breakdown by Type ===
  const expenseByType = fdGroupBy(nonSalaryExpenses, 'type');
  // Add salary as a category
  if (salaryExpenses.length > 0) {
  expenseByType['مرتبات'] = salaryExpenses;
  }
  document.getElementById('fd-expense-breakdown').innerHTML = fdBreakdownHTML(expenseByType, 'var(--danger)') || '<div style="color: rgba(48,56,65,0.3); padding: 12px;">لا توجد مصروفات</div>';

  // === Full Expenses Table (non-salary) ===
  const expTbody = document.getElementById('fd-expense-table');
  if (nonSalaryExpenses.length === 0) {
  expTbody.innerHTML = fdEmptyRow(8);
  } else {
  expTbody.innerHTML = nonSalaryExpenses.map((e, i) => `
  <tr>
  <td>${i + 1}</td>
  <td><code style="color: var(--warning); font-family: monospace;">${esc(e.id)}</code></td>
  <td><span class="badge badge-warning">${esc(e.type)}</span></td>
  <td>${esc(e.desc || '-')}</td>
  <td>${branchBadge(e.branch)}</td>
  <td style="color: var(--danger); font-weight: 700;">${num(e.amount).toLocaleString()} ج.م</td>
  <td>${esc(e.date)}</td>
  <td style="font-size:11px; color:rgba(48,56,65,0.55);">${esc(e.createdBy || '—')}</td>
  </tr>
  `).join('');
  }

  // === Salary Table ===
  const salTbody = document.getElementById('fd-salary-table');
  if (salaryExpenses.length === 0) {
  salTbody.innerHTML = fdEmptyRow(7);
  } else {
  salTbody.innerHTML = salaryExpenses.map((e, i) => `
  <tr>
  <td>${i + 1}</td>
  <td><code style="color: var(--warning); font-family: monospace;">${esc(e.id)}</code></td>
  <td>${esc(e.desc || '-')}</td>
  <td>${branchBadge(e.branch)}</td>
  <td style="color: var(--danger); font-weight: 700;">${num(e.amount).toLocaleString()} ج.م</td>
  <td>${esc(e.date)}</td>
  <td style="font-size:11px; color:rgba(48,56,65,0.55);">${esc(e.createdBy || '—')}</td>
  </tr>
  `).join('');
  }

  // === All Transactions (combined ledger) ===
  const allTransactions = [
  ...payments.map(p => ({ kind: 'إيراد', desc: `${p.type} - ${p.name} (${p.plan || ''})`, branch: p.branch, income: p.amount, expense: 0, date: p.date, createdBy: p.createdBy, rawDate: fdParseDate(p.date) })),
  ...expenses.map(e => ({ kind: 'مصروف', desc: `${e.type} - ${e.desc || ''}`, branch: e.branch, income: 0, expense: e.amount, date: e.date, createdBy: e.createdBy, rawDate: fdParseDate(e.date) }))
  ].sort((a, b) => b.rawDate - a.rawDate);

  const allTbody = document.getElementById('fd-all-transactions-table');
  if (allTransactions.length === 0) {
  allTbody.innerHTML = fdEmptyRow(8);
  } else {
  allTbody.innerHTML = allTransactions.map((t, i) => `
  <tr>
  <td>${i + 1}</td>
  <td><span class="badge ${t.kind === 'إيراد' ? 'badge-success' : 'badge-danger'}">${esc(t.kind)}</span></td>
  <td>${esc(t.desc)}</td>
  <td>${branchBadge(t.branch)}</td>
  <td style="color: var(--success); font-weight: 700;">${t.income > 0 ? num(t.income).toLocaleString() + ' ج.م' : '-'}</td>
  <td style="color: var(--danger); font-weight: 700;">${t.expense > 0 ? num(t.expense).toLocaleString() + ' ج.م' : '-'}</td>
  <td>${esc(t.date)}</td>
  <td style="font-size:11px; color:rgba(48,56,65,0.55);">${esc(t.createdBy || '—')}</td>
  </tr>
  `).join('');
  }
  }

  function resetFDFilters() {
  document.getElementById('fd-branch-filter').value = 'الكل';
  document.getElementById('fd-date-from').value = '';
  document.getElementById('fd-date-to').value = '';
  renderFinancialDashboard();
  }

  function exportFinancialDashboardReport() {
  const branch = document.getElementById('fd-branch-filter').value;
  const dateFrom = document.getElementById('fd-date-from').value;
  const dateTo = document.getElementById('fd-date-to').value;

  let payments = [...data.payments];
  let expenses = [...data.expenses];
  if (branch !== 'الكل') {
  payments = payments.filter(p => p.branch === branch);
  expenses = expenses.filter(e => e.branch === branch);
  }
  payments = fdFilterByDateRange(payments, dateFrom, dateTo);
  expenses = fdFilterByDateRange(expenses, dateFrom, dateTo);

  const totalIncome = payments.reduce((s, p) => s + num(p.amount), 0);
  const totalExpenses = expenses.reduce((s, e) => s + num(e.amount), 0);
  const totalSalaries = expenses.filter(e => isSalaryType(e.type)).reduce((s, e) => s + num(e.amount), 0);
  const netProfit = totalIncome - totalExpenses;

  const paymentRows = payments.map((p, i) => `
  <tr>
  <td>${i+1}</td><td>${esc(p.id)}</td><td>${esc(p.name)}</td><td>${esc(p.type)}</td>
  <td>${esc(p.plan || '-')}</td><td>${esc(p.branch || 'غير محدد')}</td>
  <td>${num(p.amount).toLocaleString()} ج.م</td><td>${esc(p.method || '-')}</td><td>${esc(p.date)}</td>
  </tr>
  `).join('') || '<tr><td colspan="9" style="text-align:center; color:#9aa1ab;">لا توجد إيرادات</td></tr>';

  const expenseRows = expenses.map((e, i) => `
  <tr>
  <td>${i+1}</td><td>${esc(e.id)}</td><td>${esc(e.type)}</td><td>${esc(e.desc || '-')}</td>
  <td>${esc(e.branch || 'غير محدد')}</td><td>${num(e.amount).toLocaleString()} ج.م</td><td>${esc(e.date)}</td>
  </tr>
  `).join('') || '<tr><td colspan="7" style="text-align:center; color:#9aa1ab;">لا توجد مصروفات</td></tr>';

  const filterInfo = branch !== 'الكل' ? `الفرع: ${branch}` : 'كل الفروع';
  const dateInfo = (dateFrom || dateTo) ? ` | الفترة: ${dateFrom || '...'} إلى ${dateTo || '...'}` : '';

  const body = `
  <div class="section-block">
  <div class="report-title">التقرير المالي التفصيلي</div>
  <div style="font-size:12px; color:#6b7280; margin-bottom:14px;">${filterInfo}${dateInfo}</div>
  <div class="summary-row">
  ${summaryBox('إجمالي الإيرادات', totalIncome.toLocaleString() + ' ج.م')}
  ${summaryBox('إجمالي المصروفات', totalExpenses.toLocaleString() + ' ج.م')}
  ${summaryBox('المرتبات', totalSalaries.toLocaleString() + ' ج.م')}
  ${summaryBox('صافي الربح', netProfit.toLocaleString() + ' ج.م')}
  </div>
  <table>
  <thead><tr><th colspan="9" style="text-align:right; background:#B8901F;">الإيرادات</th></tr>
  <tr><th>#</th><th>الكود</th><th>الاسم</th><th>النوع</th><th>الرياضة</th><th>الفرع</th><th>المبلغ</th><th>طريقة الدفع</th><th>التاريخ</th></tr></thead>
  <tbody>${paymentRows}</tbody>
  </table>
  <table>
  <thead><tr><th colspan="7" style="text-align:right; background:#B8901F;">المصروفات</th></tr>
  <tr><th>#</th><th>الكود</th><th>النوع</th><th>الوصف</th><th>الفرع</th><th>المبلغ</th><th>التاريخ</th></tr></thead>
  <tbody>${expenseRows}</tbody>
  </table>
  </div>
  `;
  reportDoc('التقرير المالي التفصيلي - ' + filterInfo, body);
  }

  function updateBadge() {
  document.getElementById('reg-badge').textContent = data.trainees.length;
 }

 // ==================== REPORTS ====================
 function updateReports() {
 renderFeedback();
 const monthInput = document.getElementById('monthly-month');
 if (monthInput && !monthInput.value) monthInput.value = thisMonthVal();

 const total = data.trainees.length;
 const active = data.trainees.filter(t => t.status === 'نشط').length;
 const tests = data.trainees.filter(t => t.type === 'test').length;
 const totalIncome = data.payments.reduce((sum, p) => sum + num(p.amount), 0);
 const totalExpenses = data.expenses.reduce((sum, e) => sum + num(e.amount), 0);
 const totalSalaries = data.expenses.filter(e => isSalaryType(e.type)).reduce((sum, e) => sum + num(e.amount), 0);
 const totalAttendance = data.attendance.length;

 document.getElementById('members-report').innerHTML = `
 ${reportItem('إجمالي اللاعبين', total, 'var(--gold)')}
 ${reportItem('اشتراكات نشطة', active, 'var(--success)')}
 ${reportItem('جلسات تجريبية', tests, 'var(--gold)')}
 ${reportItem('نسبة التحويل', total > 0 ? `${Math.round((active/total)*100)}%` : '0%', 'var(--warning)')}
 `;

 document.getElementById('financial-report').innerHTML = `
 ${reportItem('إجمالي الإيرادات', `${totalIncome.toLocaleString()} ج.م`, 'var(--success)')}
 ${reportItem('المصروفات', `${totalExpenses.toLocaleString()} ج.م`, 'var(--danger)')}
 ${reportItem('مرتبات مصروفة', `${totalSalaries.toLocaleString()} ج.م`, 'var(--warning)')}
 ${reportItem('صافي الربح', `${(totalIncome - totalExpenses).toLocaleString()} ج.م`, 'var(--gold)')}
 `;

 document.getElementById('attendance-report').innerHTML = `
 ${reportItem('إجمالي سجلات الحضور', totalAttendance, 'var(--success)')}
 ${reportItem('أيام التشغيل', [...new Set(data.attendance.map(a => a.date))].length, 'var(--gold)')}
 ${reportItem('متوسط الحضور اليومي', totalAttendance > 0 ? Math.round(totalAttendance / Math.max(1, [...new Set(data.attendance.map(a => a.date))].length)) : 0, 'var(--warning)')}
 `;
 }

 function reportItem(label, value, color = 'var(--accent)') {
 return `
 <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; background: rgba(48,56,65,0.03); border-radius: 8px;">
 <span style="color: rgba(48,56,65,0.6); font-size: 13px;">${label}</span>
 <span style="font-weight: 700; color: ${color};">${value}</span>
 </div>
 `;
 }

 function reportDoc(title, bodyHtml) {
 const win = window.open('', '_blank');
 if (!win) { showNotification('فعّل السماح بالنوافذ المنبثقة لطباعة التقرير', 'warning'); return; }
 win.document.write(`
 <html dir="rtl" lang="ar"><head><title>${title}</title>
 <meta charset="UTF-8">
 <style>
 * { box-sizing: border-box; margin: 0; padding: 0; font-family: Arial, sans-serif; }
 body { background: #ffffff; color: #1B2433; padding: 30px 40px; }
 .report-header {
 display: flex; justify-content: space-between; align-items: flex-end;
 border-bottom: 3px solid #B8901F; padding-bottom: 14px; margin-bottom: 20px;
 }
 .academy-name { font-size: 26px; font-weight: 800; letter-spacing: 1px; color: #1B2433; }
 .report-meta { text-align: left; font-size: 12px; color: #6b7280; }
 .report-title { font-size: 17px; font-weight: 700; color: #B8901F; margin: 18px 0 10px; }
 .summary-row { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
 .summary-box {
 flex: 1; min-width: 140px; border: 1px solid #e3e6eb; border-radius: 8px;
 padding: 10px 14px; background: #f7f9fb;
 }
 .summary-label { font-size: 11px; color: #6b7280; margin-bottom: 4px; }
 .summary-value { font-size: 16px; font-weight: 700; color: #1B2433; }
 table { width: 100%; border-collapse: collapse; margin-bottom: 26px; font-size: 12px; }
 th, td { border: 1px solid #e3e6eb; padding: 8px 10px; text-align: right; }
 th { background: #1B2433; color: #ffffff; font-weight: 600; }
 tbody tr:nth-child(even) { background: #f7f9fb; }
 .section-block { page-break-inside: avoid; }
 .report-footer { margin-top: 10px; font-size: 11px; color: #9aa1ab; text-align: center; }
 @media print { .summary-box { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
 th { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
 </style>
 </head>
 <body>
 <div class="report-header">
 <div class="academy-name">Academy</div>
 <div class="report-meta">تاريخ الطباعة: ${todayAr()}</div>
 </div>
 ${bodyHtml}
 <div class="report-footer">تم إنشاء هذا التقرير تلقائياً من نظام إدارة الأكاديمية</div>
 <script>
 window.onload = function() { setTimeout(function() { window.print(); }, 250); };
 <\/script>
 </body></html>
 `);
 win.document.close();
 }

 function summaryBox(label, value) {
 return `<div class="summary-box"><div class="summary-label">${label}</div><div class="summary-value">${value}</div></div>`;
 }

 function buildMembersReport(branch) {
 const trainees = branch ? data.trainees.filter(t => (t.branch || 'غير محدد') === branch) : data.trainees;
 const total = trainees.length;
 const active = trainees.filter(t => t.status === 'نشط').length;
 const tests = trainees.filter(t => t.type === 'test').length;
 const conv = total > 0 ? `${Math.round((active/total)*100)}%` : '0%';

 const rows = trainees.map(t => `
 <tr>
 <td>${esc(t.id)}</td>
 <td>${esc(t.name)}</td>
 <td>${esc(t.phone)}</td>
 <td>${t.type === 'subscription' ? 'اشتراك' : 'تجريبي'}</td>
 <td>${esc(sportLabel(t))}</td>
 <td>${esc(t.branch || 'غير محدد')}</td>
 <td>${esc(t.status)}</td>
 <td>${esc(t.expiryDate || '-')}</td>
 </tr>
 `).join('') || '<tr><td colspan="8" style="text-align:center; color:#9aa1ab;">لا يوجد لاعبون</td></tr>';

 return `
 <div class="section-block">
 <div class="report-title">تقرير اللاعبين</div>
 <div class="summary-row">
 ${summaryBox('إجمالي اللاعبين', total)}
 ${summaryBox('اشتراكات نشطة', active)}
 ${summaryBox('جلسات تجريبية', tests)}
 ${summaryBox('نسبة التحويل', conv)}
 </div>
 <table>
 <thead><tr><th>الكود</th><th>الاسم</th><th>الهاتف</th><th>النوع</th><th>الرياضة</th><th>الفرع</th><th>الحالة</th><th>تاريخ الانتهاء</th></tr></thead>
 <tbody>${rows}</tbody>
 </table>
 </div>
 `;
 }

 function buildFinancialReport(branch) {
 const payments = branch ? data.payments.filter(p => (p.branch || 'غير محدد') === branch) : data.payments;
 const expenses = branch ? data.expenses.filter(e => (e.branch || 'غير محدد') === branch) : data.expenses;
 const totalIncome = payments.reduce((sum, p) => sum + num(p.amount), 0);
 const totalExpenses = expenses.reduce((sum, e) => sum + num(e.amount), 0);
 const totalSalaries = expenses.filter(e => isSalaryType(e.type)).reduce((sum, e) => sum + num(e.amount), 0);
 const net = totalIncome - totalExpenses;

 const paymentRows = payments.map(p => `
 <tr>
 <td>${esc(p.id)}</td>
 <td>${esc(p.name)}</td>
 <td>${esc(p.type)}</td>
 <td>${esc(p.plan)}</td>
 <td>${esc(p.branch || 'غير محدد')}</td>
 <td>${num(p.amount).toLocaleString()} ج.م</td>
 <td>${esc(p.method)}</td>
 <td>${esc(p.date)}</td>
 <td>${esc(p.createdBy || '—')}</td>
 </tr>
 `).join('') || '<tr><td colspan="9" style="text-align:center; color:#9aa1ab;">لا يوجد مدفوعات</td></tr>';

 const expenseRows = expenses.map(e => `
 <tr>
 <td>${esc(e.id)}</td>
 <td>${esc(e.type)}</td>
 <td>${esc(e.desc)}</td>
 <td>${esc(e.branch || 'غير محدد')}</td>
 <td>${num(e.amount).toLocaleString()} ج.م</td>
 <td>${esc(e.date)}</td>
 <td>${esc(e.createdBy || '—')}</td>
 </tr>
 `).join('') || '<tr><td colspan="7" style="text-align:center; color:#9aa1ab;">لا يوجد مصروفات</td></tr>';

 const salaryRows = data.employees.map(e => `
 <tr>
 <td>${esc(e.id)}</td>
 <td>${esc(e.name)}</td>
 <td>${esc(e.role)}</td>
 <td>${num(e.salary).toLocaleString()} ج.م</td>
 <td>${esc(e.status)}</td>
 </tr>
 `).join('') || '<tr><td colspan="5" style="text-align:center; color:#9aa1ab;">لا يوجد موظفون</td></tr>';

 return `
 <div class="section-block">
 <div class="report-title">التقرير المالي</div>
 <div class="summary-row">
 ${summaryBox('إجمالي الإيرادات', `${totalIncome.toLocaleString()} ج.م`)}
 ${summaryBox('المصروفات', `${totalExpenses.toLocaleString()} ج.م`)}
 ${summaryBox('مرتبات مصروفة', `${totalSalaries.toLocaleString()} ج.م`)}
 ${summaryBox('صافي الربح', `${net.toLocaleString()} ج.م`)}
 </div>
 <table>
 <thead><tr><th colspan="9" style="text-align:right; background:#B8901F;">المدفوعات</th></tr><tr><th>الكود</th><th>الاسم</th><th>نوع العملية</th><th>الرياضة</th><th>الفرع</th><th>المبلغ</th><th>طريقة الدفع</th><th>التاريخ</th><th>بواسطة</th></tr></thead>
 <tbody>${paymentRows}</tbody>
 </table>
 <table>
 <thead><tr><th colspan="7" style="text-align:right; background:#B8901F;">المصروفات</th></tr><tr><th>الكود</th><th>النوع</th><th>الوصف</th><th>الفرع</th><th>المبلغ</th><th>التاريخ</th><th>بواسطة</th></tr></thead>
 <tbody>${expenseRows}</tbody>
 </table>
 </div>
 `;
 }

 function buildAttendanceReport(branch) {
 // Attendance records have no branch of their own, so resolve it through
 // the trainee they belong to.
 let attendance = data.attendance;
 if (branch) {
 const idsInBranch = new Set(data.trainees.filter(t => (t.branch || 'غير محدد') === branch).map(t => t.id));
 attendance = data.attendance.filter(a => idsInBranch.has(a.id));
 }
 const totalAttendance = attendance.length;
 const days = [...new Set(attendance.map(a => a.date))].length;
 const avg = totalAttendance > 0 ? Math.round(totalAttendance / Math.max(1, days)) : 0;

 const rows = attendance.map(a => `
 <tr>
 <td>${esc(a.id)}</td>
 <td>${esc(a.name)}</td>
 <td>${esc(a.date)}</td>
 <td>${esc(a.time)}</td>
 <td>${esc(a.status)}</td>
 </tr>
 `).join('') || '<tr><td colspan="5" style="text-align:center; color:#9aa1ab;">لا يوجد سجلات حضور</td></tr>';

 return `
 <div class="section-block">
 <div class="report-title">تقرير الحضور</div>
 <div class="summary-row">
 ${summaryBox('إجمالي سجلات الحضور', totalAttendance)}
 ${summaryBox('أيام التشغيل', days)}
 ${summaryBox('متوسط الحضور اليومي', avg)}
 </div>
 <table>
 <thead><tr><th>الكود</th><th>الاسم</th><th>التاريخ</th><th>الوقت</th><th>الحالة</th></tr></thead>
 <tbody>${rows}</tbody>
 </table>
 </div>
 `;
 }

 // Wraps a per-branch report builder so each branch lands on its own PDF page.
 function perBranchPages(builderFn, titlePrefix) {
 return BRANCHES.map((b, i) => `
 <div style="${i > 0 ? 'page-break-before: always;' : ''}">
 <div style="font-size:20px; font-weight:800; color:#B8901F; border-bottom:3px solid #B8901F; padding-bottom:8px; margin:0 0 16px;">${esc(titlePrefix)} — ${esc(b)}</div>
 ${builderFn(b)}
 </div>
 `).join('');
 }

 // "branch" = each branch on its own page, "combined" = all branches together.
 function reportScope() {
 const sel = document.getElementById('report-scope');
 return sel ? sel.value : 'branch';
 }

 function exportReport(type) {
 const builder = type === 'members' ? buildMembersReport : type === 'financial' ? buildFinancialReport : buildAttendanceReport;
 const title = type === 'members' ? 'تقرير اللاعبين' : type === 'financial' ? 'التقرير المالي' : 'تقرير الحضور';
 if (reportScope() === 'combined') {
 reportDoc(title + ' (مجمّع)', builder());
 } else {
 reportDoc(title + ' (كل فرع في صفحة)', perBranchPages(builder, title));
 }
 }

 // Comprehensive report: per-branch pages, or one combined report.
 function printReport() {
 if (reportScope() === 'combined') {
 const body = buildMembersReport() + buildFinancialReport() + buildAttendanceReport();
 reportDoc('التقرير الشامل المجمّع', body);
 return;
 }
 const body = BRANCHES.map((b, i) => `
 <div style="${i > 0 ? 'page-break-before: always;' : ''}">
 <div style="font-size:24px; font-weight:800; color:#B8901F; border-bottom:3px solid #B8901F; padding-bottom:10px; margin:0 0 18px;">تقارير ${esc(b)}</div>
 ${buildMembersReport(b)}
 ${buildFinancialReport(b)}
 ${buildAttendanceReport(b)}
 </div>
 `).join('');
 reportDoc('التقارير الشاملة — كل فرع في صفحة', body);
 }

 // ==================== MONTHLY REPORT ====================
 function getMonthlyData(monthVal, branch) {
 const inBranch = x => branch === 'الكل' || (x.branch || 'غير محدد') === branch;
 const inMonth = x => dateKey(x.date).slice(0, 7) === monthVal; // YYYY-MM
 const pays = data.payments.filter(p => inBranch(p) && inMonth(p));
 const exps = data.expenses.filter(e => inBranch(e) && inMonth(e));
 const income = pays.reduce((s, p) => s + num(p.amount), 0);
 const expense = exps.reduce((s, e) => s + num(e.amount), 0);
 return { pays, exps, income, expense, net: income - expense };
 }

 function thisMonthVal() {
 const d = new Date();
 return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
 }

 function renderMonthlyReport() {
 const monthVal = document.getElementById('monthly-month').value || thisMonthVal();
 const branch = document.getElementById('monthly-branch').value;
 const out = document.getElementById('monthly-report-result');
 const d = getMonthlyData(monthVal, branch);
 out.innerHTML = `
 <div class="financial-summary" style="margin-bottom:0;">
 <div class="fin-card"><div class="fin-amount" style="color:var(--success);">${d.income.toLocaleString()} ج.م</div><div class="fin-label">إيرادات الشهر</div></div>
 <div class="fin-card"><div class="fin-amount" style="color:var(--danger);">${d.expense.toLocaleString()} ج.م</div><div class="fin-label">مصروفات الشهر</div></div>
 <div class="fin-card"><div class="fin-amount" style="color:${d.net >= 0 ? 'var(--success)' : 'var(--danger)'};">${d.net.toLocaleString()} ج.م</div><div class="fin-label">صافي الربح</div></div>
 </div>
 <p style="margin-top:12px; color:rgba(48,56,65,0.5); font-size:13px;">عدد عمليات الإيراد: ${d.pays.length} • عدد المصروفات: ${d.exps.length}</p>`;
 }

 function printMonthlyReport() {
 const monthVal = document.getElementById('monthly-month').value || thisMonthVal();
 const branch = document.getElementById('monthly-branch').value;
 const branchInfo = branch === 'الكل' ? 'كل الفروع' : branch;
 const build = (b) => {
 const d = getMonthlyData(monthVal, b === 'الكل' ? 'الكل' : b);
 const payRows = d.pays.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.id)}</td><td>${esc(p.name)}</td><td>${esc(p.type)}</td><td>${esc(p.branch || 'غير محدد')}</td><td>${num(p.amount).toLocaleString()} ج.م</td><td>${esc(p.method || '-')}</td><td>${esc(p.date)}</td></tr>`).join('') || '<tr><td colspan="8" style="text-align:center; color:#9aa1ab;">لا توجد إيرادات</td></tr>';
 const expRows = d.exps.map((e, i) => `<tr><td>${i + 1}</td><td>${esc(e.type)}</td><td>${esc(e.desc || '-')}</td><td>${esc(e.branch || 'غير محدد')}</td><td>${num(e.amount).toLocaleString()} ج.م</td><td>${esc(e.date)}</td></tr>`).join('') || '<tr><td colspan="6" style="text-align:center; color:#9aa1ab;">لا توجد مصروفات</td></tr>';
 return `
 <div class="report-title">تقرير شهر ${esc(monthVal)} — ${esc(b === 'الكل' ? branchInfo : b)}</div>
 <div class="summary-row">
 ${summaryBox('إيرادات الشهر', d.income.toLocaleString() + ' ج.م')}
 ${summaryBox('مصروفات الشهر', d.expense.toLocaleString() + ' ج.م')}
 ${summaryBox('صافي الربح', d.net.toLocaleString() + ' ج.م')}
 </div>
 <table><thead><tr><th colspan="8" style="text-align:right; background:#B8901F;">الإيرادات</th></tr><tr><th>#</th><th>الكود</th><th>الاسم</th><th>النوع</th><th>الفرع</th><th>المبلغ</th><th>الطريقة</th><th>التاريخ</th></tr></thead><tbody>${payRows}</tbody></table>
 <table><thead><tr><th colspan="6" style="text-align:right; background:#B8901F;">المصروفات</th></tr><tr><th>#</th><th>النوع</th><th>الوصف</th><th>الفرع</th><th>المبلغ</th><th>التاريخ</th></tr></thead><tbody>${expRows}</tbody></table>`;
 };

 let body;
 if (branch === 'الكل' && reportScope() === 'branch') {
 body = BRANCHES.map((b, i) => `<div style="${i > 0 ? 'page-break-before: always;' : ''}">${build(b)}</div>`).join('');
 } else {
 body = `<div class="section-block">${build(branch)}</div>`;
 }
 reportDoc('تقرير شهري - ' + monthVal, body);
 }

 // ==================== FEEDBACK / COMPLAINTS ====================
 function addFeedback() {
 const text = document.getElementById('feedback-text').value.trim();
 if (!text) { showNotification('اكتب تفاصيل الشكوى/الملاحظة', 'warning'); return; }
 const name = document.getElementById('feedback-name').value.trim();
 const branch = document.getElementById('feedback-branch').value;
 const ftype = document.getElementById('feedback-type').value;
 const docId = genDocId('FB');
 const fb = { _docId: docId, id: docId, name: name || 'مجهول', branch, type: ftype, text, date: todayAr() };
 data.feedback = data.feedback || [];
 data.feedback.push(fb);
 dbSetDoc(feedbackCol, docId, fb);
 document.getElementById('feedback-text').value = '';
 document.getElementById('feedback-name').value = '';
 renderFeedback();
 showNotification('تم تسجيل الملاحظة');
 }

 function renderFeedback() {
 const tbody = document.getElementById('feedback-table');
 if (!tbody) return;
 const list = (data.feedback || []).slice().reverse();
 if (list.length === 0) {
 tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:rgba(48,56,65,0.3); padding:20px;">لا توجد شكاوى مسجلة</td></tr>';
 return;
 }
 tbody.innerHTML = list.map(f => `
 <tr>
 <td>${esc(f.date)}</td>
 <td><span class="badge ${f.type === 'شكوى' ? 'badge-danger' : f.type === 'اقتراح' ? 'badge-info' : 'badge-test'}">${esc(f.type)}</span></td>
 <td>${esc(f.name)}</td>
 <td>${esc(f.branch || 'غير محدد')}</td>
 <td>${esc(f.text)}</td>
 <td style="font-size:11px; color:rgba(48,56,65,0.55);">${esc(f.createdBy || '—')}</td>
 <td><button class="btn btn-danger btn-sm" onclick="deleteFeedback('${esc(f._docId)}')">حذف</button></td>
 </tr>`).join('');
 }

 function deleteFeedback(id) {
 if (!confirm('حذف هذه الملاحظة؟')) return;
 data.feedback = (data.feedback || []).filter(f => f._docId !== id);
 dbDeleteDoc(feedbackCol, id);
 renderFeedback();
 }

 function printFeedback() {
 const list = (data.feedback || []).slice().reverse();
 const rows = list.length
 ? list.map((f, i) => `<tr><td>${i + 1}</td><td>${esc(f.date)}</td><td>${esc(f.type)}</td><td>${esc(f.name)}</td><td>${esc(f.branch || 'غير محدد')}</td><td>${esc(f.text)}</td></tr>`).join('')
 : '<tr><td colspan="6" style="text-align:center; color:#9aa1ab;">لا توجد شكاوى</td></tr>';
 const body = `
 <div class="section-block">
 <div class="report-title">سجل الشكاوى والملاحظات</div>
 <table><thead><tr><th>#</th><th>التاريخ</th><th>النوع</th><th>الاسم</th><th>الفرع</th><th>التفاصيل</th></tr></thead><tbody>${rows}</tbody></table>
 </div>`;
 reportDoc('سجل الشكاوى والملاحظات', body);
 }

 // ==================== DAILY REPORT ====================
 // Income/expenses/net for one calendar day, optionally for one branch.
 function getDailyData(dateVal, branch) {
 const inBranch = x => branch === 'الكل' || (x.branch || 'غير محدد') === branch;
 const pays = data.payments.filter(p => inBranch(p) && dateKey(p.date) === dateVal);
 const exps = data.expenses.filter(e => inBranch(e) && dateKey(e.date) === dateVal);
 const income = pays.reduce((s, p) => s + num(p.amount), 0);
 const expense = exps.reduce((s, e) => s + num(e.amount), 0);
 return { pays, exps, income, expense, net: income - expense };
 }

 function renderDailyReport() {
 const dateVal = document.getElementById('daily-date').value;
 const branch = document.getElementById('daily-branch').value;
 const out = document.getElementById('daily-report-result');
 if (!dateVal) { showNotification('اختر التاريخ أولاً', 'warning'); return; }
 const d = getDailyData(dateVal, branch);

 const tx = [
 ...d.pays.map(p => ({ kind: 'إيراد', desc: `${p.type} - ${p.name}`, amount: num(p.amount), branch: p.branch })),
 ...d.exps.map(e => ({ kind: 'مصروف', desc: `${e.type} - ${e.desc || ''}`, amount: num(e.amount), branch: e.branch }))
 ];
 const rows = tx.length ? tx.map(t => `
 <tr>
 <td><span class="badge ${t.kind === 'إيراد' ? 'badge-success' : 'badge-danger'}">${t.kind}</span></td>
 <td>${esc(t.desc)}</td>
 <td>${branchBadge(t.branch)}</td>
 <td style="font-weight:700; color:${t.kind === 'إيراد' ? 'var(--success)' : 'var(--danger)'};">${t.amount.toLocaleString()} ج.م</td>
 </tr>`).join('') : '<tr><td colspan="4" style="text-align:center; color:rgba(48,56,65,0.3); padding:20px;">لا توجد حركات مالية في هذا اليوم</td></tr>';

 out.innerHTML = `
 <div class="financial-summary" style="margin-bottom:18px;">
 <div class="fin-card"><div class="fin-amount" style="color:var(--success);">${d.income.toLocaleString()} ج.م</div><div class="fin-label">إيرادات اليوم</div></div>
 <div class="fin-card"><div class="fin-amount" style="color:var(--danger);">${d.expense.toLocaleString()} ج.م</div><div class="fin-label">مصروفات اليوم</div></div>
 <div class="fin-card"><div class="fin-amount" style="color:${d.net >= 0 ? 'var(--success)' : 'var(--danger)'};">${d.net.toLocaleString()} ج.م</div><div class="fin-label">صافي الربح</div></div>
 </div>
 <div class="table-container"><table>
 <thead><tr><th>النوع</th><th>البيان</th><th>الفرع</th><th>المبلغ</th></tr></thead>
 <tbody>${rows}</tbody>
 </table></div>`;
 }

 function printDailyReport() {
 const dateVal = document.getElementById('daily-date').value;
 const branch = document.getElementById('daily-branch').value;
 if (!dateVal) { showNotification('اختر التاريخ أولاً', 'warning'); return; }
 const d = getDailyData(dateVal, branch);

 const payRows = d.pays.map((p, i) => `
 <tr><td>${i + 1}</td><td>${esc(p.id)}</td><td>${esc(p.name)}</td><td>${esc(p.type)}</td><td>${esc(p.branch || 'غير محدد')}</td><td>${num(p.amount).toLocaleString()} ج.م</td><td>${esc(p.method || '-')}</td></tr>
 `).join('') || '<tr><td colspan="7" style="text-align:center; color:#9aa1ab;">لا توجد إيرادات</td></tr>';
 const expRows = d.exps.map((e, i) => `
 <tr><td>${i + 1}</td><td>${esc(e.id)}</td><td>${esc(e.type)}</td><td>${esc(e.desc || '-')}</td><td>${esc(e.branch || 'غير محدد')}</td><td>${num(e.amount).toLocaleString()} ج.م</td></tr>
 `).join('') || '<tr><td colspan="6" style="text-align:center; color:#9aa1ab;">لا توجد مصروفات</td></tr>';

 const branchInfo = branch === 'الكل' ? 'كل الفروع' : branch;
 const body = `
 <div class="section-block">
 <div class="report-title">تقرير يومي — ${esc(dateVal)} (${esc(branchInfo)})</div>
 <div class="summary-row">
 ${summaryBox('إيرادات اليوم', d.income.toLocaleString() + ' ج.م')}
 ${summaryBox('مصروفات اليوم', d.expense.toLocaleString() + ' ج.م')}
 ${summaryBox('صافي الربح', d.net.toLocaleString() + ' ج.م')}
 </div>
 <table>
 <thead><tr><th colspan="7" style="text-align:right; background:#B8901F;">الإيرادات</th></tr>
 <tr><th>#</th><th>الكود</th><th>الاسم</th><th>النوع</th><th>الفرع</th><th>المبلغ</th><th>طريقة الدفع</th></tr></thead>
 <tbody>${payRows}</tbody>
 </table>
 <table>
 <thead><tr><th colspan="6" style="text-align:right; background:#B8901F;">المصروفات</th></tr>
 <tr><th>#</th><th>الكود</th><th>النوع</th><th>الوصف</th><th>الفرع</th><th>المبلغ</th></tr></thead>
 <tbody>${expRows}</tbody>
 </table>
 </div>`;
 reportDoc(`تقرير يومي - ${dateVal}`, body);
 }

 function exportData() {
 const csv = data.trainees.map(t =>
 `${t.id},${t.name},${t.phone},${t.type},${t.plan},${t.status},${t.registrationDate}`
 ).join('\n');

 const header = 'الكود,الاسم,الهاتف,النوع,الخطة,الحالة,التاريخ\n';
 const blob = new Blob(['\uFEFF' + header + csv], { type: 'text/csv;charset=utf-8;' });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url;
 a.download = 'trainees.csv';
 a.click();
 }

 // ==================== BACKUP & RESTORE ====================
 // Full-system backup: download EVERY collection as one JSON file, so the
 // whole database can be rebuilt later if the server/database is ever lost.
 function backupAllData() {
 const stamp = new Date();
 const backup = {
 _meta: {
 app: 'Academy System',
 version: 1,
 exportedAt: stamp.toISOString(),
 exportedBy: (auth.currentUser && auth.currentUser.email) || 'unknown',
 counts: {
 trainees: (data.trainees || []).length,
 payments: (data.payments || []).length,
 attendance: (data.attendance || []).length,
 employees: (data.employees || []).length,
 expenses: (data.expenses || []).length,
 groups: (data.groups || []).length,
 sessions: (data.sessions || []).length,
 staffAttendance: (data.staffAttendance || []).length,
 feedback: (data.feedback || []).length,
 },
 },
 trainees: data.trainees || [],
 payments: data.payments || [],
 attendance: data.attendance || [],
 employees: data.employees || [],
 expenses: data.expenses || [],
 groups: data.groups || [],
 sessions: data.sessions || [],
 staffAttendance: data.staffAttendance || [],
 feedback: data.feedback || [],
 counter: data.counter || 1,
 };

 const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 const p = n => String(n).padStart(2, '0');
 a.href = url;
 a.download = `backup-${stamp.getFullYear()}-${p(stamp.getMonth() + 1)}-${p(stamp.getDate())}-${p(stamp.getHours())}${p(stamp.getMinutes())}.json`;
 a.click();
 URL.revokeObjectURL(url);

 const total = Object.values(backup._meta.counts).reduce((s, n) => s + n, 0);
 const lbl = document.getElementById('backup-last');
 if (lbl) lbl.textContent = `آخر نسخة: ${stamp.toLocaleString('ar-EG')} — ${total} سجل`;
 showNotification(`تم تنزيل نسخة احتياطية كاملة (${total} سجل)`);
 }

 // Opens the file picker for restore. ADMIN ONLY.
 function triggerRestore() {
 if (currentRole !== 'admin') { showNotification('الاسترجاع متاح للمدير فقط', 'danger'); return; }
 document.getElementById('restore-file-input').click();
 }

 // Restore from a backup file. ADMIN ONLY. Rewrites every collection back
 // into Supabase in batches of 500 rows (upsert). Existing rows with the same
 // id are overwritten.
 async function restoreAllData(inputEl) {
 if (currentRole !== 'admin') { showNotification('الاسترجاع متاح للمدير فقط', 'danger'); return; }
 const file = inputEl.files && inputEl.files[0];
 if (!file) return;

 let backup;
 try {
 backup = JSON.parse(await file.text());
 } catch (e) {
 showNotification('ملف النسخة الاحتياطية غير صالح', 'danger');
 inputEl.value = '';
 return;
 }
 if (!backup || (!backup.trainees && !backup.payments && !backup.employees)) {
 showNotification('الملف لا يحتوي على بيانات نسخة احتياطية صحيحة', 'danger');
 inputEl.value = '';
 return;
 }

 const proceed = confirm(
 'سيتم استرجاع البيانات من النسخة الاحتياطية وكتابتها فوق قاعدة البيانات الحالية.\n\n' +
 `لاعبون: ${(backup.trainees || []).length}\n` +
 `مدفوعات: ${(backup.payments || []).length}\n` +
 `حضور: ${(backup.attendance || []).length}\n` +
 `موظفون/مدربون: ${(backup.employees || []).length}\n` +
 `مصروفات: ${(backup.expenses || []).length}\n\n` +
 'هل تريد المتابعة؟'
 );
 if (!proceed) { inputEl.value = ''; return; }

 try {
 showNotification('جارٍ الاسترجاع... قد يستغرق دقيقة، من فضلك لا تغلق الصفحة', 'warning');

 // Write to Supabase. Each record becomes a row { id, branch, ts, data }.
 // Keyed collections upsert (a re-restore overwrites cleanly); attendance
 // has no stable id so it is inserted (auto-generated uuid).
 const tsOf = r => r.ts || parseDate(r.date) || Date.now();
 const toRow = (r, idField) => ({ id: String(r[idField] || r.id), branch: r.branch || null, ts: tsOf(r), data: r });
 const CHUNK = 500;
 let written = 0;

 const keyed = [
 ['trainees', backup.trainees, 'id'],
 ['employees', backup.employees, 'id'],
 ['expenses', backup.expenses, 'id'],
 ['payments', backup.payments, '_docId'],
 ['groups', backup.groups, '_docId'],
 ['sessions', backup.sessions, '_docId'],
 ['staff_attendance', backup.staffAttendance, '_docId'],
 ['feedback', backup.feedback, '_docId'],
 ];
 for (const [table, arr, idField] of keyed) {
 const rows = (arr || []).map(r => toRow(r, idField));
 for (let i = 0; i < rows.length; i += CHUNK) {
 const { error } = await sb.from(table).upsert(rows.slice(i, i + CHUNK));
 if (error) throw error;
 written += Math.min(CHUNK, rows.length - i);
 }
 }
 // attendance: no stable id -> insert with trainee_id extracted for cleanup.
 const attRows = (backup.attendance || []).map(a => ({ trainee_id: a.id || null, branch: a.branch || null, ts: tsOf(a), data: a }));
 for (let i = 0; i < attRows.length; i += CHUNK) {
 const { error } = await sb.from('attendance').insert(attRows.slice(i, i + CHUNK));
 if (error) throw error;
 written += Math.min(CHUNK, attRows.length - i);
 }
 if (backup.counter) await sb.from('meta').upsert({ id: 'counter', data: { value: backup.counter } });

 inputEl.value = '';
 showNotification(`تم استرجاع ${written} سجل بنجاح. جارٍ إعادة التحميل...`);
 setTimeout(() => location.reload(), 1500);
 } catch (err) {
 console.error('Restore error:', err);
 showNotification('حدث خطأ أثناء الاسترجاع: ' + ((err && err.message) || ''), 'danger');
 inputEl.value = '';
 }
 }

 // ==================== UTILITIES ====================
 function closeModal() {
 document.getElementById('modal-overlay').classList.remove('show');
 }

 function showNotification(text, type = 'success') {
 const notif = document.getElementById('notification');
 const colors = { success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)' };

 notif.style.borderRightColor = colors[type];
 document.getElementById('notif-text').textContent = text;
 notif.classList.add('show');

 setTimeout(() => notif.classList.remove('show'), 3000);
 }

 function updateDateTime() {
 const now = new Date();
 document.getElementById('current-date').textContent =
 now.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
 }

 // ==================== AUTH & ROLES ====================
 // Anyone in this list is a full admin. Everyone else who logs in is
 // treated as an "employee" and only sees the cashier sections below.
 const ADMIN_EMAILS = ['abdrhmanq5005@gmail.com', 'ahmed@elwasl.com', 'hesham@elwasl.com'];

 // Sections an employee (cashier) is allowed to see.
 const EMPLOYEE_SECTIONS = ['registration', 'trials', 'attendance', 'sessions', 'groups', 'staff-attendance', 'financial', 'salaries'];

 function roleForEmail(email) {
 return ADMIN_EMAILS.includes((email || '').toLowerCase()) ? 'admin' : 'employee';
 }

 // Shows/hides sidebar items based on role. NOTE: this is a UI gate, not
 // hard security — real enforcement would need Supabase row-level security.
 function applyRolePermissions(role) {
 const navItems = document.querySelectorAll('.nav-item');
 if (role === 'admin') {
 navItems.forEach(n => { n.style.display = ''; });
 return;
 }
 // Employee: hide every section that isn't in the allowed list.
 navItems.forEach(n => {
 const sec = n.getAttribute('data-section');
 n.style.display = EMPLOYEE_SECTIONS.includes(sec) ? '' : 'none';
 });
 // In الشؤون المالية, an employee sees ONLY the "add expense / rent" card.
 ['card-add-employee', 'card-employees-table', 'card-expenses-table'].forEach(id => {
 const el = document.getElementById(id);
 if (el) el.style.display = 'none';
 });
 // Employees can't choose the branch: hide the device-branch picker, and lock
 // the form branch fields to the device's branch (set once by an admin).
 const deviceSel = document.getElementById('device-branch-select');
 if (deviceSel) deviceSel.style.display = 'none';
 const b = getDeviceBranch();
 if (b) ['reg-branch', 'expense-branch', 'emp-branch', 'trial-branch'].forEach(id => {
 const sel = document.getElementById(id);
 if (sel) { sel.value = b; sel.disabled = true; }
 });
 // The default landing section (dashboard) is hidden for employees,
 // so send them to the first section they're allowed to use.
 showSection(EMPLOYEE_SECTIONS[0]);
 }

 // (3) Reports: load only the chosen date range, then re-render the reports.
 function loadReportRange() {
 const fromEl = document.getElementById('report-from');
 const toEl = document.getElementById('report-to');
 const fromTs = (fromEl && fromEl.value) ? new Date(fromEl.value + 'T00:00:00').getTime() : (Date.now() - 30 * 86400000);
 const toTs = (toEl && toEl.value) ? new Date(toEl.value + 'T23:59:59').getTime() : 0;
 loadHistoryRange(fromTs, toTs).then(() => updateReports());
 }

 // (4) Per-branch: when the device's branch is changed, persist it and
 // reload so every query is scoped to that branch (≈ a third of the reads).
 function onDeviceBranchChange(value) {
 setDeviceBranch(value);
 showNotification('جارٍ إعادة التحميل حسب الفرع المحدد...');
 loadData().then(() => {
 updateDashboard();
 updateBadge();
 refreshHistoryViews();
 const active = document.querySelector('.nav-item.active');
 if (active) showSection(active.getAttribute('data-section'));
 });
 }

 // Maps Firebase auth error codes to friendly Arabic messages.
 function loginErrorMessage(code) {
 switch (code) {
 case 'auth/invalid-email': return 'صيغة البريد الإلكتروني غير صحيحة';
 case 'auth/user-disabled': return 'تم تعطيل هذا الحساب';
 case 'auth/user-not-found':
 case 'auth/wrong-password':
 case 'auth/invalid-credential': return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
 case 'auth/too-many-requests': return 'محاولات كثيرة، حاول مرة أخرى بعد قليل';
 case 'auth/network-request-failed': return 'تعذر الاتصال بالشبكة، تحقق من الإنترنت';
 default: return 'تعذر تسجيل الدخول، حاول مرة أخرى';
 }
 }

 async function handleLogin(e) {
 e.preventDefault();
 const email = document.getElementById('login-email').value.trim();
 const password = document.getElementById('login-password').value;
 const errEl = document.getElementById('login-error');
 const btn = document.getElementById('login-btn');
 errEl.textContent = '';

 if (!email || !password) {
 errEl.textContent = 'يرجى إدخال البريد الإلكتروني وكلمة المرور';
 return;
 }

 btn.disabled = true;
 btn.textContent = 'جاري تسجيل الدخول...';
 try {
 // On success, onAuthStateChanged fires and bootstraps the app.
 await auth.signInWithEmailAndPassword(email, password);
 } catch (err) {
 console.error('Login error:', err);
 errEl.textContent = loginErrorMessage(err.code);
 } finally {
 btn.disabled = false;
 btn.textContent = 'تسجيل الدخول';
 }
 }

 function logout() {
 auth.signOut().catch(err => console.error('Logout error:', err));
 // onAuthStateChanged will show the login screen again.
 }

 function showLoginScreen() {
 document.getElementById('loading-overlay').classList.add('hidden');
 document.getElementById('app-header').style.display = 'none';
 document.getElementById('app-container').style.display = 'none';
 document.getElementById('login-screen').classList.remove('hidden');
 document.getElementById('login-password').value = '';
 }

 // Runs once after a user is authenticated: loads data and reveals the app.
 async function startApp(user) {
 document.getElementById('login-screen').classList.add('hidden');
 document.getElementById('loading-overlay').classList.remove('hidden');

 await loadData();
 refreshExpiredStatuses();
 purgeOldRejectedTrials();

 document.getElementById('loading-overlay').classList.add('hidden');
 document.getElementById('app-header').style.display = '';
 document.getElementById('app-container').style.display = '';

 currentRole = roleForEmail(user.email);
 const roleLabel = currentRole === 'admin' ? 'مدير' : 'موظف';
 document.getElementById('current-user').textContent = `${user.email || 'مستخدم'} (${roleLabel})`;

 // Reflect this device's saved branch scope in the header selector.
 const branchSel = document.getElementById('device-branch-select');
 if (branchSel) branchSel.value = getDeviceBranch();

 updateDashboard();
 updateBadge();

 // Set today's date
 document.getElementById('reg-start-date').valueAsDate = new Date();
 document.getElementById('renew-date').valueAsDate = new Date();
 const dailyDate = document.getElementById('daily-date');
 if (dailyDate) dailyDate.valueAsDate = new Date();
 populateRegTrainerSelect();

 applyRolePermissions(currentRole);
 }

 // ==================== INIT ====================
 document.addEventListener('DOMContentLoaded', () => {
 updateDateTime();
 setInterval(updateDateTime, 60000);

 document.getElementById('login-form').addEventListener('submit', handleLogin);

 // Single source of truth for "is the user logged in?". Fires on load,
 // after login, after logout, and on token refresh.
 auth.onAuthStateChanged(user => {
 if (user) startApp(user);
 else showLoginScreen();
 });
 });

 // Close modal on overlay click
 document.getElementById('modal-overlay').addEventListener('click', function(e) {
 if (e.target === this) closeModal();
 });

 // Enter key for attendance
 document.addEventListener('keypress', function(e) {
 if (e.key === 'Enter' && document.getElementById('attendance-code') === document.activeElement) {
 recordAttendance();
 }
 });