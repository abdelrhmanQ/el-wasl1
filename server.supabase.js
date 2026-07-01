 // ====================================================================
 // server.supabase.js  —  Supabase data layer (replaces server.js)
 // --------------------------------------------------------------------
 // Same public interface as the old Firebase server.js (data, loadData,
 // dbSetDoc, dbAddDoc, dbDeleteDoc, nextCounterValue, the `auth` object...),
 // so main.js keeps working with almost no changes.
 //
 // Each Firestore "document" is stored as a row: { id, branch, ts, data(jsonb) }.
 // We read `row.data` back as the record (identical shape to before).
 //
 // Load order in index.html must be:
 //   Supabase SDK (CDN)  ->  server.supabase.js  ->  main.js
 // ====================================================================

 // ==================== SUPABASE SETUP ====================
 // The anon key is PUBLIC (like Firebase apiKey). Paste yours from
 // Supabase Dashboard -> Project Settings -> API -> "anon public".
 const SUPABASE_URL = 'https://yhzpbjijnrobdecekmgg.supabase.co';
 const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InloenBiamlqbnJvYmRlY2VrbWdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MjkwMDUsImV4cCI6MjA5ODMwNTAwNX0.N_j42fKjePPfCSvXgG1hoHaVZ62KtOyt5dX1PdFUe7w';

 // The UMD global from the CDN is named `supabase`; our client is `sb`.
 const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

 // ---- Firebase-compatible auth shim, so main.js's login code is unchanged ----
 const auth = {
 currentUser: null,
 async signInWithEmailAndPassword(email, password) {
 const { error } = await sb.auth.signInWithPassword({ email, password });
 if (error) {
 // Map to a Firebase-like code so loginErrorMessage() still works.
 const e = new Error(error.message);
 e.code = /invalid login|credential/i.test(error.message) ? 'auth/invalid-credential'
 : /network/i.test(error.message) ? 'auth/network-request-failed' : 'auth/unknown';
 throw e;
 }
 },
 signOut() { return sb.auth.signOut(); },
 onAuthStateChanged(cb) {
 // Fires immediately with the current session, then on every change.
 sb.auth.onAuthStateChange((_event, session) => {
 auth.currentUser = session && session.user ? { email: session.user.email } : null;
 cb(auth.currentUser);
 });
 }
 };

 // Table names (used as the "collection refs" main.js passes around).
 const traineesCol = 'trainees';
 const attendanceCol = 'attendance';
 const paymentsCol = 'payments';
 const employeesCol = 'employees';
 const expensesCol = 'expenses';
 const groupsCol = 'groups';
 const sessionsCol = 'sessions';
 const staffAttendanceCol = 'staff_attendance';
 const feedbackCol = 'feedback';

 // Map of in-memory data key -> table name for the five history collections.
 const historyTables = {
 attendance: 'attendance', payments: 'payments', expenses: 'expenses',
 staffAttendance: 'staff_attendance', feedback: 'feedback',
 };

 // Turn a DB row { id, branch, ts, data } back into the original record,
 // carrying its row id under _docId (so edit/delete still work).
 const rowToRecord = r => Object.assign({}, r.data, { _docId: r.id });

 // ============ TEMP: BACKDATING (إدخال بأثر رجعي) ============
 // Same feature as before: while an override date is set, every new record is
 // stamped with it. Remove this block + the UI bar + toggleBackdate() to undo.
 let entryDateOverride = null;
 function entryNow() { return entryDateOverride != null ? entryDateOverride : Date.now(); }
 // ===========================================================

 // ==================== READ WINDOWS ====================
 const HISTORY_DAYS = 30;
 const ATTENDANCE_DAYS = 14;
 const REPORTS_DAYS = 30;
 const HISTORY_COLLECTIONS = ['attendance', 'payments', 'expenses', 'staffAttendance', 'feedback'];
 let historyFullyLoaded = false;
 let defaultHistoryLoaded = false;
 let loadedSections = { attendance: false, payments: false, expenses: false, staffAttendance: false, feedback: false };

 // Per-device branch scope. '' = all branches (admin).
 let currentBranch = localStorage.getItem('device-branch') || '';
 function setDeviceBranch(b) {
 currentBranch = (b && b !== 'الكل') ? b : '';
 if (currentBranch) localStorage.setItem('device-branch', currentBranch);
 else localStorage.removeItem('device-branch');
 }
 function getDeviceBranch() { return currentBranch; }
 // Apply the branch filter to a Supabase query only when a branch is selected.
 function branchSel(q) { return currentBranch ? q.eq('branch', currentBranch) : q; }

 // Running totals shown on the dashboard (recomputed from the DB on each load).
 let stats = { revenue: 0, expenses: 0 };
 // Per-branch totals: { 'فرع ...': { revenue, expenses } } — lets the dashboard
 // show each branch's own figures, and the sum when "كل الفروع" is selected.
 let statsByBranch = {};

 // ==================== DATA STORE ====================
 let data = {
 trainees: [], attendance: [], payments: [], employees: [], expenses: [],
 groups: [], sessions: [], staffAttendance: [], feedback: [], counter: 1
 };

 // ---- Paginated fetch: Supabase caps rows per request, so page through them
 // in blocks of 1000 until a short page signals the end (works for any size). ----
 async function fetchRows(table, build) {
 const PAGE = 1000;
 let from = 0, all = [];
 while (true) {
 let q = sb.from(table).select('*').range(from, from + PAGE - 1);
 if (build) q = build(q);
 const { data: rows, error } = await q;
 if (error) throw error;
 all = all.concat(rows || []);
 if (!rows || rows.length < PAGE) break;
 from += PAGE;
 }
 return all;
 }

 // Keep a slimmed local copy so the app still opens read-only if offline.
 function cacheLocally() {
 const KEEP = 800;
 const slim = {
 trainees: data.trainees, employees: data.employees, groups: data.groups,
 sessions: data.sessions, counter: data.counter,
 payments: (data.payments || []).slice(-KEEP),
 attendance: (data.attendance || []).slice(-KEEP),
 expenses: (data.expenses || []).slice(-KEEP),
 staffAttendance: (data.staffAttendance || []).slice(-KEEP),
 feedback: (data.feedback || []).slice(-KEEP),
 };
 try { localStorage.setItem('racer-data', JSON.stringify(slim)); }
 catch (e) {
 try {
 localStorage.setItem('racer-data', JSON.stringify({
 trainees: data.trainees, employees: data.employees, groups: data.groups,
 sessions: data.sessions, counter: data.counter,
 payments: [], attendance: [], expenses: [], staffAttendance: [], feedback: []
 }));
 } catch (e2) { /* storage full - not critical */ }
 }
 }

 // Recompute revenue/expenses per branch via a SQL aggregate (reads are free).
 // The global `stats` is the sum across branches; `statsByBranch` holds each.
 async function recomputeStats() {
 try {
 const { data: rows, error } = await sb.rpc('branch_totals');
 if (error) throw error;
 statsByBranch = {};
 let rev = 0, exp = 0;
 (rows || []).forEach(r => {
 const b = r.branch || 'غير محدد';
 statsByBranch[b] = { revenue: num(r.revenue), expenses: num(r.expenses) };
 rev += num(r.revenue); exp += num(r.expenses);
 });
 stats.revenue = rev; stats.expenses = exp;
 } catch (e) { console.error('recomputeStats error:', e); }
 }

 // ==================== LOAD ====================
 async function loadData() {
 try {
 // Current-state collections (small) load in full, branch-scoped.
 const [trainees, employees, groups, sessions] = await Promise.all([
 fetchRows(traineesCol, branchSel),
 fetchRows(employeesCol),
 fetchRows(groupsCol, branchSel),
 fetchRows(sessionsCol, branchSel),
 ]);
 data.trainees = trainees.map(rowToRecord);
 data.employees = employees.map(rowToRecord);
 data.groups = groups.map(rowToRecord);
 data.sessions = sessions.map(rowToRecord);

 // Counter (atomic value lives in meta).
 const { data: cRow } = await sb.from('meta').select('data').eq('id', 'counter').maybeSingle();
 data.counter = cRow && cRow.data ? cRow.data.value : (data.trainees.length + 1);

 await recomputeStats();

 historyFullyLoaded = false;
 defaultHistoryLoaded = false;
 loadedSections = { attendance: false, payments: false, expenses: false, staffAttendance: false, feedback: false };

 // Today's attendance window is needed on first paint.
 await loadSection('attendance');
 cacheLocally();
 } catch (err) {
 console.error('Supabase load error:', err);
 const saved = localStorage.getItem('racer-data');
 if (saved) data = JSON.parse(saved);
 showNotification('تعذر الاتصال بقاعدة البيانات، يتم عرض آخر نسخة محفوظة محلياً', 'danger');
 }
 }

 // Load ONE history collection: branch-scoped + time-windowed.
 async function loadSection(name) {
 const table = historyTables[name];
 if (!table) return;
 const days = name === 'attendance' ? ATTENDANCE_DAYS : HISTORY_DAYS;
 const cutoff = Date.now() - days * 86400000;
 try {
 const rows = await fetchRows(table, q => branchSel(q).gte('ts', cutoff));
 data[name] = rows.map(rowToRecord);
 loadedSections[name] = true;
 cacheLocally();
 } catch (err) {
 console.error(`loadSection(${name}) error:`, err);
 showNotification('تعذر تحميل بيانات هذا القسم', 'danger');
 }
 }

 // Lazy-load a section then render it.
 async function ensureSection(name, renderFn) {
 if (!loadedSections[name]) await loadSection(name);
 if (typeof renderFn === 'function') { try { renderFn(); } catch (e) { console.error(e); } }
 }

 // Load history for a chosen date range (reports / financial dashboard).
 async function loadHistoryRange(fromTs, toTs) {
 try {
 showNotification('جارٍ تحميل بيانات الفترة المحددة...');
 await Promise.all(Object.keys(historyTables).map(async name => {
 const rows = await fetchRows(historyTables[name], q => {
 let qq = branchSel(q).gte('ts', fromTs);
 if (toTs) qq = qq.lte('ts', toTs);
 return qq;
 });
 data[name] = rows.map(rowToRecord);
 loadedSections[name] = true;
 }));
 historyFullyLoaded = false;
 defaultHistoryLoaded = true;
 cacheLocally();
 refreshHistoryViews();
 showNotification('تم تحميل بيانات الفترة المحددة');
 } catch (err) {
 console.error('loadHistoryRange error:', err);
 showNotification('تعذر تحميل بيانات الفترة', 'danger');
 }
 }

 // Default recent window for reports / financial dashboard (bounded read).
 async function ensureRecentHistory(days = REPORTS_DAYS) {
 if (historyFullyLoaded || defaultHistoryLoaded) return;
 await loadHistoryRange(Date.now() - days * 86400000, 0);
 }

 // Load the FULL history (all dates), branch-scoped.
 async function loadAllHistory() {
 if (historyFullyLoaded) { showNotification('السجل الكامل محمّل بالفعل'); return; }
 try {
 showNotification('جارٍ تحميل السجل الكامل...');
 await Promise.all(Object.keys(historyTables).map(async name => {
 const rows = await fetchRows(historyTables[name], branchSel);
 data[name] = rows.map(rowToRecord);
 loadedSections[name] = true;
 }));
 historyFullyLoaded = true;
 defaultHistoryLoaded = true;
 await recomputeStats();
 cacheLocally();
 refreshHistoryViews();
 showNotification('تم تحميل السجل الكامل لكل الفترة');
 } catch (err) {
 console.error('loadAllHistory error:', err);
 showNotification('تعذر تحميل السجل الكامل', 'danger');
 }
 }

 // Re-window every already-loaded section.
 async function reloadHistoryWindow() {
 for (const name of HISTORY_COLLECTIONS) {
 if (loadedSections[name]) { loadedSections[name] = false; await loadSection(name); }
 }
 refreshHistoryViews();
 }

 // Local-only running total bump (dashboard updates instantly; DB is the
 // source of truth, recomputed via branch_totals() on the next load).
 function bumpStat(field, delta, branch) {
 if (!delta) return;
 stats[field] = (stats[field] || 0) + delta;
 if (branch) {
 if (!statsByBranch[branch]) statsByBranch[branch] = { revenue: 0, expenses: 0 };
 statsByBranch[branch][field] = (statsByBranch[branch][field] || 0) + delta;
 }
 }

 // Re-render every view that depends on history data.
 function refreshHistoryViews() {
 const fns = ['updateDashboard', 'updateAttendanceLog', 'updateFinancial', 'updateSalaries',
 'updateReports', 'renderFinancialDashboard', 'renderStaffAttendance', 'updateBadge'];
 fns.forEach(fn => { try { if (typeof window[fn] === 'function') window[fn](); } catch (e) { /* ignore */ } });
 }

 // ==================== WRITE HELPERS ====================
 // Build the row stored for a record: scalar branch/ts columns + the full
 // object as JSONB (so the record shape main.js expects is preserved).
 function toRow(id, obj) {
 return { id: String(id), branch: obj.branch || null, ts: obj.ts || null, data: obj };
 }

 async function dbSetDoc(table, id, obj) {
 const isNew = obj && obj.ts == null;
 if (isNew) {
 obj.ts = entryNow();
 // Audit: stamp who created this record (the logged-in user's email).
 if (auth.currentUser && obj.createdBy == null) obj.createdBy = auth.currentUser.email;
 }
 cacheLocally();
 if (isNew && table === paymentsCol) bumpStat('revenue', num(obj.amount), obj.branch);
 if (isNew && table === expensesCol) bumpStat('expenses', num(obj.amount), obj.branch);
 try {
 const { error } = await sb.from(table).upsert(toRow(id, obj));
 if (error) throw error;
 } catch (err) {
 console.error('Supabase set error:', err);
 showNotification('تم الحفظ محلياً، لكن تعذر رفعه لقاعدة البيانات. تحقق من الاتصال', 'danger');
 }
 }

 // Used for attendance (auto-generated id). trainee_id is extracted so a
 // player's attendance can be deleted when the player is removed.
 async function dbAddDoc(table, obj) {
 if (obj && obj.ts == null) obj.ts = entryNow();
 if (obj && obj.createdBy == null && auth.currentUser) obj.createdBy = auth.currentUser.email;
 cacheLocally();
 const row = { branch: obj.branch || null, ts: obj.ts || null, data: obj };
 if (table === attendanceCol) row.trainee_id = obj.id || null;
 try {
 const { error } = await sb.from(table).insert(row);
 if (error) throw error;
 } catch (err) {
 console.error('Supabase add error:', err);
 showNotification('تم الحفظ محلياً، لكن تعذر رفعه لقاعدة البيانات. تحقق من الاتصال', 'danger');
 }
 }

 async function dbDeleteDoc(table, id) {
 cacheLocally();
 try {
 const { error } = await sb.from(table).delete().eq('id', String(id));
 if (error) throw error;
 } catch (err) {
 console.error('Supabase delete error:', err);
 showNotification('تعذر الحذف من قاعدة البيانات السحابية', 'danger');
 }
 }

 // Delete every row where a field equals a value (used to remove a deleted
 // player's attendance — stored under the trainee_id column).
 async function dbDeleteWhere(table, field, value) {
 cacheLocally();
 const column = (table === attendanceCol && field === 'id') ? 'trainee_id' : field;
 try {
 const { error } = await sb.from(table).delete().eq(column, value);
 if (error) throw error;
 } catch (err) {
 console.error('Supabase delete-where error:', err);
 showNotification('تعذر حذف بعض السجلات المرتبطة من قاعدة البيانات', 'danger');
 }
 }

 async function dbSaveCounter() {
 cacheLocally();
 try { await sb.from('meta').upsert({ id: 'counter', data: { value: data.counter } }); }
 catch (err) { console.error('Supabase counter error:', err); }
 }

 // Atomically reserve the next trainee number via the next_counter() SQL
 // function, so two devices can never get the same code. Falls back locally.
 async function nextCounterValue() {
 try {
 const { data: v, error } = await sb.rpc('next_counter');
 if (error) throw error;
 data.counter = v + 1;
 cacheLocally();
 return v;
 } catch (err) {
 console.error('Counter RPC error (using local fallback):', err);
 const fallback = data.counter++;
 dbSaveCounter();
 return fallback;
 }
 }
