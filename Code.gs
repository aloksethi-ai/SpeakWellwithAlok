/**
 * SpeakWell - Google Apps Script receiver (paste into Extensions > Apps Script of your Google Sheet).
 *
 * 1. Run setup() once. It creates the tabs, formats the columns and prints a SECRET in the
 *    execution log. Copy that value into Vercel as SHEET_SECRET.
 * 2. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 *    Copy the web app URL (ends in /exec) into Vercel as SHEET_WEBHOOK_URL.
 * 3. After ANY later code change: Deploy > Manage deployments > Edit > New version.
 *
 * Only your Vercel function knows the secret, so random visitors cannot write to the sheet.
 */

var REG_HEADERS = ['ID', 'Registered at (IST)', 'Name', 'Email', 'City', 'WhatsApp', 'Marketing opt-in', 'Consent version', '18+ confirmed'];
var USE_HEADERS = ['Completed at (IST)', 'Registration ID', 'Duration (sec)', 'Overall score', 'Video recorded'];

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
  if (use.getLastRow() === 0) use.appendRow(USE_HEADERS);
  use.getRange(1, 1, 1, USE_HEADERS.length).setFontWeight('bold').setBackground('#e8eef6');
  use.setFrozenRows(1);
  use.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  use.getRange('B:B').setNumberFormat('@');

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

  Logger.log('SECRET (copy into Vercel as SHEET_SECRET): ' + props.getProperty('SECRET'));
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
  sh.appendRow([new Date(), String(d.id), Number(d.duration) || 0, d.score === '' ? '' : Number(d.score), d.hasVideo ? 'Yes' : 'No']);
  return { ok: true };
}

function getSs_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
