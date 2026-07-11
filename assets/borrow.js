const CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycbziXcr38A0pmgv8-Vsa_cm4tFIkvVrsYNaPPeKGiF4uTa2ier4JFP8vEIePKAiKA509Gg/exec",
  currency: "vi-VN",
  maxLoanDays: 7,
  requestTimeoutMs: 45000,
};

let state = { books: [], loans: [], borrowers: [], shelves: [] };

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const num = (value) => Number(value || 0);
const fmtMoney = (value) => `${Number(value || 0).toLocaleString(CONFIG.currency)} đ`;
const uid = (prefix) => `${prefix}${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
const dateToISO = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const todayISO = () => dateToISO(new Date());
const addDays = (iso, days) => {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return dateToISO(d);
};
const bookQuantity = (book) => Math.max(0, num(book.quantity || 1));
const unavailableLoanStatuses = new Set(["Chờ xác nhận", "Đang mượn", "Quá hạn"]);
const unavailableLoansForBook = (bookId) => state.loans.filter((loan) => loan.bookId === bookId && unavailableLoanStatuses.has(loan.status)).length;
const bookIsBlocked = (book) => book.status === "Bảo trì" || book.status === "Đã bán";
const activeLoansForBook = (bookId) => unavailableLoansForBook(bookId);
const borrowableCopies = (book) => (bookIsBlocked(book) ? 0 : Math.max(bookQuantity(book) - unavailableLoansForBook(book.id), 0));
const availableCopies = borrowableCopies;
const bookCanBorrow = (book) => borrowableCopies(book) > 0;
const shelfName = (book) => state.shelves.find((shelf) => String(shelf.id) === String(book.shelfId))?.name || book.shelfId || "Chưa có vị trí kệ";

function showNotice(message) {
  $("#notice").textContent = message;
  $("#notice").classList.add("show");
}

function hideNotice() {
  $("#notice").textContent = "";
  $("#notice").classList.remove("show");
}

function showFormMessage(type, message) {
  const box = $("#formMessage");
  box.className = `form-message show ${type}`;
  box.textContent = message;
}

function clearFormMessage() {
  const box = $("#formMessage");
  box.className = "form-message";
  box.textContent = "";
}

function jsonpAction(action, payload = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = `cklibraryPublic_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
    const params = new URLSearchParams({ action, callback: callbackName, t: Date.now().toString() });
    if (payload.record) params.set("record", JSON.stringify(payload.record));
    script.src = `${CONFIG.apiUrl}?${params.toString()}`;
    script.onerror = () => {
      cleanup();
      reject(new Error("Không kết nối được Apps Script."));
    };
    document.body.appendChild(script);
  });
}

async function loadData() {
  showNotice("Đang tải danh sách sách...");
  try {
    const data = await jsonpAction("list");
    state = { books: data.books || [], loans: data.loans || [], borrowers: data.borrowers || [], shelves: data.shelves || [] };
    renderBooks();
    hideNotice();
  } catch (error) {
    showNotice(`Chưa tải được dữ liệu: ${error.message}`);
  }
}

function filteredBooks() {
  const keyword = $("#searchInput").value.trim().toLowerCase();
  return state.books
    .filter((book) => [book.title, book.author].join(" ").toLowerCase().includes(keyword));
}

function renderBooks() {
  const books = filteredBooks();
  const totalBorrowable = books.reduce((sum, book) => sum + borrowableCopies(book), 0);
  const borrowableTitles = books.filter(bookCanBorrow).length;
  $("#summary").textContent = `Hiển thị ${books.length} đầu sách, ${borrowableTitles} đầu sách còn có thể mượn (${totalBorrowable} quyển còn trên kệ).`;
  $("#bookGrid").innerHTML = books.map((book) => `
    <article class="book-card ${bookCanBorrow(book) ? "" : "unavailable"}">
      <div class="book-tags">
        <span class="tag">${book.type || "Sách"}</span>
        <span class="tag ${bookCanBorrow(book) ? "ready" : "muted"}">${bookCanBorrow(book) ? `Còn ${borrowableCopies(book)} quyển` : "Hết lượt mượn"}</span>
        <span class="tag">${fmtMoney(book.borrowFee)}</span>
      </div>
      <h2>${book.title || "Chưa đặt tên"}</h2>
      <p class="book-meta">${book.author || "Chưa có tác giả"}</p>
      <p class="shelf-line"><i data-lucide="map-pin"></i><span>${shelfName(book)}</span></p>
      <div class="card-actions">
        <button class="primary" type="button" data-borrow="${book.id}" ${bookCanBorrow(book) ? "" : "disabled"}><i data-lucide="handshake"></i><span>${bookCanBorrow(book) ? "Mượn sách" : "Tạm hết"}</span></button>
      </div>
    </article>
  `).join("") || "<div class='empty'>Không tìm thấy sách phù hợp.</div>";
  if (window.lucide) lucide.createIcons();
}

function openBorrowDialog(bookId) {
  const book = state.books.find((item) => item.id === bookId);
  if (!book) return;
  if (!bookCanBorrow(book)) return;
  $("#bookIdInput").value = book.id;
  $("#dialogBookTitle").textContent = book.title || book.id;
  $("#dialogBookMeta").textContent = `${book.author || "Chưa có tác giả"} · ${shelfName(book)} · phí ${fmtMoney(book.borrowFee)}`;
  clearFormMessage();
  $("#borrowDialog").showModal();
}

function ensureBorrowRequestSaved(result, loan) {
  const savedLoan = result?.id === loan.id || result?.loan?.id === loan.id || result?.loans?.some((item) => item.id === loan.id);
  if (!savedLoan) throw new Error("Apps Script backend chưa ghi phiếu mượn vào Google Sheet. Hãy cập nhật Code.gs mới và deploy lại Web App.");
}

function setSubmitting(isSubmitting) {
  const button = $("#submitBtn");
  button.disabled = isSubmitting;
  button.querySelector("span").textContent = isSubmitting ? "Đang gửi..." : "Gửi yêu cầu";
}

function bindEvents() {
  $("#searchInput").addEventListener("input", renderBooks);
  $("#bookGrid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-borrow]");
    if (button) openBorrowDialog(button.dataset.borrow);
  });
  $("#closeDialog").addEventListener("click", () => $("#borrowDialog").close());
  $("#borrowForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const book = state.books.find((item) => item.id === data.bookId);
    if (!book || availableCopies(book) <= 0) return showFormMessage("error", "Sách này hiện không còn bản sẵn sàng.");
    const person = { id: uid("NM"), name: data.name, phone: data.phone, email: data.email, blacklisted: "Không", note: data.note };
    const loan = {
      id: uid("YC"),
      bookId: data.bookId,
      borrowerId: person.id,
      borrowDate: todayISO(),
      dueDate: addDays(todayISO(), CONFIG.maxLoanDays),
      returnDate: "",
      deposit: book.coverPrice || 0,
      fee: book.borrowFee || 0,
      damageFee: 0,
      status: "Chờ xác nhận",
      note: `Yêu cầu công khai: ${data.note || ""}`,
    };
    setSubmitting(true);
    clearFormMessage();
    try {
      const result = await jsonpAction("borrowRequest", { record: { person, loan } });
      ensureBorrowRequestSaved(result, loan);
      showFormMessage("success", "Đã gửi yêu cầu. Thư viện sẽ kiểm tra và xác nhận phiếu mượn.");
      await loadData();
      form.reset();
    } catch (error) {
      showFormMessage("error", error.message || "Chưa gửi được yêu cầu.");
    } finally {
      setSubmitting(false);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  loadData();
});
