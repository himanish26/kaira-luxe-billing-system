/**
 * KLBS Customer CRM receiver, contract KLBS_CUSTOMER_CRM_V1.
 * Spreadsheet-bound Web App. Never logs request bodies or personal fields.
 */
var KLBS_CRM_CONTRACT_ = 'KLBS_CUSTOMER_CRM_V1';
var KLBS_CRM_MASTER_ = 'Customer_Master';
var KLBS_CRM_LOG_ = 'Sync_Log';
var KLBS_CRM_META_ = 'CRM_Revision_Metadata';
var KLBS_CRM_SECRET_PROPERTY_ = 'KLBS_CUSTOMER_CRM_AUTH_SECRET';
var KLBS_CRM_SPREADSHEET_PROPERTY_ = 'KLBS_CUSTOMER_CRM_SPREADSHEET_ID';
var KLBS_CRM_TOLERANCE_MS_ = 5 * 60 * 1000;
var KLBS_CRM_LOCK_WAIT_MS_ = 10000;
var KLBS_CRM_MAX_LOG_ROWS_ = 5000;
var KLBS_CRM_MASTER_HEADERS_ = [
  'Store Code', 'Customer ID', 'Customer Name', 'Mobile Number',
  'Birthday (DDMM)', 'Anniversary (DDMM)', 'Email',
  'Customer Created At', 'Customer Updated At', 'Last Synced At'
];
var KLBS_CRM_LOG_HEADERS_ = [
  'Timestamp', 'Operation', 'Store Code', 'Customer ID', 'Result', 'Error Code', 'Details'
];
var KLBS_CRM_META_HEADERS_ = ['Identity Key', 'Highest Accepted Revision'];

function doPost(e) {
  var envelope = null;
  var operation = 'UNKNOWN';
  var identity = { storeCode: '', customerId: '' };
  var parseError = null;
  try {
    envelope = crmParseEnvelope_(e);
    operation = envelope.action;
    if (envelope.payload && typeof envelope.payload === 'object') identity = crmLogIdentity_(envelope.payload);
  } catch (error) {
    parseError = error;
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(KLBS_CRM_LOCK_WAIT_MS_)) {
    return crmJson_({ contract: KLBS_CRM_CONTRACT_, action: operation,
      result: 'RETRYABLE_FAILURE', errorCode: 'LOCK_BUSY' });
  }
  try {
    if (parseError) throw parseError;
    crmVerifyEnvelope_(envelope);

    var result;
    if (operation === 'TEST_CONNECTION') {
      result = crmTestConnection_(envelope.payload);
    } else if (operation === 'CUSTOMER_UPSERT') {
      result = crmUpsertCustomer_(envelope.payload, identity);
    } else {
      throw crmError_('PERMANENT_REJECTION', 'UNSUPPORTED_ACTION');
    }
    crmLog_(operation, identity, 'SUCCESS', '', result.logDetails);
    return crmJson_(result.ack);
  } catch (error) {
    var classified = crmClassifyError_(error);
    var errorCode = classified.errorCode;
    var responseAction = operation === 'UNKNOWN' ? 'UNKNOWN' : operation;
    try {
      crmLog_(responseAction, identity, classified.result, errorCode, 'Request rejected or deferred.');
    } catch (_) {
      // A logging failure must not disclose request content or credentials.
    }
    return crmJson_({ contract: KLBS_CRM_CONTRACT_, action: responseAction,
      result: classified.result, errorCode: errorCode });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return crmJson_({ contract: KLBS_CRM_CONTRACT_, result: 'PERMANENT_REJECTION', errorCode: 'POST_REQUIRED' });
}

function crmJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function crmParseEnvelope_(e) {
  if (!e || !e.postData || !/^application\/json(?:\s*;|$)/i.test(String(e.postData.type || ''))) {
    throw crmError_('PERMANENT_REJECTION', 'JSON_POST_REQUIRED');
  }
  var parsed;
  try { parsed = JSON.parse(String(e.postData.contents || '')); }
  catch (_) { throw crmError_('PERMANENT_REJECTION', 'INVALID_JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      Object.keys(parsed).sort().join(',') !== 'action,contract,payload,signature,timestamp') {
    throw crmError_('PERMANENT_REJECTION', 'INVALID_ENVELOPE');
  }
  if (parsed.contract !== KLBS_CRM_CONTRACT_) throw crmError_('PERMANENT_REJECTION', 'UNSUPPORTED_CONTRACT');
  if (parsed.action !== 'TEST_CONNECTION' && parsed.action !== 'CUSTOMER_UPSERT') {
    throw crmError_('PERMANENT_REJECTION', 'UNSUPPORTED_ACTION');
  }
  return parsed;
}

function crmVerifyEnvelope_(envelope) {
  if (typeof envelope.timestamp !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(envelope.timestamp)) {
    throw crmError_('PERMANENT_REJECTION', 'INVALID_TIMESTAMP');
  }
  var timestampMs = Date.parse(envelope.timestamp);
  if (!isFinite(timestampMs) || new Date(timestampMs).toISOString() !== envelope.timestamp ||
      Math.abs(Date.now() - timestampMs) > KLBS_CRM_TOLERANCE_MS_) {
    throw crmError_('PERMANENT_REJECTION', 'TIMESTAMP_OUTSIDE_WINDOW');
  }
  if (!envelope.payload || typeof envelope.payload !== 'object' || Array.isArray(envelope.payload)) {
    throw crmError_('PERMANENT_REJECTION', 'INVALID_PAYLOAD');
  }
  var secret = PropertiesService.getScriptProperties().getProperty(KLBS_CRM_SECRET_PROPERTY_);
  if (!secret) throw crmError_('PERMANENT_REJECTION', 'SERVER_SECRET_NOT_CONFIGURED');
  var signedText = envelope.timestamp + '\n' + envelope.action + '\n' + JSON.stringify(envelope.payload);
  var expected = crmHex_(Utilities.computeHmacSha256Signature(signedText, secret));
  if (!crmConstantTimeEqual_(expected, envelope.signature)) {
    throw crmError_('PERMANENT_REJECTION', 'AUTHENTICATION_FAILED');
  }
}

function crmHex_(bytes) {
  return bytes.map(function(byte) {
    return ('0' + ((byte < 0 ? byte + 256 : byte).toString(16))).slice(-2);
  }).join('');
}

function crmConstantTimeEqual_(left, right) {
  left = String(left || '');
  right = String(right || '');
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right) || left.length !== right.length) return false;
  var difference = 0;
  for (var i = 0; i < left.length; i += 1) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

function crmTestConnection_(payload) {
  crmRequireKeys_(payload, ['contract', 'spreadsheetId', 'worksheet']);
  if (payload.contract !== KLBS_CRM_CONTRACT_) throw crmError_('PERMANENT_REJECTION', 'UNSUPPORTED_CONTRACT');
  if (payload.worksheet !== KLBS_CRM_MASTER_) throw crmError_('PERMANENT_REJECTION', 'UNSUPPORTED_WORKSHEET');
  var spreadsheet = crmOpenConfiguredSpreadsheet_(payload.spreadsheetId);
  var master = spreadsheet.getSheetByName(KLBS_CRM_MASTER_);
  if (!master) throw crmError_('PERMANENT_REJECTION', 'CUSTOMER_MASTER_NOT_FOUND');
  crmVerifyHeaders_(master, KLBS_CRM_MASTER_HEADERS_, 'CUSTOMER_MASTER_HEADERS_INVALID');
  var log = spreadsheet.getSheetByName(KLBS_CRM_LOG_);
  if (!log) throw crmError_('PERMANENT_REJECTION', 'SYNC_LOG_NOT_FOUND');
  crmVerifyHeaders_(log, KLBS_CRM_LOG_HEADERS_, 'SYNC_LOG_HEADERS_INVALID');
  return {
    ack: { contract: KLBS_CRM_CONTRACT_, action: 'TEST_CONNECTION', result: 'SUCCESS',
      spreadsheetId: payload.spreadsheetId, worksheet: KLBS_CRM_MASTER_ },
    logDetails: 'Receiver and required worksheet headers verified.'
  };
}

function crmRequireKeys_(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw crmError_('PERMANENT_REJECTION', 'INVALID_PAYLOAD');
  var actualKeys = Object.keys(value).sort();
  var expectedKeys = expected.slice().sort();
  if (actualKeys.join(',') !== expectedKeys.join(',')) throw crmError_('PERMANENT_REJECTION', 'INVALID_PAYLOAD_FIELDS');
}

function crmUpsertCustomer_(payload, identity) {
  crmValidateCustomer_(payload);
  identity = { storeCode: payload.storeCode, customerId: payload.customerId };
  var spreadsheet = crmOpenConfiguredSpreadsheet_(payload.spreadsheetId);
  var master = spreadsheet.getSheetByName(KLBS_CRM_MASTER_);
  if (!master) throw crmError_('PERMANENT_REJECTION', 'CUSTOMER_MASTER_NOT_FOUND');
  crmVerifyHeaders_(master, KLBS_CRM_MASTER_HEADERS_, 'CUSTOMER_MASTER_HEADERS_INVALID');
  var log = spreadsheet.getSheetByName(KLBS_CRM_LOG_);
  if (!log) throw crmError_('PERMANENT_REJECTION', 'SYNC_LOG_NOT_FOUND');
  crmVerifyHeaders_(log, KLBS_CRM_LOG_HEADERS_, 'SYNC_LOG_HEADERS_INVALID');

  var metadata = crmGetMetadataSheet_(spreadsheet);
  var key = JSON.stringify([payload.storeCode, payload.customerId]);
  var metaRows = crmFindExactRows_(metadata, 1, key);
  if (metaRows.length > 1) throw crmError_('PERMANENT_REJECTION', 'REVISION_METADATA_DUPLICATE');
  var metaRow = metaRows.length ? metaRows[0] : 0;
  var highestRevision = metaRow ? Number(metadata.getRange(metaRow, 2).getValue()) : 0;
  if (metaRow && (!isFinite(highestRevision) || highestRevision < 1 || Math.floor(highestRevision) !== highestRevision)) {
    throw crmError_('PERMANENT_REJECTION', 'REVISION_METADATA_INVALID');
  }
  if (payload.customerRevision < highestRevision) {
    throw crmError_('PERMANENT_REJECTION', 'STALE_REVISION');
  }

  var matchingRows = crmFindCustomerRows_(master, payload.storeCode, payload.customerId);
  if (matchingRows.length > 1) throw crmError_('PERMANENT_REJECTION', 'CUSTOMER_IDENTITY_DUPLICATE');
  var syncedAt = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
  var values = crmCustomerRow_(payload, syncedAt);
  var disposition;
  if (payload.customerRevision === highestRevision && highestRevision > 0 && matchingRows.length === 1) {
    disposition = 'UNCHANGED';
  } else {
    var targetRow = matchingRows.length ? matchingRows[0] : Math.max(master.getLastRow() + 1, 2);
    var range = master.getRange(targetRow, 1, 1, KLBS_CRM_MASTER_HEADERS_.length);
    range.setNumberFormat('@');
    range.setValues([values]);
    disposition = matchingRows.length ? 'UPDATED' : 'INSERTED';
  }

  if (metaRow) {
    if (payload.customerRevision > highestRevision) metadata.getRange(metaRow, 2).setValue(payload.customerRevision);
  } else {
    var metadataRow = Math.max(metadata.getLastRow() + 1, 2);
    metadata.getRange(metadataRow, 1, 1, 2).setNumberFormat('@');
    metadata.getRange(metadataRow, 1, 1, 2).setValues([[key, String(payload.customerRevision)]]);
  }
  return {
    ack: { contract: KLBS_CRM_CONTRACT_, action: 'CUSTOMER_UPSERT', result: 'SUCCESS',
      storeCode: payload.storeCode, customerId: payload.customerId,
      customerRevision: payload.customerRevision, disposition: disposition },
    logDetails: 'Revision ' + payload.customerRevision + '; ' + disposition + '.'
  };
}

function crmValidateCustomer_(payload) {
  var expected = ['contract', 'storeCode', 'customerId', 'customerName', 'mobile', 'email',
    'birthdayDDMM', 'anniversaryDDMM', 'customerCreatedAt', 'customerUpdatedAt',
    'customerRevision', 'spreadsheetId', 'worksheet'];
  crmRequireKeys_(payload, expected);
  if (payload.contract !== KLBS_CRM_CONTRACT_) throw crmError_('PERMANENT_REJECTION', 'UNSUPPORTED_CONTRACT');
  if (typeof payload.storeCode !== 'string' || !payload.storeCode.trim() || payload.storeCode.length > 100 || /[\u0000-\u001f]/.test(payload.storeCode)) throw crmError_('PERMANENT_REJECTION', 'INVALID_STORE_CODE');
  if (typeof payload.customerId !== 'string' || !/^KLCUS\d{6}$/.test(payload.customerId)) throw crmError_('PERMANENT_REJECTION', 'INVALID_CUSTOMER_ID');
  if (typeof payload.customerName !== 'string' || !payload.customerName.trim() || payload.customerName.length > 120) throw crmError_('PERMANENT_REJECTION', 'INVALID_CUSTOMER_NAME');
  if (!crmOptionalText_(payload.mobile) || (payload.mobile !== null && payload.mobile !== '' && !/^\d{10}$/.test(payload.mobile))) throw crmError_('PERMANENT_REJECTION', 'INVALID_MOBILE');
  if (!crmOptionalText_(payload.email) || (payload.email !== null && payload.email !== '' &&
      (payload.email.length > 254 || !/^[A-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i.test(payload.email)))) throw crmError_('PERMANENT_REJECTION', 'INVALID_EMAIL');
  if (!crmOptionalText_(payload.birthdayDDMM) || !crmValidDdMm_(payload.birthdayDDMM)) throw crmError_('PERMANENT_REJECTION', 'INVALID_BIRTHDAY');
  if (!crmOptionalText_(payload.anniversaryDDMM) || !crmValidDdMm_(payload.anniversaryDDMM)) throw crmError_('PERMANENT_REJECTION', 'INVALID_ANNIVERSARY');
  if (!crmValidTimestamp_(payload.customerCreatedAt) || !crmValidTimestamp_(payload.customerUpdatedAt)) throw crmError_('PERMANENT_REJECTION', 'INVALID_CUSTOMER_TIMESTAMP');
  if (typeof payload.customerRevision !== 'number' || !isFinite(payload.customerRevision) ||
      Math.floor(payload.customerRevision) !== payload.customerRevision || payload.customerRevision < 1 || payload.customerRevision > Number.MAX_SAFE_INTEGER) throw crmError_('PERMANENT_REJECTION', 'INVALID_CUSTOMER_REVISION');
  if (payload.worksheet !== KLBS_CRM_MASTER_) throw crmError_('PERMANENT_REJECTION', 'UNSUPPORTED_WORKSHEET');
}

function crmOptionalText_(value) {
  return value === null || value === '' || (typeof value === 'string' && value.length <= 500 && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value));
}

function crmValidDdMm_(value) {
  if (value === null || value === '') return true;
  if (typeof value !== 'string') return false;
  var match = /^(\d{2})\/(\d{2})$/.exec(value);
  if (!match) return false;
  var date = new Date(Date.UTC(2000, Number(match[2]) - 1, Number(match[1])));
  return date.getUTCDate() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1;
}

function crmValidTimestamp_(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  var parsed = Date.parse(value);
  return isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function crmCustomerRow_(payload, syncedAt) {
  return [payload.storeCode, payload.customerId, crmCellText_(payload.customerName),
    crmCellText_(payload.mobile), crmCellText_(payload.birthdayDDMM),
    crmCellText_(payload.anniversaryDDMM), crmCellText_(payload.email),
    crmCellText_(payload.customerCreatedAt), crmCellText_(payload.customerUpdatedAt), syncedAt];
}

function crmCellText_(value) {
  if (value === null || value === undefined || value === '') return '';
  var text = String(value);
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? "'" + text : text;
}

function crmOpenConfiguredSpreadsheet_(requestedId) {
  var configuredId = PropertiesService.getScriptProperties().getProperty(KLBS_CRM_SPREADSHEET_PROPERTY_);
  if (!configuredId) throw crmError_('PERMANENT_REJECTION', 'SERVER_SPREADSHEET_NOT_CONFIGURED');
  if (typeof requestedId !== 'string' || requestedId !== configuredId) throw crmError_('PERMANENT_REJECTION', 'SPREADSHEET_ID_MISMATCH');
  try { return SpreadsheetApp.openById(configuredId); }
  catch (_) { throw crmError_('RETRYABLE_FAILURE', 'SPREADSHEET_UNAVAILABLE'); }
}

function crmVerifyHeaders_(sheet, expected, errorCode) {
  if (sheet.getLastRow() < 1 || sheet.getLastColumn() < expected.length) throw crmError_('PERMANENT_REJECTION', errorCode);
  var actual = sheet.getRange(1, 1, 1, expected.length).getDisplayValues()[0];
  for (var i = 0; i < expected.length; i += 1) if (actual[i] !== expected[i]) throw crmError_('PERMANENT_REJECTION', errorCode);
}

function crmGetMetadataSheet_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(KLBS_CRM_META_);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(KLBS_CRM_META_);
    sheet.getRange(1, 1, 1, KLBS_CRM_META_HEADERS_.length).setValues([KLBS_CRM_META_HEADERS_]);
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  } else if (sheet.getLastRow() < 1 || sheet.getLastColumn() < 2 ||
      sheet.getRange(1, 1, 1, 2).getDisplayValues()[0].join('|') !== KLBS_CRM_META_HEADERS_.join('|')) {
    throw crmError_('PERMANENT_REJECTION', 'REVISION_METADATA_HEADERS_INVALID');
  }
  return sheet;
}

function crmFindExactRows_(sheet, column, value) {
  if (sheet.getLastRow() < 2) return [];
  var matches = sheet.getRange(2, column, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(value)).matchEntireCell(true).matchCase(true).findAll();
  return matches.map(function(cell) { return cell.getRow(); });
}

function crmFindCustomerRows_(sheet, storeCode, customerId) {
  if (sheet.getLastRow() < 2) return [];
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues();
  var found = [];
  rows.forEach(function(row, index) {
    if (row[0] === storeCode && row[1] === customerId) found.push(index + 2);
  });
  return found;
}

function crmLogIdentity_(payload) {
  return {
    storeCode: typeof payload.storeCode === 'string' && payload.storeCode.trim() && payload.storeCode.length <= 100 && !/[\u0000-\u001f]/.test(payload.storeCode) ? payload.storeCode : '',
    customerId: typeof payload.customerId === 'string' && /^KLCUS\d{6}$/.test(payload.customerId) ? payload.customerId : ''
  };
}

function crmLog_(operation, identity, result, errorCode, details) {
  var id = PropertiesService.getScriptProperties().getProperty(KLBS_CRM_SPREADSHEET_PROPERTY_);
  if (!id) return;
  var spreadsheet = SpreadsheetApp.openById(id);
  var sheet = spreadsheet.getSheetByName(KLBS_CRM_LOG_);
  if (!sheet) return;
  crmVerifyHeaders_(sheet, KLBS_CRM_LOG_HEADERS_, 'SYNC_LOG_HEADERS_INVALID');
  var lastRow = sheet.getLastRow();
  if (lastRow > KLBS_CRM_MAX_LOG_ROWS_) {
    sheet.deleteRows(2, lastRow - KLBS_CRM_MAX_LOG_ROWS_);
    lastRow = sheet.getLastRow();
  }
  var row = [Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'),
    String(operation || 'UNKNOWN').slice(0, 40), identity.storeCode || '', identity.customerId || '',
    String(result || '').slice(0, 40), String(errorCode || '').slice(0, 60), String(details || '').slice(0, 200)];
  var target = Math.max(lastRow + 1, 2);
  sheet.getRange(target, 1, 1, row.length).setNumberFormat('@');
  sheet.getRange(target, 1, 1, row.length).setValues([row.map(crmCellText_)]);
}

function crmError_(result, errorCode) {
  var error = new Error(String(errorCode || 'REQUEST_FAILED'));
  error.crmResult = result;
  error.crmCode = String(errorCode || 'REQUEST_FAILED');
  return error;
}

function crmClassifyError_(error) {
  var result = error && error.crmResult === 'RETRYABLE_FAILURE' ? 'RETRYABLE_FAILURE' : 'PERMANENT_REJECTION';
  var code = error && error.crmCode || 'REQUEST_REJECTED';
  if (error && !error.crmCode) {
    // Spreadsheet service failures and transient quotas are safe to retry.
    result = 'RETRYABLE_FAILURE';
    code = 'RECEIVER_TEMPORARY_ERROR';
  }
  return { result: result, errorCode: code };
}

/** Run once in the bound Apps Script editor after setting Script Properties. */
function verifyKLBSCustomerCrmSetup() {
  var properties = PropertiesService.getScriptProperties();
  var spreadsheetId = properties.getProperty(KLBS_CRM_SPREADSHEET_PROPERTY_);
  if (!spreadsheetId || !properties.getProperty(KLBS_CRM_SECRET_PROPERTY_)) {
    throw new Error('Set KLBS_CUSTOMER_CRM_SPREADSHEET_ID and KLBS_CUSTOMER_CRM_AUTH_SECRET in Script Properties first.');
  }
  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  crmVerifyHeaders_(spreadsheet.getSheetByName(KLBS_CRM_MASTER_), KLBS_CRM_MASTER_HEADERS_, 'CUSTOMER_MASTER_HEADERS_INVALID');
  crmVerifyHeaders_(spreadsheet.getSheetByName(KLBS_CRM_LOG_), KLBS_CRM_LOG_HEADERS_, 'SYNC_LOG_HEADERS_INVALID');
  return 'Customer CRM receiver configuration and worksheet headers verified.';
}
