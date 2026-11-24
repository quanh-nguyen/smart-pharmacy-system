import { getMedicineOrders, renderOwnerOnlineOrders, startOwnerOrderWatch, stopOwnerOrderWatch } from "./medicine-order.js";
import { fetchRoadDistances, fetchRoadRoute } from "./routing.js";
import { demoOrigin, demoPharmacies, openPharmacyOrder, openCheckoutHistory, getCheckoutOrders, showInvoice } from "./checkout.js";

import { apiEnabled, apiRequest, getSession, saveSession, signIn, signOut } from "./api-client.js";
import { renderApiHistory } from "./customer-api.js";
import { boundsContain, findPharmacyCatalog, getMapCoordinates, getSearchBounds, prefetchPharmacyCatalog, validBounds } from "./pharmacy-catalog.js";
import { matchesMedicine, medicineLabel, parseMedicineList, readPrescriptionImage } from "./prescription.js";

let mapResultsVersion = 0;
let routeRequestVersion = 0;
let displayedMapResults = null;

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
const removePrescriptionImage = document.querySelector("#removePrescriptionImage");
const retryPrescriptionOcr = document.querySelector("#retryPrescriptionOcr");
const prescriptionOcrStatus = document.querySelector("#prescriptionOcrStatus");
const prescriptionRawDetails = document.querySelector('#prescriptionRawDetails');
const prescriptionRawText = document.querySelector('#prescriptionRawText');
const openPrescriptionImage = document.querySelector('#openPrescriptionImage');
const prescriptionMedicines = document.querySelector("#prescriptionMedicines");
const confirmPrescriptionMedicines = document.querySelector("#confirmPrescriptionMedicines");
let prescriptionImageUrl = null;
let prescriptionOcrController = null;
let prescriptionRevision = 0;
let prescriptionReviewItems = new Map();
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
const customerDashboard = document.querySelector("#customerDashboard");
const customerNameField = document.querySelector("#customerNameField");
const customerNameInput = document.querySelector("#authCustomerName");
let activeCustomer = (() => {
  try {
    if (apiEnabled) {
      const user = getSession()?.user;
      return user?.role === "CUSTOMER" ? { ...user, role: "customer" } : null;
    }
    const saved = sessionStorage.getItem("smartPharmacyActiveCustomer");
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
})();
const customerNavGreeting = document.querySelector("#customerNavGreeting");
const customerLoginButton = document.querySelector("#customerLoginButton");
const customerRegisterButton = document.querySelector("#customerRegisterButton");
const customerHistoryButton = document.querySelector("#customerHistoryButton");

function updateCustomerHeader() {
  const loggedIn = Boolean(activeCustomer && activeCustomer.role === "customer");
  customerLoginButton?.classList.toggle("hidden", loggedIn);
  customerRegisterButton?.classList.toggle("hidden", loggedIn);
  customerHistoryButton?.classList.toggle("hidden", !loggedIn);
  if (customerNavGreeting) {
    customerNavGreeting.classList.toggle("hidden", !loggedIn);
    customerNavGreeting.textContent = loggedIn
      ? `Xin chào, ${activeCustomer.name || activeCustomer.email}`
      : "";
  }
}
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
    name: "Nhà thuốc Trung Sơn",
    address: "Hệ thống nhà thuốc Trung Sơn · website chính thức",
    image: "",
    link: "https://trungsoncare.com/",
  },
  {
    name: "Phano Pharmacy",
    address: "Hệ thống nhà thuốc Phano · website chính thức",
    image: "",
    link: "https://phanopharmacy.com/",
  },
  {
    name: "Nhà thuốc ECO Pharma",
    address: "Hệ thống nhà thuốc ECO Pharma · website chính thức",
    image: "",
    link: "https://ecopharma.com.vn/",
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

function ensureTestOwnerAccount() {
  const allData = JSON.parse(localStorage.getItem(dashboardDataKey) || "{}");
  if (!allData.test) {
    allData.test = {
      pharmacy: {
        name: "Nhà thuốc Test",
        address: "12 Đường Trải Nghiệm, Hoàn Kiếm, Hà Nội",
        latitude: "21.032",
        longitude: "105.848",
      },
      medicines: [],
      orders: [],
      invoices: [],
    };
    localStorage.setItem(dashboardDataKey, JSON.stringify(allData));
  }
}

function getOwnerData() {
  const allData = JSON.parse(localStorage.getItem(dashboardDataKey) || "{}");
  if (activeOwnerEmail === "test" && !allData.test) ensureTestOwnerAccount();
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
  renderOwnerOnlineOrders(data.pharmacy);
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
  startOwnerOrderWatch(() => getOwnerData().pharmacy);
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
  customerNameField.classList.toggle("hidden", mode !== "register" || selectedRole !== "customer");
  customerNameInput.required = mode === "register" && selectedRole === "customer";
  authStatus.textContent = "";
  authForm.reset();
  document.querySelector(".account-types").classList.toggle("hidden", isAdminRoute);
  authModal.classList.remove("hidden");
  authEmail.focus();
}

addListener(adminLoginButton, "click", () => openAuth("login"));
addListener(customerLoginButton, "click", () => { selectedRole = "customer"; openAuth("login"); });
addListener(customerRegisterButton, "click", () => { selectedRole = "customer"; openAuth("register"); });

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
    customerNameField.classList.toggle("hidden", authMode !== "register" || selectedRole !== "customer");
    customerNameInput.required = authMode === "register" && selectedRole === "customer";
  });
});
addListener(authForm, "submit", async (event) => {
  event.preventDefault();
  const email = authEmail.value.trim().toLowerCase();
  const password = authPassword.value;

  // Tài khoản demo dùng chung tên đăng nhập/mật khẩu "test"; vai trò được chọn ở giao diện.
  if (!isAdminRoute && authMode === "login" && email === "test" && password === "test") {
    authForm.reset();
    authModal.classList.add("hidden");
    if (selectedRole === "owner") {
      activeOwnerEmail = "test";
      ensureTestOwnerAccount();
      openOwnerDashboard();
    } else {
      activeCustomer = { email: "test", name: "Khách hàng Test", role: "customer" };
      sessionStorage.setItem("smartPharmacyActiveCustomer", JSON.stringify(activeCustomer));
      updateCustomerHeader();
      openCustomerDashboard();
    }
    return;
  }

  if (apiEnabled) {
    if (selectedRole === "owner") { window.location.href = new URL("./pharmacy/", window.location.href); return; }
    authSubmit.disabled = true;
    try {
      const data = await signIn(email, password, { register: authMode === "register", role: "CUSTOMER", name: customerNameInput.value.trim() });
      if (data.user?.role !== "CUSTOMER") {
        window.location.href = new URL(data.user?.role === "ADMIN" || data.mfaEnrollmentRequired ? "./admin/" : "./pharmacy/", window.location.href);
        return;
      }
      activeCustomer = { ...data.user, role: "customer" };
      authForm.reset(); updateCustomerHeader(); authModal.classList.add("hidden"); openCustomerDashboard();
    } catch (error) { authStatus.textContent = error.message; }
    finally { authSubmit.disabled = false; }
    return;
  }
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
    const name = selectedRole === "customer" ? customerNameInput.value.trim() : "";
    accounts.push({ email, password, role: selectedRole, name, createdAt: new Date().toISOString() });
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
  authForm.reset();
  if (selectedRole === "owner") {
    authStatus.textContent = "Đăng nhập thành công với tài khoản chủ cửa hàng.";
    activeOwnerEmail = email;
    openOwnerDashboard();
    return;
  }
  activeCustomer = account;
  sessionStorage.setItem("smartPharmacyActiveCustomer", JSON.stringify(account));
  updateCustomerHeader();
  authModal.classList.add("hidden");
  openCustomerDashboard();
});

function openCustomerDashboard() {
  if (activeCustomer?.role !== "customer") return;
  document.querySelector("main").classList.add("hidden");
  document.querySelector(".hero")?.classList.add("hidden");
  document.querySelector(".symptom-widget")?.classList.add("hidden");
  document.querySelector("footer")?.classList.add("hidden");
  ownerDashboard?.classList.add("hidden");
  adminDashboard?.classList.add("hidden");
  customerDashboard.classList.remove("hidden");
  document.querySelector("#customerWelcome").textContent = `Xin chào ${activeCustomer?.name || activeCustomer?.email || "khách hàng"}. Đây là lịch sử đơn thuốc của bạn.`;
  renderCustomerHistory();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderCustomerHistory() {
  if (apiEnabled) return renderApiHistory();
  const allData = getAllOwnerData();
  const email = (activeCustomer?.email || "").toLowerCase();
  const name = normalizeText(activeCustomer?.name || "");
  let checkoutOrders = [];
  try {
    checkoutOrders = getCheckoutOrders(email).map((order) => ({
      ...order, pharmacyName: order.pharmacy.name,
      medicine: order.items.map((item) => `${item.name} × ${item.quantity}`).join(", "),
      date: new Date(order.createdAt).toLocaleString("vi-VN"), checkoutOrder: order,
    }));
  } catch { /* Checkout history shows its own storage error. */ }
  const ownerOrders = Object.values(allData)
    .flatMap((ownerData) => (ownerData.orders || []).map((order) => ({ ...order, pharmacyName: ownerData.pharmacy?.name || "Nhà thuốc" })))
    .filter((order) => String(order.customerEmail || "").toLowerCase() === email || (name && normalizeText(order.customer || "") === name));
  const orders = [...ownerOrders, ...checkoutOrders]
    .sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0));
  document.querySelector("#customerHistoryCount").textContent = `${orders.length} đơn`;
  document.querySelector("#customerOrderHistory").innerHTML = orders.length ? orders.map((order) => `
    <article class="customer-order-card"><div class="customer-order-top"><strong>Đơn thuốc #${escapeHtml(order.id)}</strong><span class="order-status">${escapeHtml(order.status || "Đang xử lý")}</span></div><p><strong>Nhà thuốc:</strong> ${escapeHtml(order.pharmacyName)}</p><p><strong>Thuốc:</strong> ${escapeHtml(order.medicine || "Chưa có thông tin")}${order.quantity ? ` · Số lượng: ${escapeHtml(order.quantity)}` : ""}</p><div class="customer-order-bottom"><span>${escapeHtml(order.date || order.createdAt || "Chưa có ngày")}</span><strong>${Number(order.total || 0).toLocaleString("vi-VN")} VNĐ</strong>${order.checkoutOrder ? `<button class="row-action" type="button" data-customer-invoice="${escapeHtml(order.id)}">Xem hóa đơn</button>` : ""}</div></article>
  `).join("") : '<div class="customer-history-empty"><span>▤</span><h3>Chưa có lịch sử đơn thuốc</h3><p>Các đơn được ghi nhận bằng đúng email hoặc họ tên của bạn sẽ xuất hiện tại đây.</p></div>';
}

function returnToPharmacySearch() {
  customerDashboard.classList.add("hidden");
  document.querySelector("main").classList.remove("hidden");
  document.querySelector(".hero")?.classList.remove("hidden");
  document.querySelector(".symptom-widget")?.classList.remove("hidden");
  document.querySelector("footer")?.classList.remove("hidden");
  const restored = restorePharmacySearchState();
  window.requestAnimationFrame(() => pharmacyMap?.invalidateSize());
  if (!restored) window.scrollTo({ top: 0, behavior: "smooth" });
}

addListener(document.querySelector("#customerLogoutButton"), "click", async () => {
  if (apiEnabled) { try { await signOut(); } catch (error) { console.warn(error.message); } }
  activeCustomer = null;
  sessionStorage.removeItem("smartPharmacyActiveCustomer");
  updateCustomerHeader();
  returnToPharmacySearch();
});
addListener(document.querySelector("#backToSearchButton"), "click", returnToPharmacySearch);
addListener(customerHistoryButton, "click", openCustomerDashboard);
addListener(document.querySelector("#checkoutHistoryButton"), "click", () => openCheckoutHistory(activeCustomer));
addListener(document.querySelector("#customerOrderHistory"), "click", (event) => {
  const button = event.target.closest("[data-customer-invoice]");
  if (!button) return;
  const order = getCheckoutOrders(activeCustomer?.email).find((item) => item.id === button.dataset.customerInvoice);
  if (order) showInvoice(order);
});
addListener(document, "pharmacy-order-created", () => { if (activeCustomer) renderCustomerHistory(); });
addListener(document, "pharmacy-order-updated", () => { if (activeCustomer) renderCustomerHistory(); });

document.querySelectorAll(".dashboard-tab").forEach((tab) => {
  addListener(tab, "click", () => {
    document.querySelectorAll(".dashboard-tab").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".dashboard-panel").forEach((panel) => panel.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`#${tab.dataset.dashboardTab}`).classList.add("active");
  });
});

addListener(document.querySelector("#ownerLogout"), "click", () => {
  stopOwnerOrderWatch();
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
    customerEmail: document.querySelector("#orderCustomerEmail").value.trim().toLowerCase(),
    medicine: selectedMedicine.name,
    date: new Date().toLocaleDateString("vi-VN"),
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

let activeSuggestionIndex = -1;
const pharmacySearchClear = document.querySelector("#pharmacySearchClear");

const testPharmacySuggestion = {
  name: "Nhà thuốc Test",
  address: "Bấm để xem thuốc và đặt hàng thử nghiệm",
  image: "",
  link: "",
  isTestAccount: true,
};

function getPharmacyMatches(value) {
  const query = normalizeText(value.trim());
  const terms = query.split(/\s+/).filter(Boolean);
  return pharmacies
    .map((pharmacy, originalIndex) => ({ pharmacy, originalIndex }))
    // Chỉ hiển thị nhà thuốc có website chính thức trong gợi ý tìm kiếm.
    .filter(({ pharmacy }) => /^https:\/\/[^\s]+/i.test(pharmacy.link || ""))
    .map(({ pharmacy, originalIndex }) => {
      const name = normalizeText(pharmacy.name);
      const address = normalizeText(pharmacy.address);
      const searchable = `${name} ${address}`;
      if (query && !terms.every((term) => searchable.includes(term))) return null;
      const score = !query ? 0
        : (name === query ? 100 : 0)
          + (name.startsWith(query) ? 50 : 0)
          + (name.includes(query) ? 25 : 0)
          + (address.includes(query) ? 10 : 0);
      return { pharmacy, originalIndex, score, isTestAccount: false };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

function showSearchSuggestions(value) {
  const matches = getPharmacyMatches(value);
  // Tài khoản demo luôn nằm cuối danh sách, không bị bộ lọc từ khóa loại bỏ.
  matches.push({ pharmacy: testPharmacySuggestion, originalIndex: -1, score: -1, isTestAccount: true });
  activeSuggestionIndex = -1;

  pharmacySuggestions.innerHTML =
    `<p class="suggestion-caption">${value.trim() ? "Nhà thuốc có website phù hợp" : "Nhà thuốc có website"}</p>` +
    matches.map(({ pharmacy, originalIndex, isTestAccount }) => `
      <div class="pharmacy-suggestion${isTestAccount ? " pharmacy-suggestion-test" : ""}"
           data-index="${originalIndex}" data-test-account="${isTestAccount ? "true" : "false"}"
           role="option" aria-selected="false" tabindex="-1">
        ${pharmacy.image
          ? `<img src="${escapeHtml(pharmacy.image)}" alt="" loading="lazy" />`
          : `<span class="suggestion-avatar" aria-hidden="true">${isTestAccount ? "T" : "✚"}</span>`}
        <span class="suggestion-copy">
          <strong>${escapeHtml(pharmacy.name)}</strong>
          <small>${escapeHtml(pharmacy.address || "")}</small>
        </span>
        ${isTestAccount
          ? `<span class="suggestion-action">Xem thuốc · Đặt hàng thử</span>`
          : `<span class="suggestion-action">Mở website chính thức ↗</span>`}
      </div>
    `).join("");


  pharmacySuggestions.classList.remove("hidden");
  pharmacySearch.setAttribute("aria-expanded", "true");
  updateSearchClearButton();
}

function updateSearchClearButton() {
  if (pharmacySearchClear) {
    pharmacySearchClear.classList.toggle("hidden", !pharmacySearch.value);
  }
}


function setActiveSuggestion(nextIndex) {
  const items = [...pharmacySuggestions.querySelectorAll(".pharmacy-suggestion")];
  if (!items.length) return;
  activeSuggestionIndex = (nextIndex + items.length) % items.length;
  items.forEach((item, index) => {
    const active = index === activeSuggestionIndex;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-selected", String(active));
  });
  items[activeSuggestionIndex].scrollIntoView({ block: "nearest" });
}

function closeSearchSuggestions() {
  pharmacySuggestions.classList.add("hidden");
  pharmacySearch.setAttribute("aria-expanded", "false");
  activeSuggestionIndex = -1;
}

function selectPharmacy(pharmacy) {
  if (!pharmacy) return;
  pharmacySearch.value = pharmacy.name;
  submitPharmacySearch();
}

async function submitPharmacySearch() {
  if (pharmacySearchBusy) return;
  const query = pharmacySearch.value.trim();
  if (!query) {
    showSearchSuggestions("");
    pharmacySearch.focus();
    return;
  }
  closeSearchSuggestions();
  lowerPharmacySearch();
  updateSearchClearButton();
  if (lastPharmacySearch?.type === "address") {
    await searchPharmaciesByAddress(lastPharmacySearch.location, query);
  } else if (lastPharmacySearch?.origin) {
    await findPharmacies("normal", lastPharmacySearch.origin, query);
  } else if (addressInput.value.trim()) {
    await searchPharmaciesByAddress(null, query);
  } else {
    await findPharmacies("normal", null, query);
  }
}


function raisePharmacySearch() {
  const panel = document.querySelector(".pharmacy-search");
  if (panel) panel.classList.add("is-raised");
}
function lowerPharmacySearch() {
  const panel = document.querySelector(".pharmacy-search");
  if (panel) panel.classList.remove("is-raised");
}

addListener(pharmacySearch, "focus", () => {
  raisePharmacySearch();
  showSearchSuggestions(pharmacySearch.value);
});
addListener(pharmacySearch, "input", () => {
  raisePharmacySearch();
  showSearchSuggestions(pharmacySearch.value);
});
addListener(pharmacySearch, "keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (pharmacySuggestions.classList.contains("hidden")) showSearchSuggestions(pharmacySearch.value);
    setActiveSuggestion(activeSuggestionIndex + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    setActiveSuggestion(activeSuggestionIndex - 1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    const items = [...pharmacySuggestions.querySelectorAll(".pharmacy-suggestion")];
    if (activeSuggestionIndex >= 0 && items[activeSuggestionIndex]) {
      items[activeSuggestionIndex].click();
    } else {
      const firstWebsiteResult = pharmacySuggestions.querySelector(".pharmacy-suggestion:not(.pharmacy-suggestion-test)");
      if (firstWebsiteResult) firstWebsiteResult.click();
      else {
        const hint = pharmacySuggestions.querySelector(".suggestion-caption");
        if (hint) hint.textContent = "Không tìm thấy nhà thuốc có website phù hợp";
      }
    }
  } else if (event.key === "Escape") {
    closeSearchSuggestions();
  }
});
addListener(pharmacySearchClear, "click", () => {
  pharmacySearch.value = "";
  updateSearchClearButton();
  showSearchSuggestions("");
  pharmacySearch.focus();
});
addListener(pharmacySuggestions, "click", (event) => {
  const item = event.target.closest(".pharmacy-suggestion");
  if (!item) return;
  if (item.dataset.testAccount === "true") {
    closeSearchSuggestions();
    lowerPharmacySearch();
    statusText.textContent = "Nhà thuốc thử nghiệm chưa cung cấp số điện thoại liên hệ. Hãy chọn nhà thuốc có thông tin điện thoại để gọi hoặc nhắn tin.";
    return;
  }
  const index = Number(item.dataset.index);
  const pharmacy = pharmacies[index];
  if (pharmacy?.link) {
    window.open(pharmacy.link, "_blank", "noopener,noreferrer");
    closeSearchSuggestions();
    lowerPharmacySearch();
  }
});
addListener(document, "click", (event) => {
  if (!event.target.closest(".pharmacy-search")) {
    closeSearchSuggestions();
    lowerPharmacySearch();
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

function updatePrescriptionControls() {
  const medicines = parseMedicineList(medicineInput.value);
  const reading = Boolean(prescriptionOcrController);
  prescriptionButton.disabled = pharmacySearchBusy || reading || !medicines.length ||
    medicines.length > 30 || !confirmPrescriptionMedicines.checked;
  confirmPrescriptionMedicines.disabled = pharmacySearchBusy || reading || !medicines.length || medicines.length > 30;
  medicineInput.disabled = pharmacySearchBusy || reading;
  fileInput.disabled = pharmacySearchBusy;
  removePrescriptionImage.disabled = pharmacySearchBusy;
  retryPrescriptionOcr.disabled = pharmacySearchBusy || reading;
  prescriptionMedicines.replaceChildren(...medicines.map(item => {
    const li = document.createElement("li");
    li.textContent = medicineLabel(item);
    const review = prescriptionReviewItems.get(medicineLabel(item));
    if (review?.needsReview) {
      li.classList.add("needs-review");
      li.setAttribute('aria-label', `${medicineLabel(item)} — cần đối chiếu ảnh`);
      li.title = `Cần đối chiếu ảnh. Chữ đọc từ ảnh: ${review.rawText}`;
    }
    return li;
  }));
  if (medicines.length > 30) setPrescriptionStatus("Chỉ tìm tối đa 30 loại thuốc mỗi lần. Vui lòng chia nhỏ danh sách.", "error");
}

function setPrescriptionStatus(message, state = "ready") {
  prescriptionOcrStatus.textContent = message;
  prescriptionOcrStatus.dataset.state = state;
}

function invalidatePrescriptionResults(clearReview = true) {
  prescriptionRevision++;
  if (clearReview) prescriptionReviewItems.clear();
  confirmPrescriptionMedicines.checked = false;
  if (lastPharmacySearch?.mode === "prescription") {
    lastPharmacySearch = { ...lastPharmacySearch, mode: "normal" };
    results.classList.add("hidden");
    clearMapLayers();
    pharmacyList.replaceChildren();
    statusText.textContent = "Danh sách thuốc đã thay đổi. Hãy kiểm tra và tìm lại.";
  }
}

function clearPrescriptionImage() {
  prescriptionOcrController?.abort();
  prescriptionOcrController = null;
  if (prescriptionImageUrl) URL.revokeObjectURL(prescriptionImageUrl);
  prescriptionImageUrl = null;
  fileInput.value = "";
  preview.removeAttribute("src");
  preview.style.display = "none";
  prescriptionRawText.value = '';
  prescriptionRawDetails.hidden = true;
  prescriptionRawDetails.open = false;
  openPrescriptionImage.removeAttribute('href');
  openPrescriptionImage.classList.add('hidden');
  uploadText.textContent = "Chụp ảnh đơn thuốc";
  removePrescriptionImage.classList.add("hidden");
  retryPrescriptionOcr.classList.add("hidden");
  medicineInput.value = "";
  invalidatePrescriptionResults();
  updatePrescriptionControls();
}

async function recognizePrescription(file) {
  prescriptionOcrController?.abort();
  const controller = new AbortController();
  prescriptionOcrController = controller;
  medicineInput.value = "";
  prescriptionRawText.value = '';
  prescriptionRawDetails.hidden = true;
  prescriptionRawDetails.open = false;
  invalidatePrescriptionResults();
  setPrescriptionStatus("Đang tải công cụ và đọc ảnh đơn thuốc…", "reading");
  updatePrescriptionControls();
  try {
    const medicines = await readPrescriptionImage(file, {
      signal: controller.signal,
      onProgress: progress => {
        if (prescriptionOcrController === controller) setPrescriptionStatus(`Đang đọc tên thuốc… ${Math.round(progress * 100)}%`, "reading");
      },
      onText: text => {
        if (prescriptionOcrController !== controller) return;
        prescriptionRawText.value = text;
        prescriptionRawDetails.hidden = !text.trim();
      },
    });
    if (prescriptionOcrController !== controller) return;
    medicineInput.value = medicines.map(medicineLabel).join("\n");
    prescriptionReviewItems = new Map(medicines.map(item => [medicineLabel(item), item]));
    const uncertain = medicines.filter(item => item.needsReview).length;
    const numbers = [...new Set(medicines.flatMap(item => item.rowNumbers || []))].sort((a,b)=>a-b);
    const gap = numbers.length > 1 && numbers[0] === 1 && numbers.at(-1) <= 30 && numbers.some((number,index)=>number !== index+1);
    setPrescriptionStatus(medicines.length
      ? `Đã lọc được ${medicines.length} loại thuốc.${uncertain ? ` Có ${uncertain} dòng chưa chắc chắn (màu vàng).` : ""}${gap ? ' Số thứ tự chưa liên tục; hãy đối chiếu ảnh gốc.' : ''}`
      : "Chưa lọc được tên thuốc rõ ràng. Hãy đối chiếu ảnh, xem văn bản đầy đủ hoặc nhập tên thuốc bên dưới.", medicines.length ? "ready" : "error");
  } catch (error) {
    if (prescriptionOcrController !== controller) return;
    setPrescriptionStatus(error.name === "TimeoutError"
      ? "Đọc ảnh quá lâu. Hãy thử lại với ảnh rõ hơn hoặc nhập tên thuốc."
      : "Không đọc được ảnh đơn thuốc. Hãy thử lại hoặc nhập tên thuốc bên dưới.", "error");
  } finally {
    if (prescriptionOcrController === controller) {
      prescriptionOcrController = null;
      updatePrescriptionControls();
    }
  }
}

addListener(fileInput, "change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
    clearPrescriptionImage();
    setPrescriptionStatus("Vui lòng chọn ảnh hợp lệ, dung lượng không quá 10 MB.", "error");
    return;
  }
  if (prescriptionImageUrl) URL.revokeObjectURL(prescriptionImageUrl);
  prescriptionImageUrl = URL.createObjectURL(file);
  uploadText.textContent = file.name;
  preview.src = prescriptionImageUrl;
  openPrescriptionImage.href = prescriptionImageUrl;
  openPrescriptionImage.classList.remove('hidden');
  preview.style.display = "block";
  removePrescriptionImage.classList.remove("hidden");
  retryPrescriptionOcr.classList.remove("hidden");
  void recognizePrescription(file);
});
addListener(removePrescriptionImage, "click", () => {
  clearPrescriptionImage();
  setPrescriptionStatus("Đã xóa ảnh và danh sách thuốc từ ảnh. Bạn có thể tải ảnh khác hoặc nhập tay.");
});
addListener(retryPrescriptionOcr, "click", () => {
  if (fileInput.files[0]) void recognizePrescription(fileInput.files[0]);
});
addListener(medicineInput, "input", () => {
  invalidatePrescriptionResults(false);
  const labels = new Set(parseMedicineList(medicineInput.value).map(medicineLabel));
  for (const label of prescriptionReviewItems.keys()) {
    if (!labels.has(label)) prescriptionReviewItems.delete(label);
  }
  setPrescriptionStatus("Hãy kiểm tra và xác nhận danh sách thuốc trước khi tìm.");
  updatePrescriptionControls();
});
addListener(confirmPrescriptionMedicines, "change", updatePrescriptionControls);

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

function syncSymptomWidgetVisibility() {
  const isOpen = !symptomWidget.classList.contains("hidden");
  document.body.classList.toggle("symptom-widget-open", isOpen);
}

addListener(widgetTrigger, "click", () => {
  symptomWidget.classList.toggle("hidden");
  syncSymptomWidgetVisibility();
});
addListener(document.querySelector("#closeWidget"), "click", () => {
  symptomWidget.classList.add("hidden");
  syncSymptomWidgetVisibility();
});
syncSymptomWidgetVisibility();


let pharmacySearchBusy = false;
let lastPharmacySearch = null;
const SEARCH_REQUEST_TIMEOUT_MS = 15000;
// Cho phép máy chủ xếp hàng, chạy truy vấn và truyền hết nội dung JSON trước khi hủy.
const OVERPASS_REQUEST_TIMEOUT_MS = 45000;
const OVERPASS_QUERY_TIMEOUT_SECONDS = 25;
const OVERPASS_FALLBACK_DELAY_MS = 4000;
// Hai nguồn toàn cầu được Overpass Turbo liệt kê: https://github.com/tyrasd/overpass-turbo/blob/master/js/configs.ts
const OVERPASS_SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"
];
const PHARMACY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PHARMACY_CACHE_MAX_ENTRIES = 20;
// Đổi phiên bản khi mở rộng truy vấn để không dùng lại danh sách ít kết quả của bản cũ.
const PHARMACY_CACHE_STORAGE_KEY = "smartPharmacyMapCache_v3";
const pharmacySearchCache = readPharmacySearchCache();
const pendingPharmacyRequests = new Map();

function readPharmacySearchCache() {
  try {
    const entries = JSON.parse(localStorage.getItem(PHARMACY_CACHE_STORAGE_KEY) || "[]");
    if (!Array.isArray(entries)) return new Map();
    return new Map(entries.filter((entry) => Array.isArray(entry) && entry.length === 2 &&
      typeof entry[0] === "string" && Number.isFinite(entry[1]?.savedAt) &&
      Date.now() - entry[1].savedAt >= 0 && Date.now() - entry[1].savedAt < PHARMACY_CACHE_TTL_MS &&
      Array.isArray(entry[1].data?.elements) && !entry[1].data.remark &&
      validBounds(entry[1].bounds) &&
      (!entry[1].data.elements.length || entry[1].data.elements.some(getMapCoordinates)))
      .slice(-PHARMACY_CACHE_MAX_ENTRIES));
  } catch {
    return new Map();
  }
}

function savePharmacySearchCache() {
  try {
    localStorage.setItem(PHARMACY_CACHE_STORAGE_KEY, JSON.stringify([...pharmacySearchCache]));
  } catch {
    // Vẫn dùng cache trong bộ nhớ nếu trình duyệt không cho phép lưu trữ hoặc hết dung lượng.
  }
}

function setPharmacySearchBusy(busy) {
  pharmacySearchBusy = busy;
  document.querySelectorAll(".find-button, #suggestionButton, #addressSearchButton, #searchRadius, #pharmacySearch, #loadOrderDemo, [data-pharmacy-search-action]").forEach((control) => {
    control.disabled = busy;
  });
  if (!busy && displayedMapResults?.items.some(item => item.isDemo)) document.querySelector("#searchRadius").disabled = true;
  updatePrescriptionControls();
  results.setAttribute("aria-busy", String(busy));
}

// Đọc bán kính từ bộ lọc trên giao diện (đơn vị mét).
function getSearchRadius() {
  const radiusSelect = document.querySelector("#searchRadius");
  const radius = Number(radiusSelect?.value);
  // Mặc định 3 km để tránh bỏ sót các nhà thuốc ngoài phạm vi 1 km.
  return Number.isFinite(radius) && radius > 0 ? radius : 3000;
}

function formatRadius(radiusInMeters) {
  const km = Number(radiusInMeters) / 1000;
  return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}

function filterPharmaciesByName(items, query) {
  const terms = normalizeText(query).replace(/\b(nha thuoc|hieu thuoc|quay thuoc|pharmacy)\b/g, " ").trim().split(/\s+/).filter(Boolean);
  return items.filter(pharmacy => {
    const text = normalizeText(`${pharmacy.name} ${pharmacy.searchNames || ""} ${pharmacy.address}`);
    return terms.every(term => text.includes(term));
  });
}

async function getCurrentSearchOrigin(knownOrigin) {
  if (knownOrigin) return knownOrigin;
  if (!navigator.geolocation) throw new Error("Trình duyệt không hỗ trợ định vị. Bạn có thể nhập địa chỉ thay thế.");
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(position => {
      resolve({ lat: position.coords.latitude, lon: position.coords.longitude });
    }, () => reject(new Error("Không thể lấy vị trí. Bạn có thể nhập địa chỉ thay thế.")), {
      enableHighAccuracy: true, timeout: 12000, maximumAge: 60000
    });
  });
}

async function findPharmacies(mode = "normal", knownOrigin = null, nameQuery = "") {
  if (mode === "prescription") return findPrescriptionPharmacies(knownOrigin);
  if (pharmacySearchBusy) return;
  if (!knownOrigin && !navigator.geolocation) {
    statusText.textContent = "Trình duyệt không hỗ trợ định vị.";
    return;
  }

  setPharmacySearchBusy(true);
  statusText.textContent = knownOrigin ? "Đang tìm nhà thuốc gần bạn…" : "Đang xác định vị trí...";

  try {
    const origin = await getCurrentSearchOrigin(knownOrigin);
    lastPharmacySearch = { type: "current", mode, origin, nameQuery };
    const radius = getSearchRadius();
    const mapMode = mode === "normal" ? "current" : "prescription";
    const heading = document.querySelector(".results-title h2");
    if (heading) {
      heading.textContent = nameQuery ? `Nhà thuốc phù hợp với “${nameQuery}”` : mode === "normal"
        ? "Nhà thuốc gần vị trí của bạn"
        : "Nhà thuốc gần bạn để liên hệ hỏi thuốc";
    }

    // Hiện bản đồ và vị trí trước khi chờ máy chủ dữ liệu nhà thuốc.
    results.classList.remove("hidden");
    symptomWidget.classList.add("hidden");
    initializePharmacyMap(origin.lat, origin.lon, 14);
    renderMapPharmacies([], mapMode, origin);
    showPharmacyListState("loading", `Đang tìm nhà thuốc trong phạm vi ${formatRadius(radius)} quanh vị trí của bạn…`);
    resultNote.textContent = "Đang tìm nhà thuốc gần bạn…";
    statusText.textContent = "Đã xác định vị trí. Đang tìm nhà thuốc gần bạn…";
    results.scrollIntoView({ behavior: "smooth", block: "start" });

    const { items, incomplete, updatedAt } = await fetchNearbyPharmacies(origin.lat, origin.lon, radius,
      (progress) => showPharmacySearchProgress({ items: filterPharmaciesByName(progress.items, nameQuery) }, mapMode, origin));
    const nearby = filterPharmaciesByName(items, nameQuery);
    renderMapPharmacies(nearby, mapMode, origin, updatedAt);
    resultNote.textContent = nearby.length
      ? (mode === "normal" ? "Đang tính quãng đường bộ…" : "Liên hệ nhà thuốc để xác nhận tình trạng thuốc")
      : "Bạn có thể mở rộng phạm vi tìm kiếm bên dưới.";
    statusText.textContent = nearby.length
      ? `Tìm thấy ${nearby.length} nhà thuốc${nameQuery ? ` phù hợp với “${nameQuery}”` : " có dữ liệu"} trong bán kính ${formatRadius(radius)}.`
      : `Chưa có nhà thuốc${nameQuery ? ` phù hợp với “${nameQuery}”` : " được ghi nhận"} trong phạm vi ${formatRadius(radius)}. Bạn có thể mở rộng phạm vi tìm kiếm.`;
    if (incomplete) {
      const message = nearby.length
        ? `Đã tìm thấy ${nearby.length} nhà thuốc. Nguồn dữ liệu chưa trả đủ kết quả; bạn có thể thử lại để bổ sung.`
        : "Nguồn dữ liệu chưa trả đủ kết quả cho phạm vi này. Vui lòng thử lại.";
      statusText.textContent = message;
      showPharmacyListState(nearby.length ? "partial" : "error", message);
    } else if (!nearby.length) {
      showPharmacyListState("empty", statusText.textContent);
    }
    savePharmacySearchState();
  } catch (error) {
    statusText.textContent = error.message || "Không thể tìm nhà thuốc lúc này.";
    resultNote.textContent = "Chưa tải được kết quả. Hãy bấm tìm lại.";
    if (!results.classList.contains("hidden")) showPharmacyListState("error", statusText.textContent);
  } finally {
    setPharmacySearchBusy(false);
  }
}

async function findPrescriptionPharmacies(knownOrigin = null) {
  const requested = medicineInput?.value?.trim() || "";
  const message = requested
    ? `Xin chào, tôi muốn hỏi nhà thuốc hiện có các thuốc sau không: ${requested}. Mong nhà thuốc kiểm tra và phản hồi giúp tôi. Xin cảm ơn!`
    : "Xin chào, tôi muốn hỏi tình trạng thuốc tại nhà thuốc. Mong nhà thuốc hỗ trợ tư vấn giúp tôi. Xin cảm ơn!";
  window.smartPharmacyContactMessage = message;
  await findPharmacies("normal", knownOrigin);
  const heading = document.querySelector(".results-title h2");
  if (heading) heading.textContent = "Nhà thuốc để liên hệ hỏi thuốc";
  resultNote.textContent = "Gọi điện hoặc nhắn tin trực tiếp cho nhà thuốc để xác nhận tình trạng thuốc.";
}

addListener(
  document.querySelector(".panel#normal .find-button"),
  "click",
  () => findPharmacies("normal")
);
addListener(prescriptionButton, "click", () => findPrescriptionPharmacies());
addListener(
  document.querySelector("#suggestionButton"),
  "click",
  () => findPharmacies("symptom")
);

if (isAdminRoute) showAdminLogin();

const addressInput = document.querySelector("#addressInput");
const addressSearchButton = document.querySelector("#addressSearchButton");
const mapElement = document.querySelector("#map");

async function repeatPharmacySearch() {
  if (pharmacySearchBusy || !lastPharmacySearch) return;
  if (lastPharmacySearch.type === "current") {
    await findPharmacies(lastPharmacySearch.mode, lastPharmacySearch.origin, lastPharmacySearch.nameQuery);
  } else {
    await searchPharmaciesByAddress(lastPharmacySearch.location, lastPharmacySearch.nameQuery);
  }
}

addListener(document.querySelector("#searchRadius"), "change", repeatPharmacySearch);
addListener(pharmacyList, "click", (event) => {
  const chatButton = event.target.closest("[data-chat-pharmacy]");
  if (chatButton) {
    openDemoChat(chatButton.dataset.chatName || "Nhà thuốc", chatButton.dataset.chatAddress || "");
    return;
  }
  const button = event.target.closest("[data-pharmacy-search-action]");
  if (!button || pharmacySearchBusy) return;
  if (button.dataset.pharmacySearchAction === "expand") {
    document.querySelector("#searchRadius").value = button.dataset.radius;
  } else {
    // Người dùng bấm thử lại cần một truy vấn mới, kể cả kết quả rỗng đã được lưu tạm.
    pharmacySearchCache.clear();
    savePharmacySearchCache();
  }
  repeatPharmacySearch();
});

function showPharmacyListState(state, message) {
  document.querySelector("#pharmacyResultSummary").textContent = state === "loading"
    ? "Đang tải danh sách nhà thuốc…"
    : state === "partial" ? message
    : state === "empty" ? "Chưa có kết quả trong phạm vi đã chọn."
    : "Chưa tải được danh sách nhà thuốc. Bạn có thể thử lại bên dưới.";
  const panel = document.createElement("div");
  panel.className = "pharmacy-list-state";
  panel.dataset.state = state;
  const title = document.createElement("strong");
  title.textContent = state === "loading" ? "Đang tìm nhà thuốc…"
    : state === "partial" ? "Đã tải được một phần danh sách nhà thuốc"
    : state === "empty" ? "Chưa tìm thấy nhà thuốc trong phạm vi đã chọn"
    : "Chưa tải được danh sách nhà thuốc";
  const description = document.createElement("p");
  description.setAttribute("role", state === "error" ? "alert" : "status");
  description.textContent = message;
  panel.append(title, description);

  if (state !== "loading") {
    const actions = document.createElement("div");
    actions.className = "pharmacy-list-actions";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "primary";
    retry.dataset.pharmacySearchAction = "retry";
    retry.disabled = pharmacySearchBusy;
    retry.textContent = "Thử lại";
    actions.appendChild(retry);

    const nextRadius = [...document.querySelector("#searchRadius").options]
      .map((option) => Number(option.value)).find((radius) => radius > getSearchRadius());
    if (state === "empty" && nextRadius) {
      const expand = document.createElement("button");
      expand.type = "button";
      expand.className = "secondary-button";
      expand.dataset.pharmacySearchAction = "expand";
      expand.dataset.radius = String(nextRadius);
      expand.disabled = pharmacySearchBusy;
      expand.textContent = `Mở rộng lên ${formatRadius(nextRadius)}`;
      actions.appendChild(expand);
    }
    if (lastPharmacySearch) {
      const location = lastPharmacySearch.type === "current"
        ? `${lastPharmacySearch.origin.lat},${lastPharmacySearch.origin.lon}`
        : lastPharmacySearch.location.display_name;
      const mapsLink = document.createElement("a");
      mapsLink.className = "pharmacy-link";
      mapsLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`nhà thuốc gần ${location}`)}`;
      mapsLink.target = "_blank";
      mapsLink.rel = "noopener noreferrer";
      mapsLink.textContent = "Tìm trên Google Maps";
      actions.appendChild(mapsLink);
    }
    panel.appendChild(actions);
  }
  if (state === "partial") pharmacyList.prepend(panel);
  else pharmacyList.replaceChildren(panel);
}

function showPharmacySearchProgress({ items }, mode, origin = null) {
  if (!items.length) return;
  renderMapPharmacies(items, mode, origin, null, false);
  const message = `Đã tìm thấy ${items.length} nhà thuốc. Đang tiếp tục tìm kết quả bổ sung…`;
  statusText.textContent = message;
  showPharmacyListState("partial", message);
}

let pharmacyMap = null;
let pharmacyMarkers = [];
let userMarker = null;
let routeLayer = null;
let selectedMapOrigin = null;
let mapOriginMarker = null;

// Lưu toàn bộ phiên tìm kiếm để quay lại từ trang chi tiết/lịch sử mà không gọi API lại.
const PHARMACY_SEARCH_STATE_KEY = "smartPharmacySearchState_v1";
let restoringPharmacySearchState = false;
function savePharmacySearchState() {
  if (restoringPharmacySearchState || !displayedMapResults || !results || results.classList.contains("hidden")) return;
  try {
    const center = pharmacyMap?.getCenter();
    const state = {
      savedAt: Date.now(),
      lastSearch: lastPharmacySearch,
      items: displayedMapResults.items,
      mode: displayedMapResults.mode,
      origin: displayedMapResults.origin,
      selectedMapOrigin,
      radius: document.querySelector("#searchRadius")?.value || "3000",
      addressInput: addressInput?.value || "",
      pharmacySearch: pharmacySearch?.value || "",
      title: document.querySelector(".results-title h2")?.textContent || "Nhà thuốc quanh địa chỉ đã chọn",
      status: statusText?.textContent || "",
      resultNote: resultNote?.textContent || "",
      summary: document.querySelector("#pharmacyResultSummary")?.textContent || "",
      routeStatus: document.querySelector("#routeStatus")?.textContent || "",
      map: center && pharmacyMap ? { lat: center.lat, lon: center.lng, zoom: pharmacyMap.getZoom() } : null,
      scrollY: window.scrollY
    };
    sessionStorage.setItem(PHARMACY_SEARCH_STATE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("[Smart Pharmacy] Không thể lưu trạng thái tìm kiếm", error);
  }
}

function restorePharmacySearchState() {
  let state;
  try { state = JSON.parse(sessionStorage.getItem(PHARMACY_SEARCH_STATE_KEY) || "null"); } catch { return false; }
  if (!state || !Array.isArray(state.items) || !state.mode) return false;
  restoringPharmacySearchState = true;
  try {
    lastPharmacySearch = state.lastSearch || null;
    selectedMapOrigin = state.selectedMapOrigin || null;
    if (addressInput) addressInput.value = state.addressInput || "";
    if (pharmacySearch) pharmacySearch.value = state.pharmacySearch || "";
    const radius = document.querySelector("#searchRadius");
    if (radius && [...radius.options].some(option => option.value === String(state.radius))) radius.value = String(state.radius);
    results.classList.remove("hidden");
    symptomWidget?.classList.add("hidden");
    const title = document.querySelector(".results-title h2");
    if (title) title.textContent = state.title || "Nhà thuốc quanh địa chỉ đã chọn";
    statusText.textContent = state.status || "Đã khôi phục kết quả tìm kiếm trước đó.";
    resultNote.textContent = state.resultNote || "";
    document.querySelector("#pharmacyResultSummary").textContent = state.summary || `Tìm thấy ${state.items.length} nhà thuốc trong khu vực.`;
    document.querySelector("#routeStatus").textContent = state.routeStatus || "";
    const fallback = state.map || (state.origin ? { lat: state.origin.lat, lon: state.origin.lon, zoom: 14 } : null);
    if (fallback) initializePharmacyMap(fallback.lat, fallback.lon, fallback.zoom || 14);
    displayedMapResults = { items: state.items, mode: state.mode, origin: state.origin || null };
    document.querySelector("#searchRadius").disabled = state.items.length > 0 && state.items.every(item => item.isDemo);
    drawMapPharmacies(state.items, state.mode, state.origin || null);
    if (state.map && pharmacyMap) pharmacyMap.setView([state.map.lat, state.map.lon], state.map.zoom, { animate: false });
    if (state.origin && state.mode === "address") {
      const hint = document.querySelector("#mapOriginHint");
      if (hint && state.selectedMapOrigin) hint.textContent = `Đã chọn điểm xuất phát: ${state.selectedMapOrigin.lat.toFixed(6)}, ${state.selectedMapOrigin.lon.toFixed(6)}. Có thể kéo ghim để điều chỉnh.`;
    }
    if (!state.items.length) showPharmacyListState("empty", state.status || "Chưa có kết quả.");
    window.requestAnimationFrame(() => {
      pharmacyMap?.invalidateSize();
      window.scrollTo({ top: Math.max(0, Number(state.scrollY) || 0), behavior: "instant" });
    });
    return true;
  } catch (error) {
    console.warn("[Smart Pharmacy] Không thể khôi phục trạng thái tìm kiếm", error);
    return false;
  } finally {
    restoringPharmacySearchState = false;
  }
}

window.addEventListener("pagehide", savePharmacySearchState);
window.addEventListener("beforeunload", savePharmacySearchState);
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    restorePharmacySearchState();
    window.requestAnimationFrame(() => pharmacyMap?.invalidateSize());
  }
});

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

  mapElement.hidden = false;
  if (typeof L === "undefined") {
    mapElement.classList.add("map-unavailable");
    mapElement.textContent = "Bản đồ chưa tải được. Bạn vẫn có thể xem danh sách, đặt hàng demo và xuất hóa đơn bên dưới.";
    return;
  }

  mapElement.classList.add("map-visible");

  if (!pharmacyMap) {
    pharmacyMap = L.map("map").setView([latitude, longitude], zoom);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
    }).addTo(pharmacyMap);
  } else {
    pharmacyMap.setView([latitude, longitude], zoom);
  }

  if (!pharmacyMap.__originPickerBound) {
    pharmacyMap.on("click", (event) => {
      if (!displayedMapResults || pharmacySearchBusy) return;
      selectMapOrigin(event.latlng);
    });
    pharmacyMap.on("moveend", () => savePharmacySearchState());
    pharmacyMap.__originPickerBound = true;
  }
  window.setTimeout(() => pharmacyMap.invalidateSize(), 150);
}

async function selectMapOrigin(latlng) {
  const origin = { lat: Number(latlng.lat), lon: Number(latlng.lng) };
  if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lon)) return;
  selectedMapOrigin = origin;
  savePharmacySearchState();
  const hint = document.querySelector("#mapOriginHint");
  if (hint) hint.textContent = `Đã chọn điểm xuất phát: ${origin.lat.toFixed(6)}, ${origin.lon.toFixed(6)}. Có thể kéo ghim để chỉnh lại, sau đó bấm Đường đi tại nhà thuốc muốn đến.`;
  const current = displayedMapResults;
  if (current) await renderMapPharmacies(current.items, current.mode, origin, null, true);
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

async function fetchSearchJson(url, options, failureMessage) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), SEARCH_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(failureMessage);
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Dịch vụ tìm kiếm phản hồi quá lâu. Vui lòng bấm tìm lại hoặc giảm bán kính tìm kiếm.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function isPharmacyFeature(item) {
  const tags = item?.tags || {};
  if (tags.amenity === "pharmacy" || tags.healthcare === "pharmacy" ||
      ["pharmacy", "drugstore"].includes(tags.shop)) return true;

  // Tên có thể bổ sung một nhãn còn thiếu, nhưng không biến bệnh viện/phòng khám thành nhà thuốc.
  if (["hospital", "clinic", "doctors", "dentist", "veterinary"].includes(tags.amenity) ||
      ["hospital", "clinic", "doctor", "dentist", "physiotherapist"].includes(tags.healthcare) ||
      ["cosmetics", "tobacco"].includes(tags.shop)) return false;
  const names = [tags.name, tags["name:vi"], tags["name:en"], tags.brand, tags.operator]
    .map((value) => normalizeText(String(value || ""))).join(" ");
  if (/\b(nha\s*thuoc|quay\s*thuoc|hieu\s*thuoc|tiem\s*thuoc|pharmacy\b|pharmacies\b|drug\s*store\b)/.test(names)) return true;

  // shop=chemist còn có thể là cửa hàng mỹ phẩm; chỉ nhận khi có thêm dấu hiệu nhà thuốc.
  return tags.shop === "chemist" && /\b(pharmacity|long\s*chau|an\s*khang|trung\s*son)\b/.test(names);
}

function normalizeMapPharmacy(item) {
  const coordinates = getMapCoordinates(item);
  if (!coordinates || !isPharmacyFeature(item)) return null;
  const tags = item.tags || {};
  return {
    id: `osm-${item.type}-${item.id}`,
    name: tags.name || tags["name:vi"] || tags["name:en"] || tags.brand || "Nhà thuốc chưa có tên",
    searchNames: [tags["name:vi"], tags["name:en"], tags.brand, tags.operator].filter(Boolean).join(" "),
    address: [tags["addr:housenumber"], tags["addr:street"], tags["addr:suburb"] || tags["addr:district"], tags["addr:city"]].filter(Boolean).join(", ") || "Chưa có địa chỉ chi tiết",
    phone: tags.phone || tags["contact:phone"] || tags.mobile || tags["contact:mobile"] || "",
    ownerProfile: item.ownerProfile || null,
    ...coordinates
  };
}

// Bổ sung hồ sơ chủ nhà thuốc vào kết quả bản đồ: nhà thuốc mới chỉ công khai sau Admin duyệt;
// nhà thuốc đã khớp OSM được liên kết với bản ghi hiện hữu, không tạo marker trùng.
const OWNER_SUBMISSIONS_STORAGE_KEY = "sp_pharmacy_submissions_v1";
function mergeOwnerPharmaciesIntoElements(elements, bounds) {
  let submissions = [];
  try {
    const saved = JSON.parse(localStorage.getItem(OWNER_SUBMISSIONS_STORAGE_KEY) || "[]");
    if (Array.isArray(saved)) submissions = saved;
  } catch { /* Bỏ qua dữ liệu demo hỏng */ }
  const output = [...elements];
  const byOsmId = new Map(output.map((item, index) => [`${item.type}-${item.id}`, index]));
  for (const profile of submissions) {
    if (!profile || !["approved", "linked-existing"].includes(profile.status)) continue;
    const lat = Number(profile.lat), lon = Number(profile.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !validBounds(bounds) ||
        lat < bounds[0] || lat > bounds[2] || lon < bounds[1] || lon > bounds[3]) continue;
    const tags = { amenity: "pharmacy", name: profile.name, phone: profile.phone || "", opening_hours: profile.hours || "", description: profile.description || "" };
    if (profile.linkedOsmId) {
      const index = byOsmId.get(profile.linkedOsmId);
      if (index !== undefined) {
        const existing = output[index];
        output[index] = { ...existing, tags: { ...(existing.tags || {}), ...tags,
          name: existing.tags?.name || profile.name,
          phone: profile.phone || existing.tags?.phone || existing.tags?.["contact:phone"] || "" },
          ownerProfile: { id: profile.id, photo: profile.photo || "", ownerEmail: profile.ownerEmail || "" } };
      }
      continue;
    }
    // Hồ sơ nhà thuốc mới đã duyệt: thêm một điểm mới vào kết quả tìm kiếm.
    output.push({ type: "node", id: `owner-${profile.id}`, lat, lon, tags,
      ownerProfile: { id: profile.id, photo: profile.photo || "", ownerEmail: profile.ownerEmail || "" } });
  }
  return output;
}

function buildPharmacyQuery(bbox) {
  return `
    [out:json][timeout:${OVERPASS_QUERY_TIMEOUT_SECONDS}];
    (
      nwr["amenity"="pharmacy"](${bbox});
      nwr["healthcare"="pharmacy"](${bbox});
      nwr["shop"~"^(pharmacy|drugstore|chemist)$"](${bbox});
    );
    out center tags;
  `;
}

function mergeOverpassData(responses, incomplete) {
  const elements = new Map();
  for (const response of responses) {
    for (const item of response.elements) {
      const coordinates = getMapCoordinates(item);
      if (!coordinates) continue;
      const key = item.id != null ? `${item.type}/${item.id}`
        : JSON.stringify([coordinates.lat, coordinates.lon, item.tags?.name || item.tags?.["name:vi"] || ""]);
      const previous = elements.get(key);
      elements.set(key, { ...previous, ...item, tags: { ...previous?.tags, ...item.tags } });
    }
  }
  return { elements: [...elements.values()], ...(incomplete ? { remark: "Incomplete Overpass response" } : {}) };
}

async function requestOverpassData(query, onProgress, signal) {
  const controller = new AbortController();
  const sources = [];
  const partialResponses = [];
  let timedOut = false;
  let startFallback;
  const fallbackReady = new Promise((resolve) => { startFallback = resolve; });
  const abort = () => { controller.abort(); startFallback(); };
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const fallbackTimer = window.setTimeout(startFallback, OVERPASS_FALLBACK_DELAY_MS);
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
    startFallback();
  }, OVERPASS_REQUEST_TIMEOUT_MS);
  const slowResponseTimer = window.setTimeout(() => {
    if (controller.signal.aborted) return;
    const loadingMessage = pharmacyList.querySelector('[data-state="loading"] p');
    if (loadingMessage) loadingMessage.textContent = "Dịch vụ dữ liệu đang phản hồi chậm. Hệ thống vẫn đang chờ danh sách nhà thuốc…";
  }, 12000);

  const request = async (url) => {
    const source = { server: new URL(url).hostname, status: null, stage: "headers", error: null };
    sources.push(source);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query }),
        signal: controller.signal
      });
      source.status = response.status;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      source.stage = "body";
      const data = await response.json();
      controller.signal.throwIfAborted();
      // Kết quả có remark vẫn dùng được nếu chứa nhà thuốc có tọa độ; giao diện đánh dấu chưa đầy đủ.
      const hasCoordinates = Array.isArray(data?.elements) && data.elements.some(getMapCoordinates);
      if (!Array.isArray(data?.elements) ||
          ((data.remark || data.elements.length) && !hasCoordinates)) {
        throw new Error("InvalidOverpassData");
      }
      if (data.remark) {
        partialResponses.push(data);
        source.stage = "partial";
        onProgress?.(mergeOverpassData(partialResponses, true));
        startFallback();
        throw new Error("IncompleteOverpassResponse");
      }
      source.stage = "complete";
      return data;
    } catch (error) {
      source.error = error.name === "Error" ? error.message : error.name;
      throw error;
    }
  };

  try {
    const primary = request(OVERPASS_SERVERS[0]).catch((error) => {
      startFallback();
      throw error;
    });
    // Chỉ gọi nguồn dự phòng khi nguồn chính lỗi hoặc chờ quá 4 giây.
    const fallback = fallbackReady.then(() => {
      controller.signal.throwIfAborted();
      return request(OVERPASS_SERVERS[1]);
    });
    const complete = await Promise.any([primary, fallback]);
    return mergeOverpassData([...partialResponses, complete], false);
  } catch (cause) {
    if (signal?.aborted) throw cause;
    // Giữ những nhà thuốc đã tìm được nếu các nguồn còn lại đều lỗi hoặc hết thời gian chờ.
    if (partialResponses.length) return mergeOverpassData(partialResponses, true);
    // Chỉ ghi trạng thái nguồn; không ghi truy vấn hoặc tọa độ của người dùng vào Console.
    console.warn("[Smart Pharmacy] Overpass search failed", { timedOut, sources });
    const message = timedOut
      ? "Dịch vụ tìm nhà thuốc phản hồi quá lâu sau 45 giây. Vui lòng thử lại."
      : sources.some((source) => source.status === 429)
        ? "Dịch vụ tìm nhà thuốc đang giới hạn lượt truy cập. Vui lòng đợi rồi thử lại."
        : "Chưa tải được danh sách nhà thuốc. Vui lòng kiểm tra kết nối và thử lại.";
    throw new Error(message, { cause });
  } finally {
    window.clearTimeout(fallbackTimer);
    window.clearTimeout(timeout);
    window.clearTimeout(slowResponseTimer);
    signal?.removeEventListener("abort", abort);
    controller.abort();
  }
}

async function fetchPharmacyData(query, onProgress, bounds, requiredBounds = bounds) {
  const now = Date.now();
  for (const [key, entry] of pharmacySearchCache) {
    if (now - entry.savedAt >= PHARMACY_CACHE_TTL_MS) pharmacySearchCache.delete(key);
  }
  // Dùng nguyên truy vấn làm khóa để không nhầm vị trí hoặc bán kính tìm kiếm.
  const cached = pharmacySearchCache.get(query) || [...pharmacySearchCache.values()]
    .find((entry) => boundsContain(entry.bounds, requiredBounds));
  if (cached) return cached.data;
  if (pendingPharmacyRequests.has(query)) return pendingPharmacyRequests.get(query);

  const request = (async () => {
    const liveController = new AbortController();
    let startLive;
    const ready = new Promise((resolve) => { startLive = resolve; });
    const timer = window.setTimeout(startLive, 1500);
    const catalog = findPharmacyCatalog(bounds).catch((error) => { startLive(); throw error; });
    const live = ready.then(() => {
      liveController.signal.throwIfAborted();
      return requestOverpassData(query, onProgress, liveController.signal);
    });
    let data;
    try {
      data = await Promise.any([catalog, live]);
    } catch (error) {
      throw error.errors?.[1] || error;
    } finally {
      window.clearTimeout(timer);
      liveController.abort();
    }
    // Không lưu một danh sách chưa đầy đủ như kết quả hoàn chỉnh cho các lần tìm sau.
    if (data.remark) return data;
    if (pharmacySearchCache.size >= PHARMACY_CACHE_MAX_ENTRIES) {
      pharmacySearchCache.delete(pharmacySearchCache.keys().next().value);
    }
    pharmacySearchCache.set(query, { data, bounds, savedAt: Date.now() });
    savePharmacySearchCache();
    return data;
  })();

  pendingPharmacyRequests.set(query, request);
  try {
    return await request;
  } finally {
    pendingPharmacyRequests.delete(query);
  }
}

async function fetchPharmaciesNearGeoJSONArea(geometry, radius = 3000, onProgress) {
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
  const toResult = (data) => ({
    items: mergeOwnerPharmaciesIntoElements(data.elements, [south, west, north, east]).map(normalizeMapPharmacy).filter(Boolean).map((pharmacy) => ({
      ...pharmacy,
      distance: distanceToGeoJSONAreaKm(pharmacy.lat, pharmacy.lon, geometry)
    })).filter((pharmacy) => pharmacy.distance <= radius / 1000).sort((a, b) => a.distance - b.distance),
    incomplete: Boolean(data.remark), updatedAt: data.catalogUpdatedAt
  });
  const data = await fetchPharmacyData(buildPharmacyQuery(bbox), onProgress && ((data) => onProgress(toResult(data))), [south, west, north, east]);
  return toResult(data);
}

async function fetchNearbyPharmacies(latitude, longitude, radius = 3000, onProgress) {
  // Gom theo ô khoảng 1 km, có phần đệm để dùng lại dữ liệu cho các vị trí gần nhau.
  const queryLatitude = Math.round(latitude * 100) / 100;
  const queryLongitude = Math.round(longitude * 100) / 100;
  const bounds = getSearchBounds(queryLatitude, queryLongitude, radius + 800);
  const [south, west, north, east] = bounds;
  // Truy vấn khung chữ nhật có chỉ mục, rồi lọc đúng bán kính ở phía trình duyệt.
  const bbox = `${south},${west},${north},${east}`;
  const toResult = (data) => ({
    items: mergeOwnerPharmaciesIntoElements(data.elements, bounds).map(normalizeMapPharmacy).filter(Boolean).map((pharmacy) => ({
      ...pharmacy,
      distance: calculateDistanceKm(latitude, longitude, pharmacy.lat, pharmacy.lon)
    })).filter((pharmacy) => pharmacy.distance <= radius / 1000).sort((a, b) => a.distance - b.distance),
    incomplete: Boolean(data.remark), updatedAt: data.catalogUpdatedAt
  });
  const data = await fetchPharmacyData(buildPharmacyQuery(bbox), onProgress && ((data) => onProgress(toResult(data))),
    bounds, getSearchBounds(latitude, longitude, radius));
  return toResult(data);
}

function clearMapLayers(preserveRoute = false) {
  pharmacyMarkers.forEach((marker) => marker.remove());
  pharmacyMarkers = [];

  if (userMarker) {
    userMarker.remove();
    userMarker = null;
  }
  if (mapOriginMarker) {
    mapOriginMarker.remove();
    mapOriginMarker = null;
  }

  if (routeLayer && !preserveRoute) {
    routeLayer.remove();
    routeLayer = null;
  }
}

function drawMapPharmacies(items, mode, origin, preserveRoute = false) {
  clearMapLayers(preserveRoute);
  if (pharmacyMap && origin) {
    userMarker = L.circleMarker([origin.lat, origin.lon], {
      radius: 9, color: "#ffffff", weight: 3, fillColor: "#2563c9", fillOpacity: 1,
    }).addTo(pharmacyMap).bindPopup(selectedMapOrigin ? "Vị trí xuất phát đã chọn trên bản đồ" : (mode === "current" ? "Vị trí của bạn" : "Điểm bắt đầu"));
    if (selectedMapOrigin && Math.abs(selectedMapOrigin.lat - origin.lat) < 1e-7 && Math.abs(selectedMapOrigin.lon - origin.lon) < 1e-7) {
      mapOriginMarker = L.marker([origin.lat, origin.lon], { draggable: true, title: "Vị trí xuất phát đã chọn" }).addTo(pharmacyMap).bindPopup("Vị trí xuất phát của bạn");
      mapOriginMarker.on("dragend", (event) => selectMapOrigin(event.target.getLatLng()));
    }
  }
  const notice = preserveRoute ? pharmacyList.querySelector(".pharmacy-list-state") : null;
  pharmacyList.innerHTML = "";
  items.forEach((pharmacy, index) => {
    if (pharmacyMap) {
      const marker = L.marker([pharmacy.lat, pharmacy.lon]).addTo(pharmacyMap);
      marker.bindPopup(`<strong>${escapeAddressHtml(pharmacy.name)}</strong><br>${escapeAddressHtml(pharmacy.address)}`);
      pharmacyMarkers.push(marker);
    }
    let distanceLine = "Chọn một vị trí hoặc địa chỉ cụ thể để tính quãng đường bộ.";
    if (origin) {
      if (pharmacy.roadStatus === "ready") {
        distanceLine = `Đường bộ: ${pharmacy.roadDistanceKm.toFixed(2)} km · khoảng ${pharmacy.roadDurationMinutes} phút${pharmacy.isDemo ? " (mô phỏng)" : " lái xe"}`;
      } else if (pharmacy.roadStatus === "pending") {
        distanceLine = "Đang tính quãng đường bộ...";
      } else if (pharmacy.roadStatus === "no-route") {
        distanceLine = "Chưa tìm thấy tuyến đường bộ đến nhà thuốc này.";
      } else {
        distanceLine = "Chưa tính được quãng đường bộ. Bấm Đường đi để thử lại.";
      }
    }
    const article = document.createElement("article");
    article.innerHTML = `
      <div class="marker">${index + 1}</div>
      <div><h3>${escapeAddressHtml(pharmacy.name)}</h3><p>${escapeAddressHtml(pharmacy.address)}</p>
        <small class="${pharmacy.roadStatus === "ready" ? "" : "distance-unavailable"}">${distanceLine}</small>
        ${pharmacy.phone ? `<br><small class="pharmacy-phone">Điện thoại: ${escapeAddressHtml(pharmacy.phone)}</small>` : '<br><small class="pharmacy-phone-unavailable">Chưa có số điện thoại được cung cấp</small>'}
        ${pharmacy.isDemo ? '<br><span class="demo-badge">Nhà thuốc minh họa · thông tin liên hệ chưa xác thực</span>' : ""}
      </div>
      <div class="pharmacy-actions">${origin ? '<button class="outline-button route-button" type="button">Đường đi</button>' : ""}${pharmacy.phone ? `<a class="primary contact-call" href="tel:${encodeURIComponent(pharmacy.phone.replace(/[^+\d]/g, ""))}">Gọi điện</a>` : ""}<button class="outline-button contact-chat" type="button" data-chat-pharmacy="${index}" data-chat-name="${escapeAddressHtml(pharmacy.name)}" data-chat-address="${escapeAddressHtml(pharmacy.address)}"><span aria-hidden="true">▣</span> Nhắn tin</button></div></div>`;
    if (origin) article.querySelector(".route-button").addEventListener("click", () => showPharmacyRoute(origin, pharmacy));
    pharmacyList.appendChild(article);
  });
  if (notice) pharmacyList.prepend(notice);
  const points = items.map((item) => [item.lat, item.lon]);
  if (origin) points.push([origin.lat, origin.lon]);
  if (pharmacyMap && points.length && !preserveRoute) {
    pharmacyMap.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 15 });
  }
}

const DEMO_CHAT_STORAGE_KEY = "smartPharmacyMessengerDemo_v2";
let demoConversations = loadDemoConversations();
let activeDemoConversationId = null;
let demoReplyTimers = new Map();

function loadDemoConversations() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEMO_CHAT_STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch { return []; }
}
function saveDemoConversations() {
  try { localStorage.setItem(DEMO_CHAT_STORAGE_KEY, JSON.stringify(demoConversations)); } catch {}
}
function demoConversationId(name, address) { return `${name}::${address}`; }
function getActiveDemoConversation() { return demoConversations.find(item => item.id === activeDemoConversationId); }
function formatDemoTime(value) {
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function showMessengerToast(message) {
  const toast = document.querySelector("#messengerToast");
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showMessengerToast.timer);
  showMessengerToast.timer = setTimeout(() => { toast.hidden = true; }, 3200);
}
function updateMessengerUnread() {
  const total = demoConversations.reduce((sum, item) => sum + (item.unread || 0), 0);
  const badge = document.querySelector("#messengerUnreadTotal");
  const launcherBadge = document.querySelector("#messengerLauncherUnread");
  if (launcherBadge) { launcherBadge.hidden = total === 0; launcherBadge.textContent = total > 9 ? "9+" : String(total); }
  if (badge) { badge.textContent = total > 99 ? "99+" : String(total); badge.hidden = total === 0; }
  renderDemoConversationList();
}
function renderDemoConversationList() {
  const list = document.querySelector("#messengerConversationList");
  if (!list) return;
  list.replaceChildren();
  const sorted = [...demoConversations].sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!sorted.length) {
    const empty = document.createElement("p"); empty.className = "messenger-empty-inbox";
    empty.textContent = "Chưa có hội thoại. Hãy chọn Nhắn tin tại một nhà thuốc."; list.appendChild(empty); return;
  }
  sorted.forEach(conversation => {
    const button = document.createElement("button");
    button.type = "button"; button.className = `messenger-conversation${conversation.id === activeDemoConversationId ? " is-active" : ""}`;
    const avatar = document.createElement("span"); avatar.className = "messenger-list-avatar"; avatar.textContent = "✚";
    const copy = document.createElement("span"); copy.className = "messenger-conversation-copy";
    const name = document.createElement("strong"); name.textContent = conversation.name;
    const preview = document.createElement("small"); preview.textContent = conversation.messages?.at(-1)?.text || conversation.address || "Bắt đầu trò chuyện";
    const meta = document.createElement("span"); meta.className = "messenger-conversation-meta";
    const time = document.createElement("small"); time.textContent = conversation.updatedAt ? formatDemoTime(conversation.updatedAt) : "";
    meta.appendChild(time);
    if (conversation.unread) { const unread = document.createElement("b"); unread.className = "messenger-unread-count"; unread.textContent = conversation.unread > 9 ? "9+" : String(conversation.unread); meta.appendChild(unread); }
    copy.append(name, preview); button.append(avatar, copy, meta);
    button.addEventListener("click", () => selectDemoConversation(conversation.id));
    list.appendChild(button);
  });
}
function renderDemoMessages(conversation) {
  const messages = document.querySelector("#messengerDemoMessages");
  if (!messages) return;
  messages.replaceChildren();
  const notice = document.createElement("div"); notice.className = "messenger-demo-notice";
  notice.textContent = "Bạn đang sử dụng bản DEMO. Tin nhắn và phản hồi minh họa chỉ lưu trên trình duyệt này, chưa được gửi đến nhà thuốc thật.";
  messages.appendChild(notice);
  conversation.messages.forEach(message => {
    const bubble = document.createElement("div");
    bubble.className = `messenger-bubble ${message.from === "user" ? "messenger-bubble-user" : "messenger-bubble-store"}`;
    bubble.textContent = message.text;
    messages.appendChild(bubble);
    const meta = document.createElement("p"); meta.className = `messenger-message-meta${message.from === "user" ? " is-user" : ""}`;
    meta.textContent = `${formatDemoTime(message.time)}${message.from === "user" ? (message.status === "read" ? " · Đã xem (mô phỏng)" : " · Đã gửi (DEMO)") : (message.isAuto ? " · Phản hồi tự động DEMO" : "")}`;
    messages.appendChild(meta);
  });
  messages.scrollTop = messages.scrollHeight;
}
function selectDemoConversation(id) {
  const conversation = demoConversations.find(item => item.id === id);
  if (!conversation) return;
  activeDemoConversationId = id; conversation.unread = 0;
  document.querySelector("#messengerDemoTitle").textContent = conversation.name;
  document.querySelector("#messengerDemoAddress").textContent = conversation.address;
  document.querySelector("#messengerDemoInput").disabled = false;
  document.querySelector('#messengerDemoForm button[type="submit"]').disabled = false;
  renderDemoMessages(conversation); saveDemoConversations(); updateMessengerUnread();
}
function openDemoChat(pharmacyName, pharmacyAddress) {
  const dialog = document.querySelector("#messengerDemoDialog");
  if (!dialog) return;
  const id = demoConversationId(pharmacyName, pharmacyAddress);
  let conversation = demoConversations.find(item => item.id === id);
  if (!conversation) {
    conversation = { id, name: pharmacyName, address: pharmacyAddress, unread: 0, updatedAt: Date.now(), messages: [{ from: "store", text: `Xin chào! Đây là hội thoại DEMO với ${pharmacyName}. Bạn có thể thử gửi tin nhắn bên dưới.`, time: Date.now(), isAuto: true }] };
    demoConversations.push(conversation); saveDemoConversations();
  }
  renderDemoConversationList(); selectDemoConversation(id);
  if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
  else dialog.setAttribute("open", "");
  document.querySelector("#messengerDemoInput").focus();
}
function submitDemoMessage(event) {
  event.preventDefault();
  const input = document.querySelector("#messengerDemoInput");
  const conversation = getActiveDemoConversation();
  const value = input?.value.trim();
  if (!conversation || !value) return;
  const sentAt = Date.now();
  conversation.messages.push({ from: "user", text: value, time: sentAt, status: "sent" });
  conversation.updatedAt = sentAt; input.value = "";
  renderDemoMessages(conversation); saveDemoConversations(); updateMessengerUnread();
  const timer = setTimeout(() => {
    const current = demoConversations.find(item => item.id === conversation.id);
    if (!current) return;
    const replyAt = Date.now();
    current.messages = current.messages.map(message => message.from === "user" && message.time === sentAt ? { ...message, status: "read" } : message);
    current.messages.push({ from: "store", text: "Cảm ơn bạn đã nhắn tin! Đây là phản hồi tự động để minh họa giao diện. Khi triển khai chính thức, nhà thuốc sẽ trực tiếp tiếp nhận và phản hồi tin nhắn.", time: replyAt, isAuto: true });
    current.updatedAt = replyAt;
    const dialog = document.querySelector("#messengerDemoDialog");
    if (dialog?.open && activeDemoConversationId === current.id) renderDemoMessages(current);
    else current.unread = (current.unread || 0) + 1;
    saveDemoConversations(); updateMessengerUnread();
    if (!dialog?.open || activeDemoConversationId !== current.id) showMessengerToast(`Có phản hồi DEMO từ ${current.name}`);
  }, 2200);
  demoReplyTimers.set(conversation.id, timer);
}
const messengerForm = document.querySelector("#messengerDemoForm");
if (messengerForm) messengerForm.addEventListener("submit", submitDemoMessage);
updateMessengerUnread();

async function renderMapPharmacies(items, mode, origin = null, updatedAt = null, resolveRoad = true) {
  items = items.map(item => ({ ...item, id: item.id || `${item.name}|${item.lat},${item.lon}` }));
  const dateNote = updatedAt && Number.isFinite(Date.parse(updatedAt))
    ? ` Dữ liệu cập nhật ${new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Bangkok" }).format(new Date(updatedAt))}.` : "";
  document.querySelector("#pharmacyResultSummary").textContent = `Tìm thấy ${items.length} nhà thuốc trong khu vực.${dateNote}`;
  const version = ++mapResultsVersion;
  routeRequestVersion++;
  document.querySelector("#routeStatus").textContent = "";
  const isDemo = items.length > 0 && items.every((item) => item.isDemo);
  displayedMapResults = { items: items.map((item) => ({ ...item, roadStatus: isDemo ? "ready" : "pending" })), mode, origin };
  document.querySelector("#searchRadius").disabled = isDemo;
  document.querySelector("#roadDistanceHint").textContent = isDemo
    ? "Đây là dữ liệu nhà thuốc minh họa; hãy xác minh thông tin liên hệ trước khi đến."
    : "Bán kính dùng để tìm trong khu vực. Quãng đường hiển thị theo tuyến lái xe từ điểm bắt đầu; dịch vụ lỗi sẽ không hiển thị khoảng cách ước đoán.";
  drawMapPharmacies(displayedMapResults.items, mode, origin);
  savePharmacySearchState();
  if (isDemo || !origin || !items.length || !resolveRoad) return;
  const routed = await fetchRoadDistances(origin, items);
  if (version !== mapResultsVersion) return;
  displayedMapResults.items = routed.map((item) => {
    const known = displayedMapResults.items.find((previous) => previous.id === item.id && previous.roadStatus === "ready");
    return known || item;
  }).sort((a, b) => (a.roadDistanceKm ?? Infinity) - (b.roadDistanceKm ?? Infinity));
  drawMapPharmacies(displayedMapResults.items, mode, origin, true);
  updateRoadResultNote(displayedMapResults.items);
  savePharmacySearchState();
}

function updateRoadResultNote(items) {
  const ready = items.filter((item) => item.roadStatus === "ready").length;
  resultNote.textContent = ready === items.length
    ? "Sắp xếp theo quãng đường bộ · gần đến xa"
    : `Đã tính đường bộ ${ready}/${items.length} nhà thuốc${ready ? " · gần đến xa" : " · dịch vụ định tuyến chưa khả dụng"}`;
}

async function showPharmacyRoute(origin, destination) {
  const requestVersion = ++routeRequestVersion;
  const routeStatus = document.querySelector("#routeStatus");
  routeStatus.textContent = "Đang tìm đường bộ...";
  if (routeLayer) { routeLayer.remove(); routeLayer = null; }
  try {
    const route = destination.isDemo
      ? { distance: destination.roadDistanceKm * 1000, duration: destination.roadDurationMinutes * 60, geometry: { type: "LineString", coordinates: destination.demoRoute } }
      : await fetchRoadRoute(origin, destination);
    if (requestVersion !== routeRequestVersion) return;
    if (pharmacyMap) {
      routeLayer = L.geoJSON(route.geometry, { style: { color: "#2563c9", weight: 5, ...(destination.isDemo ? { dashArray: "8 6" } : {}) } }).addTo(pharmacyMap);
      pharmacyMap.fitBounds(routeLayer.getBounds(), { padding: [35, 35] });
    }
    routeStatus.textContent = `${destination.name}: quãng đường bộ ${(route.distance / 1000).toFixed(2)} km · khoảng ${Math.max(1, Math.round(route.duration / 60))} phút lái xe.${destination.isDemo ? " Tuyến đường demo mô phỏng, không dùng để chỉ đường thực tế." : ""}`;
    if (!destination.isDemo) {
      if (displayedMapResults) {
        displayedMapResults.items = displayedMapResults.items.map((item) => item.id === destination.id
          ? { ...item, roadStatus: "ready", roadDistanceKm: route.distance / 1000, roadDurationMinutes: Math.max(1, Math.round(route.duration / 60)) }
          : item).sort((a, b) => (a.roadDistanceKm ?? Infinity) - (b.roadDistanceKm ?? Infinity));
        drawMapPharmacies(displayedMapResults.items, displayedMapResults.mode, displayedMapResults.origin, true);
        updateRoadResultNote(displayedMapResults.items);
        savePharmacySearchState();
      }
    }
  } catch (error) {
    if (requestVersion !== routeRequestVersion) return;
    routeStatus.textContent = error.name === "TimeoutError"
      ? "Dịch vụ tìm đường phản hồi quá lâu. Vui lòng thử lại."
      : "Chưa lấy được tuyến đường bộ. Vui lòng thử lại sau.";
  }
}

async function searchPharmaciesByAddress(knownLocation = null, nameQuery = "") {
  if (pharmacySearchBusy) return;
  const query = addressInput?.value.trim();

  if (!knownLocation && (!query || query.length < 2)) {
    statusText.textContent = "Vui lòng nhập phường hoặc địa chỉ muốn tìm.";
    addressInput?.focus();
    return;
  }

  setPharmacySearchBusy(true);
  statusText.textContent = "Đang tìm địa chỉ...";

  try {
    let location = knownLocation;
    if (!location) {
      const geocodeUrl = new URL("https://nominatim.openstreetmap.org/search");
      geocodeUrl.search = new URLSearchParams({
        q: `${query}, Việt Nam`,
        format: "jsonv2",
        limit: "1",
        countrycodes: "vn",
        polygon_geojson: "1",
        addressdetails: "1"
      });
      const locations = await fetchSearchJson(geocodeUrl, {}, "Dịch vụ tìm địa chỉ đang bận.");
      if (!locations.length) {
        statusText.textContent = "Không tìm thấy địa chỉ. Hãy thử nhập rõ hơn.";
        return;
      }
      location = locations[0];
    }
    lastPharmacySearch = { type: "address", location, nameQuery };
    selectedMapOrigin = null;
    const latitude = Number(location.lat);
    const longitude = Number(location.lon);

    statusText.textContent = "Đang tìm nhà thuốc trong khu vực...";

    const radius = getSearchRadius();
    const isAreaSearch = ["administrative", "boundary"].includes(location.type) ||
      ["administrative", "boundary"].includes(location.class);
    const hasAreaGeometry = location.geojson &&
      ["Polygon", "MultiPolygon"].includes(location.geojson.type);
    // Với khu vực có ranh giới, đặt bản đồ theo khung khu vực thay vì coi tâm địa danh là điểm gốc.
    results.classList.remove("hidden");
    resultNote.textContent = "Đang tìm nhà thuốc trong khu vực…";
    if (isAreaSearch && hasAreaGeometry) {
      const bounds = getGeoJSONBounds(location.geojson);
      initializePharmacyMap((bounds.south + bounds.north) / 2, (bounds.west + bounds.east) / 2, 13);
      if (pharmacyMap) {
        const leafletBounds = L.latLngBounds([bounds.south, bounds.west], [bounds.north, bounds.east]);
        pharmacyMap.fitBounds(leafletBounds, { padding: [25, 25] });
      }
    } else {
      initializePharmacyMap(latitude, longitude, 13);
    }
    // Tìm kiếm theo địa chỉ chỉ xác định khu vực; người dùng tự chọn điểm xuất phát chính xác trên bản đồ.
    const origin = null;
    renderMapPharmacies([], "address", origin);
    showPharmacyListState("loading", `Đang tìm nhà thuốc quanh ${location.display_name}…`);
    results.scrollIntoView({ behavior: "smooth", block: "start" });

    const resultsTitle = document.querySelector(".results-title h2");
    if (resultsTitle) {
      resultsTitle.textContent = nameQuery ? `Nhà thuốc phù hợp với “${nameQuery}”` : "Nhà thuốc quanh địa chỉ đã chọn";
    }

    const onProgress = progress => showPharmacySearchProgress({ items: filterPharmaciesByName(progress.items, nameQuery) }, "address", origin);
    const { items, incomplete, updatedAt } = isAreaSearch && hasAreaGeometry
      ? await fetchPharmaciesNearGeoJSONArea(location.geojson, radius,
        onProgress)
      : await fetchNearbyPharmacies(latitude, longitude, radius,
        onProgress);
    const nearbyPharmacies = filterPharmaciesByName(items, nameQuery);
    renderMapPharmacies(nearbyPharmacies, "address", origin, updatedAt);
    resultNote.textContent = isAreaSearch && hasAreaGeometry
      ? `Trong khu vực ${location.display_name} và phạm vi ${formatRadius(radius)} tính từ ranh giới khu vực.`
      : `${formatRadius(radius)} quanh: ${location.display_name}`;
    statusText.textContent = nearbyPharmacies.length
      ? `Tìm thấy ${nearbyPharmacies.length} nhà thuốc${nameQuery ? ` phù hợp với “${nameQuery}”` : ""} ${isAreaSearch && hasAreaGeometry ? `trong khu vực và cách ranh giới không quá ${formatRadius(radius)}` : `trong bán kính ${formatRadius(radius)}`}.`
      : `Không tìm thấy nhà thuốc${nameQuery ? ` phù hợp với “${nameQuery}”` : " có dữ liệu"} quanh địa chỉ này.`;
    if (incomplete) {
      const message = nearbyPharmacies.length
        ? `Đã tìm thấy ${nearbyPharmacies.length} nhà thuốc. Nguồn dữ liệu chưa trả đủ kết quả; bạn có thể thử lại để bổ sung.`
        : "Nguồn dữ liệu chưa trả đủ kết quả cho phạm vi này. Vui lòng thử lại.";
      statusText.textContent = message;
      showPharmacyListState(nearbyPharmacies.length ? "partial" : "error", message);
    } else if (!nearbyPharmacies.length) {
      showPharmacyListState("empty", statusText.textContent);
    }
    savePharmacySearchState();
  } catch (error) {
    statusText.textContent =
      error.message || "Có lỗi khi tìm kiếm địa chỉ.";
    resultNote.textContent = "Chưa tải được kết quả. Hãy bấm tìm lại.";
    if (!results.classList.contains("hidden")) showPharmacyListState("error", statusText.textContent);
  } finally {
    setPharmacySearchBusy(false);
  }
}

addListener(addressSearchButton, "click", () => searchPharmaciesByAddress());

addListener(addressInput, "keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    searchPharmaciesByAddress();
  }
});


addListener(document.querySelector("#loadOrderDemo"), "click", () => {
  if (pharmacySearchBusy) return;
  lastPharmacySearch = null;
  returnToPharmacySearch();
  initializePharmacyMap(demoOrigin.lat, demoOrigin.lon, 14);
  renderMapPharmacies(demoPharmacies, "demo", demoOrigin);
  document.querySelector(".results-title h2").textContent = "Chọn nhà thuốc để thử đặt hàng";
  resultNote.textContent = "3 nhà thuốc mẫu · khoảng cách mô phỏng";
  statusText.textContent = "Đã tải dữ liệu demo. Bấm Đặt hàng → Điền mẫu → Kiểm tra đơn hàng → Xác nhận đặt hàng để thử.";
  results.classList.remove("hidden");
  symptomWidget.classList.add("hidden");
  results.scrollIntoView({ behavior: "smooth", block: "start" });
});


/* Đồng bộ header và trang lịch sử với phiên đăng nhập khách hàng trong tab hiện tại. */
updateCustomerHeader();
prefetchPharmacyCatalog();

if (!isAdminRoute && activeCustomer && activeCustomer.role === "customer") {
  openCustomerDashboard();
} else if (!isAdminRoute) {
  restorePharmacySearchState();
}

if (apiEnabled) {
  document.querySelector('.customer-demo-note').textContent = 'Lịch sử được lưu trên hệ thống và gắn với tài khoản đã đăng nhập.';
  authPassword.minLength = 4; // Cho phép tài khoản demo test/test; tài khoản thật vẫn được xác thực bởi API.
  if (getSession()) apiRequest('/api/v1/me').then(result => {
    saveSession({ ...getSession(), user: result.data.user });
    activeCustomer = result.data.user.role === 'CUSTOMER' ? { ...result.data.user, role: 'customer' } : null;
    updateCustomerHeader();
  }).catch(error => {
    if (error.status === 401) { activeCustomer = null; updateCustomerHeader(); }
  });
}

// Global inbox launcher: customers can open the Messenger inbox without first selecting a pharmacy.
const messengerLauncher = document.querySelector("#messengerLauncher");
if (messengerLauncher) messengerLauncher.addEventListener("click", () => {
  const dialog = document.querySelector("#messengerDemoDialog");
  if (dialog && !dialog.open) dialog.showModal();
  renderDemoConversationList();
});

window.addEventListener("storage", event => {
  if (event.key === "smartPharmacyMessengerDemo_v2") {
    updateMessengerUnread();
    const dialog = document.querySelector("#messengerDemoDialog");
    if (dialog?.open && activeDemoConversationId) { const c = getActiveDemoConversation(); if (c) renderDemoMessages(c); }
  }
});
