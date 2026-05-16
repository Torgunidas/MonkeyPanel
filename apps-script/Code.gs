/* MonkeyPanel Central Apps Script Backend
   Install in CLIENT_INDEX Apps Script, not in client plan spreadsheets. */

const MP = {
  VERSION: '0.2.2-performed-date',
  INDEX_SHEET: 'CLIENT_INDEX',
  PLAN_SHEET: 'Plan',
  WG_SHEET: 'WG',
  CONFIG_SHEET: 'APP_CONFIG',
  LOG_SHEET: 'APP_LOG',
  MEASUREMENTS_SHEET: 'APP_MEASUREMENTS',
  STATUS_SHEET: 'APP_STATUS',
  TIMEZONE: 'Europe/Warsaw'
};

const LOG_HEADERS = ['timestamp','client_id','session_id','workout_date','week','workout_id','workout_name','exercise_no','exercise_name','set_no','planned_label','kg','reps','rpe','done','note','source','payload_json','plan_id'];
const MEASUREMENT_HEADERS = ['timestamp','client_id','measurement_date','week','Udo','Dupa','Brzuch','Klatka','Biceps','Szyja','Waga','payload_json','plan_id'];
const STATUS_HEADERS = ['timestamp','client_id','session_id','workout_date','week','workout_id','status','completed_exercises','total_exercises','payload_json','plan_id','session_note'];

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'health';
  try {
    if (action === 'health') return json_({ ok:true, version:MP.VERSION, now:nowLocal_(), clients:listClients_() });
    const ctx = getClientContextFromEvent_(e);
    if (action === 'getPlan') return json_(getPlan_(ctx));
    if (action === 'getMeasurements') return json_(getMeasurements_(ctx));
    if (action === 'getWorkoutLog') return json_(getWorkoutLog_(ctx, e));
    return json_({ ok:false, error:'Unknown action: ' + action });
  } catch (err) { return json_({ ok:false, error:String(err), stack:err && err.stack }); }
}

function doPost(e) {
  try {
    const payload = parsePayload_(e);
    const ctx = getClientContextFromPayload_(payload);
    if (payload.action === 'saveWorkoutLog') return json_(saveWorkoutLog_(ctx, payload));
    if (payload.action === 'saveMeasurements') return json_(saveMeasurements_(ctx, payload));
    if (payload.action === 'saveStatus') return json_(saveStatus_(ctx, payload));
    return json_({ ok:false, error:'Unknown action: ' + payload.action });
  } catch (err) { return json_({ ok:false, error:String(err), stack:err && err.stack }); }
}

function setupCentralBackend() {
  const rows = getClientIndexRows_().filter(r => String(r.status || '').toLowerCase() === 'active');
  const results = rows.map(r => {
    const ss = SpreadsheetApp.openById(r.spreadsheet_id);
    ensureClientSheets_(ss);
    return { clientId:r.client_id, planId:r.active_plan_id, spreadsheetId:r.spreadsheet_id, ok:true };
  });
  return { ok:true, version:MP.VERSION, activeClients:results.length, results };
}

function getClientContextFromEvent_(e) {
  const clientId = String((e && e.parameter && (e.parameter.client || e.parameter.clientId)) || '').trim();
  return getClientContext_(clientId);
}
function getClientContextFromPayload_(payload) {
  const clientId = String(payload.client || payload.clientId || '').trim();
  return getClientContext_(clientId);
}
function getClientContext_(clientId) {
  if (!clientId) throw new Error('Missing client. Use ?client=gabriel or ?client=michal');
  const row = getClientIndexRows_().find(r => normalizeClientId_(r.client_id) === normalizeClientId_(clientId));
  if (!row) throw new Error('Client not found in CLIENT_INDEX: ' + clientId);
  if (String(row.status || '').toLowerCase() !== 'active') throw new Error('Client is not active: ' + clientId + ' status=' + row.status);
  if (!row.spreadsheet_id || row.spreadsheet_id.indexOf('TO_FILL') >= 0) throw new Error('Missing spreadsheet_id for client: ' + clientId);
  const ss = SpreadsheetApp.openById(row.spreadsheet_id);
  ensureClientSheets_(ss);
  return {
    clientId: row.client_id,
    clientName: row.client_name || row.client_id,
    spreadsheetId: row.spreadsheet_id,
    spreadsheetUrl: row.spreadsheet_url || '',
    startDate: row.start_date || '',
    activePlanId: row.active_plan_id || '',
    ss,
    planId: getConfigValue_(ss, 'plan_id', row.active_plan_id || ''),
    planName: getConfigValue_(ss, 'plan_name', row.active_plan_id || ''),
    planStatus: getConfigValue_(ss, 'plan_status', row.status || 'active')
  };
}
function getClientIndexRows_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MP.INDEX_SHEET) || ss.getSheets()[0];
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0];
  return values.slice(1).filter(r => r.some(Boolean)).map(r => objectFromRow_(headers, r));
}
function listClients_() {
  return getClientIndexRows_().map(r => ({ clientId:r.client_id, clientName:r.client_name, status:r.status, activePlanId:r.active_plan_id }));
}

function ensureClientSheets_(ss) {
  ensureSheet_(ss, MP.CONFIG_SHEET, [['key','value','description'],['client_id','','ID podopiecznego'],['client_name','','Nazwa'],['plan_id','','ID planu'],['plan_name','','Nazwa planu'],['plan_status','active','active / archived'],['timezone',MP.TIMEZONE,'Timestampy'],['write_rule','app_sheets_only','MonkeyPanel zapisuje do APP_*']]);
  ensureSheet_(ss, MP.LOG_SHEET, [LOG_HEADERS]);
  ensureSheet_(ss, MP.MEASUREMENTS_SHEET, [MEASUREMENT_HEADERS]);
  ensureSheet_(ss, MP.STATUS_SHEET, [STATUS_HEADERS]);
  ensureHeaderColumn_(ss.getSheetByName(MP.LOG_SHEET), 'plan_id');
  ensureHeaderColumn_(ss.getSheetByName(MP.MEASUREMENTS_SHEET), 'plan_id');
  ensureHeaderColumn_(ss.getSheetByName(MP.STATUS_SHEET), 'plan_id');
  ensureHeaderColumn_(ss.getSheetByName(MP.STATUS_SHEET), 'session_note');
}

function getPlan_(ctx) {
  const sheet = ctx.ss.getSheetByName(MP.PLAN_SHEET);
  if (!sheet) throw new Error('Missing sheet in client spreadsheet: ' + MP.PLAN_SHEET);
  const values = sheet.getDataRange().getDisplayValues();
  const wgSheet = ctx.ss.getSheetByName(MP.WG_SHEET);
  const wgValues = wgSheet ? wgSheet.getDataRange().getDisplayValues() : [];
  const prescriptions = parseProgressionPrescriptions_(wgValues);
  return { ok:true, version:MP.VERSION, timezone:MP.TIMEZONE, clientId:ctx.clientId, clientName:ctx.clientName, planId:ctx.planId, planName:ctx.planName, planStatus:ctx.planStatus, startDate:ctx.startDate, spreadsheetId:ctx.spreadsheetId, workouts:parsePlanBlocks_(values, prescriptions), videos:parseVideos_(values), rpe:parseRpe_(values) };
}
function getWorkoutLog_(ctx, e) {
  const requestedPlanId = (e && e.parameter && e.parameter.planId) || ctx.planId;
  return { ok:true, clientId:ctx.clientId, planId:requestedPlanId, logs:readRowsForPlan_(ctx.ss.getSheetByName(MP.LOG_SHEET), requestedPlanId), statuses:readRowsForPlan_(ctx.ss.getSheetByName(MP.STATUS_SHEET), requestedPlanId) };
}
function getMeasurements_(ctx) {
  const sheet = ctx.ss.getSheetByName(MP.MEASUREMENTS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return { ok:true, clientId:ctx.clientId, planId:ctx.planId, measurements:[] };
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0];
  const measurements = values.slice(1).filter(r => r.some(Boolean)).map(r => objectFromRow_(headers, r)).filter(r => !r.plan_id || r.plan_id === ctx.planId);
  return { ok:true, clientId:ctx.clientId, planId:ctx.planId, measurements };
}

function saveWorkoutLog_(ctx, payload) {
  ensureClientSheets_(ctx.ss);
  const sheet = ctx.ss.getSheetByName(MP.LOG_SHEET);
  const timestamp = nowLocal_();
  const performedDate = payload.performedDate || (payload.session && payload.session.performedDate) || payload.performed_date || (payload.session && payload.session.performed_date) || todayLocal_();
  const planId = payload.planId || ctx.planId;
  const session = payload.session || {};
  const exercises = payload.exercises || [];
  const sessionId = session.sessionId || payload.sessionId || '';
  const incomingTotal = exercises.length;
  const incomingCompleted = exercises.filter(ex => Array.isArray(ex.sets) && ex.sets.length > 0 && ex.sets.every(s => s.done !== false)).length;
  const existingStatus = sessionId ? latestStatusForSession_(ctx.ss, planId, sessionId) : null;
  if (existingStatus && existingStatus.status === 'done' && incomingCompleted < incomingTotal) return { ok:false, error:'Refusing to overwrite completed session with partial payload', clientId:ctx.clientId, planId, sessionId, incomingCompleted, incomingTotal };
  if (sessionId) {
    deleteRowsMatching_(sheet, row => samePlanSession_(row, planId, sessionId));
    deleteRowsMatching_(ctx.ss.getSheetByName(MP.STATUS_SHEET), row => samePlanSession_(row, planId, sessionId));
  }
  const rows = [];
  const sessionNote = (payload.sessionNote || (payload.session && payload.session.note) || '').trim();
  if (sessionNote) rows.push([timestamp,ctx.clientId,sessionId,performedDate,session.week || payload.week || '',session.workoutId || payload.workoutId || '',session.workoutName || payload.workoutName || '','NOTE','Notatka treningu','','','', '', '', false, sessionNote,'MonkeyPanel',JSON.stringify(payload),planId]);
  exercises.forEach(ex => {
    if (ex.skipped) {
      rows.push([timestamp,ctx.clientId,sessionId,performedDate,session.week || payload.week || '',session.workoutId || payload.workoutId || '',session.workoutName || payload.workoutName || '',ex.no || '',ex.name || '',0,'POMINIĘTE','','','',false,ex.skipNote || 'Pominięte bez notatki','MonkeyPanel',JSON.stringify(payload),planId]);
      return;
    }
    (ex.sets || []).forEach((set, idx) => rows.push([timestamp,ctx.clientId,sessionId,performedDate,session.week || payload.week || '',session.workoutId || payload.workoutId || '',session.workoutName || payload.workoutName || '',ex.no || '',ex.name || '',set.setNo || idx + 1,set.plannedLabel || set.note || '',set.kg || '',set.reps || '',set.rpe || '',set.done === false ? false : true,set.note || set.freeNote || '','MonkeyPanel',JSON.stringify(payload),planId]));
  });
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, LOG_HEADERS.length).setValues(rows);
  saveStatus_(ctx, payload, false);
  refreshTrainerViews_(ctx.ss);
  return { ok:true, clientId:ctx.clientId, planId, rowsWritten:rows.length, timestamp, timezone:MP.TIMEZONE, trainerViewsRefreshed:true };
}
function saveMeasurements_(ctx, payload) {
  ensureClientSheets_(ctx.ss);
  const sheet = ctx.ss.getSheetByName(MP.MEASUREMENTS_SHEET);
  const timestamp = nowLocal_();
  const v = payload.values || payload.measurements || {};
  const planId = payload.planId || ctx.planId;
  sheet.appendRow([timestamp,ctx.clientId,payload.date || payload.measurementDate || '',payload.week || '',v.Udo || v.udo || '',v.Dupa || v.dupa || '',v.Brzuch || v.brzuch || '',v.Klatka || v.klatka || '',v.Biceps || v.biceps || '',v.Szyja || v.szyja || '',v.Waga || v.waga || '',JSON.stringify(payload),planId]);
  refreshTrainerViews_(ctx.ss);
  return { ok:true, clientId:ctx.clientId, planId, rowsWritten:1, timestamp, timezone:MP.TIMEZONE, trainerViewsRefreshed:true };
}
function saveStatus_(ctx, payload, shouldRefreshTrainerViews) {
  ensureClientSheets_(ctx.ss);
  const sheet = ctx.ss.getSheetByName(MP.STATUS_SHEET);
  const session = payload.session || {};
  const exercises = payload.exercises || [];
  const completed = exercises.filter(ex => ex.skipped || (Array.isArray(ex.sets) && ex.sets.length > 0 && ex.sets.every(s => s.done !== false))).length;
  const skipped = exercises.filter(ex => ex.skipped).length;
  const timestamp = nowLocal_();
  const performedDate = payload.performedDate || (payload.session && payload.session.performedDate) || payload.performed_date || (payload.session && payload.session.performed_date) || todayLocal_();
  const planId = payload.planId || ctx.planId;
  const sessionId = session.sessionId || payload.sessionId || '';
  const sessionNote = (payload.sessionNote || (payload.session && payload.session.note) || '').trim();
  if (sessionId && shouldRefreshTrainerViews !== false) deleteRowsMatching_(sheet, row => samePlanSession_(row, planId, sessionId));
  const status = completed === exercises.length ? (skipped ? 'done_with_skips' : 'done') : 'partial';
  sheet.appendRow([timestamp,ctx.clientId,sessionId,performedDate,session.week || payload.week || '',session.workoutId || payload.workoutId || '',status,completed,exercises.length,JSON.stringify(payload),planId,sessionNote]);
  if (shouldRefreshTrainerViews !== false) refreshTrainerViews_(ctx.ss);
  return { ok:true, clientId:ctx.clientId, planId, timestamp, timezone:MP.TIMEZONE, trainerViewsRefreshed:shouldRefreshTrainerViews !== false };
}

function latestStatusForSession_(ss, planId, sessionId) {
  const rows = readRowsForPlan_(ss.getSheetByName(MP.STATUS_SHEET), planId).filter(r => r.session_id === sessionId);
  if (!rows.length) return null;
  rows.sort((a,b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
  return rows[rows.length - 1];
}
function samePlanSession_(row, planId, sessionId) { return (row.plan_id || planId) === planId && row.session_id === sessionId; }
function deleteRowsMatching_(sheet, predicate) {
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0];
  let deleted = 0;
  for (let i = values.length - 1; i >= 1; i--) { if (predicate(objectFromRow_(headers, values[i]))) { sheet.deleteRow(i + 1); deleted++; } }
  return deleted;
}
function readRowsForPlan_(sheet, requestedPlanId) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0];
  return values.slice(1).filter(r => r.some(Boolean)).map(r => objectFromRow_(headers, r)).filter(r => !requestedPlanId || !r.plan_id || r.plan_id === requestedPlanId);
}

function parsePlanBlocks_(values, prescriptions) {
  const workouts = [];
  for (let r = 0; r < values.length; r++) {
    const row = values[r]; const header = findTrainingHeader_(row); if (!header) continue;
    const workoutId = Number(header.match(/^(\d+)/)[1]);
    const columns = findExerciseColumns_(values, r + 1); if (!columns) continue;
    const exercises = [];
    for (let i = columns.headerRow + 1; i < values.length; i++) {
      const rr = values[i]; if (findTrainingHeader_(rr)) break;
      const no = cell_(rr, columns.noCol), name = cell_(rr, columns.nameCol), set = cell_(rr, columns.setCol), reps = cell_(rr, columns.repsCol);
      const rest = columns.restCol >= 0 ? cell_(rr, columns.restCol) : '';
      const notes = columns.notesCol >= 0 ? cell_(rr, columns.notesCol) : '';
      if (!no && !name) { if (exercises.length > 0) break; continue; }
      if (!name) continue;
      exercises.push({ no:no || '', name, sets:set || '', reps:reps || '', rest:rest || '', notes:notes || '', type:inferExerciseType_(name, notes, rest), prescriptions:prescriptionForExercise_(name, prescriptions) });
    }
    workouts.push({ id:workoutId, name:header.trim(), focus:inferWorkoutFocus_(workoutId), exercises });
  }
  return workouts;
}
function findTrainingHeader_(row) { for (const value of row) { const text = String(value || '').trim(); if (/^\d+\s+TRENING$/i.test(text)) return text; } return null; }
function findExerciseColumns_(values, startRow) {
  for (let r = startRow; r < Math.min(values.length, startRow + 8); r++) {
    const row = values[r].map(v => normalize_(v));
    const noCol = row.findIndex(v => v === 'numer'), nameCol = row.findIndex(v => v === 'cwiczenie'), setCol = row.findIndex(v => v === 'set'), repsCol = row.findIndex(v => v === 'reps'), restCol = row.findIndex(v => v === 'rest'), notesCol = row.findIndex(v => v === 'uwagi');
    if (noCol >= 0 && nameCol >= 0 && setCol >= 0 && repsCol >= 0) return { headerRow:r, noCol, nameCol, setCol, repsCol, restCol, notesCol };
  }
  return null;
}

function parseProgressionPrescriptions_(values) {
  const out = {};
  if (!values || !values.length) return out;
  for (let r = 0; r < values.length - 2; r++) {
    for (let c = 0; c < values[r].length; c++) {
      const exerciseName = String(values[r][c] || '').trim();
      if (!exerciseName || /tydzień|blok|kg|rep|set|pomiary/i.test(exerciseName)) continue;
      const labels = values[r + 1] || [];
      const data = values[r + 2] || [];
      const localLabels = labels.slice(c, c + 10).map(x => normalize_(x));
      if (!localLabels.includes('kg') || !localLabels.includes('rep')) continue;
      const week = findWeekForColumn_(values, r, c);
      if (!week) continue;
      const sets = buildPrescriptionSets_(labels, data, c);
      if (!sets.length) continue;
      const key = normalizeExerciseKey_(exerciseName);
      out[key] = out[key] || {};
      out[key][String(week)] = sets;
    }
  }
  return out;
}
function findWeekForColumn_(values, rowIndex, colIndex) {
  for (let r = rowIndex; r >= 0; r--) {
    for (let c = colIndex; c >= Math.max(0, colIndex - 3); c--) {
      const m = String((values[r] || [])[c] || '').match(/tydzień\s*(\d+)/i);
      if (m) return Number(m[1]);
    }
  }
  return null;
}
function buildPrescriptionSets_(labels, data, startCol) {
  const sets = [];
  let i = startCol;
  let ordinal = 1;
  while (i < labels.length && i < startCol + 12) {
    const label = normalize_(labels[i]);
    if (label === 'kg' && normalize_(labels[i + 1]) === 'rep') {
      const kg = cleanCell_(data[i]);
      const reps = cleanCell_(data[i + 1]);
      if (kg || reps) sets.push({ note:'Seria ' + ordinal, kg, reps });
      ordinal++; i += 2; continue;
    }
    if (label === 'fsl') {
      const kg = cleanCell_(data[i]);
      const reps = cleanCell_(data[i + 1]);
      const count = parseInt(cleanCell_(data[i + 2]) || '0', 10);
      const n = Number.isFinite(count) && count > 0 ? Math.min(count, 8) : 1;
      for (let k = 1; k <= n; k++) sets.push({ note:'FSL ' + k, kg, reps });
      i += 3; continue;
    }
    if (!cleanCell_(labels[i]) && sets.length) break;
    i++;
  }
  return sets;
}
function prescriptionForExercise_(exerciseName, prescriptions) {
  if (!prescriptions) return {};
  const exKey = normalizeExerciseKey_(exerciseName);
  let best = null;
  Object.keys(prescriptions).forEach(key => {
    if (exKey === key || exKey.indexOf(key) >= 0 || key.indexOf(exKey) >= 0) {
      if (!best || key.length > best.key.length) best = { key, value:prescriptions[key] };
    }
  });
  return best ? best.value : {};
}
function normalizeExerciseKey_(value) { return normalize_(value).replace(/[^a-z0-9]+/g, ' ').trim(); }
function cleanCell_(value) { const s = String(value || '').trim(); return s === '-' ? '' : s; }

function parseVideos_(values) { const out = {}; for (const row of values) for (let c = 0; c < row.length; c++) { const val = String(row[c] || '').trim(); if (/^https?:\/\/youtu/.test(val)) { const name = String(row[0] || '').trim(); if (name) out[name] = val; } } return out; }
function parseRpe_(values) { const rows = []; let inTable = false; for (const row of values) { const joined = row.join(' ').toLowerCase(); if (joined.includes('tabela rpe')) inTable = true; if (!inTable) continue; const rpe = cell_(row,1), desc = cell_(row,3), reserve = cell_(row,8); if (rpe && desc && rpe.toLowerCase() !== 'rpe') rows.push({ rpe, description:desc, reserve }); } return rows; }

function refreshTrainerViews_(ss) { if (typeof rebuildTrainerViews !== 'function') return { ok:false, skipped:true, reason:'TrainerViews.gs not installed' }; try { return rebuildTrainerViews(ss); } catch (err) { console.error('Trainer views refresh failed: ' + err); return { ok:false, error:String(err) }; } }
function ensureSheet_(ss, name, initialRows) { let sheet = ss.getSheetByName(name); if (!sheet) sheet = ss.insertSheet(name); if (sheet.getLastRow() === 0 && initialRows && initialRows.length) { sheet.getRange(1,1,initialRows.length,initialRows[0].length).setValues(initialRows); sheet.getRange(1,1,1,initialRows[0].length).setFontWeight('bold'); } return sheet; }
function ensureHeaderColumn_(sheet, header) { if (!sheet) return; const lastCol = Math.max(1, sheet.getLastColumn()); const headers = sheet.getRange(1,1,1,lastCol).getDisplayValues()[0]; if (headers.indexOf(header) === -1) sheet.getRange(1,lastCol+1).setValue(header).setFontWeight('bold'); }
function getConfigValue_(ss, key, fallback) { const sheet = ss.getSheetByName(MP.CONFIG_SHEET); if (!sheet) return fallback; const values = sheet.getDataRange().getDisplayValues(); for (const row of values) if (row[0] === key) return row[1] || fallback; return fallback; }
function parsePayload_(e) { if (!e || !e.postData || !e.postData.contents) throw new Error('Empty POST body'); return JSON.parse(e.postData.contents); }
function json_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
function nowLocal_() { return Utilities.formatDate(new Date(), MP.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'); }
function todayLocal_() { return Utilities.formatDate(new Date(), MP.TIMEZONE, 'yyyy-MM-dd'); }
function cell_(row, index) { if (index < 0) return ''; return String(row[index] || '').trim(); }
function normalize_(value) { return String(value || '').trim().toLowerCase().replace(/ć/g,'c').replace(/ą/g,'a').replace(/ę/g,'e').replace(/ł/g,'l').replace(/ń/g,'n').replace(/ó/g,'o').replace(/ś/g,'s').replace(/ż/g,'z').replace(/ź/g,'z'); }
function normalizeClientId_(value) { return normalize_(value).replace(/\s+/g, ''); }
function inferExerciseType_(name, notes, rest) { const text = normalize_([name,notes,rest].join(' ')); if (text.includes('warm')) return 'warmup'; if (text.includes('cardio') || text.includes('orbitrek') || text.includes('rower')) return 'time'; if (text.includes('rolowanie') || text.includes('flexibility') || text.includes('stretch')) return 'mobility'; if (text.includes('brzuch') || text.includes('plank') || text.includes('dead bug') || text.includes('bird dog')) return 'core'; if (text.includes('wg rozpiski')) return 'strength'; return 'accessory'; }
function inferWorkoutFocus_(id) { const map = { 1:'Trening 1', 2:'Trening 2', 3:'Trening 3', 4:'Trening 4' }; return map[id] || ''; }
function objectFromRow_(headers, row) { const obj = {}; headers.forEach((h,i) => obj[h] = row[i] || ''); return obj; }
