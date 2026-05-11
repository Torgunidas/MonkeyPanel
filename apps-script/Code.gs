/*
  MonkeyPanel Apps Script Backend MVP

  Source of truth:
  - Plan = readonly coach workflow
  - WG = readonly progression/helper sheet
  - APP_LOG / APP_MEASUREMENTS / APP_STATUS = app writes
  - TRENER_* = human-readable trainer views generated from APP_*
*/

const MP = {
  CLIENT_ID: 'gabriel',
  PLAN_ID: 'gabriel_plan_2026_05_v1',
  PLAN_NAME: 'Gabriel Plan v1',
  PLAN_STATUS: 'active',
  PLAN_SHEET: 'Plan',
  WG_SHEET: 'WG',
  CONFIG_SHEET: 'APP_CONFIG',
  LOG_SHEET: 'APP_LOG',
  MEASUREMENTS_SHEET: 'APP_MEASUREMENTS',
  STATUS_SHEET: 'APP_STATUS',
  TIMEZONE: 'Europe/Warsaw',
  VERSION: '0.1.4'
};

const LOG_HEADERS = [
  'timestamp', 'client_id', 'session_id', 'workout_date', 'week', 'workout_id', 'workout_name',
  'exercise_no', 'exercise_name', 'set_no', 'planned_label', 'kg', 'reps', 'rpe', 'done', 'note', 'source', 'payload_json', 'plan_id'
];

const MEASUREMENT_HEADERS = [
  'timestamp', 'client_id', 'measurement_date', 'week', 'Udo', 'Dupa', 'Brzuch', 'Klatka', 'Biceps', 'Szyja', 'Waga', 'payload_json', 'plan_id'
];

const STATUS_HEADERS = [
  'timestamp', 'client_id', 'session_id', 'workout_date', 'week', 'workout_id', 'status', 'completed_exercises', 'total_exercises', 'payload_json', 'plan_id'
];

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'health';
  try {
    if (action === 'health') return json_({ ok: true, version: MP.VERSION, timezone: MP.TIMEZONE, now: nowLocal_(), planId: getPlanId_() });
    if (action === 'getPlan') return json_(getPlan_());
    if (action === 'getMeasurements') return json_(getMeasurements_());
    if (action === 'getWorkoutLog') return json_(getWorkoutLog_(e));
    return json_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return json_({ ok: false, error: String(err), stack: err && err.stack });
  }
}

function doPost(e) {
  try {
    const payload = parsePayload_(e);
    const action = payload.action;
    if (action === 'saveWorkoutLog') return json_(saveWorkoutLog_(payload));
    if (action === 'saveMeasurements') return json_(saveMeasurements_(payload));
    if (action === 'saveStatus') return json_(saveStatus_(payload));
    return json_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return json_({ ok: false, error: String(err), stack: err && err.stack });
  }
}

function setupMonkeyPanelSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, MP.CONFIG_SHEET, [
    ['key', 'value', 'description'],
    ['client_id', MP.CLIENT_ID, 'ID podopiecznego używane przez MonkeyPanel'],
    ['client_name', 'Gabriel', 'Nazwa wyświetlana'],
    ['plan_id', MP.PLAN_ID, 'Stabilne ID planu. Historia zapisów jest przypisana do plan_id.'],
    ['plan_name', MP.PLAN_NAME, 'Nazwa planu wyświetlana w panelach / raportach'],
    ['plan_status', MP.PLAN_STATUS, 'active albo archived'],
    ['template_version', 'MonkeyPanel Template v1', 'Wersja szablonu arkusza'],
    ['canonical_plan_sheet', MP.PLAN_SHEET, 'Arkusz planu trenera, readonly'],
    ['progression_sheet', MP.WG_SHEET, 'Arkusz progresji / pomocniczy, readonly'],
    ['timezone', MP.TIMEZONE, 'Timestampy zapisujemy jawnie w polskim czasie lokalnym'],
    ['parser_rule', 'training_blocks', 'Szukaj nagłówków typu 1 TRENING, 2 TRENING; czytaj tabelę pod nagłówkiem'],
    ['write_rule', 'app_sheets_only', 'MonkeyPanel zapisuje tylko do APP_*']
  ]);

  ensureSheet_(ss, MP.LOG_SHEET, [LOG_HEADERS]);
  ensureSheet_(ss, MP.MEASUREMENTS_SHEET, [MEASUREMENT_HEADERS]);
  ensureSheet_(ss, MP.STATUS_SHEET, [STATUS_HEADERS]);
  ensureHeaderColumn_(ss.getSheetByName(MP.LOG_SHEET), 'plan_id');
  ensureHeaderColumn_(ss.getSheetByName(MP.MEASUREMENTS_SHEET), 'plan_id');
  ensureHeaderColumn_(ss.getSheetByName(MP.STATUS_SHEET), 'plan_id');

  return { ok: true, message: 'MonkeyPanel APP_* sheets initialized', timezone: MP.TIMEZONE, planId: getPlanId_() };
}

function getPlan_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MP.PLAN_SHEET);
  if (!sheet) throw new Error('Missing sheet: ' + MP.PLAN_SHEET);
  const values = sheet.getDataRange().getDisplayValues();
  return {
    ok: true,
    version: MP.VERSION,
    timezone: MP.TIMEZONE,
    clientId: getConfigValue_('client_id', MP.CLIENT_ID),
    planId: getPlanId_(),
    planName: getConfigValue_('plan_name', MP.PLAN_NAME),
    planStatus: getConfigValue_('plan_status', MP.PLAN_STATUS),
    planSheet: MP.PLAN_SHEET,
    workouts: parsePlanBlocks_(values),
    videos: parseVideos_(values),
    rpe: parseRpe_(values)
  };
}

function parsePlanBlocks_(values) {
  const workouts = [];
  for (let r = 0; r < values.length; r++) {
    const row = values[r];
    const header = findTrainingHeader_(row);
    if (!header) continue;
    const workoutId = Number(header.match(/^(\d+)/)[1]);
    const columns = findExerciseColumns_(values, r + 1);
    if (!columns) continue;
    const exercises = [];
    for (let i = columns.headerRow + 1; i < values.length; i++) {
      const rr = values[i];
      if (findTrainingHeader_(rr)) break;
      const no = cell_(rr, columns.noCol);
      const name = cell_(rr, columns.nameCol);
      const set = cell_(rr, columns.setCol);
      const reps = cell_(rr, columns.repsCol);
      const rest = columns.restCol >= 0 ? cell_(rr, columns.restCol) : '';
      const notes = columns.notesCol >= 0 ? cell_(rr, columns.notesCol) : '';
      if (!no && !name) {
        if (exercises.length > 0) break;
        continue;
      }
      if (!name) continue;
      exercises.push({ no: no || '', name, sets: set || '', reps: reps || '', rest: rest || '', notes: notes || '', type: inferExerciseType_(name, notes, rest) });
    }
    workouts.push({ id: workoutId, name: header.trim(), focus: inferWorkoutFocus_(workoutId), exercises });
  }
  return workouts;
}

function findTrainingHeader_(row) {
  for (const value of row) {
    const text = String(value || '').trim();
    if (/^\d+\s+TRENING$/i.test(text)) return text;
  }
  return null;
}

function findExerciseColumns_(values, startRow) {
  for (let r = startRow; r < Math.min(values.length, startRow + 5); r++) {
    const row = values[r].map(v => normalize_(v));
    const noCol = row.findIndex(v => v === 'numer');
    const nameCol = row.findIndex(v => v === 'cwiczenie');
    const setCol = row.findIndex(v => v === 'set');
    const repsCol = row.findIndex(v => v === 'reps');
    const restCol = row.findIndex(v => v === 'rest');
    const notesCol = row.findIndex(v => v === 'uwagi');
    if (noCol >= 0 && nameCol >= 0 && setCol >= 0 && repsCol >= 0) return { headerRow: r, noCol, nameCol, setCol, repsCol, restCol, notesCol };
  }
  return null;
}

function parseVideos_(values) {
  const out = {};
  for (const row of values) {
    for (let c = 0; c < row.length; c++) {
      const val = String(row[c] || '').trim();
      if (/^https?:\/\/youtu/.test(val)) {
        const name = String(row[0] || '').trim();
        if (name) out[name] = val;
      }
    }
  }
  return out;
}

function parseRpe_(values) {
  const rows = [];
  let inTable = false;
  for (const row of values) {
    const joined = row.join(' ').toLowerCase();
    if (joined.includes('tabela rpe')) inTable = true;
    if (!inTable) continue;
    const rpe = cell_(row, 1);
    const desc = cell_(row, 3);
    const reserve = cell_(row, 8);
    if (rpe && desc && rpe.toLowerCase() !== 'rpe') rows.push({ rpe, description: desc, reserve });
  }
  return rows;
}

function saveWorkoutLog_(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  setupMonkeyPanelSheets();
  const sheet = ss.getSheetByName(MP.LOG_SHEET);
  const rows = [];
  const timestamp = nowLocal_();
  const clientId = payload.clientId || MP.CLIENT_ID;
  const planId = payload.planId || getPlanId_();
  const session = payload.session || {};
  const exercises = payload.exercises || [];

  exercises.forEach(ex => {
    const sets = ex.sets || [];
    sets.forEach((set, idx) => {
      rows.push([
        timestamp, clientId, session.sessionId || payload.sessionId || '', session.workoutDate || payload.workoutDate || '',
        session.week || payload.week || '', session.workoutId || payload.workoutId || '', session.workoutName || payload.workoutName || '',
        ex.no || '', ex.name || '', set.setNo || idx + 1, set.plannedLabel || set.note || '', set.kg || '', set.reps || '', set.rpe || '',
        set.done === false ? false : true, set.note || set.freeNote || '', 'MonkeyPanel', JSON.stringify(payload), planId
      ]);
    });
  });

  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  saveStatus_(payload, false);
  refreshTrainerViews_();
  return { ok: true, rowsWritten: rows.length, timestamp, timezone: MP.TIMEZONE, planId, trainerViewsRefreshed: true };
}

function saveMeasurements_(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  setupMonkeyPanelSheets();
  const sheet = ss.getSheetByName(MP.MEASUREMENTS_SHEET);
  const timestamp = nowLocal_();
  const values = payload.values || payload.measurements || {};
  const planId = payload.planId || getPlanId_();
  sheet.appendRow([
    timestamp, payload.clientId || MP.CLIENT_ID, payload.date || payload.measurementDate || '', payload.week || '',
    values.Udo || values.udo || '', values.Dupa || values.dupa || '', values.Brzuch || values.brzuch || '',
    values.Klatka || values.klatka || '', values.Biceps || values.biceps || '', values.Szyja || values.szyja || '', values.Waga || values.waga || '',
    JSON.stringify(payload), planId
  ]);
  refreshTrainerViews_();
  return { ok: true, rowsWritten: 1, timestamp, timezone: MP.TIMEZONE, planId, trainerViewsRefreshed: true };
}

function saveStatus_(payload, shouldRefreshTrainerViews) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MP.STATUS_SHEET);
  if (!sheet) return { ok: false, error: 'Missing APP_STATUS' };
  const session = payload.session || {};
  const exercises = payload.exercises || [];
  const completed = exercises.filter(ex => (ex.sets || []).every(s => s.done !== false)).length;
  const timestamp = nowLocal_();
  const planId = payload.planId || getPlanId_();
  sheet.appendRow([
    timestamp, payload.clientId || MP.CLIENT_ID, session.sessionId || payload.sessionId || '', session.workoutDate || payload.workoutDate || '',
    session.week || payload.week || '', session.workoutId || payload.workoutId || '', completed === exercises.length ? 'done' : 'partial',
    completed, exercises.length, JSON.stringify(payload), planId
  ]);
  if (shouldRefreshTrainerViews !== false) refreshTrainerViews_();
  return { ok: true, timestamp, timezone: MP.TIMEZONE, planId, trainerViewsRefreshed: shouldRefreshTrainerViews !== false };
}

function getWorkoutLog_(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MP.LOG_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, logs: [] };

  const requestedPlanId = (e && e.parameter && e.parameter.planId) || getPlanId_();
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0];
  const rows = values.slice(1)
    .filter(row => row.some(Boolean))
    .map(row => objectFromRow_(headers, row))
    .filter(row => !requestedPlanId || !row.plan_id || row.plan_id === requestedPlanId);

  return { ok: true, logs: rows, planId: requestedPlanId };
}

function getMeasurements_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MP.MEASUREMENTS_SHEET);
  if (!sheet) return { ok: true, measurements: [] };
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length <= 1) return { ok: true, measurements: [] };
  const headers = values[0];
  const rows = values.slice(1).map(row => objectFromRow_(headers, row));
  return { ok: true, measurements: rows };
}

function refreshTrainerViews_() {
  if (typeof rebuildTrainerViews !== 'function') return { ok: false, skipped: true, reason: 'TrainerViews.gs not installed' };
  try {
    return rebuildTrainerViews();
  } catch (err) {
    console.error('Trainer views refresh failed: ' + err);
    return { ok: false, error: String(err) };
  }
}

function getPlanId_() {
  return getConfigValue_('plan_id', MP.PLAN_ID);
}

function nowLocal_() {
  return Utilities.formatDate(new Date(), MP.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

function ensureSheet_(ss, name, initialRows) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0 && initialRows && initialRows.length) {
    sheet.getRange(1, 1, initialRows.length, initialRows[0].length).setValues(initialRows);
    sheet.getRange(1, 1, 1, initialRows[0].length).setFontWeight('bold');
  }
  return sheet;
}

function ensureHeaderColumn_(sheet, header) {
  if (!sheet) return;
  const lastCol = Math.max(1, sheet.getLastColumn());
  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  if (headers.indexOf(header) === -1) sheet.getRange(1, lastCol + 1).setValue(header).setFontWeight('bold');
}

function getConfigValue_(key, fallback) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MP.CONFIG_SHEET);
  if (!sheet) return fallback;
  const values = sheet.getDataRange().getDisplayValues();
  for (const row of values) if (row[0] === key) return row[1] || fallback;
  return fallback;
}

function parsePayload_(e) {
  if (!e || !e.postData || !e.postData.contents) throw new Error('Empty POST body');
  return JSON.parse(e.postData.contents);
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function cell_(row, index) {
  if (index < 0) return '';
  return String(row[index] || '').trim();
}

function normalize_(value) {
  return String(value || '').trim().toLowerCase().replace(/ć/g, 'c').replace(/ą/g, 'a').replace(/ę/g, 'e').replace(/ł/g, 'l').replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/ż/g, 'z').replace(/ź/g, 'z');
}

function inferExerciseType_(name, notes, rest) {
  const text = normalize_([name, notes, rest].join(' '));
  if (text.includes('warm')) return 'warmup';
  if (text.includes('cardio') || text.includes('orbitrek') || text.includes('rower')) return 'time';
  if (text.includes('rolowanie') || text.includes('flexibility') || text.includes('stretch')) return 'mobility';
  if (text.includes('brzuch') || text.includes('plank') || text.includes('dead bug') || text.includes('bird dog')) return 'core';
  if (text.includes('wg rozpiski')) return 'strength';
  return 'accessory';
}

function inferWorkoutFocus_(id) {
  const map = { 1: 'Dół + klatka + core', 2: 'Plecy + barki + tył', 3: 'Góra + push + core', 4: 'Cardio + mobilność' };
  return map[id] || '';
}

function objectFromRow_(headers, row) {
  const obj = {};
  headers.forEach((h, i) => obj[h] = row[i] || '');
  return obj;
}
