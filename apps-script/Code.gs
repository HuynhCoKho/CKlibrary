const SPREADSHEET_ID = '10CMcmP--MMX5QeLiEyUqO1n8ct9pAgEIXdSvD292LAc';
const MAX_ACTIVE_LOANS = 5;
const MAX_LOAN_DAYS = 7;

const TABLES = {
  areas: ['id', 'name', 'note'],
  shelves: ['id', 'name', 'areaId', 'note'],
  books: ['id', 'type', 'topic', 'title', 'author', 'publisher', 'year', 'shelfId', 'status', 'coverPrice', 'purchasePrice', 'borrowFee', 'note'],
  borrowers: ['id', 'name', 'phone', 'email', 'blacklisted', 'note'],
  loans: ['id', 'bookId', 'borrowerId', 'borrowDate', 'dueDate', 'returnDate', 'deposit', 'fee', 'damageFee', 'status', 'note'],
  finance: ['id', 'date', 'kind', 'category', 'amount', 'note'],
};

const KIND_TO_TABLE = {
  area: 'areas',
  shelf: 'shelves',
  book: 'books',
  person: 'borrowers',
  loan: 'loans',
  finance: 'finance',
};

function doGet() {
  return jsonResponse({ ok: true, data: listData() });
}

function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    if (body.action === 'list') return jsonResponse({ ok: true, data: listData() });
    if (body.action === 'borrowRequest') return jsonResponse({ ok: true, data: saveBorrowRequest(body.record) });
    requireAdmin(body.token);
    if (body.action === 'save') return jsonResponse({ ok: true, data: saveRecord(body.kind, body.op, body.record) });
    if (body.action === 'setup') return jsonResponse({ ok: true, data: setupSheets() });
    throw new Error('Action không hợp lệ.');
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function setupSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  Object.keys(TABLES).forEach((name) => {
    const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    const headers = TABLES[name];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, headers.length);
  });
  return 'OK';
}

function listData() {
  setupSheets();
  const result = {};
  Object.keys(TABLES).forEach((name) => {
    result[name] = readTable(name);
  });
  return result;
}

function saveRecord(kind, op, record) {
  const table = KIND_TO_TABLE[kind];
  if (!table) throw new Error('Loại dữ liệu không hợp lệ.');
  if (!record || !record.id) throw new Error('Thiếu ID.');
  if (kind === 'loan' && record.status === 'Đang mượn') validateLoan(record);
  const sheet = getSheet(table);
  const headers = TABLES[table];
  const rowIndex = findRowById(sheet, record.id);
  if (op === 'delete') {
    if (rowIndex > 1) sheet.deleteRow(rowIndex);
    return record;
  }
  const row = headers.map((key) => cleanValue(record[key]));
  if (rowIndex > 1) sheet.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
  else sheet.appendRow(row);
  if (kind === 'loan') applyLoanSideEffects(record);
  return record;
}

function saveBorrowRequest(record) {
  if (!record || !record.person || !record.loan) throw new Error('Thiếu thông tin mượn sách.');
  const lock = LockService.getScriptLock();
  lock.waitLock(8000);
  try {
    const person = record.person;
    const loan = record.loan;
    upsertRow('borrowers', person);
    validateLoan(loan);
    upsertRow('loans', loan);
    updateBookStatus(loan.bookId, 'Cho mượn');
    upsertRow('finance', {
      id: 'TC' + Date.now(),
      date: loan.borrowDate,
      kind: 'Thu',
      category: 'Nhận đặt cọc',
      amount: loan.deposit || 0,
      note: 'Đặt cọc phiếu ' + loan.id,
    });
    if (Number(loan.fee || 0) > 0) {
      upsertRow('finance', {
        id: 'TC' + Date.now() + 'F',
        date: loan.borrowDate,
        kind: 'Thu',
        category: 'Cho thuê',
        amount: loan.fee,
        note: 'Phí mượn phiếu ' + loan.id,
      });
    }
    return loan;
  } finally {
    lock.releaseLock();
  }
}

function validateLoan(loan) {
  const borrowers = readTable('borrowers');
  const borrower = borrowers.find((item) => item.id === loan.borrowerId);
  if (borrower && borrower.blacklisted === 'Có') throw new Error('Người mượn đang trong danh sách đen.');
  const activeCount = readTable('loans').filter((item) => item.borrowerId === loan.borrowerId && item.status === 'Đang mượn' && item.id !== loan.id).length;
  if (activeCount >= MAX_ACTIVE_LOANS) throw new Error('Mỗi người chỉ được mượn tối đa 5 quyển chưa trả.');
  const borrowDate = new Date(loan.borrowDate);
  const dueDate = new Date(loan.dueDate);
  const maxDue = new Date(borrowDate);
  maxDue.setDate(maxDue.getDate() + MAX_LOAN_DAYS);
  if (dueDate > maxDue) throw new Error('Hạn trả tối đa là 7 ngày.');
  const book = readTable('books').find((item) => item.id === loan.bookId);
  if (book && book.status !== 'Đang ở kệ') throw new Error('Sách này hiện không sẵn sàng cho mượn.');
}

function applyLoanSideEffects(loan) {
  if (loan.status === 'Đang mượn' || loan.status === 'Quá hạn') {
    updateBookStatus(loan.bookId, 'Cho mượn');
  }
  if (loan.status === 'Đã trả') {
    updateBookStatus(loan.bookId, 'Đang ở kệ');
    const refund = Math.max(Number(loan.deposit || 0) - Number(loan.fee || 0) - Number(loan.damageFee || 0), 0);
    upsertRow('finance', {
      id: 'TC' + Date.now(),
      date: loan.returnDate || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      kind: 'Chi',
      category: 'Hoàn cọc',
      amount: refund,
      note: 'Hoàn cọc phiếu ' + loan.id,
    });
  }
}

function updateBookStatus(bookId, status) {
  const books = getSheet('books');
  const rowIndex = findRowById(books, bookId);
  if (rowIndex <= 1) return;
  const statusColumn = TABLES.books.indexOf('status') + 1;
  books.getRange(rowIndex, statusColumn).setValue(status);
}

function upsertRow(table, record) {
  const sheet = getSheet(table);
  const headers = TABLES[table];
  const rowIndex = findRowById(sheet, record.id);
  const row = headers.map((key) => cleanValue(record[key]));
  if (rowIndex > 1) sheet.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
  else sheet.appendRow(row);
}

function readTable(name) {
  const sheet = getSheet(name);
  const headers = TABLES[name];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, headers.length).getValues().map((row) => {
    const item = {};
    headers.forEach((key, index) => {
      item[key] = normalizeValue(row[index]);
    });
    return item;
  }).filter((item) => item.id);
}

function getSheet(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function findRowById(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const index = values.findIndex((value) => String(value) === String(id));
  return index >= 0 ? index + 2 : -1;
}

function normalizeValue(value) {
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return value === null || value === undefined ? '' : value;
}

function cleanValue(value) {
  return value === null || value === undefined ? '' : value;
}

function requireAdmin(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN');
  if (!expected) throw new Error('Chưa cấu hình ADMIN_TOKEN trong Script properties.');
  if (token !== expected) throw new Error('Không có quyền quản trị.');
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
