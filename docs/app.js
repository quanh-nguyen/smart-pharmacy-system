const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll("#search .panel");
const statusText = document.querySelector("#status");
const results = document.querySelector("#results");
const resultNote = document.querySelector("#resultNote");
const fileInput = document.querySelector("#prescriptionFile");
const uploadText = document.querySelector("#uploadText");
const preview = document.querySelector("#preview");
const prescriptionButton = document.querySelector("#prescriptionButton");
const medicineInput = document.querySelector("#medicineInput");
const suggestion = document.querySelector("#suggestion");
const suggestionTitle = document.querySelector("#suggestionTitle");
const suggestionText = document.querySelector("#suggestionText");
const widgetTrigger = document.querySelector("#widgetTrigger");
const symptomWidget = document.querySelector("#symptomWidget");
const pharmacySearch = document.querySelector("#pharmacySearch");
const pharmacySuggestions = document.querySelector("#pharmacySuggestions");
const pharmacyList = document.querySelector("#pharmacyList");
const authModal = document.querySelector("#authModal");
const authTitle = document.querySelector("#authTitle");
const authModeLabel = document.querySelector("#authModeLabel");
const authForm = document.querySelector("#authForm");
const authEmail = document.querySelector("#authEmail");
const authPassword = document.querySelector("#authPassword");
const authSubmit = document.querySelector("#authSubmit");
const authStatus = document.querySelector("#authStatus");
let authMode = "login";
let selectedRole = "customer";
let activeOwnerEmail = "";
const ownerDashboard = document.querySelector("#ownerDashboard");
const adminDashboard = document.querySelector("#adminDashboard");
const adminPharmacyList = document.querySelector("#adminPharmacyList");
const adminStatus = document.querySelector("#adminStatus");
const adminDetail = document.querySelector("#adminDetail");
const adminDetailName = document.querySelector("#adminDetailName");
const adminDetailMeta = document.querySelector("#adminDetailMeta");
const adminMedicineList = document.querySelector("#adminMedicineList");
const adminMedicineForm = document.querySelector("#adminMedicineForm");
const adminMedicineCancel = document.querySelector("#adminMedicineCancel");
const adminLoginScreen = document.querySelector("#adminLoginScreen");
const adminLoginButton = document.querySelector("#adminLoginButton");
const dashboardDataKey = "smartPharmacyOwnerData";
let activeAdminEmail = "";
const isAdminRoute = /^\/admin(?:\/|$)/.test(window.location.pathname);

function addListener(element, event, handler) {
  if (element) element.addEventListener(event, handler);
}

const pharmacies = [
  {
    name: "Nhà thuốc Long Châu",
    address: "82 Thanh Nhàn, Bạch Mai, Hà Nội",
    image: "https://mms.img.susercontent.com/vn-11134004-7r98o-lv2ogigyfta12a",
    link: "https://nhathuoclongchau.com.vn",
  },
  {
    name: "Nhà thuốc Pharmacity",
    address: "123 Nguyễn Trãi, Thanh Xuân, Hà Nội",
    image: "https://images.unsplash.com/photo-1580281658223-9b93f18ae9ae?auto=format&fit=crop&w=120&q=80",
    link: "https://www.pharmacity.vn",
  },
  {
    name: "Nhà thuốc An Khang",
    address: "45 Lê Văn Lương, Cầu Giấy, Hà Nội",
    image: "https://images.unsplash.com/photo-1587854692152-cbe660dbde88?auto=format&fit=crop&w=120&q=80",
    link: "https://www.nhathuocankhang.com",
  },
  {
    name: "Nhà thuốc Đức Tâm",
    address: "18 Trần Hưng Đạo, Hoàn Kiếm, Hà Nội",
    image: "https://images.unsplash.com/photo-1471864190281-a93a3070b6de?auto=format&fit=crop&w=120&q=80",
  },
];

const symptomSuggestions = {
  fever: {
    title: "Sốt nhẹ",
    text: "Gợi ý: nghỉ ngơi, uống đủ nước và hỏi dược sĩ về thuốc hạ sốt phù hợp.",
  },
  runnyNose: {
    title: "Sổ mũi",
    text: "Gợi ý: vệ sinh mũi bằng nước muối sinh lý và giữ ấm cơ thể.",
  },
  cough: {
    title: "Ho",
    text: "Gợi ý: uống nước ấm, giữ ấm cổ và hỏi dược sĩ về thuốc giảm ho.",
  },
  soreThroat: {
    title: "Đau họng",
    text: "Gợi ý: súc miệng nước muối, uống nước ấm và dùng viên ngậm phù hợp.",
  },
  headache: {
    title: "Đau đầu",
    text: "Gợi ý: nghỉ ngơi, uống đủ nước và theo dõi thêm các triệu chứng khác.",
  },
};

function normalizeText(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[character]));
}

function getOwnerData() {
  const allData = JSON.parse(localStorage.getItem(dashboardDataKey) || "{}");
  return allData[activeOwnerEmail] || { pharmacy: {}, medicines: [], orders: [], invoices: [] };
}

function saveOwnerData(data) {
  const allData = JSON.parse(localStorage.getItem(dashboardDataKey) || "{}");
  allData[activeOwnerEmail] = data;
  localStorage.setItem(dashboardDataKey, JSON.stringify(allData));
}

function getAllOwnerData() {
  return JSON.parse(localStorage.getItem(dashboardDataKey) || "{}");
}

function adminPharmacyMarkup(email, data) {
  return `
    <tr data-admin-email="${escapeHtml(email)}">
      <td><button class="admin-pharmacy-button" type="button" data-admin-open="${escapeHtml(email)}">${escapeHtml(data.pharmacy?.name || "Chưa khai báo tên")}</button></td>
      <td>${escapeHtml(data.pharmacy?.address || "Chưa khai báo địa chỉ")}</td>
      <td><span class="admin-email">${escapeHtml(email)}</span></td>
      <td><button class="row-action" type="button" data-admin-open="${escapeHtml(email)}">Xem thuốc</button></td>
    </tr>
  `;
}

function renderAdminDashboard() {
  const allData = getAllOwnerData();
  const entries = Object.entries(allData);
  adminPharmacyList.innerHTML = entries.length
    ? entries.map(([email, data]) => adminPharmacyMarkup(email, data)).join("")
    : '<tr><td colspan="5" class="admin-empty">Chưa có dữ liệu chủ cửa hàng.</td></tr>';
}

function resetAdminMedicineForm() {
  adminMedicineForm.reset();
  document.querySelector("#adminMedicineId").value = "";
  document.querySelector("#adminMedicineSubmit").textContent = "Thêm thuốc";
  adminMedicineCancel.classList.add("hidden");
}

function renderAdminMedicines() {
  const data = getAllOwnerData()[activeAdminEmail];
  if (!data) return;
  adminDetailName.textContent = data.pharmacy?.name || "Nhà thuốc chưa khai báo tên";
  adminDetailMeta.textContent = `${data.pharmacy?.address || "Chưa khai báo địa chỉ"} · ${activeAdminEmail}`;
  adminMedicineList.innerHTML = data.medicines?.length
    ? data.medicines.map((medicine) => `
      <div class="management-row">
        <span><strong>${escapeHtml(medicine.name)}</strong><small>Số lượng: ${Number(medicine.quantity) || 0} · ${Number(medicine.price).toLocaleString("vi-VN")} VNĐ</small></span>
        <button class="row-action" type="button" data-admin-edit-medicine="${escapeHtml(medicine.id)}">Sửa</button>
        <button class="row-action danger" type="button" data-admin-delete-medicine="${escapeHtml(medicine.id)}">Xóa</button>
      </div>
    `).join("")
    : '<p class="empty-state">Chưa có thuốc được kê khai.</p>';
}

function openAdminPharmacy(email) {
  activeAdminEmail = email;
  adminDetail.classList.remove("hidden");
  adminPharmacyList.closest(".admin-table-wrap").classList.add("hidden");
  resetAdminMedicineForm();
  renderAdminMedicines();
  adminDetail.scrollIntoView({ behavior: "smooth", block: "start" });
}

function openAdminDashboard() {
  document.querySelector("main").classList.add("hidden");
  document.querySelector("header").classList.add("hidden");
  document.querySelector("footer").classList.add("hidden");
  adminLoginScreen.classList.add("hidden");
  ownerDashboard.classList.add("hidden");
  document.querySelector(".symptom-widget").classList.add("hidden");
  authModal.classList.add("hidden");
  adminDashboard.classList.remove("hidden");
  renderAdminDashboard();
}

function showAdminLogin() {
  document.querySelector("main").classList.add("hidden");
  document.querySelector("header").classList.add("hidden");
  document.querySelector("footer").classList.add("hidden");
  ownerDashboard.classList.add("hidden");
  adminDashboard.classList.add("hidden");
  document.querySelector(".symptom-widget").classList.add("hidden");
  adminLoginScreen.classList.remove("hidden");
}

function renderOwnerDashboard() {
  const data = getOwnerData();
  document.querySelector("#pharmacyName").value = data.pharmacy.name || "";
  document.querySelector("#pharmacyAddress").value = data.pharmacy.address || "";
  document.querySelector("#pharmacyLatitude").value = data.pharmacy.latitude || "";
  document.querySelector("#pharmacyLongitude").value = data.pharmacy.longitude || "";
  if (data.pharmacy.image) {
    document.querySelector("#pharmacyPreview").src = data.pharmacy.image;
    document.querySelector("#pharmacyPreview").classList.remove("hidden");
  }
  const orderMedicine = document.querySelector("#orderMedicine");
  const selectedMedicine = orderMedicine.value;
  orderMedicine.innerHTML = `<option value="">${data.medicines.length ? "Chọn thuốc trong kho" : "Chưa có thuốc trong kho"}</option>${data.medicines.map((medicine) => `<option value="${escapeHtml(medicine.id)}">${escapeHtml(medicine.name)} - ${Number(medicine.price).toLocaleString("vi-VN")} VNĐ</option>`).join("")}`;
  if (data.medicines.some((medicine) => medicine.id === selectedMedicine)) orderMedicine.value = selectedMedicine;
  document.querySelector("#medicineList").innerHTML = data.medicines.length ? data.medicines.map((medicine) => `
    <div class="management-row"><span><strong>${escapeHtml(medicine.name)}</strong><small>${medicine.quantity} sản phẩm · ${Number(medicine.price).toLocaleString("vi-VN")} VNĐ</small></span>
    <button class="row-action" data-edit-medicine="${medicine.id}">Sửa</button><button class="row-action danger" data-delete-medicine="${medicine.id}">Xóa</button></div>
  `).join("") : '<p class="empty-state">Chưa có thuốc trong kho.</p>';
  document.querySelector("#orderList").innerHTML = data.orders.length ? data.orders.map((order) => `
    <div class="management-row"><span><strong>Đơn #${order.id}</strong><small>${escapeHtml(order.customer)} · ${escapeHtml(order.medicine)}${order.quantity ? ` · SL: ${escapeHtml(order.quantity)}` : ""} · ${Number(order.total).toLocaleString("vi-VN")} VNĐ</small></span><span class="order-status">${escapeHtml(order.status)}</span></div>
  `).join("") : '<p class="empty-state">Chưa có đơn thuốc.</p>';
  document.querySelector("#invoiceList").innerHTML = data.invoices.length ? data.invoices.map((invoice) => `
    <div class="management-row"><span><strong>Hóa đơn #${invoice.id}</strong><small>${escapeHtml(invoice.customer)} · ${Number(invoice.total).toLocaleString("vi-VN")} VNĐ</small></span><small>${invoice.date}</small></div>
  `).join("") : '<p class="empty-state">Chưa có hóa đơn bán thuốc.</p>';
}

function openOwnerDashboard() {
  authModal.classList.add("hidden");
  document.querySelector("main").classList.add("hidden");
  document.querySelector(".symptom-widget").classList.add("hidden");
  ownerDashboard.classList.remove("hidden");
  renderOwnerDashboard();
  ownerDashboard.scrollIntoView({ behavior: "smooth" });
}

function openAuth(mode) {
  authMode = mode;
  authTitle.textContent = isAdminRoute ? "Đăng nhập quản trị" : (mode === "login" ? "Đăng nhập" : "Đăng ký");
  authModeLabel.textContent = isAdminRoute ? "QUẢN TRỊ HỆ THỐNG" : (mode === "login" ? "ĐĂNG NHẬP TÀI KHOẢN" : "TẠO TÀI KHOẢN");
  authSubmit.textContent = mode === "login" ? "Đăng nhập" : "Đăng ký";
  authPassword.autocomplete = mode === "login" ? "current-password" : "new-password";
  authStatus.textContent = "";
  authForm.reset();
  document.querySelector(".account-types").classList.toggle("hidden", isAdminRoute);
  authModal.classList.remove("hidden");
  authEmail.focus();
}

addListener(adminLoginButton, "click", () => openAuth("login"));

addListener(document.querySelector("#registerButton"), "click", () => openAuth("register"));
addListener(document.querySelector("#loginButton"), "click", () => openAuth("login"));
addListener(document.querySelector("#closeAuth"), "click", () => authModal.classList.add("hidden"));
addListener(authModal, "click", (event) => {
  if (event.target === authModal) authModal.classList.add("hidden");
});
document.querySelectorAll(".account-type").forEach((button) => {
  addListener(button, "click", () => {
    document.querySelectorAll(".account-type").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    selectedRole = button.dataset.role;
  });
});
addListener(authForm, "submit", (event) => {
  event.preventDefault();
  const email = authEmail.value.trim().toLowerCase();
  const password = authPassword.value;
  if (isAdminRoute) {
    if (authMode !== "login" || email !== "admin@smartpharmacy.vn" || password !== "admin123") {
      authStatus.textContent = "Thông tin quản trị không đúng.";
      return;
    }
    authStatus.textContent = "Đăng nhập quản trị thành công.";
    authForm.reset();
    openAdminDashboard();
    return;
  }
  const accounts = JSON.parse(localStorage.getItem("smartPharmacyAccounts") || "[]");
  const account = accounts.find((item) => item.email === email && item.role === selectedRole);

  if (authMode === "register") {
    if (account) {
      authStatus.textContent = "Email này đã được đăng ký cho loại tài khoản đã chọn.";
      return;
    }
    accounts.push({ email, password, role: selectedRole });
    localStorage.setItem("smartPharmacyAccounts", JSON.stringify(accounts));
    authStatus.textContent = "Đăng ký thành công. Bạn có thể đăng nhập ngay.";
    authMode = "login";
    authTitle.textContent = "Đăng nhập";
    authModeLabel.textContent = "ĐĂNG NHẬP TÀI KHOẢN";
    authSubmit.textContent = "Đăng nhập";
    authPassword.value = "";
    return;
  }

  if (!account || account.password !== password) {
    authStatus.textContent = "Email hoặc mật khẩu không đúng.";
    return;
  }
  authStatus.textContent = `Đăng nhập thành công với tài khoản ${selectedRole === "owner" ? "chủ cửa hàng" : "khách hàng"}.`;
  authForm.reset();
  if (selectedRole === "owner") {
    activeOwnerEmail = email;
    openOwnerDashboard();
  }
});

document.querySelectorAll(".dashboard-tab").forEach((tab) => {
  addListener(tab, "click", () => {
    document.querySelectorAll(".dashboard-tab").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".dashboard-panel").forEach((panel) => panel.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`#${tab.dataset.dashboardTab}`).classList.add("active");
  });
});

addListener(document.querySelector("#ownerLogout"), "click", () => {
  ownerDashboard.classList.add("hidden");
  document.querySelector("main").classList.remove("hidden");
  document.querySelector(".symptom-widget").classList.remove("hidden");
  activeOwnerEmail = "";
});

addListener(adminPharmacyList, "click", (event) => {
  const pharmacy = event.target.closest("[data-admin-open]");
  if (pharmacy) openAdminPharmacy(pharmacy.dataset.adminOpen);
});

addListener(adminMedicineForm, "submit", (event) => {
  event.preventDefault();
  const allData = getAllOwnerData();
  const data = allData[activeAdminEmail];
  if (!data) return;
  const id = document.querySelector("#adminMedicineId").value;
  const medicine = {
    id: id || Date.now().toString(),
    name: document.querySelector("#adminMedicineName").value.trim(),
    quantity: document.querySelector("#adminMedicineQuantity").value,
    price: document.querySelector("#adminMedicinePrice").value,
  };
  data.medicines = id
    ? (data.medicines || []).map((item) => item.id === id ? medicine : item)
    : [...(data.medicines || []), medicine];
  allData[activeAdminEmail] = data;
  localStorage.setItem(dashboardDataKey, JSON.stringify(allData));
  adminStatus.textContent = id ? "Đã cập nhật thuốc." : "Đã thêm thuốc vào nhà thuốc.";
  resetAdminMedicineForm();
  renderAdminMedicines();
});

addListener(adminMedicineList, "click", (event) => {
  const data = getAllOwnerData()[activeAdminEmail];
  if (!data) return;
  const editId = event.target.dataset.adminEditMedicine;
  const deleteId = event.target.dataset.adminDeleteMedicine;
  if (editId) {
    const medicine = data.medicines.find((item) => item.id === editId);
    if (!medicine) return;
    document.querySelector("#adminMedicineId").value = medicine.id;
    document.querySelector("#adminMedicineName").value = medicine.name;
    document.querySelector("#adminMedicineQuantity").value = medicine.quantity;
    document.querySelector("#adminMedicinePrice").value = medicine.price;
    document.querySelector("#adminMedicineSubmit").textContent = "Lưu thay đổi";
    adminMedicineCancel.classList.remove("hidden");
    adminMedicineForm.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  if (deleteId) {
    data.medicines = data.medicines.filter((item) => item.id !== deleteId);
    const allData = getAllOwnerData();
    allData[activeAdminEmail] = data;
    localStorage.setItem(dashboardDataKey, JSON.stringify(allData));
    adminStatus.textContent = "Đã xóa thuốc.";
    renderAdminMedicines();
  }
});

addListener(adminMedicineCancel, "click", resetAdminMedicineForm);
addListener(document.querySelector("#adminBackToList"), "click", () => {
  activeAdminEmail = "";
  adminDetail.classList.add("hidden");
  adminPharmacyList.closest(".admin-table-wrap").classList.remove("hidden");
  adminStatus.textContent = "";
});

addListener(document.querySelector("#adminHome"), "click", () => {
  window.location.href = "/";
});

addListener(document.querySelector("#pharmacyImage"), "change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    document.querySelector("#pharmacyPreview").src = reader.result;
    document.querySelector("#pharmacyPreview").classList.remove("hidden");
  };
  reader.readAsDataURL(file);
});

addListener(document.querySelector("#locationFile"), "change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const content = String(reader.result).trim();
      const location = file.name.endsWith(".json") ? JSON.parse(content) : Object.fromEntries(content.split(/\r?\n/)[0].split(",").map((key, index) => [key.trim(), content.split(/\r?\n/)[1]?.split(",")[index]?.trim()]));
      document.querySelector("#pharmacyLatitude").value = location.latitude || location.lat || "";
      document.querySelector("#pharmacyLongitude").value = location.longitude || location.lng || location.lon || "";
      document.querySelector("#pharmacyAddress").value = location.address || document.querySelector("#pharmacyAddress").value;
    } catch {
      document.querySelector("#pharmacyStatus").textContent = "Không đọc được dữ liệu vị trí. Dùng JSON hoặc CSV có cột latitude, longitude.";
    }
  };
  reader.readAsText(file);
});

addListener(document.querySelector("#pharmacyForm"), "submit", (event) => {
  event.preventDefault();
  const data = getOwnerData();
  data.pharmacy = {
    ...data.pharmacy,
    name: document.querySelector("#pharmacyName").value.trim(),
    address: document.querySelector("#pharmacyAddress").value.trim(),
    latitude: document.querySelector("#pharmacyLatitude").value,
    longitude: document.querySelector("#pharmacyLongitude").value,
  };
  const image = document.querySelector("#pharmacyPreview").src;
  if (image) data.pharmacy.image = image;
  saveOwnerData(data);
  document.querySelector("#pharmacyStatus").textContent = "Đã lưu thông tin hiệu thuốc.";
});

addListener(document.querySelector("#editRequestButton"), "click", () => {
  document.querySelector("#pharmacyStatus").textContent = "Đã gửi yêu cầu chỉnh sửa. Ban quản trị sẽ phản hồi sớm.";
});

addListener(document.querySelector("#medicineForm"), "submit", (event) => {
  event.preventDefault();
  const data = getOwnerData();
  const id = document.querySelector("#medicineId").value;
  const medicine = { id: id || Date.now().toString(), name: document.querySelector("#medicineName").value.trim(), quantity: document.querySelector("#medicineQuantity").value, price: document.querySelector("#medicinePrice").value };
  data.medicines = id ? data.medicines.map((item) => item.id === id ? medicine : item) : [...data.medicines, medicine];
  saveOwnerData(data);
  event.target.reset();
  document.querySelector("#medicineId").value = "";
  document.querySelector("#medicineSubmit").textContent = "Thêm thuốc";
  renderOwnerDashboard();
});

function updateOrderTotal() {
  const data = getOwnerData();
  const medicine = data.medicines.find((item) => item.id === document.querySelector("#orderMedicine").value);
  const quantity = Number(document.querySelector("#orderQuantity").value) || 0;
  if (medicine) document.querySelector("#orderTotal").value = Number(medicine.price) * quantity;
}

addListener(document.querySelector("#orderMedicine"), "change", updateOrderTotal);
addListener(document.querySelector("#orderQuantity"), "input", updateOrderTotal);

addListener(document.querySelector("#medicineList"), "click", (event) => {
  const data = getOwnerData();
  const editId = event.target.dataset.editMedicine;
  const deleteId = event.target.dataset.deleteMedicine;
  if (editId) {
    const medicine = data.medicines.find((item) => item.id === editId);
    document.querySelector("#medicineId").value = medicine.id;
    document.querySelector("#medicineName").value = medicine.name;
    document.querySelector("#medicineQuantity").value = medicine.quantity;
    document.querySelector("#medicinePrice").value = medicine.price;
    document.querySelector("#medicineSubmit").textContent = "Lưu thay đổi";
  }
  if (deleteId) {
    saveOwnerData({ ...data, medicines: data.medicines.filter((item) => item.id !== deleteId) });
    renderOwnerDashboard();
  }
});

addListener(document.querySelector("#orderForm"), "submit", (event) => {
  event.preventDefault();
  const data = getOwnerData();
  const selectedMedicine = data.medicines.find((item) => item.id === document.querySelector("#orderMedicine").value);
  if (!selectedMedicine) return;
  const order = {
    id: Date.now().toString().slice(-6),
    customer: document.querySelector("#orderCustomer").value.trim(),
    medicine: selectedMedicine.name,
    quantity: document.querySelector("#orderQuantity").value,
    total: document.querySelector("#orderTotal").value,
    status: "Chờ xử lý",
  };
  data.orders.unshift(order);
  data.invoices.unshift({ id: order.id, customer: order.customer, total: order.total, date: new Date().toLocaleDateString("vi-VN") });
  saveOwnerData(data);
  event.target.reset();
  renderOwnerDashboard();
});

function pharmacyMarkup(pharmacy, index) {
  return `
    <article>
      <div class="marker">${index + 1}</div>
      <div>
        <h3>${pharmacy.name}</h3>
        <p>${pharmacy.address}</p>
        <small>Đang mở cửa</small>
      </div>
      ${pharmacy.link ? `<a class="pharmacy-link" href="${pharmacy.link}" target="_blank" rel="noreferrer">Trang web</a>` : ""}
    </article>
  `;
}

function renderPharmacies(items) {
  pharmacyList.innerHTML = items.map(pharmacyMarkup).join("");
}

function showSearchSuggestions(value) {
  const query = normalizeText(value.trim());
  const matches = query
    ? pharmacies.filter((pharmacy) => normalizeText(`${pharmacy.name} ${pharmacy.address}`).includes(query))
    : pharmacies;

  pharmacySuggestions.innerHTML = matches.length
    ? matches
        .map(
          (pharmacy) => `
            <div class="pharmacy-suggestion" data-index="${pharmacies.indexOf(pharmacy)}" role="option" tabindex="0">
              <img src="${pharmacy.image}" alt="" />
              <span><strong>${pharmacy.name}</strong><small>${pharmacy.address}</small></span>
              ${pharmacy.link ? `<a class="suggestion-link" href="${pharmacy.link}" target="_blank" rel="noreferrer">Trang web</a>` : ""}
            </div>
          `,
        )
        .join("")
    : '<p class="no-suggestions">Không tìm thấy nhà thuốc phù hợp.</p>';

  pharmacySuggestions.classList.remove("hidden");
  pharmacySearch.setAttribute("aria-expanded", "true");
}

function selectPharmacy(pharmacy) {
  pharmacySearch.value = pharmacy.name;
  pharmacySuggestions.classList.add("hidden");
  pharmacySearch.setAttribute("aria-expanded", "false");
  resultNote.textContent = "Kết quả tìm kiếm";
  results.classList.remove("hidden");
  renderPharmacies([pharmacy]);
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

renderPharmacies(pharmacies);

addListener(pharmacySearch, "focus", () => showSearchSuggestions(pharmacySearch.value));
addListener(pharmacySearch, "input", () => showSearchSuggestions(pharmacySearch.value));
addListener(pharmacySuggestions, "click", (event) => {
  const item = event.target.closest(".pharmacy-suggestion");
  if (item && !event.target.closest(".suggestion-link")) selectPharmacy(pharmacies[Number(item.dataset.index)]);
});
addListener(pharmacySuggestions, "keydown", (event) => {
  const item = event.target.closest(".pharmacy-suggestion");
  if (item && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    selectPharmacy(pharmacies[Number(item.dataset.index)]);
  }
});
addListener(document, "click", (event) => {
  if (!event.target.closest(".pharmacy-search")) {
    pharmacySuggestions.classList.add("hidden");
    pharmacySearch.setAttribute("aria-expanded", "false");
  }
});

tabs.forEach((tab) => {
  addListener(tab, "click", () => {
    tabs.forEach((item) => item.classList.remove("active"));
    panels.forEach((panel) => panel.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`#${tab.dataset.tab}`).classList.add("active");
    statusText.textContent = "";
  });
});

addListener(fileInput, "change", () => {
  const file = fileInput.files[0];
  if (!file) return;

  uploadText.textContent = file.name;
  preview.src = URL.createObjectURL(file);
  preview.style.display = "block";
  prescriptionButton.disabled = false;
});

addListener(medicineInput, "input", () => {
  prescriptionButton.disabled = !medicineInput.value.trim() && !fileInput.files.length;
});

document.querySelectorAll(".symptom-list button").forEach((button) => {
  addListener(button, "click", () => {
    document.querySelectorAll(".symptom-list button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    const selected = symptomSuggestions[button.dataset.symptom];
    suggestionTitle.textContent = selected.title;
    suggestionText.textContent = selected.text;
    suggestion.classList.remove("hidden");
  });
});

addListener(widgetTrigger, "click", () => symptomWidget.classList.toggle("hidden"));
addListener(document.querySelector("#closeWidget"), "click", () => symptomWidget.classList.add("hidden"));


// Đọc bán kính từ bộ lọc trên giao diện (đơn vị mét).
function getSearchRadius() {
  const radiusSelect = document.querySelector("#searchRadius");
  const radius = Number(radiusSelect?.value);
  // Mặc định 3 km nếu bộ lọc chưa có hoặc giá trị không hợp lệ.
  return Number.isFinite(radius) && radius > 0 ? radius : 3000;
}

function formatRadius(radiusInMeters) {
  const km = Number(radiusInMeters) / 1000;
  return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}

function findPharmacies(mode = "normal") {
  statusText.textContent = "Đang xác định vị trí...";

  if (!navigator.geolocation) {
    statusText.textContent = "Trình duyệt không hỗ trợ định vị.";
    return;
  }

  navigator.geolocation.getCurrentPosition(async (position) => {
    const origin = {
      lat: position.coords.latitude,
      lon: position.coords.longitude
    };

    try {
      statusText.textContent = "Đang tìm nhà thuốc gần bạn...";
      const radius = getSearchRadius();
      const nearby = await fetchNearbyPharmacies(origin.lat, origin.lon, radius);

      initializePharmacyMap(origin.lat, origin.lon, 14);
      renderMapPharmacies(nearby, mode === "normal" ? "current" : "prescription", origin);

      const heading = document.querySelector(".results-title h2");
      if (heading) {
        heading.textContent = mode === "normal"
          ? "Nhà thuốc gần vị trí của bạn"
          : "Nhà thuốc gần bạn có thể kiểm tra thuốc cần tìm";
      }

      resultNote.textContent = mode === "normal"
        ? "Chọn nhà thuốc để xem đường đi"
        : "Vui lòng xác nhận thuốc còn hàng với nhà thuốc";

      results.classList.remove("hidden");
      symptomWidget.classList.add("hidden");

      statusText.textContent = nearby.length
        ? `Tìm thấy ${nearby.length} nhà thuốc có dữ liệu trong bán kính ${formatRadius(radius)}.`
        : "Không tìm thấy nhà thuốc có dữ liệu gần bạn.";

      results.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      statusText.textContent = error.message || "Không thể tìm nhà thuốc lúc này.";
    }
  }, () => {
    statusText.textContent = "Không thể lấy vị trí. Bạn có thể nhập địa chỉ thay thế.";
  }, {
    enableHighAccuracy: true,
    timeout: 12000,
    maximumAge: 60000
  });
}

addListener(
  document.querySelector(".panel#normal .find-button"),
  "click",
  () => findPharmacies("normal")
);
addListener(prescriptionButton, "click", () => findPharmacies("prescription"));
addListener(
  document.querySelector("#suggestionButton"),
  "click",
  () => findPharmacies("symptom")
);

if (isAdminRoute) showAdminLogin();

const addressInput = document.querySelector("#addressInput");
const addressSearchButton = document.querySelector("#addressSearchButton");
const mapElement = document.querySelector("#map");

let pharmacyMap = null;
let pharmacyMarkers = [];
let userMarker = null;
let routeLayer = null;

function escapeAddressHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function initializePharmacyMap(latitude, longitude, zoom = 14) {
  if (!mapElement) {
    throw new Error("Không tìm thấy phần tử #map trong index.html.");
  }

  if (typeof L === "undefined") {
    throw new Error("Leaflet chưa được tải. Hãy kiểm tra index.html.");
  }

  mapElement.classList.add("map-visible");

  if (!pharmacyMap) {
    pharmacyMap = L.map("map").setView([latitude, longitude], zoom);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(pharmacyMap);
  } else {
    pharmacyMap.setView([latitude, longitude], zoom);
  }

  window.setTimeout(() => pharmacyMap.invalidateSize(), 150);
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const rad = (value) => value * Math.PI / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) *
    Math.cos(rad(lat2)) *
    Math.sin(dLon / 2) ** 2;

  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Kiểm tra điểm có nằm trong một vòng đa giác hay không (tọa độ GeoJSON: [lon, lat]).
function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, polygonCoordinates) {
  if (!polygonCoordinates?.length || !pointInRing(point, polygonCoordinates[0])) return false;
  // Các vòng bên trong là lỗ của polygon.
  return !polygonCoordinates.slice(1).some((ring) => pointInRing(point, ring));
}

function pointInGeoJSON(point, geometry) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") return pointInPolygon(point, geometry.coordinates);
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) => pointInPolygon(point, polygon));
  }
  return false;
}

function getGeoJSONRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

// Khoảng cách từ một điểm đến đoạn biên, xấp xỉ theo mặt phẳng cục bộ (đủ chính xác cho vài km).
function distanceToSegmentKm(point, start, end) {
  const lat0 = point[1] * Math.PI / 180;
  const kmPerLon = 111.32 * Math.cos(lat0);
  const kmPerLat = 110.574;
  const px = (point[0] - start[0]) * kmPerLon;
  const py = (point[1] - start[1]) * kmPerLat;
  const sx = 0;
  const sy = 0;
  const ex = (end[0] - start[0]) * kmPerLon;
  const ey = (end[1] - start[1]) * kmPerLat;
  const dx = ex - sx;
  const dy = ey - sy;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / lengthSquared)) : 0;
  return Math.hypot(px - (sx + t * dx), py - (sy + t * dy));
}

function distanceToGeoJSONAreaKm(latitude, longitude, geometry) {
  const point = [longitude, latitude];
  if (pointInGeoJSON(point, geometry)) return 0;
  let minimum = Infinity;
  for (const ring of getGeoJSONRings(geometry)) {
    for (let i = 0; i < ring.length - 1; i++) {
      minimum = Math.min(minimum, distanceToSegmentKm(point, ring[i], ring[i + 1]));
    }
  }
  return minimum;
}

function getGeoJSONBounds(geometry) {
  const coordinates = [];
  const collect = (value) => {
    if (Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number") {
      coordinates.push(value);
    } else if (Array.isArray(value)) {
      value.forEach(collect);
    }
  };
  collect(geometry?.coordinates || []);
  if (!coordinates.length) return null;
  return coordinates.reduce((bounds, [lon, lat]) => ({
    south: Math.min(bounds.south, lat), west: Math.min(bounds.west, lon),
    north: Math.max(bounds.north, lat), east: Math.max(bounds.east, lon)
  }), { south: Infinity, west: Infinity, north: -Infinity, east: -Infinity });
}

async function fetchPharmaciesNearGeoJSONArea(geometry, radius = 3000) {
  const bounds = getGeoJSONBounds(geometry);
  if (!bounds) throw new Error("Địa chỉ này không có dữ liệu ranh giới. Hãy nhập địa chỉ cụ thể hơn hoặc chọn điểm trên bản đồ.");

  const paddingLat = (radius / 1000) / 110.574;
  const middleLat = (bounds.south + bounds.north) / 2;
  const paddingLon = (radius / 1000) / Math.max(1, 111.32 * Math.cos(middleLat * Math.PI / 180));
  const south = bounds.south - paddingLat;
  const west = bounds.west - paddingLon;
  const north = bounds.north + paddingLat;
  const east = bounds.east + paddingLon;
  const bbox = `${south},${west},${north},${east}`;
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"="pharmacy"](${bbox});
      way["amenity"="pharmacy"](${bbox});
      relation["amenity"="pharmacy"](${bbox});
    );
    out center tags;
  `;
  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: query })
  });
  if (!response.ok) throw new Error("Máy chủ dữ liệu nhà thuốc đang bận. Hãy thử lại sau.");
  const data = await response.json();
  return data.elements.map((item) => {
    const lat = item.lat ?? item.center?.lat;
    const lon = item.lon ?? item.center?.lon;
    const tags = item.tags || {};
    if (lat == null || lon == null) return null;
    const distance = distanceToGeoJSONAreaKm(Number(lat), Number(lon), geometry);
    if (distance > radius / 1000) return null;
    return {
      name: tags.name || tags["name:vi"] || "Nhà thuốc chưa có tên",
      address: [tags["addr:housenumber"], tags["addr:street"], tags["addr:suburb"] || tags["addr:district"], tags["addr:city"]].filter(Boolean).join(", ") || "Chưa có địa chỉ chi tiết",
      lat: Number(lat), lon: Number(lon), distance
    };
  }).filter(Boolean).sort((a, b) => a.distance - b.distance);
}

async function fetchNearbyPharmacies(latitude, longitude, radius = 3000) {
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"="pharmacy"](around:${radius},${latitude},${longitude});
      way["amenity"="pharmacy"](around:${radius},${latitude},${longitude});
      relation["amenity"="pharmacy"](around:${radius},${latitude},${longitude});
    );
    out center tags;
  `;

  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ data: query })
  });

  if (!response.ok) {
    throw new Error("Máy chủ dữ liệu nhà thuốc đang bận. Hãy thử lại sau.");
  }

  const data = await response.json();

  return data.elements.map((item) => {
    const lat = item.lat ?? item.center?.lat;
    const lon = item.lon ?? item.center?.lon;
    const tags = item.tags || {};

    if (lat == null || lon == null) return null;

    return {
      name: tags.name || tags["name:vi"] || "Nhà thuốc chưa có tên",
      address: [
        tags["addr:housenumber"],
        tags["addr:street"],
        tags["addr:suburb"] || tags["addr:district"],
        tags["addr:city"]
      ].filter(Boolean).join(", ") || "Chưa có địa chỉ chi tiết",
      lat: Number(lat),
      lon: Number(lon),
      distance: calculateDistanceKm(
        latitude, longitude, Number(lat), Number(lon)
      )
    };
  }).filter(Boolean).sort((a, b) => a.distance - b.distance);
}

function clearMapLayers() {
  pharmacyMarkers.forEach((marker) => marker.remove());
  pharmacyMarkers = [];

  if (userMarker) {
    userMarker.remove();
    userMarker = null;
  }

  if (routeLayer) {
    routeLayer.remove();
    routeLayer = null;
  }
}

function renderMapPharmacies(items, mode, origin = null) {
  clearMapLayers();

  if (mode === "current" && origin) {
    userMarker = L.circleMarker([origin.lat, origin.lon], {
      radius: 9,
      color: "#ffffff",
      weight: 3,
      fillColor: "#2563c9",
      fillOpacity: 1
    }).addTo(pharmacyMap).bindPopup("Vị trí của bạn");
  }

  pharmacyList.innerHTML = "";

  items.forEach((pharmacy, index) => {
    const marker = L.marker([pharmacy.lat, pharmacy.lon]).addTo(pharmacyMap);

    marker.bindPopup(
      `<strong>${escapeAddressHtml(pharmacy.name)}</strong><br>${escapeAddressHtml(pharmacy.address)}`
    );

    pharmacyMarkers.push(marker);

    const article = document.createElement("article");
    const distanceLine = mode === "current"
      ? `<small>Cách bạn khoảng ${pharmacy.distance.toFixed(2)} km (đường chim bay)</small>`
      : "";

    article.innerHTML = `
      <div class="marker">${index + 1}</div>
      <div>
        <h3>${escapeAddressHtml(pharmacy.name)}</h3>
        <p>${escapeAddressHtml(pharmacy.address)}</p>
        ${distanceLine}
      </div>
      ${mode === "current"
        ? '<button class="primary route-button" type="button">Đường đi</button>'
        : ""}
    `;

    marker.on("click", () => marker.openPopup());

    if (mode === "current" && origin) {
      article.querySelector(".route-button").addEventListener("click", () => {
        showPharmacyRoute(origin, pharmacy);
      });
    }

    pharmacyList.appendChild(article);
  });

  const points = items.map((item) => [item.lat, item.lon]);
  if (origin) points.push([origin.lat, origin.lon]);

  if (points.length) {
    pharmacyMap.fitBounds(L.latLngBounds(points), {
      padding: [30, 30],
      maxZoom: 15
    });
  } else if (origin) {
    pharmacyMap.setView([origin.lat, origin.lon], 14);
  }
}

async function showPharmacyRoute(origin, destination) {
  try {
    statusText.textContent = "Đang tìm đường đi...";

    if (routeLayer) routeLayer.remove();

    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${origin.lon},${origin.lat};${destination.lon},${destination.lat}` +
      `?overview=full&geometries=geojson`;

    const response = await fetch(url);
    if (!response.ok) throw new Error("Không lấy được tuyến đường.");

    const data = await response.json();
    const route = data.routes?.[0];

    if (!route) throw new Error("Không tìm thấy tuyến đường.");

    routeLayer = L.geoJSON(route.geometry, {
      style: { color: "#2563c9", weight: 5 }
    }).addTo(pharmacyMap);

    pharmacyMap.fitBounds(routeLayer.getBounds(), { padding: [35, 35] });

    statusText.textContent =
      `Quãng đường đi khoảng ${(route.distance / 1000).toFixed(2)} km · ` +
      `thời gian lái xe ước tính ${Math.round(route.duration / 60)} phút.`;
  } catch (error) {
    statusText.textContent =
      error.message || "Không lấy được tuyến đường. Hãy thử lại sau.";
  }
}

async function searchPharmaciesByAddress() {
  const query = addressInput?.value.trim();

  if (!query || query.length < 2) {
    statusText.textContent = "Vui lòng nhập phường hoặc địa chỉ muốn tìm.";
    addressInput?.focus();
    return;
  }

  addressSearchButton.disabled = true;
  results.classList.add("hidden");
  statusText.textContent = "Đang tìm địa chỉ...";

  try {
    const geocodeUrl = new URL(
      "https://nominatim.openstreetmap.org/search"
    );

    geocodeUrl.search = new URLSearchParams({
      q: `${query}, Việt Nam`,
      format: "jsonv2",
      limit: "1",
      countrycodes: "vn",
      polygon_geojson: "1",
      addressdetails: "1"
    });

    const geocodeResponse = await fetch(geocodeUrl);

    if (!geocodeResponse.ok) {
      throw new Error("Dịch vụ tìm địa chỉ đang bận.");
    }

    const locations = await geocodeResponse.json();

    if (!locations.length) {
      statusText.textContent = "Không tìm thấy địa chỉ. Hãy thử nhập rõ hơn.";
      return;
    }

    const location = locations[0];
    const latitude = Number(location.lat);
    const longitude = Number(location.lon);

    statusText.textContent = "Đang tìm nhà thuốc trong khu vực...";

    const radius = getSearchRadius();
    const isAreaSearch = ["administrative", "boundary"].includes(location.type) ||
      ["administrative", "boundary"].includes(location.class);
    const hasAreaGeometry = location.geojson &&
      ["Polygon", "MultiPolygon"].includes(location.geojson.type);
    const nearbyPharmacies = isAreaSearch && hasAreaGeometry
      ? await fetchPharmaciesNearGeoJSONArea(location.geojson, radius)
      : await fetchNearbyPharmacies(latitude, longitude, radius);

    // Với khu vực có ranh giới, đặt bản đồ theo khung khu vực thay vì coi tâm địa danh là điểm gốc.
    if (isAreaSearch && hasAreaGeometry) {
      const bounds = getGeoJSONBounds(location.geojson);
      initializePharmacyMap((bounds.south + bounds.north) / 2, (bounds.west + bounds.east) / 2, 13);
      const leafletBounds = L.latLngBounds(
        [bounds.south, bounds.west], [bounds.north, bounds.east]
      );
      pharmacyMap.fitBounds(leafletBounds, { padding: [25, 25] });
    } else {
      initializePharmacyMap(latitude, longitude, 13);
    }
    renderMapPharmacies(nearbyPharmacies, "address");

    const resultsTitle = document.querySelector(".results-title h2");
    if (resultsTitle) {
      resultsTitle.textContent = "Nhà thuốc quanh địa chỉ đã chọn";
    }

    resultNote.textContent = isAreaSearch && hasAreaGeometry
      ? `Trong khu vực ${location.display_name} và phạm vi ${formatRadius(radius)} tính từ ranh giới khu vực.`
      : `${formatRadius(radius)} quanh: ${location.display_name}`;
    results.classList.remove("hidden");

    statusText.textContent = nearbyPharmacies.length
      ? `Tìm thấy ${nearbyPharmacies.length} nhà thuốc ${isAreaSearch && hasAreaGeometry ? `trong khu vực và cách ranh giới không quá ${formatRadius(radius)}` : `trong bán kính ${formatRadius(radius)}`}.`
      : "Không tìm thấy nhà thuốc có dữ liệu quanh địa chỉ này.";

    results.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    statusText.textContent =
      error.message || "Có lỗi khi tìm kiếm địa chỉ.";
  } finally {
    addressSearchButton.disabled = false;
  }
}

addListener(addressSearchButton, "click", searchPharmaciesByAddress);

addListener(addressInput, "keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    searchPharmaciesByAddress();
  }
});
