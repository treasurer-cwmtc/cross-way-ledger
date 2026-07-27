/**
 * Cross Way Ledger - General Ledger pull for Google Sheets.
 *
 * Pulls the live General Ledger from Cross Way Ledger into a sheet tab,
 * authenticated as whoever runs it (via their own Google identity - no
 * password or API key stored anywhere). Build a normal Sheets Pivot Table
 * on top of the "General Ledger" tab this creates.
 *
 * Setup: see docs/DEPLOYMENT.md's "Google Sheets General Ledger export"
 * section in the Cross Way Ledger repo for the one-time setup steps
 * (linking this script to the right Google Cloud project, granting the
 * openid scope, and authorizing).
 */

// Update this if the backend URL ever changes.
const BACKEND_URL = 'https://ledger-backend-prod-633510572581.us-south1.run.app/api/sheets/general-ledger';
const SHEET_NAME = 'General Ledger';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Cross Way Ledger')
    .addItem('Refresh General Ledger', 'refreshGeneralLedger')
    .addToUi();
}

function refreshGeneralLedger() {
  const token = ScriptApp.getIdentityToken();
  const response = UrlFetchApp.fetch(BACKEND_URL, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  if (status !== 200) {
    SpreadsheetApp.getUi().alert(
      'Refresh failed (HTTP ' + status + '): ' + response.getContentText()
    );
    return;
  }

  const rows = JSON.parse(response.getContentText());
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  sheet.clear();

  if (rows.length === 0) {
    sheet.getRange(1, 1).setValue('No General Ledger rows returned.');
    return;
  }

  const headers = Object.keys(rows[0]);
  const values = rows.map((row) => headers.map((h) => row[h]));
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  sheet.setFrozenRows(1);

  SpreadsheetApp.getUi().alert('Refreshed ' + rows.length + ' General Ledger rows.');
}

/**
 * Optional: run this once (from the Apps Script editor, not the Sheet) to
 * set up an automatic daily refresh instead of clicking the menu item
 * every time. Safe to re-run - it clears any existing trigger for this
 * function first so you don't end up with duplicates.
 */
function setupDailyRefreshTrigger() {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === 'refreshGeneralLedger') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('refreshGeneralLedger').timeBased().everyDays(1).atHour(6).create();
}
