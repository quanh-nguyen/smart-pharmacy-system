(() => {
  "use strict";

  const AUTH_ACCOUNTS_KEY = "smartPharmacyOwnerAccounts_v1";
  const AUTH_SESSION_KEY = "smartPharmacyOwnerSession_v1";
  const authGate = document.querySelector("#authGate");
  const appShell = document.querySelector("#appShell");
  const authForm = document.querySelector("#ownerAuthForm");
  const loginTab = document.querySelector("#loginTab");
  const registerTab = document.querySelector("#registerTab");
  const authHeading = document.querySelector("#authHeading");
  const authMessage = document.querySelector("#authMessage");
  const authSubmit = document.querySelector("#ownerAuthSubmit");
  const ownerNameField = document.querySelector("#ownerNameField");
  const ownerConfirmField = document.querySelector("#ownerConfirmField");
  const ownerNameInput = document.querySelector("#ownerName");
  const ownerEmailInput = document.querySelector("#ownerEmail");
  const ownerPasswordInput = document.querySelector("#ownerPassword");
  const ownerConfirmInput = document.querySelector("#ownerConfirmPassword");
  let authMode = "login";

  function getOwnerAccounts() {
    try {
      const value = JSON.parse(localStorage.getItem(AUTH_ACCOUNTS_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  }
  function setAuthMessage(message, isError = false) {
    authMessage.textContent = message;
    authMessage.classList.toggle("error", isError);
  }
  function switchAuthMode(mode) {
    authMode = mode;
    const registering = mode === "register";
    loginTab.classList.toggle("active", !registering);
    registerTab.classList.toggle("active", registering);
    loginTab.setAttribute("aria-selected", String(!registering));
    registerTab.setAttribute("aria-selected", String(registering));
    ownerNameField.hidden = !registering;
    ownerConfirmField.hidden = !registering;
    ownerNameInput.required = registering;
    ownerConfirmInput.required = registering;
    ownerPasswordInput.autocomplete = registering ? "new-password" : "current-password";
    authHeading.textContent = registering ? "Tạo tài khoản chủ hiệu thuốc" : "Đăng nhập quản lý hiệu thuốc";
    authSubmit.textContent = registering ? "Tạo tài khoản" : "Đăng nhập";
    setAuthMessage("");
  }
  function openOwnerWorkspace(account) {
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ email: account.email, name: account.name }));
    authGate.classList.add("hidden");
    appShell.classList.remove("hidden");
    const initials = (account.name || account.email).trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(part => part[0].toLocaleUpperCase("vi")).join("");
    document.querySelector("#userAvatar").textContent = initials || "NT";
    document.querySelector("#welcomeTitle").textContent = account.name ? `Xin chào, ${account.name}` : "Chào mừng đến với khu vực quản lý";
  }
  loginTab.addEventListener("click", () => switchAuthMode("login"));
  registerTab.addEventListener("click", () => switchAuthMode("register"));
  authForm.addEventListener("submit", event => {
    event.preventDefault();
    const email = ownerEmailInput.value.trim().toLocaleLowerCase("vi");
    const password = ownerPasswordInput.value;
    const accounts = getOwnerAccounts();
    if (authMode === "register") {
      const name = ownerNameInput.value.trim();
      if (!name) return setAuthMessage("Vui lòng nhập tên chủ hiệu thuốc.", true);
      if (password !== ownerConfirmInput.value) return setAuthMessage("Mật khẩu nhập lại chưa khớp.", true);
      if (accounts.some(account => account.email === email)) return setAuthMessage("Email này đã được đăng ký. Hãy đăng nhập.", true);
      accounts.push({ name, email, password });
      try { localStorage.setItem(AUTH_ACCOUNTS_KEY, JSON.stringify(accounts)); }
      catch { return setAuthMessage("Không thể lưu tài khoản trên trình duyệt này.", true); }
      switchAuthMode("login");
      ownerEmailInput.value = email;
      ownerPasswordInput.value = "";
      setAuthMessage("Đăng ký thành công. Hãy đăng nhập bằng tài khoản vừa tạo.");
      return;
    }
    const account = accounts.find(item => item.email === email && item.password === password);
    if (!account) return setAuthMessage("Email hoặc mật khẩu chưa đúng. Nếu chưa có tài khoản, hãy chọn Đăng ký.", true);
    openOwnerWorkspace(account);
  });
  document.querySelector("#logoutButton").addEventListener("click", () => {
    localStorage.removeItem(AUTH_SESSION_KEY);
    appShell.classList.add("hidden");
    authGate.classList.remove("hidden");
    authForm.reset();
    switchAuthMode("login");
  });
  try {
    const session = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || "null");
    const account = session && getOwnerAccounts().find(item => item.email === session.email);
    if (account) openOwnerWorkspace(account);
  } catch { /* Không có phiên đăng nhập hợp lệ thì giữ màn hình đăng nhập. */ }

  const MEDICINES_KEY = "smartPharmacyPharmacyMedicines_v1";
  const PROFILE_KEY = "smartPharmacyPharmacyProfile_v1";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const money = value => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Number(value) || 0) + " ₫";
  const safeText = value => String(value ?? "");
  const escapeHtml = value => safeText(value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const sampleMedicines = [
    { code: "THUOC001", name: "Paracetamol 500 mg", ingredient: "Paracetamol", category: "Giảm đau, hạ sốt", price: 12000, quantity: 48, unit: "Vỉ", expiry: "2027-08-31" },
    { code: "THUOC002", name: "Vitamin C 500 mg", ingredient: "Acid ascorbic", category: "Vitamin và khoáng chất", price: 35000, quantity: 8, unit: "Hộp", expiry: "2027-05-20" },
    { code: "THUOC003", name: "Dung dịch nước muối sinh lý", ingredient: "Natri clorid 0,9%", category: "Vật tư y tế", price: 8000, quantity: 0, unit: "Chai", expiry: "2026-12-15" },
    { code: "THUOC004", name: "Men vi sinh", ingredient: "Lợi khuẩn đường ruột", category: "Tiêu hóa", price: 65000, quantity: 23, unit: "Hộp", expiry: "2027-03-10" },
    { code: "THUOC005", name: "Siro ho thảo dược", ingredient: "Chiết xuất thảo dược", category: "Ho, cảm cúm", price: 42000, quantity: 5, unit: "Chai", expiry: "2027-01-18" }
  ];
  const defaultProfile = { name: "Nhà thuốc của tôi", address: "Chưa cập nhật địa chỉ", phone: "", hours: "07:00 – 22:00", description: "" };
  let medicines = readStorage(MEDICINES_KEY, null);
  if (!Array.isArray(medicines)) { medicines = sampleMedicines.map(item => ({ ...item })); writeStorage(MEDICINES_KEY, medicines); }
  let profile = readStorage(PROFILE_KEY, defaultProfile);
  let toastTimer;

  function readStorage(key, fallback) {
    try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; }
    catch { return fallback; }
  }
  function writeStorage(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { showToast("Không thể lưu dữ liệu. Hãy kiểm tra dung lượng trình duyệt.", true); return false; }
  }
  function showToast(message, isError = false) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.toggle("error", isError);
    toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add("hidden"), 3000);
  }
  function stockState(item) {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) return { label: "Hết hàng", className: "stock-empty" };
    if (qty <= 10) return { label: "Sắp hết", className: "stock-low" };
    return { label: "Còn hàng", className: "stock-ok" };
  }
  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("vi-VN");
  }
  function isExpired(item) { return Boolean(item.expiry && item.expiry < todayISO()); }

  function switchView(name) {
    const labels = { overview: "Tổng quan", medicines: "Kho thuốc", profile: "Thông tin hiệu thuốc" };
    if (!labels[name]) return;
    $$(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.view === name));
    $$(".view").forEach(view => view.classList.toggle("active", view.id === `view-${name}`));
    $("#pageTitle").textContent = labels[name];
    if (name === "medicines") renderMedicines();
    if (name === "profile") fillProfileForm();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function renderStats() {
    $("#statKinds").textContent = medicines.length.toLocaleString("vi-VN");
    $("#statUnits").textContent = medicines.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0).toLocaleString("vi-VN");
    $("#statLow").textContent = medicines.filter(item => Number(item.quantity) <= 10).length.toLocaleString("vi-VN");
    const totalValue = medicines.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0);
    $("#statValue").textContent = money(totalValue);
    $("#welcomeTitle").textContent = profile.name && profile.name !== "Nhà thuốc của tôi" ? `Xin chào, ${profile.name}` : "Chào mừng đến với khu vực quản lý";
    renderAttention();
  }
  function renderAttention() {
    const attention = medicines.filter(item => Number(item.quantity) <= 10 || isExpired(item)).sort((a,b) => Number(a.quantity) - Number(b.quantity)).slice(0, 6);
    const container = $("#attentionList");
    if (!attention.length) { container.innerHTML = '<div class="empty-inline">Hiện không có thuốc nào cần chú ý.</div>'; return; }
    container.innerHTML = attention.map(item => {
      const state = stockState(item);
      const note = isExpired(item) ? `Đã hết hạn · HSD ${formatDate(item.expiry)}` : `${state.label} · ${item.category}`;
      return `<div class="attention-row"><div class="medicine-symbol">Rx</div><div class="attention-info"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.code)} · ${escapeHtml(note)}</small></div><span class="stock-count">${Number(item.quantity) || 0} ${escapeHtml(item.unit || "đv")}</span></div>`;
    }).join("");
  }
  function renderCategoryFilter() {
    const select = $("#categoryFilter");
    const previous = select.value || "all";
    const categories = [...new Set(medicines.map(item => item.category).filter(Boolean))].sort((a,b) => a.localeCompare(b,"vi"));
    select.innerHTML = '<option value="all">Tất cả nhóm thuốc</option>' + categories.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join("");
    select.value = categories.includes(previous) ? previous : "all";
  }
  function renderMedicines() {
    renderCategoryFilter();
    const query = $("#medicineSearch").value.trim().toLocaleLowerCase("vi");
    const category = $("#categoryFilter").value;
    const filter = $("#stockFilter").value;
    const rows = medicines.filter(item => {
      const text = `${item.code} ${item.name} ${item.ingredient || ""}`.toLocaleLowerCase("vi");
      const state = stockState(item);
      return (!query || text.includes(query)) && (category === "all" || item.category === category) &&
        (filter === "all" || (filter === "available" && Number(item.quantity) > 10) || (filter === "low" && Number(item.quantity) > 0 && Number(item.quantity) <= 10) || (filter === "empty" && Number(item.quantity) <= 0));
    });
    $("#resultCount").textContent = `${rows.length} / ${medicines.length} loại thuốc`;
    $("#medicineTableBody").innerHTML = rows.map(item => {
      const state = stockState(item);
      const expiryLabel = isExpired(item) ? `<span class="status-pill" style="background:#ffeded;color:#bd3434">Đã hết hạn</span>` : `<span class="status-pill">${formatDate(item.expiry)}</span>`;
      return `<tr>
        <td><span class="medicine-code">${escapeHtml(item.code)}</span></td>
        <td><span class="medicine-name">${escapeHtml(item.name)}</span><span class="medicine-ingredient">${escapeHtml(item.ingredient || "Chưa khai báo hoạt chất")}</span></td>
        <td>${escapeHtml(item.category)}</td><td class="price-cell">${money(item.price)}</td>
        <td>${Number(item.quantity) || 0} ${escapeHtml(item.unit || "")}</td><td>${expiryLabel}</td>
        <td><span class="stock-pill ${state.className}">${state.label}</span></td>
        <td><div class="action-group"><button class="table-action" type="button" data-edit="${escapeHtml(item.code)}">Sửa</button><button class="table-action delete" type="button" data-delete="${escapeHtml(item.code)}">Xóa</button></div></td>
      </tr>`;
    }).join("");
    $("#emptyMedicines").classList.toggle("hidden", rows.length > 0);
    $(".table-wrap").classList.toggle("hidden", rows.length === 0);
  }
  function refreshAll() { renderStats(); renderMedicines(); }

  function openMedicineModal(code = "") {
    const item = code ? medicines.find(m => m.code === code) : null;
    if (code && !item) { showToast("Không tìm thấy thuốc cần sửa.", true); return; }
    $("#medicineForm").reset();
    $("#medicineFormError").classList.add("hidden");
    $("#medicineOriginalCode").value = item?.code || "";
    $("#medicineCode").value = item?.code || "";
    $("#medicineCode").readOnly = Boolean(item);
    $("#medicineName").value = item?.name || "";
    $("#medicineIngredient").value = item?.ingredient || "";
    $("#medicineCategory").value = item?.category || "";
    $("#medicinePrice").value = item?.price ?? "";
    $("#medicineQuantity").value = item?.quantity ?? "";
    $("#medicineUnit").value = item?.unit || "";
    $("#medicineExpiry").value = item?.expiry || "";
    $("#medicineModalTitle").textContent = item ? "Cập nhật thông tin thuốc" : "Thêm thuốc mới";
    $("#saveMedicine").textContent = item ? "Lưu thay đổi" : "Thêm vào kho";
    $("#medicineModal").classList.remove("hidden");
    $("#medicineName").focus();
  }
  function closeMedicineModal() { $("#medicineModal").classList.add("hidden"); }
  function showFormError(message) {
    const element = $("#medicineFormError"); element.textContent = message; element.classList.remove("hidden");
  }
  function saveMedicine(event) {
    event.preventDefault();
    const originalCode = $("#medicineOriginalCode").value;
    const code = $("#medicineCode").value.trim().toUpperCase();
    const name = $("#medicineName").value.trim();
    const category = $("#medicineCategory").value;
    const price = Number($("#medicinePrice").value);
    const quantity = Number($("#medicineQuantity").value);
    if (!/^[A-Z0-9_-]{1,24}$/.test(code)) return showFormError("Mã thuốc chỉ được chứa chữ không dấu, số, dấu gạch dưới hoặc gạch ngang.");
    if (medicines.some(item => item.code.toUpperCase() === code && item.code !== originalCode)) return showFormError("Mã thuốc này đã tồn tại. Hãy nhập mã khác.");
    if (!name || !category || !$("#medicineUnit").value) return showFormError("Vui lòng nhập đủ tên thuốc, nhóm thuốc và đơn vị tính.");
    if (!Number.isFinite(price) || price < 0 || !Number.isFinite(quantity) || quantity < 0 || !Number.isInteger(quantity)) return showFormError("Đơn giá phải không âm và số lượng phải là số nguyên không âm.");
    const item = { code, name, ingredient: $("#medicineIngredient").value.trim(), category, price, quantity, unit: $("#medicineUnit").value, expiry: $("#medicineExpiry").value };
    if (originalCode) medicines = medicines.map(m => m.code === originalCode ? item : m);
    else medicines.unshift(item);
    if (!writeStorage(MEDICINES_KEY, medicines)) return;
    closeMedicineModal(); refreshAll(); showToast(originalCode ? "Đã cập nhật thuốc." : "Đã thêm thuốc vào kho.");
  }
  function deleteMedicine(code) {
    const item = medicines.find(m => m.code === code);
    if (!item) return;
    const ok = window.confirm(`Bạn có chắc muốn xóa “${item.name}” (${item.code}) khỏi danh mục?`);
    if (!ok) return;
    medicines = medicines.filter(m => m.code !== code);
    if (!writeStorage(MEDICINES_KEY, medicines)) return;
    refreshAll(); showToast("Đã xóa thuốc khỏi danh mục.");
  }
  function fillProfileForm() {
    $("#profileName").value = profile.name || "";
    $("#profileAddress").value = profile.address || "";
    $("#profilePhone").value = profile.phone || "";
    $("#profileHours").value = profile.hours || "";
    $("#profileDescription").value = profile.description || "";
  }
  function saveProfile(event) {
    event.preventDefault();
    profile = { name: $("#profileName").value.trim(), address: $("#profileAddress").value.trim(), phone: $("#profilePhone").value.trim(), hours: $("#profileHours").value.trim(), description: $("#profileDescription").value.trim() };
    if (!writeStorage(PROFILE_KEY, profile)) return;
    $("#profileStatus").textContent = "Đã lưu thông tin trên trình duyệt này.";
    $("#welcomeTitle").textContent = `Xin chào, ${profile.name}`;
    showToast("Đã lưu thông tin hiệu thuốc.");
  }

  $$(".nav-item").forEach(button => button.addEventListener("click", () => switchView(button.dataset.view)));
  $$('[data-go]').forEach(button => button.addEventListener("click", () => switchView(button.dataset.go)));
  $$('[data-action="add-medicine"]').forEach(button => button.addEventListener("click", () => { switchView("medicines"); openMedicineModal(); }));
  $("#medicineSearch").addEventListener("input", renderMedicines);
  $("#categoryFilter").addEventListener("change", renderMedicines);
  $("#stockFilter").addEventListener("change", renderMedicines);
  $("#resetFilters").addEventListener("click", () => { $("#medicineSearch").value = ""; $("#categoryFilter").value = "all"; $("#stockFilter").value = "all"; renderMedicines(); });
  $("#medicineTableBody").addEventListener("click", event => {
    const editButton = event.target.closest("[data-edit]");
    const deleteButton = event.target.closest("[data-delete]");
    if (editButton) openMedicineModal(editButton.dataset.edit);
    if (deleteButton) deleteMedicine(deleteButton.dataset.delete);
  });
  $("#medicineForm").addEventListener("submit", saveMedicine);
  $("#closeMedicineModal").addEventListener("click", closeMedicineModal);
  $("#cancelMedicine").addEventListener("click", closeMedicineModal);
  $("#medicineModal").addEventListener("click", event => { if (event.target === $("#medicineModal")) closeMedicineModal(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeMedicineModal(); });
  $("#profileForm").addEventListener("submit", saveProfile);

  fillProfileForm();
  refreshAll();
})();
