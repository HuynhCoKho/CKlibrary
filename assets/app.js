const CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycbziXcr38A0pmgv8-Vsa_cm4tFIkvVrsYNaPPeKGiF4uTa2ier4JFP8vEIePKAiKA509Gg/exec",
  currency: "vi-VN",
  maxActiveLoans: 5,
  maxLoanDays: 7,
};

let state = {
  areas: [],
  shelves: [],
  books: [],
  borrowers: [],
  loans: [],
  finance: [],
  adminToken: localStorage.getItem("cklibrary_admin_token") || "",
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
    ["shelfId", "Vị trí sách", "shelf"], ["status", "Trạng thái", ["Đang ở kệ", "Cho mượn", "Bảo trì", "Đã bán"]],
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
    ["status", "Trạng thái", ["Đang mượn", "Đã trả", "Quá hạn", "Hủy"]], ["note", "Ghi chú", "textarea", false, "wide"],
  ]},
  finance: { title: "Thu chi", store: "finance", prefix: "TC", fields: [
    ["id", "ID", "text", true], ["date", "Ngày", "date"], ["kind", "Loại", ["Thu", "Chi"]],
    ["category", "Danh mục", ["Tài trợ", "Cho thuê", "Bán sách", "Nhận đặt cọc", "Mua sách", "Sửa sách", "Hoàn cọc", "Khác"]],
    ["amount", "Số tiền", "number"], ["note", "Ghi chú", "textarea", false, "wide"],
  ]},
};

async function api(action, payload = {}) {
  try {
    const res = await fetch(CONFIG.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, token: state.adminToken, ...payload }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Lỗi dữ liệu");
    return json.data;
  } catch (error) {
    console.warn(error);
    throw error;
  }
}

function seedData() {
  const areaId = "KV001";
  const shelfId = "KE001";
  return {
    areas: [{ id: areaId, name: "Khu vực A", note: "Sách giấy thường mượn" }],
    shelves: [{ id: shelfId, name: "Kệ A1", areaId, note: "Gần cửa vào" }],
    books: [
      { id: "S001", type: "Sách giấy", topic: "Kỹ năng", title: "Tư duy nhanh và chậm", author: "Daniel Kahneman", publisher: "NXB Thế Giới", year: 2023, shelfId, status: "Đang ở kệ", coverPrice: 250000, purchasePrice: 180000, borrowFee: 10000, note: "" },
      { id: "S002", type: "Ebook", topic: "Công nghệ", title: "Clean Code", author: "Robert C. Martin", publisher: "Prentice Hall", year: 2008, shelfId, status: "Đang ở kệ", coverPrice: 0, purchasePrice: 0, borrowFee: 0, note: "Bản đọc nội bộ" },
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
    hideNotice();
  } catch {
    Object.assign(state, seedData(), JSON.parse(localStorage.getItem("cklibrary_cache") || "{}"));
    showNotice("Đang dùng dữ liệu mẫu/bộ nhớ trình duyệt. Hãy cập nhật Apps Script backend để kết nối Google Sheets đầy đủ.");
  }
  renderAll();
}

async function saveRecord(kind, record) {
  validateRules(kind, record);
  const schema = schemas[kind];
  record.id = record.id || uid(schema.prefix);
  const index = state[schema.store].findIndex((item) => item.id === record.id);
  if (index >= 0) state[schema.store][index] = record; else state[schema.store].push(record);
  await persist(kind, "upsert", record);
  applySideEffects(kind, record);
  renderAll();
}

async function deleteRecord(kind, id) {
  const schema = schemas[kind];
  state[schema.store] = state[schema.store].filter((item) => item.id !== id);
  await persist(kind, "delete", { id });
  renderAll();
}

async function persist(kind, op, record) {
  localStorage.setItem("cklibrary_cache", JSON.stringify(pickStores()));
  if (!isAdmin() && op !== "borrowRequest") return;
  try { await api("save", { kind, op, record }); } catch (error) { showNotice(`Đã lưu tạm trên trình duyệt, chưa ghi được vào Sheet: ${error.message}`); }
}

function pickStores() {
  return { areas: state.areas, shelves: state.shelves, books: state.books, borrowers: state.borrowers, loans: state.loans, finance: state.finance };
}

function validateRules(kind, record) {
  if (kind !== "loan" || record.status !== "Đang mượn") return;
  const borrower = byId(state.borrowers, record.borrowerId);
  if (borrower.blacklisted === "Có") throw new Error("Người mượn đang trong danh sách đen.");
  const active = state.loans.filter((loan) => loan.borrowerId === record.borrowerId && loan.status === "Đang mượn" && loan.id !== record.id).length;
  if (active >= CONFIG.maxActiveLoans) throw new Error("Mỗi người chỉ được mượn tối đa 5 quyển đang mở.");
  if (new Date(toISODate(record.dueDate)) > new Date(addDays(record.borrowDate, CONFIG.maxLoanDays))) throw new Error("Hạn trả tối đa là 7 ngày.");
}

function applySideEffects(kind, record) {
  if (kind !== "loan") return;
  const book = byId(state.books, record.bookId);
  if (book.id) book.status = record.status === "Đang mượn" || record.status === "Quá hạn" ? "Cho mượn" : "Đang ở kệ";
  if (record.status === "Đã trả") {
    const netReturn = Number(record.deposit || 0) - Number(record.fee || 0) - Number(record.damageFee || 0);
    state.finance.push({ id: uid("TC"), date: record.returnDate || todayISO(), kind: "Chi", category: "Hoàn cọc", amount: Math.max(netReturn, 0), note: `Hoàn cọc phiếu ${record.id}` });
  }
}

function showNotice(message) { $("#notice").textContent = message; $("#notice").classList.add("show"); }
function hideNotice() { $("#notice").classList.remove("show"); }
function statusBadge(status) {
  const cls = status === "Đang ở kệ" || status === "Đã trả" || status === "Không" ? "good" : status === "Quá hạn" || status === "Có" ? "bad" : "warn";
  return `<span class="badge ${cls}">${status || ""}</span>`;
}

function renderAll() {
  renderAdmin();
  renderStats();
  renderBooks();
  renderBorrowOptions();
  renderAlerts();
  renderCards("areas", $("#areasList"), (a) => `${a.name}`, (a) => a.note || "Không có ghi chú", "area");
  renderCards("shelves", $("#shelvesList"), (s) => `${s.name}`, (s) => `${byId(state.areas, s.areaId).name || "Chưa chọn khu vực"} · ${s.note || ""}`, "shelf");
  renderPeople();
  renderLoans();
  renderFinance();
  if (window.lucide) lucide.createIcons();
}

function renderAdmin() {
  $$(".admin-only").forEach((el) => el.classList.toggle("locked", !isAdmin()));
  $("#adminBtn span").textContent = isAdmin() ? "Đã mở khóa" : "Quản trị";
}

function renderStats() {
  const activeLoans = state.loans.filter((l) => l.status === "Đang mượn").length;
  const overdue = getOverdueLoans().length;
  $("#stats").innerHTML = [
    ["Sách", state.books.length], ["Đang mượn", activeLoans], ["Quá hạn", overdue], ["Người mượn", state.borrowers.length],
  ].map(([label, value]) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`).join("");
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
      <td>${statusBadge(b.status)}</td><td>${fmtMoney(b.borrowFee)}</td>
      <td class="admin-only"><button class="icon-button" onclick="openForm('book','${b.id}')" title="Sửa"><i data-lucide="pencil"></i></button></td>
    </tr>`).join("");
  $("#booksTable").innerHTML = rows || $("#emptyTemplate").innerHTML;
}

function renderBorrowOptions() {
  const options = state.books.filter((b) => b.status === "Đang ở kệ").map((b) => `<option value="${b.id}">${b.title} - ${fmtMoney(b.borrowFee)}</option>`).join("");
  $("#borrowRequestForm select[name=bookId]").innerHTML = options || "<option value=''>Chưa có sách sẵn sàng</option>";
}

function getOverdueLoans() {
  const now = new Date(todayISO());
  return state.loans.filter((l) => l.status === "Đang mượn" && new Date(toISODate(l.dueDate)) < now);
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
  $("#loansTable").innerHTML = state.loans.map((l) => `<tr><td>${l.id}</td><td>${byId(state.books, l.bookId).title || l.bookId}</td><td>${byId(state.borrowers, l.borrowerId).name || l.borrowerId}</td><td>${fmtDate(l.borrowDate)}</td><td>${fmtDate(l.dueDate)}</td><td>${fmtDate(l.returnDate)}</td><td>${fmtMoney(l.deposit)}</td><td>${fmtMoney(l.fee)}</td><td>${statusBadge(l.status)}</td><td><button class="icon-button" onclick="openForm('loan','${l.id}')" title="Sửa"><i data-lucide="pencil"></i></button></td></tr>`).join("") || $("#emptyTemplate").innerHTML;
}

function renderFinance() {
  const from = toISODate($("#financeFrom").value) || "0000-01-01";
  const to = toISODate($("#financeTo").value) || "9999-12-31";
  const rows = state.finance.filter((f) => {
    const date = toISODate(f.date);
    return date >= from && date <= to;
  });
  const income = rows.filter((f) => f.kind === "Thu").reduce((s, f) => s + Number(f.amount || 0), 0);
  const expense = rows.filter((f) => f.kind === "Chi").reduce((s, f) => s + Number(f.amount || 0), 0);
  $("#financeSummary").innerHTML = [["Thu", income], ["Chi", expense], ["Còn lại", income - expense]].map(([l, v]) => `<div class="stat"><b>${fmtMoney(v)}</b><span>${l}</span></div>`).join("");
  $("#financeTable").innerHTML = rows.map((f) => `<tr><td>${f.id}</td><td>${fmtDate(f.date)}</td><td>${f.kind}</td><td>${f.category}</td><td>${fmtMoney(f.amount)}</td><td>${f.note || ""}</td><td><button class="icon-button" onclick="openForm('finance','${f.id}')" title="Sửa"><i data-lucide="pencil"></i></button></td></tr>`).join("") || $("#emptyTemplate").innerHTML;
}

function fieldHtml([name, label, type, readonly, klass], value = "") {
  const common = `name="${name}" ${readonly ? "readonly" : ""}`;
  const options = (items) => `<select ${common}>${items.map(([v, t]) => `<option value="${v}" ${String(value) === String(v) ? "selected" : ""}>${t}</option>`).join("")}</select>`;
  let input = "";
  if (Array.isArray(type)) input = options(type.map((x) => [x, x]));
  else if (type === "textarea") input = `<textarea ${common} rows="3">${value || ""}</textarea>`;
  else if (type === "area") input = options(state.areas.map((a) => [a.id, a.name]));
  else if (type === "shelf") input = options(state.shelves.map((s) => [s.id, `${s.name} (${byId(state.areas, s.areaId).name || ""})`]));
  else if (type === "book") input = options(state.books.map((b) => [b.id, b.title]));
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
  if (kind === "book") return { ...base, type: "Sách giấy", status: "Đang ở kệ", borrowFee: 0 };
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
    $$(".tab, .view").forEach((el) => el.classList.remove("active"));
    tab.classList.add("active");
    $(`#${tab.dataset.view}View`).classList.add("active");
  }));
  $$("[data-open-form]").forEach((btn) => btn.addEventListener("click", () => openForm(btn.dataset.openForm)));
  $("#bookSearch").addEventListener("input", renderBooks);
  $("#bookStatusFilter").addEventListener("change", renderBooks);
  $("#financeFrom").addEventListener("change", renderFinance);
  $("#financeTo").addEventListener("change", renderFinance);
  $("#refreshBtn").addEventListener("click", loadData);
  $("#adminBtn").addEventListener("click", () => $("#adminDialog").showModal());
  $("#adminDialog form").addEventListener("submit", () => {
    state.adminToken = $("#adminTokenInput").value.trim();
    localStorage.setItem("cklibrary_admin_token", state.adminToken);
    renderAll();
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
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const person = state.borrowers.find((p) => p.phone === data.phone) || { id: uid("NM"), name: data.name, phone: data.phone, email: data.email, blacklisted: "Không", note: data.note };
    if (!state.borrowers.some((p) => p.id === person.id)) state.borrowers.push(person);
    const book = byId(state.books, data.bookId);
    const loan = { id: uid("YC"), bookId: data.bookId, borrowerId: person.id, borrowDate: todayISO(), dueDate: addDays(todayISO(), CONFIG.maxLoanDays), returnDate: "", deposit: book.coverPrice || 0, fee: book.borrowFee || 0, damageFee: 0, status: "Đang mượn", note: `Yêu cầu công khai: ${data.note || ""}` };
    state.loans.push(loan);
    book.status = "Cho mượn";
    localStorage.setItem("cklibrary_cache", JSON.stringify(pickStores()));
    try { await api("borrowRequest", { record: { person, loan } }); } catch {}
    event.currentTarget.reset();
    renderAll();
    alert("Đã gửi yêu cầu mượn sách.");
  });
}

window.openForm = openForm;
document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  loadData();
});
