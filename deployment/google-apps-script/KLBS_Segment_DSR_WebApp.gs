var KLBS_SEGMENT_DSR_CONTRACT = 'KLBS_SEGMENT_DSR_V1';
var KLBS_SEGMENT_DSR_TAB = 'KLBS_Segment_Daily_Data';
var KLBS_SEGMENT_DSR_HEADERS = [
  'Received At', 'Contract', 'Business Date', 'Close Sequence', 'Report Status',
  'Kaira Luxe Sales', 'Kaira Luxe Qty', 'Kaira Luxe Bills', 'Kaira Luxe ATV', 'Kaira Luxe UPT',
  'Mens Wear Sales', 'Mens Wear Qty', 'Mens Wear Bills', 'Mens Wear ATV', 'Mens Wear UPT',
  'Kids Wear Sales', 'Kids Wear Qty', 'Kids Wear Bills', 'Kids Wear ATV', 'Kids Wear UPT',
  'Data Quality Complete', 'Reconciliation Classified', 'KLBS Version', 'Generated At',
  'Delivery Key', 'Payload JSON',
  'KL Gross Sales', 'KL Discount Amount', 'KL Taxable Value', 'KL GST Amount', 'KL Net Billing', 'KL Qty Sold', 'KL Credit Notes', 'KL Return Value', 'KL Qty Returned',
  'MENS Gross Sales', 'MENS Discount Amount', 'MENS Taxable Value', 'MENS GST Amount', 'MENS Net Billing', 'MENS Qty Sold', 'MENS Credit Notes', 'MENS Return Value', 'MENS Qty Returned',
  'KIDS Gross Sales', 'KIDS Discount Amount', 'KIDS Taxable Value', 'KIDS GST Amount', 'KIDS Net Billing', 'KIDS Qty Sold', 'KIDS Credit Notes', 'KIDS Return Value', 'KIDS Qty Returned',
  'Diagnostics'
];
var KLBS_SEGMENT_DSR_DETAIL_FIELDS = ['grossSales', 'discountAmount', 'taxableValue', 'gstAmount', 'netBilling', 'qtySold', 'creditNotes', 'returnValue', 'qtyReturned'];

function segmentDsrHex_(bytes) {
  return bytes.map(function(value) {
    var normalized = value < 0 ? value + 256 : value;
    return ('0' + normalized.toString(16)).slice(-2);
  }).join('');
}

function segmentDsrConstantTimeEqual_(left, right) {
  left = String(left || '').toLowerCase();
  right = String(right || '').toLowerCase();
  if (left.length !== right.length) return false;
  var mismatch = 0;
  for (var i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

function segmentDsrSegmentJson_(segment) {
  var detail = {};
  KLBS_SEGMENT_DSR_DETAIL_FIELDS.forEach(function(field) {
    if (!Object.prototype.hasOwnProperty.call(segment.detail || {}, field)) throw new Error('Missing segment detail field: ' + field);
    detail[field] = segment.detail[field];
  });
  return {
    label: segment.label,
    sales: segment.sales,
    qty: segment.qty,
    bills: segment.bills,
    atv: segment.atv,
    upt: segment.upt,
    detail: detail
  };
}

function segmentDsrCanonicalPayloadJson_(payload) {
  if (!payload || payload.contract !== KLBS_SEGMENT_DSR_CONTRACT) throw new Error('Unsupported Segment DSR contract.');
  return JSON.stringify({
    contract: payload.contract,
    businessDate: payload.businessDate,
    closeSequence: payload.closeSequence,
    reportStatus: payload.reportStatus,
    segments: {
      KL: segmentDsrSegmentJson_(payload.segments.KL),
      MENS: segmentDsrSegmentJson_(payload.segments.MENS),
      KIDS: segmentDsrSegmentJson_(payload.segments.KIDS)
    },
    dataQuality: {
      complete: payload.dataQuality.complete,
      reconciliationClassified: payload.dataQuality.reconciliationClassified,
      diagnostics: payload.dataQuality.diagnostics
    },
    reconciliation: payload.reconciliation,
    klbsVersion: payload.klbsVersion,
    generatedAt: payload.generatedAt
  });
}

function segmentDsrValidateNumber_(value, name, allowNegative) {
  if (typeof value !== 'number' || !isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error('Invalid numeric field: ' + name);
  if (!allowNegative && value < 0) throw new Error('Invalid non-negative field: ' + name);
}

function segmentDsrValidatePayload_(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid Segment DSR payload.');
  var payloadFields = ['businessDate', 'closeSequence', 'contract', 'dataQuality', 'generatedAt', 'klbsVersion', 'reconciliation', 'reportStatus', 'segments'];
  if (Object.keys(payload).sort().join(',') !== payloadFields.join(',')) throw new Error('Segment DSR payload fields do not match the contract.');
  ['contract', 'businessDate', 'closeSequence', 'reportStatus', 'segments', 'dataQuality', 'reconciliation', 'klbsVersion', 'generatedAt'].forEach(function(field) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) throw new Error('Missing Segment DSR field: ' + field);
  });
  var dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(payload.businessDate || ''));
  var parsedDate = dateParts && new Date(payload.businessDate + 'T00:00:00Z');
  if (!dateParts || isNaN(parsedDate.getTime()) || parsedDate.getUTCFullYear() !== Number(dateParts[1]) || parsedDate.getUTCMonth() + 1 !== Number(dateParts[2]) || parsedDate.getUTCDate() !== Number(dateParts[3])) throw new Error('Invalid Segment DSR Business Date.');
  if (typeof payload.closeSequence !== 'number' || !isFinite(payload.closeSequence) || Math.floor(payload.closeSequence) !== payload.closeSequence || payload.closeSequence < 1) throw new Error('Invalid Segment DSR Close Sequence.');
  if (payload.reportStatus !== 'FINAL' && payload.reportStatus !== 'REVISED') throw new Error('Invalid Segment DSR Report Status.');
  if (!payload.dataQuality || payload.dataQuality.complete !== true || payload.dataQuality.reconciliationClassified !== true) throw new Error('Segment DSR data quality is incomplete.');
  if (!String(payload.klbsVersion || '').trim() || !payload.generatedAt || isNaN(new Date(payload.generatedAt).getTime())) throw new Error('Invalid Segment DSR operational metadata.');
  if (!payload.segments || Object.keys(payload.segments).sort().join(',') !== 'KIDS,KL,MENS') throw new Error('Segment DSR must contain exactly KL, MENS, and KIDS.');
  ['KL', 'MENS', 'KIDS'].forEach(function(code) {
    var segment = payload.segments && payload.segments[code];
    if (!segment) throw new Error('Missing Segment DSR segment: ' + code);
    if (typeof segment.label !== 'string' || !segment.label.trim()) throw new Error('Invalid Segment DSR label: ' + code);
    segmentDsrValidateNumber_(segment.sales, code + '.sales', true);
    segmentDsrValidateNumber_(segment.qty, code + '.qty', true);
    segmentDsrValidateNumber_(segment.bills, code + '.bills', false);
    if (Math.floor(segment.bills) !== segment.bills) throw new Error('Invalid Segment DSR bill count: ' + code);
    segmentDsrValidateNumber_(segment.atv, code + '.atv', false);
    segmentDsrValidateNumber_(segment.upt, code + '.upt', false);
    KLBS_SEGMENT_DSR_DETAIL_FIELDS.forEach(function(field) { segmentDsrValidateNumber_(segment.detail && segment.detail[field], code + '.detail.' + field, true); });
  });
  segmentDsrCanonicalPayloadJson_(payload);
}

function segmentDsrVerifyEnvelope_(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || Object.keys(envelope).sort().join(',') !== 'payload,signature,timestamp') throw new Error('Invalid Segment DSR request envelope.');
  var requestTime = new Date(envelope.timestamp).getTime();
  if (!isFinite(requestTime) || Math.abs(Date.now() - requestTime) > 5 * 60 * 1000) throw new Error('Segment DSR request timestamp is outside the replay window.');
  var secret = PropertiesService.getScriptProperties().getProperty('KLBS_DSR_SYNC_SECRET');
  if (!secret) throw new Error('Server secret is not configured.');
  segmentDsrValidatePayload_(envelope.payload);
  var signedText = envelope.timestamp + '\n' + envelope.payload.businessDate + '\n' + segmentDsrCanonicalPayloadJson_(envelope.payload);
  var expected = segmentDsrHex_(Utilities.computeHmacSha256Signature(signedText, secret));
  if (!segmentDsrConstantTimeEqual_(expected, envelope.signature)) throw new Error('Segment DSR request authentication failed.');
}

function segmentDsrNormalizeDate_(value, timeZone) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) return Utilities.formatDate(value, timeZone || Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyy-MM-dd');
  return String(value || '').trim();
}

function segmentDsrDateCell_(isoDate) {
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error('Invalid canonical Segment DSR Business Date.');
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
}

function segmentDsrVerifyHeaders_(sheet) {
  if (sheet.getLastColumn() < KLBS_SEGMENT_DSR_HEADERS.length || sheet.getLastRow() < 1) throw new Error('KLBS_Segment_Daily_Data header is not initialized.');
  var headers = sheet.getRange(1, 1, 1, KLBS_SEGMENT_DSR_HEADERS.length).getValues()[0];
  if (JSON.stringify(headers) !== JSON.stringify(KLBS_SEGMENT_DSR_HEADERS)) throw new Error('KLBS_Segment_Daily_Data header does not match the contract.');
}

function segmentDsrGetSheet_() {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty('KLBS_SPREADSHEET_ID');
  if (!spreadsheetId) throw new Error('Spreadsheet ID is not configured.');
  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  var sheet = spreadsheet.getSheetByName(KLBS_SEGMENT_DSR_TAB);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(KLBS_SEGMENT_DSR_TAB);
    sheet.getRange(1, 1, 1, KLBS_SEGMENT_DSR_HEADERS.length).setValues([KLBS_SEGMENT_DSR_HEADERS]);
    sheet.setFrozenRows(1);
  } else segmentDsrVerifyHeaders_(sheet);
  return sheet;
}

function segmentDsrRow_(payload, receivedAt, deliveryKey) {
  var values = [receivedAt, payload.contract, segmentDsrDateCell_(payload.businessDate), payload.closeSequence, payload.reportStatus];
  ['KL', 'MENS', 'KIDS'].forEach(function(code) {
    var segment = payload.segments[code];
    values.push(segment.sales, segment.qty, segment.bills, segment.atv, segment.upt);
  });
  values.push(payload.dataQuality.complete, payload.dataQuality.reconciliationClassified, payload.klbsVersion, new Date(payload.generatedAt), deliveryKey, segmentDsrCanonicalPayloadJson_(payload));
  ['KL', 'MENS', 'KIDS'].forEach(function(code) {
    var detail = payload.segments[code].detail;
    KLBS_SEGMENT_DSR_DETAIL_FIELDS.forEach(function(field) { values.push(detail[field]); });
  });
  values.push(payload.dataQuality.diagnostics ? JSON.stringify(payload.dataQuality.diagnostics) : '');
  return values;
}

function handleSegmentDsrPost_(envelope) {
  segmentDsrVerifyEnvelope_(envelope);
  var payload = envelope.payload;
  var deliveryKey = payload.businessDate + '|' + payload.closeSequence;
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = segmentDsrGetSheet_();
    var spreadsheetTimeZone = sheet.getParent().getSpreadsheetTimeZone() || 'Asia/Kolkata';
    var rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 3, sheet.getLastRow() - 1, 24).getValues() : [];
    var matchingRow = null;
    var maxSequence = 0;
    rows.forEach(function(row, index) {
      var date = segmentDsrNormalizeDate_(row[0], spreadsheetTimeZone);
      var sequence = Number(row[1]);
      if (date === payload.businessDate) {
        if (sequence > maxSequence) maxSequence = sequence;
        if (sequence === payload.closeSequence) matchingRow = index + 2;
      }
    });
    var receivedAt = new Date();
    if (matchingRow) {
      var stored = sheet.getRange(matchingRow, 25, 1, 2).getValues()[0];
      var storedKey = String(stored[0] || '');
      var storedPayload = String(stored[1] || '');
      if (storedKey !== deliveryKey || storedPayload !== segmentDsrCanonicalPayloadJson_(payload)) throw new Error('Segment DSR immutable-contract conflict.');
      return jsonResponse_({ ok: true, action: 'UNCHANGED', businessDate: payload.businessDate, closeSequence: payload.closeSequence, authoritative: true, receivedAt: receivedAt.toISOString() });
    }
    var row = segmentDsrRow_(payload, receivedAt, deliveryKey);
    sheet.appendRow(row);
    var authoritative = payload.closeSequence >= maxSequence;
    return jsonResponse_({ ok: true, action: authoritative ? 'INSERTED' : 'RETAINED', businessDate: payload.businessDate, closeSequence: payload.closeSequence, authoritative: authoritative, receivedAt: receivedAt.toISOString() });
  } finally {
    lock.releaseLock();
  }
}

function setupKLBSSegmentDailyDataSheet() {
  var sheet = segmentDsrGetSheet_();
  segmentDsrVerifyHeaders_(sheet);
  return sheet.getName();
}
