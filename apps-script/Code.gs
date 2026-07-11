const SPREADSHEET_ID = '10CMcmP--MMX5QeLiEyUqO1n8ct9pAgEIXdSvD292LAc';
const MAX_ACTIVE_LOANS = 5;
const MAX_LOAN_DAYS = 7;

const TABLES = {
  areas: ['id', 'name', 'note'],
  shelves: ['id', 'name', 'areaId', 'note'],
  books: ['id', 'type', 'topic', 'title', 'author', 'publisher', 'year', 'shelfId', 'quantity', 'status', 'coverPrice', 'purchasePrice', 'borrowFee', 'note'],
  borrowers: ['id', 'name', 'phone', 'email', 'blacklisted', 'note'],
  loans: ['id', 'bookId', 'borrowerId', 'borrowDate', 'dueDate', 'returnDate', 'deposit', 'fee', 'damageFee', 'status', 'note'],
  finance: ['id', 'date', 'kind', 'category', 'amount', 'note', 'relatedId'],
};

const KIND_TO_TABLE = {
  area: 'areas',
  shelf: 'shelves',
  book: 'books',
  person: 'borrowers',
  loan: 'loans',
  finance: 'finance',
};

const ACTIVE_LOAN_STATUSES = ['Đang mượn', 'Quá hạn'];
const UNAVAILABLE_LOAN_STATUSES = ['Chờ xác nhận', 'Đang mượn', 'Quá hạn'];

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    if (params.action === 'borrowRequest') {
      const record = JSON.parse(params.record || '{}');
      return jsonResponse({ ok: true, data: saveBorrowRequest(record) }, params.callback);
    }
    return jsonResponse({ ok: true, data: listData() }, params.callback);
  } catch (err) {
    const callback = e && e.parameter && e.parameter.callback;
    return jsonResponse({ ok: false, error: err.message }, callback);
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    if (body.action === 'list') return jsonResponse({ ok: true, data: listData() });
    if (body.action === 'borrowRequest') return jsonResponse({ ok: true, data: saveBorrowRequest(body.record) });
    requireAdmin(body.token);
    if (body.action === 'bulkBorrowFee') return jsonResponse({ ok: true, data: bulkUpdateBorrowFee(body.fee) });
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
    let headers = getHeaders(sheet);
    if (!headers.length) {
      headers = TABLES[name].slice();
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else {
      const missing = TABLES[name].filter((header) => headers.indexOf(header) === -1);
      if (missing.length) {
        sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
        headers = headers.concat(missing);
      }
    }
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

  const lock = LockService.getScriptLock();
  lock.waitLock(8000);
  try {
    if (op === 'delete') {
      cascadeDelete(kind, record.id);
      syncDerivedData();
      return record;
    }
    normalizeRecord(kind, record);
  if (kind === 'loan' && record.status === 'Đang mượn') validateLoan(record);
    upsertRow(table, record);
    syncDerivedData();
    return record;
  } finally {
    lock.releaseLock();
  }
}

function saveBorrowRequest(record) {
  if (!record || !record.person || !record.loan) throw new Error('Thiếu thông tin mượn sách.');
  const lock = LockService.getScriptLock();
  lock.waitLock(8000);
  try {
    const person = record.person;
    const loan = record.loan;
    loan.status = 'Chờ xác nhận';
    normalizeRecord('loan', loan);
    upsertRow('borrowers', person);
    validateLoan(loan);
    upsertRow('loans', loan);
    syncDerivedData();
    return loan;
  } finally {
    lock.releaseLock();
  }
}

function bulkUpdateBorrowFee(fee) {
  const value = numberValue(fee);
  if (value < 0) throw new Error('Phí mượn không hợp lệ.');

  const lock = LockService.getScriptLock();
  lock.waitLock(8000);
  try {
    const books = readTable('books');
    books.forEach((book) => {
      book.borrowFee = value;
      normalizeRecord('book', book);
      upsertRow('books', book);
    });
    syncDerivedData();
    return { updated: books.length, fee: value };
  } finally {
    lock.releaseLock();
  }
}

function validateLoan(loan) {
  const borrowers = readTable('borrowers');
  const borrower = borrowers.find((item) => item.id === loan.borrowerId);
  if (borrower && borrower.blacklisted === 'Có') throw new Error('Người mượn đang trong danh sách đen.');

  const loans = readTable('loans');
  const activeCount = loans.filter((item) => item.borrowerId === loan.borrowerId && item.status === 'Đang mượn' && item.id !== loan.id).length;
  if (activeCount >= MAX_ACTIVE_LOANS) throw new Error('Mỗi người chỉ được mượn tối đa 5 quyển chưa trả.');

  const borrowDate = new Date(loan.borrowDate);
  const dueDate = new Date(loan.dueDate);
  const maxDue = new Date(borrowDate);
  maxDue.setDate(maxDue.getDate() + MAX_LOAN_DAYS);
  if (dueDate > maxDue) throw new Error('Hạn trả tối đa là 7 ngày.');

  const book = readTable('books').find((item) => item.id === loan.bookId);
  if (!book) throw new Error('Không tìm thấy sách.');
  if (book.status === 'Bảo trì' || book.status === 'Đã bán') throw new Error('Sách này hiện không sẵn sàng cho mượn.');
  const activeForBook = loans.filter((item) => item.bookId === loan.bookId && item.id !== loan.id && UNAVAILABLE_LOAN_STATUSES.indexOf(item.status) >= 0).length;
  if (bookQuantity(book) - activeForBook <= 0) throw new Error('Sách này đã hết bản còn trên kệ.');
}

function cascadeDelete(kind, id) {
  const linkedLoanIds = {};
  const linkedBookIds = {};

  if (kind === 'person') {
    readTable('loans').filter((loan) => loan.borrowerId === id).forEach((loan) => linkedLoanIds[loan.id] = true);
    deleteRowsByPredicate('borrowers', (item) => item.id === id);
  } else if (kind === 'book') {
    linkedBookIds[id] = true;
    readTable('loans').filter((loan) => loan.bookId === id).forEach((loan) => linkedLoanIds[loan.id] = true);
    deleteRowsByPredicate('books', (item) => item.id === id);
  } else if (kind === 'loan') {
    linkedLoanIds[id] = true;
    deleteRowsByPredicate('loans', (item) => item.id === id);
  } else if (kind === 'shelf') {
    readTable('books').filter((book) => book.shelfId === id).forEach((book) => linkedBookIds[book.id] = true);
    readTable('loans').filter((loan) => linkedBookIds[loan.bookId]).forEach((loan) => linkedLoanIds[loan.id] = true);
    deleteRowsByPredicate('shelves', (item) => item.id === id);
    deleteRowsByPredicate('books', (item) => item.shelfId === id);
  } else if (kind === 'area') {
    const shelfIds = {};
    readTable('shelves').filter((shelf) => shelf.areaId === id).forEach((shelf) => shelfIds[shelf.id] = true);
    readTable('books').filter((book) => shelfIds[book.shelfId]).forEach((book) => linkedBookIds[book.id] = true);
    readTable('loans').filter((loan) => linkedBookIds[loan.bookId]).forEach((loan) => linkedLoanIds[loan.id] = true);
    deleteRowsByPredicate('areas', (item) => item.id === id);
    deleteRowsByPredicate('shelves', (item) => item.areaId === id);
    deleteRowsByPredicate('books', (item) => shelfIds[item.shelfId]);
  } else {
    deleteRowsByPredicate(KIND_TO_TABLE[kind], (item) => item.id === id);
  }

  if (Object.keys(linkedLoanIds).length) deleteRowsByPredicate('loans', (loan) => linkedLoanIds[loan.id]);
  deleteRowsByPredicate('finance', (item) => {
    const related = String(item.relatedId || '');
    const note = String(item.note || '');
    return Object.keys(linkedLoanIds).some((loanId) => related.indexOf(loanId) >= 0 || note.indexOf(loanId) >= 0)
      || Object.keys(linkedBookIds).some((bookId) => related.indexOf(bookId) >= 0 || note.indexOf(bookId) >= 0);
  });
}

function syncDerivedData() {
  setupSheets();
  const books = readTable('books');
  const loans = readTable('loans');

  books.forEach((book) => {
    book.quantity = bookQuantity(book);
    if (book.status !== 'Bảo trì' && book.status !== 'Đã bán') {
      const active = loans.filter((loan) => loan.bookId === book.id && UNAVAILABLE_LOAN_STATUSES.indexOf(loan.status) >= 0).length;
      book.status = active >= book.quantity ? 'Cho mượn' : 'Đang ở kệ';
    }
    upsertRow('books', book);
  });

  deleteRowsByPredicate('finance', (item) => isAutoFinance(item) || item.category === 'Nhận đặt cọc' || item.category === 'Hoàn cọc');

  books.forEach((book) => {
    const unitCost = numberValue(book.purchasePrice) || numberValue(book.coverPrice);
    const amount = unitCost * bookQuantity(book);
    if (amount > 0) upsertRow('finance', {
      id: 'AUTOBOOK-' + book.id,
      date: book.purchaseDate || todayISO(),
      kind: 'Chi',
      category: 'Mua sách',
      amount,
      note: 'Tự động: mua ' + bookQuantity(book) + ' quyển sách ' + (book.title || book.id),
      relatedId: 'book:' + book.id,
    });
  });

  loans.forEach((loan) => {
    const book = books.find((item) => item.id === loan.bookId) || {};
    if (['Đang mượn', 'Quá hạn', 'Đã trả'].indexOf(loan.status) >= 0 && numberValue(loan.fee) > 0) upsertRow('finance', {
      id: 'AUTOLOANFEE-' + loan.id,
      date: loan.borrowDate || todayISO(),
      kind: 'Thu',
      category: 'Cho thuê',
      amount: numberValue(loan.fee),
      note: 'Tự động: phí cho thuê phiếu ' + loan.id + ' - ' + (book.title || loan.bookId),
      relatedId: 'loan-fee:' + loan.id,
    });
    if (loan.status === 'Đã trả' && numberValue(loan.damageFee) > 0) upsertRow('finance', {
      id: 'AUTOLOANDAMAGE-' + loan.id,
      date: loan.returnDate || todayISO(),
      kind: 'Thu',
      category: 'Bồi thường',
      amount: numberValue(loan.damageFee),
      note: 'Tự động: phí hư hỏng/khác phiếu ' + loan.id,
      relatedId: 'loan-damage:' + loan.id,
    });
  });
}

function normalizeRecord(kind, record) {
  if (kind === 'book') {
    record.quantity = Math.max(1, numberValue(record.quantity || 1));
    record.coverPrice = numberValue(record.coverPrice);
    record.purchasePrice = numberValue(record.purchasePrice);
    record.borrowFee = numberValue(record.borrowFee);
  }
  if (kind === 'loan') {
    record.deposit = numberValue(record.deposit);
    record.fee = numberValue(record.fee);
    record.damageFee = numberValue(record.damageFee);
  }
  if (kind === 'finance') record.amount = numberValue(record.amount);
}

function isAutoFinance(item) {
  return Boolean(item.relatedId) || String(item.id || '').indexOf('AUTO') === 0;
}

function bookQuantity(book) {
  return Math.max(1, numberValue(book.quantity || 1));
}

function numberValue(value) {
  return Number(value || 0);
}

function todayISO() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function upsertRow(table, record) {
  const sheet = getSheet(table);
  const headers = getHeaders(sheet);
  const rowIndex = findRowById(sheet, record.id);
  const row = headers.map((key) => cleanValue(record[key]));
  if (rowIndex > 1) sheet.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
  else sheet.appendRow(row);
}

function deleteRowsByPredicate(table, predicate) {
  const sheet = getSheet(table);
  const rows = readRowsWithIndex(table);
  rows.reverse().forEach((entry) => {
    if (predicate(entry.item)) sheet.deleteRow(entry.rowIndex);
  });
}

function readTable(name) {
  return readRowsWithIndex(name).map((entry) => entry.item);
}

function readRowsWithIndex(name) {
  const sheet = getSheet(name);
  const headers = getHeaders(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, headers.length).getValues().map((row, rowOffset) => {
    const item = {};
    headers.forEach((key, index) => {
      item[key] = normalizeValue(row[index]);
    });
    return { item, rowIndex: rowOffset + 2 };
  }).filter((entry) => entry.item.id);
}

function getSheet(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, TABLES[name].length).setValues([TABLES[name]]);
  }
  const headers = getHeaders(sheet);
  const missing = TABLES[name].filter((header) => headers.indexOf(header) === -1);
  if (missing.length) sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
  return sheet;
}

function getHeaders(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) return [];
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map((value) => String(value || '').trim()).filter(Boolean);
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

function jsonResponse(payload, callback) {
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + JSON.stringify(payload) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
