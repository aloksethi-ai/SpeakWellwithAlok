/**
 * SpeakWell - Google Apps Script receiver (paste into Extensions > Apps Script of your Google Sheet).
 *
 * 1. Run setup() once. It creates the tabs (Registrations, Usage, User Scores, Stats) and the secret.
 *    Run showSecret() when you need to copy the secret into Vercel as SHEET_SECRET.
 * 2. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 *    Copy the web app URL (ends in /exec) into Vercel as SHEET_WEBHOOK_URL.
 * 3. After ANY later code change: Deploy > Manage deployments > Edit > New version.
 *
 * Only your Vercel function knows the secret, so random visitors cannot write to the sheet.
 */

var REG_HEADERS = ['ID', 'Registered at (IST)', 'Name', 'Email', 'City', 'WhatsApp', 'Marketing opt-in', 'Consent version', '18+ confirmed'];
var USE_HEADERS = ['Completed at (IST)', 'Registration ID', 'Duration (sec)', 'Overall score', 'Video recorded', 'Name', 'Email', 'Started at (IST)'];

function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) props.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  var ss = getSs_();
  ss.setSpreadsheetTimeZone('Asia/Kolkata');

  var reg = ss.getSheetByName('Registrations') || ss.insertSheet('Registrations');
  if (reg.getLastRow() === 0) reg.appendRow(REG_HEADERS);
  reg.getRange(1, 1, 1, REG_HEADERS.length).setFontWeight('bold').setBackground('#e8eef6');
  reg.setFrozenRows(1);
  reg.getRange('A:A').setNumberFormat('@');
  reg.getRange('B:B').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  reg.getRange('C:F').setNumberFormat('@'); // keep +91... numbers as text

  var use = ss.getSheetByName('Usage') || ss.insertSheet('Usage');
  use.getRange(1, 1, 1, USE_HEADERS.length).setValues([USE_HEADERS]).setFontWeight('bold').setBackground('#e8eef6');
  use.setFrozenRows(1);
  use.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  use.getRange('B:B').setNumberFormat('@');
  use.getRange('F:G').setNumberFormat('@');
  use.getRange('H:H').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  backfillUsage_(ss);

  // One row per user: sessions, average / best score, last session. Updates automatically.
  var us = ss.getSheetByName('User Scores') || ss.insertSheet('User Scores');
  us.clear();
  us.getRange('A1:C1').setValues([['Name', 'Email', 'City']]);
  us.getRange('A1:H1').setFontWeight('bold').setBackground('#e8eef6');
  us.setFrozenRows(1);
  // D1 holds the QUERY: it writes its own header labels in row 1 and one row per user below.
  us.getRange('D1').setFormula('=IFERROR(QUERY(Usage!A2:D,"select B, count(B), avg(D), max(D), max(A) where B <> \'\' group by B order by avg(D) desc label B \'Registration ID\', count(B) \'Sessions\', avg(D) \'Average score\', max(D) \'Best score\', max(A) \'Last session (IST)\'",0),"")');
  var lk = function (col) {
    return '=ARRAYFORMULA(IF(D2:D="","",IFERROR(VLOOKUP(D2:D,{Registrations!A:A,Registrations!C:C,Registrations!D:D,Registrations!E:E},' + col + ',FALSE),"")))';
  };
  us.getRange('A2').setFormula(lk(2));
  us.getRange('B2').setFormula(lk(3));
  us.getRange('C2').setFormula(lk(4));
  us.getRange('F:G').setNumberFormat('0.0');
  us.getRange('H:H').setNumberFormat('yyyy-mm-dd hh:mm');
  us.setColumnWidths(1, 3, 170);
  us.setColumnWidth(4, 260);

  var st = ss.getSheetByName('Stats') || ss.insertSheet('Stats');
  st.clear();
  st.getRange('A1:B7').setValues([
    ['Metric', 'Value'],
    ['Total registered users', '=MAX(0,COUNTA(Registrations!A:A)-1)'],
    ['Registered today', '=COUNTIFS(Registrations!B:B,">="&TODAY())'],
    ['Marketing opt-ins (WhatsApp/email)', '=COUNTIF(Registrations!G:G,"Yes")'],
    ['Practice sessions completed', '=MAX(0,COUNTA(Usage!A:A)-1)'],
    ['Unique users who completed a session', '=IFERROR(COUNTA(UNIQUE(FILTER(Usage!B2:B,Usage!B2:B<>""))),0)'],
    ['Average overall score', '=IFERROR(ROUND(AVERAGE(Usage!D2:D),1),"-")']
  ]);
  st.getRange('A1:B1').setFontWeight('bold').setBackground('#e8eef6');
  st.setColumnWidth(1, 300);

  Logger.log('SETUP DONE. Secret is stored in Script Properties.');
}

/** Run this only when you need to copy the secret into Vercel (SHEET_SECRET). */
function showSecret() {
  Logger.log('SHEET_SECRET = ' + PropertiesService.getScriptProperties().getProperty('SECRET'));
}

/** Looks up [name, email] for a registration ID. */
function lookupUser_(ss, id) {
  var sh = ss.getSheetByName('Registrations');
  if (!sh || sh.getLastRow() < 2) return ['', ''];
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][0]) === String(id)) return [v[i][2], v[i][3]];
  }
  return ['', ''];
}

/** Fills Name / Email on older Usage rows that were saved before these columns existed. */
function backfillUsage_(ss) {
  var sh = ss.getSheetByName('Usage');
  if (!sh || sh.getLastRow() < 2) return;
  var n = sh.getLastRow() - 1;
  var ids = sh.getRange(2, 2, n, 1).getValues();
  var cur = sh.getRange(2, 6, n, 2).getValues();
  for (var i = 0; i < n; i++) {
    if (!cur[i][0] && ids[i][0]) cur[i] = lookupUser_(ss, ids[i][0]);
  }
  sh.getRange(2, 6, n, 2).setValues(cur);
  var t = sh.getRange(2, 1, n, 3).getValues(), h = sh.getRange(2, 8, n, 1).getValues();
  for (var j = 0; j < n; j++) {
    if (!h[j][0] && t[j][0] instanceof Date) h[j][0] = new Date(t[j][0].getTime() - (Number(t[j][2]) || 0) * 1000);
  }
  sh.getRange(2, 8, n, 1).setValues(h);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    var secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    var d;
    try { d = JSON.parse(e.postData.contents); } catch (x) { return out_({ ok: false, error: 'bad_json' }); }
    if (!secret || d.secret !== secret) return out_({ ok: false, error: 'unauthorized' });
    var ss = getSs_();
    if (d.type === 'register') return out_(register_(ss, d));
    if (d.type === 'event') return out_(event_(ss, d));
    return out_({ ok: false, error: 'unknown_type' });
  } catch (err) {
    return out_({ ok: false, error: 'server_error' });
  } finally {
    try { lock.releaseLock(); } catch (x) { /* ignore */ }
  }
}

function doGet() { return out_({ ok: true, service: 'speakwell' }); }

function register_(ss, d) {
  var sh = ss.getSheetByName('Registrations');
  if (!sh) return { ok: false, error: 'run_setup' };
  var email = String(d.email || '').toLowerCase();
  if (!email || !d.name || !d.city || !d.whatsapp) return { ok: false, error: 'missing_fields' };
  var last = sh.getLastRow();
  if (last > 1) {
    var emails = sh.getRange(2, 4, last - 1, 1).getValues();
    for (var i = 0; i < emails.length; i++) {
      if (String(emails[i][0]).toLowerCase() === email) {
        return { ok: true, id: String(sh.getRange(i + 2, 1).getValue()), existing: true };
      }
    }
  }
  var id = Utilities.getUuid();
  sh.appendRow([id, new Date(), d.name, email, d.city, d.whatsapp, d.marketing ? 'Yes' : 'No', d.consentVersion || 'v1', 'Yes']);
  return { ok: true, id: id };
}

function event_(ss, d) {
  var sh = ss.getSheetByName('Usage');
  if (!sh) return { ok: false, error: 'run_setup' };
  var u = lookupUser_(ss, d.id);
  var dur = Number(d.duration) || 0;
  var done = new Date();
  var started = new Date(done.getTime() - dur * 1000);
  sh.appendRow([done, String(d.id), dur, d.score === '' ? '' : Number(d.score), d.hasVideo ? 'Yes' : 'No', u[0], u[1], started]);
  var r = sh.getLastRow();
  sh.getRange(r, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sh.getRange(r, 8).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  return { ok: true };
}

function getSs_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
