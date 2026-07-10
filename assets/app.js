const CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycbziXcr38A0pmgv8-Vsa_cm4tFIkvVrsYNaPPeKGiF4uTa2ier4JFP8vEIePKAiKA509Gg/exec",
  currency: "vi-VN",
  maxActiveLoans: 5,
  maxLoanDays: 7,
  requestTimeoutMs: 45000,
};

let state = {
  areas: [],
  shelves: [],
  books: [],
  borrowers: [],
  loans: [],
  finance: [],
  adminToken: localStorage.getItem("cklibrary_admin_token") || "",
  loanStatusFilter: "",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const fmtMoney = (value) => `${Number(value || 0).toLocaleString(CONFIG.currency)} đ`;
const todayISO = () => {
  const d = new Date();
  return dateToISO(d);
};
const dateToISO = (d) => {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
};
const dateFields = new Set(["borrowDate", "dueDate", "returnDate", "date"]);
const toISODate = (value) => {
  if (!value) return "";
  const raw = String(value).trim();
  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const [, day, month, year] = dmy;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, year, month, day] = iso;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : dateToISO(parsed);
};
const fmtDate = (value) => {
  const iso = toISODate(value);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value || "";
};
const addDays = (iso, days) => {
  const d = new Date(toISODate(iso) || todayISO());
  d.setDate(d.getDate() + days);
  return dateToISO(d);
};
const uid = (prefix) => `${prefix}${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
const isAdmin = () => Boolean(state.adminToken);
const byId = (list, id) => list.find((item) => item.id === id) || {};
const num = (value) => Number(value || 0);
const moneyInput = (value) => Number(String(value || "").replace(/[^\d-]/g, ""));
const bookQuantity = (book) => Math.max(0, num(book.quantity || 1));
const activeLoanStatuses = new Set(["Đang mượn", "Quá hạn"]);
const activeLoansForBook = (bookId) => state.loans.filter((loan) => loan.bookId === bookId && activeLoanStatuses.has(loan.status)).length;
const activeLoansForBookExcept = (bookId, excludedLoanId) => state.loans.filter((loan) => loan.bookId === bookId && loan.id !== excludedLoanId && activeLoanStatuses.has(loan.status)).length;
const availableCopies = (book) => Math.max(bookQuantity(book) - activeLoansForBook(book.id), 0);
const bookDisplayStatus = (book) => {
  if (book.status === "Bảo trì" || book.status === "Đã bán") return book.status;
  return availableCopies(book) > 0 ? "Đang ở kệ" : "Cho mượn";
};
const isAutoFinance = (item) => item.relatedId || String(item.id || "").startsWith("AUTO");

const schemas = {
  area: { title: "Khu vực", store: "areas", prefix: "KV", fields: [
    ["id", "ID", "text", true], ["name", "Tên khu vực", "text"], ["note", "Ghi chú", "textarea", false, "wide"],
  ]},
  shelf: { title: "Kệ sách", store: "shelves", prefix: "KE", fields: [
    ["id", "ID", "text", true], ["name", "Tên kệ", "text"], ["areaId", "Vị trí đặt kệ", "area"], ["note", "Ghi chú", "textarea", false, "wide"],
  ]},
  book: { title: "Sách", store: "books", prefix: "S", fields: [
    ["id", "ID", "text", true], ["type", "Loại", ["Sách giấy", "Ebook"]], ["topic", "Chủ đề", "text"], ["title", "Tên sách", "text"],
    ["author", "Tên tác giả", "text"], ["publisher", "Nhà xuất bản", "text"], ["year", "Năm xuất bản", "number"],
    ["shelfId", "Vị trí sách", "shelf"], ["quantity", "Số lượng", "number"], ["status", "Trạng thái", ["Đang ở kệ", "Cho mượn", "Bảo trì", "Đã bán"]],
    ["coverPrice", "Giá bìa", "number"], ["purchasePrice", "Giá mua", "number"], ["borrowFee", "Phí mượn", "number"],
    ["note", "Ghi chú", "textarea", false, "wide"],
  ]},
  person: { title: "Người mượn", store: "borrowers", prefix: "NM", fields: [
    ["id", "ID", "text", true], ["name", "Họ tên", "text"], ["phone", "Số điện thoại", "tel"], ["email", "Email", "email"],
    ["blacklisted", "Danh sách đen", ["Không", "Có"]], ["note", "Ghi chú", "textarea", false, "wide"],
  ]},
  loan: { title: "Phiếu mượn", store: "loans", prefix: "PM", fields: [
    ["id", "ID", "text", true], ["bookId", "Sách", "book"], ["borrowerId", "Người mượn", "person"],
    ["borrowDate", "Ngày mượn", "date"], ["dueDate", "Hạn trả", "date"], ["returnDate", "Ngày trả", "date"],
    ["deposit", "Tiền đặt cọc", "number"], ["fee", "Phí mượn", "number"], ["damageFee", "Phí hư hỏng/khác", "number"],
    ["status", "Trạng thái", ["Chờ xác nhận", "Đang mượn", "Đã trả", "Quá hạn", "Hủy"]], ["note", "Ghi chú", "textarea", false, "wide"],
  ]},
  finance: { title: "Thu chi", store: "finance", prefix: "TC", fields: [
    ["id", "ID", "text", true], ["date", "Ngày", "date"], ["kind", "Loại", ["Thu", "Chi"]],
    ["category", "Danh mục", ["Tài trợ", "Cho thuê", "Bán sách", "Mua sách", "Sửa sách", "Bồi thường", "Khác"]],
    ["amount", "Số tiền", "number"], ["relatedId", "Nguồn liên kết", "text", true], ["note", "Ghi chú", "textarea", false, "wide"],
  ]},
};

async function api(action, payload = {}) {
  if (action === "list") return jsonpList();
  if (action === "borrowRequest") return jsonpAction("borrowRequest", payload);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
  try {
    const res = await fetch(CONFIG.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, token: state.adminToken, ...payload }),
      signal: controller.signal,
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Lỗi dữ liệu");
    return json.data;
  } catch (error) {
    console.warn(error);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function jsonpList() {
  return jsonpAction("list");
}

function jsonpAction(action, payload = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = `cklibraryJsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Không tải được dữ liệu từ Apps Script."));
    }, CONFIG.requestTimeoutMs);
    const cleanup = () => {
      clearTimeout(timeoutId);
      delete window[callbackName];
      script.remove();
    };
    window[callbackName] = (json) => {
      cleanup();
      if (!json || !json.ok) reject(new Error(json?.error || "Lỗi dữ liệu"));
      else resolve(json.data);
    };
    const params = new URLSearchParams({
      action,
      callback: callbackName,
      t: Date.now().toString(),
    });
    if (payload.record) params.set("record", JSON.stringify(payload.record));
    const separator = CONFIG.apiUrl.includes("?") ? "&" : "?";
    script.src = `${CONFIG.apiUrl}${separator}${params.toString()}`;
    script.onerror = () => {
      cleanup();
      reject(new Error("Không tải được dữ liệu từ Apps Script."));
    };
    document.head.appendChild(script);
  });
}

function seedData() {
  const areaId = "KV001";
  const shelfId = "KE001";
  return {
    areas: [{ id: areaId, name: "Khu vực A", note: "Sách giấy thường mượn" }],
    shelves: [{ id: shelfId, name: "Kệ A1", areaId, note: "Gần cửa vào" }],
    books: [
      { id: "S001", type: "Sách giấy", topic: "Kỹ năng", title: "Tư duy nhanh và chậm", author: "Daniel Kahneman", publisher: "NXB Thế Giới", year: 2023, shelfId, quantity: 2, status: "Đang ở kệ", coverPrice: 250000, purchasePrice: 180000, borrowFee: 10000, note: "" },
      { id: "S002", type: "Ebook", topic: "Công nghệ", title: "Clean Code", author: "Robert C. Martin", publisher: "Prentice Hall", year: 2008, shelfId, quantity: 1, status: "Đang ở kệ", coverPrice: 0, purchasePrice: 0, borrowFee: 0, note: "Bản đọc nội bộ" },
    ],
    borrowers: [],
    loans: [],
    finance: [],
  };
}

async function loadData() {
  showNotice("Đang tải dữ liệu...");
  try {
    const data = await api("list");
    Object.assign(state, seedData(), data);
    syncDerivedData();
    hideNotice();
  } catch {
    Object.assign(state, seedData(), JSON.parse(localStorage.getItem("cklibrary_cache") || "{}"));
    syncDerivedData();
    showNotice("Chưa kết nối được Google Sheet/App Script, trang đang dùng dữ liệu tạm trong trình duyệt. Hãy cập nhật Code.gs và deploy lại Web App để đồng bộ dữ liệu thật.");
  }
  renderAll();
}

async function saveRecord(kind, record) {
  normalizeRecord(kind, record);
  validateRules(kind, record);
  const schema = schemas[kind];
  record.id = record.id || uid(schema.prefix);
  const index = state[schema.store].findIndex((item) => item.id === record.id);
  if (index >= 0) state[schema.store][index] = record; else state[schema.store].push(record);
  syncDerivedData();
  await persist(kind, "upsert", record);
  renderAll();
}

async function deleteRecord(kind, id) {
  const schema = schemas[kind];
  cascadeDelete(kind, id);
  syncDerivedData();
  await persist(kind, "delete", { id });
  renderAll();
}

async function updateAllBorrowFees() {
  if (!isAdmin()) return showNotice("Bạn cần mở khóa quản trị trước.");
  if (!state.books.length) return showNotice("Chưa có sách để cập nhật phí mượn.");
  $("#bulkBorrowFeeInput").value = 0;
  $("#bulkFeeDialog").showModal();
}

async function applyAllBorrowFees(fee) {
  showNotice(`Đang cập nhật phí mượn ${fmtMoney(fee)} cho toàn bộ sách...`);
  try {
    const result = await api("bulkBorrowFee", { fee });
    if (!result || Number(result.updated || 0) < state.books.length) throw new Error("Backend chưa cập nhật đủ toàn bộ sách.");
    state.books = state.books.map((book) => ({ ...book, borrowFee: fee }));
    syncDerivedData();
    localStorage.setItem("cklibrary_cache", JSON.stringify(pickStores()));
    renderAll();
    showNotice(`Đã cập nhật phí mượn ${fmtMoney(fee)} cho ${result.updated} sách.`);
  } catch (error) {
    showNotice(`Chưa cập nhật được toàn bộ phí mượn: ${error.message}. Hãy cập nhật Code.gs mới và deploy lại Web App.`);
  }
}

async function persist(kind, op, record) {
  localStorage.setItem("cklibrary_cache", JSON.stringify(pickStores()));
  if (!isAdmin() && op !== "borrowRequest") return;
  try { await api("save", { kind, op, record }); } catch (error) { showNotice(`Đã lưu tạm trên trình duyệt, chưa ghi được vào Sheet: ${error.message}`); }
}

function pickStores() {
  syncDerivedData();
  return { areas: state.areas, shelves: state.shelves, books: state.books, borrowers: state.borrowers, loans: state.loans, finance: state.finance };
}

function normalizeRecord(kind, record) {
  if (kind === "book") {
    record.quantity = Math.max(1, num(record.quantity || 1));
    record.coverPrice = num(record.coverPrice);
    record.purchasePrice = num(record.purchasePrice);
    record.borrowFee = num(record.borrowFee);
  }
  if (kind === "loan") {
    record.deposit = num(record.deposit);
    record.fee = num(record.fee);
    record.damageFee = num(record.damageFee);
  }
  if (kind === "finance") record.amount = num(record.amount);
}

function validateRules(kind, record) {
  if (kind !== "loan" || record.status !== "Đang mượn") return;
  const borrower = byId(state.borrowers, record.borrowerId);
  if (borrower.blacklisted === "Có") throw new Error("Người mượn đang trong danh sách đen.");
  const active = state.loans.filter((loan) => loan.borrowerId === record.borrowerId && loan.status === "Đang mượn" && loan.id !== record.id).length;
  if (active >= CONFIG.maxActiveLoans) throw new Error("Mỗi người chỉ được mượn tối đa 5 quyển đang mở.");
  if (new Date(toISODate(record.dueDate)) > new Date(addDays(record.borrowDate, CONFIG.maxLoanDays))) throw new Error("Hạn trả tối đa là 7 ngày.");
  const book = byId(state.books, record.bookId);
  if (book.id && book.status !== "Bảo trì" && book.status !== "Đã bán" && bookQuantity(book) - activeLoansForBookExcept(book.id, record.id) <= 0) throw new Error("Sách này đã hết bản còn trên kệ.");
}

function cascadeDelete(kind, id) {
  const linkedLoanIds = new Set();
  const linkedBookIds = new Set();
  if (kind === "person") {
    state.loans.filter((loan) => loan.borrowerId === id).forEach((loan) => linkedLoanIds.add(loan.id));
    state.borrowers = state.borrowers.filter((item) => item.id !== id);
  } else if (kind === "book") {
    linkedBookIds.add(id);
    state.loans.filter((loan) => loan.bookId === id).forEach((loan) => linkedLoanIds.add(loan.id));
    state.books = state.books.filter((item) => item.id !== id);
  } else if (kind === "loan") {
    linkedLoanIds.add(id);
    state.loans = state.loans.filter((item) => item.id !== id);
  } else if (kind === "shelf") {
    state.books.filter((book) => book.shelfId === id).forEach((book) => linkedBookIds.add(book.id));
    state.loans.filter((loan) => linkedBookIds.has(loan.bookId)).forEach((loan) => linkedLoanIds.add(loan.id));
    state.shelves = state.shelves.filter((item) => item.id !== id);
    state.books = state.books.filter((book) => book.shelfId !== id);
  } else if (kind === "area") {
    const shelfIds = new Set(state.shelves.filter((shelf) => shelf.areaId === id).map((shelf) => shelf.id));
    state.books.filter((book) => shelfIds.has(book.shelfId)).forEach((book) => linkedBookIds.add(book.id));
    state.loans.filter((loan) => linkedBookIds.has(loan.bookId)).forEach((loan) => linkedLoanIds.add(loan.id));
    state.areas = state.areas.filter((item) => item.id !== id);
    state.shelves = state.shelves.filter((shelf) => shelf.areaId !== id);
    state.books = state.books.filter((book) => !shelfIds.has(book.shelfId));
  } else {
    const schema = schemas[kind];
    state[schema.store] = state[schema.store].filter((item) => item.id !== id);
  }
  if (linkedLoanIds.size) state.loans = state.loans.filter((loan) => !linkedLoanIds.has(loan.id));
  state.finance = state.finance.filter((item) => {
    const related = item.relatedId || "";
    if ([...linkedLoanIds].some((loanId) => related.includes(loanId) || (item.note || "").includes(loanId))) return false;
    if ([...linkedBookIds].some((bookId) => related.includes(bookId) || (item.note || "").includes(bookId))) return false;
    return true;
  });
}

function syncDerivedData() {
  state.books.forEach((book) => {
    book.quantity = Math.max(1, num(book.quantity || 1));
    if (book.status !== "Bảo trì" && book.status !== "Đã bán") book.status = bookDisplayStatus(book);
  });
  const manualFinance = state.finance.filter((item) => !isAutoFinance(item) && item.category !== "Nhận đặt cọc" && item.category !== "Hoàn cọc");
  const generated = [];
  state.books.forEach((book) => {
    const unitCost = num(book.purchasePrice) || num(book.coverPrice);
    const amount = unitCost * bookQuantity(book);
    if (amount > 0) generated.push({
      id: `AUTOBOOK-${book.id}`,
      date: book.purchaseDate || todayISO(),
      kind: "Chi",
      category: "Mua sách",
      amount,
      relatedId: `book:${book.id}`,
      note: `Tự động: mua ${bookQuantity(book)} quyển sách ${book.title || book.id}`,
    });
  });
  state.loans.forEach((loan) => {
    const book = byId(state.books, loan.bookId);
    if (["Đang mượn", "Quá hạn", "Đã trả"].includes(loan.status) && num(loan.fee) > 0) generated.push({
      id: `AUTOLOANFEE-${loan.id}`,
      date: loan.borrowDate || todayISO(),
      kind: "Thu",
      category: "Cho thuê",
      amount: num(loan.fee),
      relatedId: `loan-fee:${loan.id}`,
      note: `Tự động: phí cho thuê phiếu ${loan.id} - ${book.title || loan.bookId}`,
    });
    if (loan.status === "Đã trả" && num(loan.damageFee) > 0) generated.push({
      id: `AUTOLOANDAMAGE-${loan.id}`,
      date: loan.returnDate || todayISO(),
      kind: "Thu",
      category: "Bồi thường",
      amount: num(loan.damageFee),
      relatedId: `loan-damage:${loan.id}`,
      note: `Tự động: phí hư hỏng/khác phiếu ${loan.id}`,
    });
  });
  state.finance = [...manualFinance, ...generated];
}

function showNotice(message) { $("#notice").textContent = message; $("#notice").classList.add("show"); }
function hideNotice() { $("#notice").textContent = ""; $("#notice").classList.remove("show"); }
function showFormMessage(type, message) {
  const box = $("#borrowFormMessage");
  if (!box) return;
  box.className = `form-message show ${type}`;
  box.textContent = message;
}
function hideFormMessage() {
  const box = $("#borrowFormMessage");
  if (!box) return;
  box.className = "form-message";
  box.textContent = "";
}
function setBorrowSubmitting(isSubmitting) {
  const button = $("#borrowSubmitBtn");
  if (!button) return;
  button.disabled = isSubmitting;
  button.querySelector("span").textContent = isSubmitting ? "Đang gửi..." : "Gửi yêu cầu";
}
function statusBadge(status) {
  const cls = status === "Đang ở kệ" || status === "Đã trả" || status === "Không" ? "good" : status === "Quá hạn" || status === "Có" ? "bad" : "warn";
  return `<span class="badge ${cls}">${status || ""}</span>`;
}

function renderAll() {
  renderStats();
  renderBooks();
  renderBorrowOptions();
  renderAlerts();
  renderCards("areas", $("#areasList"), (a) => `${a.name}`, (a) => a.note || "Không có ghi chú", "area");
  renderCards("shelves", $("#shelvesList"), (s) => `${s.name}`, (s) => `${byId(state.areas, s.areaId).name || "Chưa chọn khu vực"} · ${s.note || ""}`, "shelf");
  renderPeople();
  renderLoans();
  renderFinance();
  renderAdmin();
  if (window.lucide) lucide.createIcons();
}

function renderAdmin() {
  document.body.classList.toggle("is-admin", isAdmin());
  $$(".admin-only").forEach((el) => el.classList.toggle("locked", !isAdmin()));
  $("#adminBtn span").textContent = isAdmin() ? "Đã mở khóa" : "Quản trị";
}

function renderStats() {
  const activeLoans = state.loans.filter((l) => activeLoanStatuses.has(l.status)).length;
  const pendingLoans = state.loans.filter((l) => l.status === "Chờ xác nhận").length;
  const overdue = getOverdueLoans().length;
  const totalCopies = state.books.reduce((sum, book) => sum + bookQuantity(book), 0);
  $("#stats").innerHTML = [
    ["Sách", totalCopies, "catalog", ""],
    ["Chờ xác nhận", pendingLoans, "loans", "Chờ xác nhận"],
    ["Đang mượn", activeLoans, "loans", "Đang mượn"],
    ["Quá hạn", overdue, "loans", "Quá hạn"],
    ["Người mượn", state.borrowers.length, "people", ""],
  ].map(([label, value, view, filter]) => `<button class="stat actionable" type="button" data-stat-view="${view}" data-stat-filter="${filter}"><b>${value}</b><span>${label}</span></button>`).join("");
}

function renderBooks() {
  const q = $("#bookSearch").value?.toLowerCase() || "";
  const st = $("#bookStatusFilter").value;
  const rows = state.books
    .filter((b) => !st || b.status === st)
    .filter((b) => [b.title, b.author, b.topic].join(" ").toLowerCase().includes(q))
    .map((b) => `<tr>
      <td>${b.id}</td><td>${b.type || ""}</td><td>${b.topic || ""}</td><td><b>${b.title || ""}</b></td><td>${b.author || ""}</td>
      <td>${b.publisher || ""}</td><td>${b.year || ""}</td><td>${byId(state.shelves, b.shelfId).name || ""}</td>
      <td>${bookQuantity(b)}</td><td>${activeLoansForBook(b.id)}</td><td>${availableCopies(b)}</td><td>${statusBadge(bookDisplayStatus(b))}</td><td>${fmtMoney(b.borrowFee)}</td>
      <td class="admin-only"><button class="icon-button" onclick="openForm('book','${b.id}')" title="Sửa"><i data-lucide="pencil"></i></button></td>
    </tr>`).join("");
  $("#booksTable").innerHTML = rows || $("#emptyTemplate").innerHTML;
}

function renderBorrowOptions() {
  const options = state.books.filter((b) => bookDisplayStatus(b) === "Đang ở kệ").map((b) => `<option value="${b.id}">${b.title} - còn ${availableCopies(b)} - ${fmtMoney(b.borrowFee)}</option>`).join("");
  $("#borrowRequestForm select[name=bookId]").innerHTML = options || "<option value=''>Chưa có sách sẵn sàng</option>";
  renderBorrowBookPreview();
}

function renderBorrowBookPreview() {
  const select = $("#borrowRequestForm select[name=bookId]");
  const book = byId(state.books, select?.value);
  $("#borrowBookPreview").innerHTML = book.id
    ? `<b>${book.title}</b><span>${book.author || "Chưa có tác giả"} · còn ${availableCopies(book)} · phí ${fmtMoney(book.borrowFee)}</span>`
    : "Chưa chọn sách.";
}

function ensureBorrowRequestSaved(result, loan) {
  const savedLoan = result?.id === loan.id || result?.loan?.id === loan.id || result?.loans?.some((item) => item.id === loan.id);
  if (!savedLoan) {
    throw new Error("Apps Script backend chưa ghi phiếu mượn vào Google Sheet. Hãy cập nhật Code.gs mới và deploy lại Web App.");
  }
}

function isLoanOverdue(loan) {
  const now = new Date(todayISO());
  return loan.status === "Quá hạn" || (loan.status === "Đang mượn" && new Date(toISODate(loan.dueDate)) < now);
}

function getOverdueLoans() {
  return state.loans.filter(isLoanOverdue);
}

function renderAlerts() {
  const overdue = getOverdueLoans();
  $("#alerts").innerHTML = overdue.length ? overdue.map((l) => `<p>${statusBadge("Quá hạn")} <b>${byId(state.books, l.bookId).title || l.bookId}</b> - ${byId(state.borrowers, l.borrowerId).name || l.borrowerId}, hạn ${fmtDate(l.dueDate)}</p>`).join("") : "<p class='empty'>Không có sách quá hạn.</p>";
}

function renderCards(store, container, titleFn, bodyFn, kind) {
  container.innerHTML = state[store].map((item) => `<article class="card"><b>${item.id} · ${titleFn(item)}</b><p>${bodyFn(item)}</p><div class="card-actions"><button class="icon-button" onclick="openForm('${kind}','${item.id}')" title="Sửa"><i data-lucide="pencil"></i></button></div></article>`).join("") || "<p class='empty'>Chưa có dữ liệu</p>";
}

function renderPeople() {
  $("#peopleTable").innerHTML = state.borrowers.map((p) => `<tr><td>${p.id}</td><td>${p.name || ""}</td><td>${p.phone || ""}</td><td>${p.email || ""}</td><td>${statusBadge(p.blacklisted || "Không")}</td><td>${p.note || ""}</td><td><button class="icon-button" onclick="openForm('person','${p.id}')" title="Sửa"><i data-lucide="pencil"></i></button></td></tr>`).join("") || $("#emptyTemplate").innerHTML;
}

function renderLoans() {
  const rows = state.loans.filter((loan) => {
    if (!state.loanStatusFilter) return true;
    if (state.loanStatusFilter === "Quá hạn") return isLoanOverdue(loan);
    return loan.status === state.loanStatusFilter;
  });
  $("#loansTable").innerHTML = rows.map((l) => {
    const actionButton = l.status === "Chờ xác nhận"
      ? `<button class="icon-button" onclick="markLoanApproved('${l.id}')" title="Xác nhận cho mượn"><i data-lucide="badge-check"></i></button>`
      : activeLoanStatuses.has(l.status)
        ? `<button class="icon-button" onclick="markLoanReturned('${l.id}')" title="Đánh dấu đã trả"><i data-lucide="check-check"></i></button>`
      : `<span class="badge good">Xong</span>`;
    return `<tr><td>${l.id}</td><td>${byId(state.books, l.bookId).title || l.bookId}</td><td>${byId(state.borrowers, l.borrowerId).name || l.borrowerId}</td><td>${fmtDate(l.borrowDate)}</td><td>${fmtDate(l.dueDate)}</td><td>${fmtDate(l.returnDate)}</td><td>${fmtMoney(l.deposit)}</td><td>${fmtMoney(l.fee)}</td><td>${statusBadge(isLoanOverdue(l) ? "Quá hạn" : l.status)}</td><td>${actionButton}</td><td><button class="icon-button" onclick="openForm('loan','${l.id}')" title="Sửa"><i data-lucide="pencil"></i></button></td></tr>`;
  }).join("") || $("#emptyTemplate").innerHTML;
}

function openView(view, filter = "") {
  if (view === "loans") {
    state.loanStatusFilter = filter || "";
    const select = $("#loanStatusFilter");
    if (select) select.value = state.loanStatusFilter;
    renderLoans();
  }
  $$(".tab, .view").forEach((el) => el.classList.remove("active"));
  document.querySelector(`.tab[data-view="${view}"]`)?.classList.add("active");
  $(`#${view}View`)?.classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function markLoanReturned(id) {
  const loan = byId(state.loans, id);
  if (!loan.id || !activeLoanStatuses.has(loan.status)) return;
  const updated = { ...loan, status: "Đã trả", returnDate: todayISO() };
  try {
    await saveRecord("loan", updated);
  } catch (error) {
    alert(error.message);
  }
}

async function markLoanApproved(id) {
  const loan = byId(state.loans, id);
  if (!loan.id || loan.status !== "Chờ xác nhận") return;
  const borrowDate = todayISO();
  const updated = { ...loan, status: "Đang mượn", borrowDate, dueDate: addDays(borrowDate, CONFIG.maxLoanDays), returnDate: "" };
  try {
    await saveRecord("loan", updated);
    showNotice(`Đã xác nhận phiếu mượn ${loan.id}.`);
  } catch (error) {
    alert(error.message);
  }
}

function renderFinance() {
  const from = toISODate($("#financeFrom").value) || "0000-01-01";
  const to = toISODate($("#financeTo").value) || "9999-12-31";
  const rows = state.finance.filter((f) => {
    const date = toISODate(f.date);
    return date >= from && date <= to;
  });
  const income = rows.filter((f) => f.kind === "Thu" && f.category !== "Nhận đặt cọc").reduce((s, f) => s + Number(f.amount || 0), 0);
  const expense = rows.filter((f) => f.kind === "Chi" && f.category !== "Hoàn cọc").reduce((s, f) => s + Number(f.amount || 0), 0);
  $("#financeSummary").innerHTML = [["Thu", income], ["Chi", expense], ["Còn lại", income - expense]].map(([l, v]) => `<div class="stat"><b>${fmtMoney(v)}</b><span>${l}</span></div>`).join("");
  $("#financeTable").innerHTML = rows.map((f) => `<tr><td>${f.id}</td><td>${fmtDate(f.date)}</td><td>${f.kind}</td><td>${f.category}</td><td>${fmtMoney(f.amount)}</td><td>${f.note || ""}</td><td>${f.relatedId ? "Tự động" : "Nhập tay"}</td><td><button class="icon-button" onclick="openForm('finance','${f.id}')" title="Sửa"><i data-lucide="pencil"></i></button></td></tr>`).join("") || $("#emptyTemplate").innerHTML;
}

function fieldHtml([name, label, type, readonly, klass], value = "") {
  const common = `name="${name}" ${readonly ? "readonly" : ""}`;
  const options = (items) => `<select ${common}>${items.map(([v, t]) => `<option value="${v}" ${String(value) === String(v) ? "selected" : ""}>${t}</option>`).join("")}</select>`;
  let input = "";
  if (Array.isArray(type)) input = options(type.map((x) => [x, x]));
  else if (type === "textarea") input = `<textarea ${common} rows="3">${value || ""}</textarea>`;
  else if (type === "area") input = options(state.areas.map((a) => [a.id, a.name]));
  else if (type === "shelf") input = options(state.shelves.map((s) => [s.id, `${s.name} (${byId(state.areas, s.areaId).name || ""})`]));
  else if (type === "book") input = options(state.books.filter((b) => availableCopies(b) > 0 || String(value) === String(b.id)).map((b) => [b.id, `${b.title} (còn ${availableCopies(b)})`]));
  else if (type === "person") input = options(state.borrowers.map((p) => [p.id, `${p.name} - ${p.phone || ""}`]));
  else if (type === "date") input = `<input ${common} type="text" value="${fmtDate(value)}" placeholder="dd/mm/yyyy" inputmode="numeric" />`;
  else input = `<input ${common} type="${type}" value="${value || ""}" />`;
  return `<label class="${klass || ""}">${label}${input}</label>`;
}

function openForm(kind, id = "") {
  const schema = schemas[kind];
  const record = id ? { ...byId(state[schema.store], id) } : defaultsFor(kind);
  $("#dialogTitle").textContent = `${id ? "Sửa" : "Thêm"} ${schema.title}`;
  $("#dialogFields").innerHTML = schema.fields.map((field) => fieldHtml(field, record[field[0]])).join("");
  $("#deleteBtn").style.visibility = id ? "visible" : "hidden";
  $("#recordDialog").dataset.kind = kind;
  $("#recordDialog").dataset.id = id;
  $("#recordDialog").showModal();
  if (window.lucide) lucide.createIcons();
}

function defaultsFor(kind) {
  const schema = schemas[kind];
  const base = { id: uid(schema.prefix) };
  if (kind === "loan") return { ...base, borrowDate: todayISO(), dueDate: addDays(todayISO(), CONFIG.maxLoanDays), status: "Đang mượn", deposit: 0, fee: 0, damageFee: 0 };
  if (kind === "finance") return { ...base, date: todayISO(), kind: "Thu", amount: 0 };
  if (kind === "book") return { ...base, type: "Sách giấy", status: "Đang ở kệ", quantity: 1, borrowFee: 0 };
  if (kind === "person") return { ...base, blacklisted: "Không" };
  return base;
}

function readDialogRecord() {
  const data = new FormData($("#recordDialog form"));
  const record = Object.fromEntries(data.entries());
  Object.keys(record).forEach((key) => {
    if (dateFields.has(key)) record[key] = toISODate(record[key]);
  });
  return record;
}

function bindEvents() {
  $$(".tab").forEach((tab) => tab.addEventListener("click", () => {
    if (tab.dataset.view === "loans") {
      state.loanStatusFilter = "";
      const select = $("#loanStatusFilter");
      if (select) select.value = "";
      renderLoans();
    }
    openView(tab.dataset.view);
  }));
  $$("[data-open-form]").forEach((btn) => btn.addEventListener("click", () => openForm(btn.dataset.openForm)));
  $("#updateBorrowFeesBtn").addEventListener("click", updateAllBorrowFees);
  $("#bookSearch").addEventListener("input", renderBooks);
  $("#bookStatusFilter").addEventListener("change", renderBooks);
  $("#borrowRequestForm select[name=bookId]").addEventListener("change", renderBorrowBookPreview);
  $("#financeFrom").addEventListener("change", renderFinance);
  $("#financeTo").addEventListener("change", renderFinance);
  $("#loanStatusFilter").addEventListener("change", (event) => {
    state.loanStatusFilter = event.target.value;
    renderLoans();
  });
  $("#stats").addEventListener("click", (event) => {
    const button = event.target.closest("[data-stat-view]");
    if (!button || !isAdmin()) return;
    openView(button.dataset.statView, button.dataset.statFilter || "");
  });
  $("#refreshBtn").addEventListener("click", loadData);
  $("#adminBtn").addEventListener("click", () => $("#adminDialog").showModal());
  $("#adminDialog form").addEventListener("submit", () => {
    state.adminToken = $("#adminTokenInput").value.trim();
    localStorage.setItem("cklibrary_admin_token", state.adminToken);
    renderAll();
  });
  $("#bulkFeeCancel").addEventListener("click", () => $("#bulkFeeDialog").close());
  $("#bulkFeeDialog form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const fee = moneyInput($("#bulkBorrowFeeInput").value);
    if (!Number.isFinite(fee) || fee < 0) return showNotice("Phí mượn không hợp lệ.");
    $("#bulkFeeDialog").close();
    await applyAllBorrowFees(fee);
  });
  $("#recordDialog form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveRecord($("#recordDialog").dataset.kind, readDialogRecord());
      $("#recordDialog").close();
    } catch (error) { alert(error.message); }
  });
  $("#deleteBtn").addEventListener("click", async () => {
    if (!confirm("Xóa bản ghi này?")) return;
    await deleteRecord($("#recordDialog").dataset.kind, $("#recordDialog").dataset.id);
    $("#recordDialog").close();
  });
  $("#borrowRequestForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget || event.target || $("#borrowRequestForm");
    hideFormMessage();
    setBorrowSubmitting(true);
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      const person = state.borrowers.find((p) => p.phone === data.phone) || { id: uid("NM"), name: data.name, phone: data.phone, email: data.email, blacklisted: "Không", note: data.note };
      const book = byId(state.books, data.bookId);
      if (!book.id || availableCopies(book) <= 0) throw new Error("Sách này đã hết bản còn trên kệ.");
      const loan = { id: uid("YC"), bookId: data.bookId, borrowerId: person.id, borrowDate: todayISO(), dueDate: addDays(todayISO(), CONFIG.maxLoanDays), returnDate: "", deposit: book.coverPrice || 0, fee: book.borrowFee || 0, damageFee: 0, status: "Chờ xác nhận", note: `Yêu cầu công khai: ${data.note || ""}` };
      const result = await api("borrowRequest", { record: { person, loan } });
      ensureBorrowRequestSaved(result, loan);
      if (!state.borrowers.some((p) => p.id === person.id)) state.borrowers.push(person);
      state.loans.push(loan);
      syncDerivedData();
      localStorage.setItem("cklibrary_cache", JSON.stringify(pickStores()));
      if (form && typeof form.reset === "function") form.reset();
      showFormMessage("success", "Đã gửi yêu cầu mượn sách thành công.");
      await loadData();
      document.querySelector('[data-view="catalog"]')?.click();
      showNotice("Đã gửi yêu cầu mượn sách thành công. Thư viện sẽ kiểm tra và xác nhận phiếu mượn.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      showFormMessage("error", error.message || "Chưa gửi được yêu cầu, vui lòng thử lại.");
    } finally {
      setBorrowSubmitting(false);
      if (window.lucide) lucide.createIcons();
    }
  });
}

window.openForm = openForm;
window.markLoanReturned = markLoanReturned;
window.markLoanApproved = markLoanApproved;
document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  loadData();
});
