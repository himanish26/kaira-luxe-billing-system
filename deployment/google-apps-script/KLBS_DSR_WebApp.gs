var KLBS_DSR_TAB = 'KLBS_Daily_Data';
var KLBS_DSR_HEADERS = [
  'Contract Version', 'Business Date', 'Closing ID', 'Close Sequence',
  'Snapshot Version', 'Closed At', 'Bills Generated', 'Qty Sold',
  'Gross Sales', 'Total Discount', 'Net Billing', 'Credit Notes',
  'Qty Returned', 'Return / CN Value', 'Net Sales After Returns', 'Cash',
  'UPI', 'Card', 'Store Credit Redeemed', 'Gift Voucher Redeemed',
  'Total Settlement', 'Actual Money Collection', 'Store Credit Issued',
  'Settlement Difference', 'Backup Status', 'Email Status', 'KLBS Version',
  'Synced At'
];
var KLBS_DSR_FIELDS = [
  'contractVersion', 'businessDate', 'closingId', 'closeSequence',
  'snapshotVersion', 'closedAt', 'totalBills', 'qtySold',
  'grossSalesPaise', 'totalDiscountPaise', 'netBillingPaise',
  'creditNoteCount', 'qtyReturned', 'returnCnValuePaise',
  'netSalesAfterReturnsPaise', 'cashPaise', 'upiPaise', 'cardPaise',
  'storeCreditRedeemedPaise', 'giftVoucherRedeemedPaise',
  'settlementTotalPaise', 'actualMoneyCollectionPaise',
  'storeCreditIssuedPaise', 'settlementDifferencePaise',
  'backupStatus', 'emailStatus', 'klbsVersion'
];
var KLBS_DSR_INTEGER_FIELDS = [
  'contractVersion', 'closingId', 'closeSequence', 'snapshotVersion',
  'totalBills', 'qtySold', 'creditNoteCount', 'qtyReturned',
  'grossSalesPaise', 'totalDiscountPaise', 'netBillingPaise',
  'returnCnValuePaise', 'netSalesAfterReturnsPaise', 'cashPaise', 'upiPaise',
  'cardPaise', 'storeCreditRedeemedPaise', 'giftVoucherRedeemedPaise',
  'settlementTotalPaise', 'actualMoneyCollectionPaise',
  'storeCreditIssuedPaise', 'settlementDifferencePaise'
];

function jsonResponse_(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

function canonicalPayloadJson_(payload) {
  var ordered = {};
  KLBS_DSR_FIELDS.forEach(function(field) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) {
      throw new Error('Missing payload field: ' + field);
    }
    ordered[field] = payload[field];
  });
  if (Object.keys(payload).length !== KLBS_DSR_FIELDS.length) {
    throw new Error('Unexpected payload field.');
  }
  return JSON.stringify(ordered);
}

function hex_(bytes) {
  return bytes.map(function(value) {
    var normalized = value < 0 ? value + 256 : value;
    return ('0' + normalized.toString(16)).slice(-2);
  }).join('');
}

function constantTimeEqual_(left, right) {
  left = String(left || '').toLowerCase();
  right = String(right || '').toLowerCase();
  if (left.length !== right.length) return false;
  var mismatch = 0;
  for (var i = 0; i < left.length; i += 1) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
}

function validatePayload_(payload) {
  canonicalPayloadJson_(payload);
  KLBS_DSR_INTEGER_FIELDS.forEach(function(field) {
    if (typeof payload[field] !== 'number' || !isFinite(payload[field]) ||
        Math.floor(payload[field]) !== payload[field] ||
        Math.abs(payload[field]) > Number.MAX_SAFE_INTEGER) {
      throw new Error('Invalid integer field: ' + field);
    }
  });
  if (payload.contractVersion !== 1 || payload.snapshotVersion !== 1) {
    throw new Error('Unsupported contract or snapshot version.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.businessDate)) {
    throw new Error('Invalid Business Date.');
  }
  if (!payload.closedAt || isNaN(new Date(payload.closedAt).getTime())) {
    throw new Error('Invalid Closed At.');
  }
  if (payload.closeSequence < 1 || payload.closingId < 1 ||
      payload.totalBills < 0 || payload.qtySold < 0 ||
      payload.creditNoteCount < 0 || payload.qtyReturned < 0) {
    throw new Error('Invalid count or sequence.');
  }
  if (payload.backupStatus !== 'SUCCESS' ||
      ['SUCCESS', 'FAILED'].indexOf(payload.emailStatus) < 0 ||
      !String(payload.klbsVersion || '').trim()) {
    throw new Error('Invalid operational metadata.');
  }
  if (payload.grossSalesPaise - payload.totalDiscountPaise !== payload.netBillingPaise ||
      payload.netBillingPaise - payload.returnCnValuePaise !== payload.netSalesAfterReturnsPaise ||
      payload.cashPaise + payload.upiPaise + payload.cardPaise +
        payload.storeCreditRedeemedPaise + payload.giftVoucherRedeemedPaise !==
        payload.settlementTotalPaise ||
      payload.cashPaise + payload.upiPaise + payload.cardPaise !==
        payload.actualMoneyCollectionPaise ||
      payload.netBillingPaise - payload.settlementTotalPaise !==
        payload.settlementDifferencePaise) {
    throw new Error('Accounting integrity validation failed.');
  }
}

function verifyEnvelope_(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
      Object.keys(envelope).sort().join(',') !== 'payload,signature,timestamp') {
    throw new Error('Invalid request envelope.');
  }
  var requestTime = new Date(envelope.timestamp).getTime();
  if (!isFinite(requestTime) || Math.abs(Date.now() - requestTime) > 5 * 60 * 1000) {
    throw new Error('Request timestamp is outside the replay window.');
  }
  var secret = PropertiesService.getScriptProperties().getProperty('KLBS_DSR_SYNC_SECRET');
  if (!secret) throw new Error('Server secret is not configured.');
  validatePayload_(envelope.payload);
  var signedText = envelope.timestamp + '\n' + envelope.payload.businessDate + '\n' +
    canonicalPayloadJson_(envelope.payload);
  var expected = hex_(Utilities.computeHmacSha256Signature(signedText, secret));
  if (!constantTimeEqual_(expected, envelope.signature)) {
    throw new Error('Request authentication failed.');
  }
}

function verifyHeaders_(sheet) {
  if (sheet.getLastColumn() < KLBS_DSR_HEADERS.length || sheet.getLastRow() < 1) {
    throw new Error('KLBS_Daily_Data header is not initialized.');
  }
  var headers = sheet.getRange(1, 1, 1, KLBS_DSR_HEADERS.length).getValues()[0];
  if (JSON.stringify(headers) !== JSON.stringify(KLBS_DSR_HEADERS)) {
    throw new Error('KLBS_Daily_Data header does not match the contract.');
  }
}

function meaningfulRow_(payload) {
  return [
    payload.contractVersion, payload.businessDate, payload.closingId,
    payload.closeSequence, payload.snapshotVersion, payload.closedAt,
    payload.totalBills, payload.qtySold, payload.grossSalesPaise / 100,
    payload.totalDiscountPaise / 100, payload.netBillingPaise / 100,
    payload.creditNoteCount, payload.qtyReturned, payload.returnCnValuePaise / 100,
    payload.netSalesAfterReturnsPaise / 100, payload.cashPaise / 100,
    payload.upiPaise / 100, payload.cardPaise / 100,
    payload.storeCreditRedeemedPaise / 100, payload.giftVoucherRedeemedPaise / 100,
    payload.settlementTotalPaise / 100, payload.actualMoneyCollectionPaise / 100,
    payload.storeCreditIssuedPaise / 100, payload.settlementDifferencePaise / 100,
    payload.backupStatus, payload.emailStatus, payload.klbsVersion
  ];
}

function doPost(event) {
  try {
    if (!event || !event.postData || event.postData.type !== 'application/json') {
      throw new Error('JSON POST is required.');
    }
    var envelope = JSON.parse(event.postData.contents);
    verifyEnvelope_(envelope);
    var payload = envelope.payload;
    var spreadsheetId = PropertiesService.getScriptProperties()
      .getProperty('KLBS_SPREADSHEET_ID');
    if (!spreadsheetId) throw new Error('Spreadsheet ID is not configured.');
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(KLBS_DSR_TAB);
      if (!sheet) throw new Error('KLBS_Daily_Data sheet was not found.');
      verifyHeaders_(sheet);
      var values = meaningfulRow_(payload);
      var data = sheet.getLastRow() > 1
        ? sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getDisplayValues() : [];
      var matchingRows = [];
      data.forEach(function(row, index) {
        if (String(row[0]).trim() === payload.businessDate) matchingRows.push(index + 2);
      });
      if (matchingRows.length > 1) throw new Error('Duplicate Business Date integrity conflict.');
      var action = 'INSERTED';
      var syncedAt = new Date();
      if (!matchingRows.length) {
        sheet.appendRow(values.concat([syncedAt]));
      } else {
        var rowNumber = matchingRows[0];
        var existing = sheet.getRange(rowNumber, 1, 1, KLBS_DSR_HEADERS.length).getValues()[0];
        var storedSequence = Number(existing[3]);
        if (payload.closeSequence < storedSequence) throw new Error('STALE_IGNORED');
        if (payload.closeSequence === storedSequence) {
          var same = values.every(function(value, index) {
            var existingValue = existing[index];
            return value instanceof Date
              ? existingValue instanceof Date && value.getTime() === existingValue.getTime()
              : String(value) === String(existingValue);
          });
          if (!same) throw new Error('Equal-sequence integrity conflict.');
          action = 'UNCHANGED';
          syncedAt = existing[27] instanceof Date ? existing[27] : syncedAt;
        } else {
          sheet.getRange(rowNumber, 1, 1, KLBS_DSR_HEADERS.length)
            .setValues([values.concat([syncedAt])]);
          action = 'UPDATED';
        }
      }
      return jsonResponse_({
        ok: true, action: action, businessDate: payload.businessDate,
        closingId: payload.closingId, closeSequence: payload.closeSequence,
        syncedAt: syncedAt.toISOString()
      });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return jsonResponse_({ ok: false, error: String(error.message || 'Request failed.').slice(0, 200) });
  }
}

function setupKLBSDailyDataSheet() {
  var spreadsheetId = PropertiesService.getScriptProperties()
    .getProperty('KLBS_SPREADSHEET_ID');
  if (!spreadsheetId) throw new Error('KLBS_SPREADSHEET_ID is not configured.');
  var sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(KLBS_DSR_TAB);
  if (!sheet) throw new Error('KLBS_Daily_Data sheet was not found.');
  if (sheet.getLastRow() > 0 || sheet.getLastColumn() > 0) {
    verifyHeaders_(sheet);
    return;
  }
  sheet.getRange(1, 1, 1, KLBS_DSR_HEADERS.length).setValues([KLBS_DSR_HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange('B:B').setNumberFormat('@');
  sheet.getRange('F:F').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.getRange('AB:AB').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  ['I:K', 'N:W', 'X:X'].forEach(function(range) {
    sheet.getRange(range).setNumberFormat('₹#,##0.00');
  });
}
