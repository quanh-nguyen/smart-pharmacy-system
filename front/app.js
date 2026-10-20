
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
const dashboardDataKey = "smartPharmacyOwnerData";

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
  authTitle.textContent = mode === "login" ? "Đăng nhập" : "Đăng ký";
  authModeLabel.textContent = mode === "login" ? "ĐĂNG NHẬP TÀI KHOẢN" : "TẠO TÀI KHOẢN";
  authSubmit.textContent = mode === "login" ? "Đăng nhập" : "Đăng ký";
  authPassword.autocomplete = mode === "login" ? "current-password" : "new-password";
  authStatus.textContent = "";
  authForm.reset();
  authModal.classList.remove("hidden");
  authEmail.focus();
}

document.querySelector("#registerButton").addEventListener("click", () => openAuth("register"));
document.querySelector("#loginButton").addEventListener("click", () => openAuth("login"));
document.querySelector("#closeAuth").addEventListener("click", () => authModal.classList.add("hidden"));
authModal.addEventListener("click", (event) => {
  if (event.target === authModal) authModal.classList.add("hidden");
});
document.querySelectorAll(".account-type").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".account-type").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    selectedRole = button.dataset.role;
  });
});
authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const email = authEmail.value.trim().toLowerCase();
  const password = authPassword.value;
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
  tab.addEventListener("click", () => {
    document.querySelectorAll(".dashboard-tab").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".dashboard-panel").forEach((panel) => panel.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`#${tab.dataset.dashboardTab}`).classList.add("active");
  });
});

document.querySelector("#ownerLogout").addEventListener("click", () => {
  ownerDashboard.classList.add("hidden");
  document.querySelector("main").classList.remove("hidden");
  document.querySelector(".symptom-widget").classList.remove("hidden");
  activeOwnerEmail = "";
});

document.querySelector("#pharmacyImage").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    document.querySelector("#pharmacyPreview").src = reader.result;
    document.querySelector("#pharmacyPreview").classList.remove("hidden");
  };
  reader.readAsDataURL(file);
});

document.querySelector("#locationFile").addEventListener("change", (event) => {
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

document.querySelector("#pharmacyForm").addEventListener("submit", (event) => {
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

document.querySelector("#editRequestButton").addEventListener("click", () => {
  document.querySelector("#pharmacyStatus").textContent = "Đã gửi yêu cầu chỉnh sửa. Ban quản trị sẽ phản hồi sớm.";
});

document.querySelector("#medicineForm").addEventListener("submit", (event) => {
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

document.querySelector("#orderMedicine").addEventListener("change", updateOrderTotal);
document.querySelector("#orderQuantity").addEventListener("input", updateOrderTotal);

document.querySelector("#medicineList").addEventListener("click", (event) => {
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

document.querySelector("#orderForm").addEventListener("submit", (event) => {
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

pharmacySearch.addEventListener("focus", () => showSearchSuggestions(pharmacySearch.value));
pharmacySearch.addEventListener("input", () => showSearchSuggestions(pharmacySearch.value));
pharmacySuggestions.addEventListener("click", (event) => {
  const item = event.target.closest(".pharmacy-suggestion");
  if (item && !event.target.closest(".suggestion-link")) selectPharmacy(pharmacies[Number(item.dataset.index)]);
});
pharmacySuggestions.addEventListener("keydown", (event) => {
  const item = event.target.closest(".pharmacy-suggestion");
  if (item && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    selectPharmacy(pharmacies[Number(item.dataset.index)]);
  }
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".pharmacy-search")) {
    pharmacySuggestions.classList.add("hidden");
    pharmacySearch.setAttribute("aria-expanded", "false");
  }
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((item) => item.classList.remove("active"));
    panels.forEach((panel) => panel.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`#${tab.dataset.tab}`).classList.add("active");
    statusText.textContent = "";
  });
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;

  uploadText.textContent = file.name;
  preview.src = URL.createObjectURL(file);
  preview.style.display = "block";
  prescriptionButton.disabled = false;
});

medicineInput.addEventListener("input", () => {
  prescriptionButton.disabled = !medicineInput.value.trim() && !fileInput.files.length;
});

document.querySelectorAll(".symptom-list button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".symptom-list button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    const selected = symptomSuggestions[button.dataset.symptom];
    suggestionTitle.textContent = selected.title;
    suggestionText.textContent = selected.text;
    suggestion.classList.remove("hidden");
  });
});

widgetTrigger.addEventListener("click", () => symptomWidget.classList.toggle("hidden"));
document.querySelector("#closeWidget").addEventListener("click", () => symptomWidget.classList.add("hidden"));

function findPharmacies(mode = "normal") {
  statusText.textContent = "Đang xác định vị trí...";

  if (!navigator.geolocation) {
    statusText.textContent = "Trình duyệt không hỗ trợ định vị.";
    return;
  }

  navigator.geolocation.getCurrentPosition(
    () => {
      statusText.textContent = "Đã xác định vị trí thành công.";
      resultNote.textContent =
        mode === "normal" ? "Sắp xếp theo khoảng cách" : "Nhà thuốc gần nhất có sản phẩm phù hợp";
      results.classList.remove("hidden");
      renderPharmacies(pharmacies);
      symptomWidget.classList.add("hidden");
      results.scrollIntoView({ behavior: "smooth" });
    },
    () => {
      statusText.textContent = "Không thể lấy vị trí. Vui lòng cho phép truy cập vị trí.";
    },
  );
}

document.querySelector(".panel#normal .find-button").addEventListener("click", () => findPharmacies("normal"));
prescriptionButton.addEventListener("click", () => findPharmacies("prescription"));
document.querySelector("#suggestionButton").addEventListener("click", () => findPharmacies("symptom"));
