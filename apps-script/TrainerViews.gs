/*
  MonkeyPanel Trainer Views

  This file is meant to be added next to Code.gs in Apps Script.

  It creates human-readable trainer sheets from APP_* raw data:
  - TRENER_PODSUMOWANIE
  - TRENER_DZIENNIK
  - TRENER_POMIARY

  APP_* sheets remain machine-readable raw storage.
*/

const TRAINER = {
  SUMMARY_SHEET: 'TRENER_PODSUMOWANIE',
  DIARY_SHEET: 'TRENER_DZIENNIK',
  MEASUREMENTS_SHEET: 'TRENER_POMIARY'
};

function setupTrainerViews() {
  setupMonkeyPanelSheets();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureTrainerSheet_(ss, TRAINER.SUMMARY_SHEET, [
    ['Sekcja', 'Wartość', 'Opis']
  ]);

  ensureTrainerSheet_(ss, TRAINER.DIARY_SHEET, [[
    'Data treningu', 'Tydzień', 'Trening', 'Status', 'Ćwiczenie', 'Serie / wynik', 'RPE', 'Notatki', 'Zapisano', 'Plan ID'
  ]]);

  ensureTrainerSheet_(ss, TRAINER.MEASUREMENTS_SHEET, [[
    'Data pomiaru', 'Tydzień', 'Waga', 'Udo', 'Dupa', 'Brzuch', 'Klatka', 'Biceps', 'Szyja', 'Zmiana wagi', 'Zapisano', 'Plan ID'
  ]]);

  formatTrainerSheets_();
  rebuildTrainerViews();
  return { ok: true, message: 'Trainer views created/rebuilt' };
}

function rebuildTrainerViews() {
  setupMonkeyPanelSheets();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const logRows = readObjects_(ss.getSheetByName(MP.LOG_SHEET));
  const measurementRows = readObjects_(ss.getSheetByName(MP.MEASUREMENTS_SHEET));
  const statusRows = readObjects_(ss.getSheetByName(MP.STATUS_SHEET));

  rebuildTrainerDiary_(ss, logRows, statusRows);
  rebuildTrainerMeasurements_(ss, measurementRows);
  rebuildTrainerSummary_(ss, logRows, measurementRows, statusRows);
  formatTrainerSheets_();

  return {
    ok: true,
    diaryRows: logRows.length,
    measurementRows: measurementRows.length,
    statusRows: statusRows.length,
    rebuiltAt: nowLocal_()
  };
}

function clearAppDataAfterArchive() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const stamp = nowLocal_().replace(/[-: ]/g, '').slice(0, 14);

  archiveSheet_(ss, MP.LOG_SHEET, 'ARCHIVE_APP_LOG_' + stamp);
  archiveSheet_(ss, MP.MEASUREMENTS_SHEET, 'ARCHIVE_APP_MEASUREMENTS_' + stamp);
  archiveSheet_(ss, MP.STATUS_SHEET, 'ARCHIVE_APP_STATUS_' + stamp);

  clearRowsBelowHeader_(ss.getSheetByName(MP.LOG_SHEET));
  clearRowsBelowHeader_(ss.getSheetByName(MP.MEASUREMENTS_SHEET));
  clearRowsBelowHeader_(ss.getSheetByName(MP.STATUS_SHEET));

  rebuildTrainerViews();

  return {
    ok: true,
    message: 'APP_* data archived and cleared. Trainer views rebuilt.',
    archiveStamp: stamp
  };
}

function rebuildTrainerDiary_(ss, logRows, statusRows) {
  const sheet = ss.getSheetByName(TRAINER.DIARY_SHEET) || ss.insertSheet(TRAINER.DIARY_SHEET);
  clearSheetKeepHeader_(sheet, ['Data treningu', 'Tydzień', 'Trening', 'Status', 'Ćwiczenie', 'Serie / wynik', 'RPE', 'Notatki', 'Zapisano', 'Plan ID']);

  const statusBySession = {};
  statusRows.forEach(row => {
    const key = row.session_id || [row.workout_date, row.week, row.workout_id].join('|');
    statusBySession[key] = row.status || '';
  });

  const grouped = {};
  logRows.forEach(row => {
    const sessionKey = row.session_id || [row.workout_date, row.week, row.workout_id].join('|');
    const exerciseKey = [sessionKey, row.exercise_no, row.exercise_name].join('|');
    if (!grouped[exerciseKey]) {
      grouped[exerciseKey] = {
        sessionKey,
        workoutDate: row.workout_date || '',
        week: row.week || '',
        workoutName: row.workout_name || '',
        exerciseNo: row.exercise_no || '',
        exerciseName: row.exercise_name || '',
        timestamp: row.timestamp || '',
        planId: row.plan_id || '',
        sets: [],
        rpes: [],
        notes: []
      };
    }

    const kg = row.kg || '-';
    const reps = row.reps || '-';
    const label = row.planned_label || ('Seria ' + (row.set_no || ''));
    grouped[exerciseKey].sets.push(label + ': ' + kg + ' kg × ' + reps);
    if (row.rpe) grouped[exerciseKey].rpes.push(row.rpe);
    if (row.note) grouped[exerciseKey].notes.push(row.note);
    if (row.timestamp) grouped[exerciseKey].timestamp = row.timestamp;
  });

  const out = Object.values(grouped)
    .sort((a, b) => String(a.workoutDate).localeCompare(String(b.workoutDate)) || Number(a.week) - Number(b.week) || String(a.exerciseNo).localeCompare(String(b.exerciseNo), 'pl', { numeric: true }))
    .map(g => [
      g.workoutDate,
      g.week,
      g.workoutName,
      statusBySession[g.sessionKey] || '',
      (g.exerciseNo ? g.exerciseNo + '. ' : '') + g.exerciseName,
      g.sets.join(' / '),
      unique_(g.rpes).join(', '),
      unique_(g.notes).join(' | '),
      g.timestamp,
      g.planId
    ]);

  if (out.length) sheet.getRange(2, 1, out.length, out[0].length).setValues(out);
}

function rebuildTrainerMeasurements_(ss, measurementRows) {
  const sheet = ss.getSheetByName(TRAINER.MEASUREMENTS_SHEET) || ss.insertSheet(TRAINER.MEASUREMENTS_SHEET);
  clearSheetKeepHeader_(sheet, ['Data pomiaru', 'Tydzień', 'Waga', 'Udo', 'Dupa', 'Brzuch', 'Klatka', 'Biceps', 'Szyja', 'Zmiana wagi', 'Zapisano', 'Plan ID']);

  const rows = measurementRows
    .sort((a, b) => String(a.measurement_date).localeCompare(String(b.measurement_date)))
    .map((row, index, arr) => {
      const prev = index > 0 ? parseNumber_(arr[index - 1].Waga) : null;
      const current = parseNumber_(row.Waga);
      const diff = prev !== null && current !== null ? round1_(current - prev) : '';
      return [
        row.measurement_date || '',
        row.week || '',
        row.Waga || '',
        row.Udo || '',
        row.Dupa || '',
        row.Brzuch || '',
        row.Klatka || '',
        row.Biceps || '',
        row.Szyja || '',
        diff,
        row.timestamp || '',
        row.plan_id || ''
      ];
    });

  if (rows.length) sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function rebuildTrainerSummary_(ss, logRows, measurementRows, statusRows) {
  const sheet = ss.getSheetByName(TRAINER.SUMMARY_SHEET) || ss.insertSheet(TRAINER.SUMMARY_SHEET);
  sheet.clear();

  const planId = getPlanId_();
  const completed = statusRows.filter(r => r.status === 'done').length;
  const partial = statusRows.filter(r => r.status === 'partial').length;
  const uniqueSessions = unique_(statusRows.map(r => r.session_id || [r.workout_date, r.week, r.workout_id].join('|')).filter(Boolean)).length;
  const lastStatus = statusRows.length ? statusRows[statusRows.length - 1] : null;
  const missingRpe = logRows.filter(r => String(r.done).toLowerCase() !== 'false' && !r.rpe).length;
  const lastMeasurement = measurementRows.length ? measurementRows[measurementRows.length - 1] : null;

  const rows = [
    ['TRENER_PODSUMOWANIE', '', 'Widok czytelny dla trenera. Dane źródłowe są w APP_*'],
    ['Plan ID', planId, 'Historia jest przypisana do konkretnego planu'],
    ['Nazwa planu', getConfigValue_('plan_name', MP.PLAN_NAME), ''],
    ['Status planu', getConfigValue_('plan_status', MP.PLAN_STATUS), 'active / archived'],
    ['Ostatnia przebudowa widoków', nowLocal_(), 'Uruchom rebuildTrainerViews(), aby odświeżyć ręcznie'],
    ['', '', ''],
    ['Treningi zapisane', uniqueSessions, 'Liczba unikalnych sesji w APP_STATUS'],
    ['Treningi ukończone', completed, 'Status done'],
    ['Treningi częściowe', partial, 'Status partial'],
    ['Ostatni trening', lastStatus ? ((lastStatus.workout_date || '') + ' · tydz. ' + (lastStatus.week || '') + ' · ' + (lastStatus.workout_id || '')) : 'brak', ''],
    ['Braki RPE', missingRpe, 'Serie wykonane bez wpisanego RPE'],
    ['Ostatni pomiar', lastMeasurement ? ((lastMeasurement.measurement_date || '') + ' · waga ' + (lastMeasurement.Waga || '-')) : 'brak', ''],
    ['', '', ''],
    ['Co czytać?', 'TRENER_DZIENNIK', 'Czytelny dziennik wykonanych ćwiczeń'],
    ['Co czytać?', 'TRENER_POMIARY', 'Czytelna historia pomiarów'],
    ['Czego nie edytować?', 'APP_*', 'Surowe dane aplikacji']
  ];

  sheet.getRange(1, 1, rows.length, 3).setValues(rows);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#d9ead3');
  sheet.getRange(7, 1, 6, 3).setBackground('#f3f3f3');
}

function ensureTrainerSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, headers.length, headers[0].length).setValues(headers);
  }
  sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight('bold');
  return sheet;
}

function formatTrainerSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [TRAINER.DIARY_SHEET, TRAINER.MEASUREMENTS_SHEET, TRAINER.SUMMARY_SHEET].forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const lastCol = Math.max(1, sheet.getLastColumn());
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, lastCol).setFontWeight('bold').setBackground('#d9ead3');
    sheet.autoResizeColumns(1, lastCol);
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).setWrap(true).setVerticalAlignment('top');
    }
  });
}

function readObjects_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0];
  return values.slice(1).filter(row => row.some(Boolean)).map(row => objectFromRow_(headers, row));
}

function clearSheetKeepHeader_(sheet, headers) {
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
}

function clearRowsBelowHeader_(sheet) {
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(1, sheet.getLastColumn());
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
}

function archiveSheet_(ss, sourceName, archiveName) {
  const source = ss.getSheetByName(sourceName);
  if (!source) return null;
  const copy = source.copyTo(ss);
  copy.setName(archiveName);
  copy.hideSheet();
  return copy;
}

function unique_(arr) {
  return Array.from(new Set((arr || []).filter(v => v !== '' && v !== null && v !== undefined)));
}

function parseNumber_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function round1_(n) {
  return Math.round(n * 10) / 10;
}
