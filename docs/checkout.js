const STORAGE_KEY = "smartPharmacyCheckout_v1";
const SHIPPING_FEE = 15000;
const money = (value) => `${Number(value).toLocaleString("vi-VN")} ₫`;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const $ = (selector) => document.querySelector(selector);

const sampleProducts = [
  { id: "saline", name: "Nước muối sinh lý 0,9%", unit: "Chai 500 ml", price: 12000, stock: 30, symbol: "◒" },
  { id: "vitamin-c", name: "Vitamin C 500 mg", unit: "Hộp 20 viên", price: 35000, stock: 20, symbol: "✦" },
  { id: "mask", name: "Khẩu trang y tế", unit: "Hộp 50 chiếc", price: 45000, stock: 15, symbol: "▱" },
  { id: "bandage", name: "Băng cá nhân", unit: "Hộp 20 miếng", price: 18000, stock: 25, symbol: "✚" },
  { id: "thermometer", name: "Nhiệt kế điện tử", unit: "Chiếc", price: 85000, stock: 3, symbol: "°" },
  { id: "handwash", name: "Dung dịch rửa tay", unit: "Chai 100 ml", price: 25000, stock: 0, symbol: "◈" },
];

export const demoOrigin = { lat: 21.0285, lon: 105.8542 };
export const demoPharmacies = [
  { id: "demo-an-tam", name: "Nhà thuốc An Tâm · Demo", address: "12 Phố Mẫu, Hoàn Kiếm, Hà Nội (địa chỉ minh họa)", lat: 21.032, lon: 105.848, roadDistanceKm: 1.2, roadDurationMinutes: 5,
    demoRoute: [[105.8542, 21.0285], [105.8542, 21.0305], [105.851, 21.0305], [105.851, 21.032], [105.848, 21.032]] },
  { id: "demo-minh-an", name: "Nhà thuốc Minh An · Demo", address: "28 Đường Minh Họa, Hoàn Kiếm, Hà Nội (địa chỉ minh họa)", lat: 21.019, lon: 105.851, roadDistanceKm: 1.8, roadDurationMinutes: 7,
    demoRoute: [[105.8542, 21.0285], [105.8542, 21.025], [105.857, 21.025], [105.857, 21.019], [105.851, 21.019]] },
  { id: "demo-binh-minh", name: "Nhà thuốc Bình Minh · Demo", address: "56 Đường Trải Nghiệm, Hai Bà Trưng, Hà Nội (địa chỉ minh họa)", lat: 21.014, lon: 105.861, roadDistanceKm: 2.7, roadDurationMinutes: 10,
    demoRoute: [[105.8542, 21.0285], [105.8542, 21.023], [105.849, 21.023], [105.849, 21.014], [105.861, 21.014]] },
].map((pharmacy) => ({ ...pharmacy, isDemo: true, roadStatus: "ready" }));

function readState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { inventories: {}, orders: [] };
  const state = JSON.parse(raw);
  if (!state || !Array.isArray(state.orders) || !state.inventories || typeof state.inventories !== "object" || Array.isArray(state.inventories)) {
    throw new Error("Dữ liệu đơn hàng trên trình duyệt không hợp lệ.");
  }
  return state;
}

function pharmacyKey(pharmacy) {
  return String(pharmacy.id || `${pharmacy.name}|${pharmacy.lat ?? ""}|${pharmacy.lon ?? pharmacy.address}`);
}

function catalogFor(state, pharmacy) {
  const saved = state.inventories[pharmacyKey(pharmacy)];
  return saved || sampleProducts.map((item) => ({ ...item }));
}

export function getCheckoutOrders(email) {
  const orders = readState().orders;
  return email ? orders.filter((order) => order.customerEmail === email.toLowerCase()) : orders;
}

let checkout = null;
let activeInvoice = null;
const checkoutDialog = $("#checkoutDialog");
const invoiceDialog = $("#invoiceDialog");
const checkoutForm = $("#checkoutForm");
const medicineSearch = $("#checkoutMedicineSearch");

function normalizeProductSearch(value) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
}

function filterCheckoutProducts() {
  const terms = normalizeProductSearch(medicineSearch.value).trim().split(/\s+/).filter(Boolean);
  let count = 0;
  checkout?.catalog.forEach((product, index) => {
    const text = normalizeProductSearch(`${product.name} ${product.unit}`).replace(/\s+/g, "");
    const matches = terms.every((term) => text.includes(term));
    $(`#cartQuantity${index}`).closest(".checkout-product").hidden = !matches;
    if (matches) count++;
  });
  medicineSearch.disabled = !checkout;
  $("#clearCheckoutSearch").hidden = !medicineSearch.value;
  $("#checkoutSearchEmpty").hidden = !checkout || count > 0;
  $("#checkoutSearchStatus").textContent = !checkout ? "Chưa có danh mục sản phẩm."
    : terms.length ? `${count} / ${checkout.catalog.length} sản phẩm · Sản phẩm đã chọn vẫn được giữ trong đơn.`
    : `${count} sản phẩm`;
}

medicineSearch.addEventListener("input", filterCheckoutProducts);
medicineSearch.addEventListener("keydown", (event) => {
  // Enter searches within the catalog; it must not accidentally place an order.
  if (event.key === "Enter") event.preventDefault();
});
$("#clearCheckoutSearch").addEventListener("click", () => {
  medicineSearch.value = "";
  filterCheckoutProducts();
  medicineSearch.focus();
});
checkoutForm.addEventListener("invalid", (event) => {
  // Reveal an invalid quantity hidden by the filter so native validation can focus it.
  if (event.target.closest(".checkout-product[hidden]")) {
    medicineSearch.value = "";
    filterCheckoutProducts();
  }
}, true);

export function openPharmacyOrder(pharmacy, customer = null) {
  checkoutForm.reset();
  $("#checkoutError").textContent = "";
  $("#checkoutPhone").setCustomValidity("");
  $("#checkoutTitle").textContent = `Đặt hàng · ${pharmacy.name}`;
  $("#checkoutPharmacyAddress").textContent = pharmacy.address;
  $("#checkoutName").value = customer?.name || "";
  $("#checkoutEmail").value = customer?.email || "";
  checkout = null;
  $("#checkoutProductList").innerHTML = "";
  try {
    const catalog = catalogFor(readState(), pharmacy);
    checkout = { pharmacy: { ...pharmacy, id: pharmacyKey(pharmacy) }, catalog };
    $("#checkoutProductList").innerHTML = catalog.map((product, index) => `
      <div class="checkout-product ${product.stock ? "" : "sold-out"}">
        <span class="checkout-product-symbol" aria-hidden="true">${escapeHtml(product.symbol)}</span>
        <div><h4>${escapeHtml(product.name)}</h4><small>${escapeHtml(product.unit)} · ${product.stock ? `Còn ${product.stock}` : "Hết hàng"}</small>
          <p class="checkout-product-price">${money(product.price)}</p>
          <div class="checkout-quantity-row"><div class="quantity-control">
            <button type="button" data-quantity-step="-1" data-product-index="${index}" aria-label="Giảm ${escapeHtml(product.name)}" disabled>−</button>
            <input type="number" id="cartQuantity${index}" data-product-index="${index}" min="0" max="${product.stock}" step="1" value="0" aria-label="Số lượng ${escapeHtml(product.name)}" ${product.stock ? "" : "disabled"} />
            <button type="button" data-quantity-step="1" data-product-index="${index}" aria-label="Tăng ${escapeHtml(product.name)}" ${product.stock ? "" : "disabled"}>+</button>
          </div><span class="line-total" data-line-total="${index}">0 ₫</span></div>
        </div>
      </div>`).join("");
  } catch {
    $("#checkoutError").textContent = "Không đọc được dữ liệu đơn hàng. Hãy kiểm tra quyền lưu trữ của trình duyệt; dữ liệu cũ được giữ nguyên.";
  }
  updateFulfillment();
  updateSummary();
  filterCheckoutProducts();
  checkoutDialog.showModal();
}

function selectedItems(catalog = checkout?.catalog || []) {
  return catalog.flatMap((product, index) => {
    const quantity = Number($(`#cartQuantity${index}`)?.value);
    return Number.isInteger(quantity) && quantity > 0
      ? [{ id: product.id, name: product.name, unit: product.unit, price: product.price, quantity, total: product.price * quantity }]
      : [];
  });
}

function updateFulfillment() {
  const delivery = $("#checkoutFulfillment").value === "delivery";
  $("#checkoutAddressField").hidden = !delivery;
  $("#checkoutAddress").disabled = !delivery;
  $("#checkoutAddress").required = delivery;
  $("#checkoutPaymentNote").textContent = delivery ? "Thanh toán khi nhận hàng. Phí giao hàng minh họa cố định 15.000 ₫." : "Thanh toán tại nhà thuốc khi nhận hàng.";
  updateSummary();
}

function updateSummary() {
  const items = selectedItems();
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const shipping = $("#checkoutFulfillment").value === "delivery" ? SHIPPING_FEE : 0;
  $("#checkoutItemCount").textContent = `(${items.reduce((sum, item) => sum + item.quantity, 0)} sản phẩm)`;
  $("#checkoutSubtotal").textContent = money(subtotal);
  $("#checkoutShipping").textContent = money(shipping);
  $("#checkoutTotal").textContent = money(subtotal + shipping);
  $("#confirmCheckout").disabled = !checkout || !items.length;
  checkout?.catalog.forEach((product, index) => {
    const input = $(`#cartQuantity${index}`);
    const quantity = Number(input.value);
    $(`[data-line-total="${index}"]`).textContent = money(Number.isInteger(quantity) && quantity > 0 ? quantity * product.price : 0);
    $(`[data-product-index="${index}"][data-quantity-step="-1"]`).disabled = quantity <= 0 || !product.stock;
    $(`[data-product-index="${index}"][data-quantity-step="1"]`).disabled = quantity >= product.stock || !product.stock;
  });
}

$("#checkoutProductList").addEventListener("input", updateSummary);
$("#checkoutProductList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-quantity-step]");
  if (!button || !checkout) return;
  const index = Number(button.dataset.productIndex);
  const input = $(`#cartQuantity${index}`);
  input.value = Math.max(0, Math.min(checkout.catalog[index].stock, (Number(input.value) || 0) + Number(button.dataset.quantityStep)));
  updateSummary();
});
$("#checkoutFulfillment").addEventListener("change", updateFulfillment);
$("#checkoutPhone").addEventListener("input", () => $("#checkoutPhone").setCustomValidity(""));
$("#fillDemoOrder").addEventListener("click", () => {
  if (!checkout) return;
  $("#checkoutName").value ||= "Nguyễn Minh Anh";
  $("#checkoutPhone").value = "0901234567";
  $("#checkoutPhone").setCustomValidity("");
  $("#checkoutEmail").value ||= "khach.demo@example.com";
  $("#checkoutAddress").value = "24 Phố Mẫu, Hoàn Kiếm, Hà Nội (địa chỉ demo)";
  let remaining = 2;
  checkout.catalog.forEach((product, index) => {
    $(`#cartQuantity${index}`).value = product.stock > 0 && remaining-- > 0 ? Math.min(product.stock, index === 0 ? 2 : 1) : 0;
  });
  $("#checkoutError").textContent = "";
  updateSummary();
});

checkoutForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!checkout) return;
  const error = $("#checkoutError");
  error.textContent = "";
  const phone = $("#checkoutPhone").value.trim();
  const digits = phone.replace(/\D/g, "");
  if (!/^\+?[\d\s().-]+$/.test(phone) || digits.length < 9 || digits.length > 15) {
    $("#checkoutPhone").setCustomValidity("Vui lòng nhập số điện thoại hợp lệ (9–15 chữ số).");
  }
  if (!checkoutForm.reportValidity()) return;
  const customer = $("#checkoutName").value.trim();
  const delivery = $("#checkoutFulfillment").value === "delivery";
  const address = delivery ? $("#checkoutAddress").value.trim() : checkout.pharmacy.address;
  if (!customer || !address) {
    error.textContent = "Vui lòng nhập họ tên và địa chỉ nhận hàng hợp lệ.";
    return;
  }
  $("#confirmCheckout").disabled = true;
  try {
    // Re-read before confirming: another checkout may have changed the available stock.
    const state = readState();
    const catalog = catalogFor(state, checkout.pharmacy);
    const items = selectedItems();
    if (!items.length) throw new Error("Hãy chọn ít nhất một sản phẩm.");
    for (const item of items) {
      const product = catalog.find((entry) => entry.id === item.id);
      if (!product || item.quantity > product.stock) throw new Error(`${item.name} không đủ tồn kho. Hãy đóng và mở lại cửa sổ để cập nhật số lượng.`);
      if (item.price !== product.price) throw new Error("Đơn giá đã thay đổi. Hãy đóng và mở lại cửa sổ để cập nhật.");
    }
    const subtotal = items.reduce((sum, item) => sum + item.total, 0);
    const shipping = delivery ? SHIPPING_FEE : 0;
    const order = {
      id: `DH-${crypto.randomUUID().toUpperCase()}`, createdAt: new Date().toISOString(),
      pharmacy: checkout.pharmacy, customer, customerPhone: phone,
      customerEmail: $("#checkoutEmail").value.trim().toLowerCase(),
      fulfillment: delivery ? "delivery" : "pickup", address,
      note: $("#checkoutNote").value.trim(), items, subtotal, shipping, total: subtotal + shipping,
      status: "Chờ xử lý · Demo", paymentStatus: "Chưa thanh toán", isDemo: true,
    };
    state.inventories[checkout.pharmacy.id] = catalog.map((product) => ({ ...product,
      stock: product.stock - (items.find((item) => item.id === product.id)?.quantity || 0),
    }));
    state.orders.unshift(order);
    // A single write persists the order, invoice snapshot and stock together.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    checkout = null;
    checkoutDialog.close();
    showInvoice(order);
    document.dispatchEvent(new CustomEvent("pharmacy-order-created"));
  } catch (failure) {
    error.textContent = failure instanceof DOMException
      ? "Không thể lưu đơn hàng. Hãy kiểm tra quyền lưu trữ hoặc dung lượng trình duyệt. Đơn chưa được tạo."
      : failure.message;
    updateSummary();
  }
});

function invoiceMarkup(order) {
  const date = new Date(order.createdAt).toLocaleString("vi-VN");
  return `<article class="invoice-sheet">
    <div class="invoice-top"><div><div class="invoice-brand">✚ Smart Pharmacy</div><h3>${order.isDemo ? "HÓA ĐƠN DEMO" : "HÓA ĐƠN ĐẶT HÀNG"}</h3><p>${escapeHtml(order.pharmacy.name)}</p><p>${escapeHtml(order.pharmacy.address)}</p></div><div><p><strong>${escapeHtml(order.id)}</strong></p><p>${escapeHtml(date)}</p><span class="invoice-status">${escapeHtml(order.paymentStatus)}</span><p>${escapeHtml(order.status)}</p></div></div>
    <div class="invoice-customer"><div><h4>KHÁCH HÀNG</h4><p><strong>${escapeHtml(order.customer)}</strong></p><p>${escapeHtml(order.customerPhone)}</p>${order.customerEmail ? `<p>${escapeHtml(order.customerEmail)}</p>` : ""}</div><div><h4>${order.fulfillment === "delivery" ? "GIAO TẬN NƠI" : "NHẬN TẠI NHÀ THUỐC"}</h4><p>${escapeHtml(order.address)}</p><p>${order.fulfillment === "delivery" ? "Thanh toán khi nhận hàng" : "Thanh toán tại nhà thuốc"}</p></div></div>
    <div class="invoice-table-wrap"><table class="invoice-table"><thead><tr><th>Sản phẩm</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead><tbody>${order.items.map((item) => `<tr><td>${escapeHtml(item.name)}<br><small>${escapeHtml(item.unit)}</small></td><td>${item.quantity}</td><td>${money(item.price)}</td><td>${money(item.total)}</td></tr>`).join("")}</tbody></table></div>
    <div class="invoice-totals"><div><span>Tạm tính</span><strong>${money(order.subtotal)}</strong></div><div><span>Phí giao hàng</span><strong>${money(order.shipping)}</strong></div><div><span>Tổng thanh toán</span><strong>${money(order.total)}</strong></div></div>
    ${order.note ? `<p><strong>Ghi chú:</strong> ${escapeHtml(order.note)}</p>` : ""}
    <p class="invoice-footnote">${order.isDemo ? "Hóa đơn minh họa, không phải hóa đơn thuế hay xác nhận thanh toán. Đơn chỉ lưu trên trình duyệt này, chưa gửi đến nhà thuốc." : "Bản tóm tắt đơn hàng được lưu trên hệ thống, không phải hóa đơn thuế hay xác nhận thanh toán."}</p>
  </article>`;
}

export function showInvoice(order) {
  activeInvoice = order;
  invoiceDialog.querySelector(".tag").textContent = order.isDemo ? "ĐƠN HÀNG DEMO" : "ĐƠN HÀNG TRÊN HỆ THỐNG";
  $("#invoiceContent").innerHTML = invoiceMarkup(order);
  if (!invoiceDialog.open) invoiceDialog.showModal();
}

// Use server snapshots for API orders; do not write them into the local demo store.
export function showApiInvoice(order, customer = null) {
  if (!order.items?.length) throw new Error("Chưa tải được chi tiết sản phẩm của đơn hàng.");
  const items = order.items.map((item) => ({
    name: item.name, unit: item.unit || "", quantity: Number(item.quantity),
    price: Number(item.unitPrice), total: Number(item.unitPrice) * Number(item.quantity),
  }));
  showInvoice({
    id: `DH-${order.id}`, createdAt: order.createdAt, pharmacy: order.pharmacy || {},
    customer: order.customer?.name || customer?.name || "Khách hàng",
    customerPhone: order.phone, customerEmail: customer?.email || "",
    fulfillment: "delivery", address: order.shippingAddress, note: order.note,
    items, subtotal: Number(order.totalAmount), shipping: 0, total: Number(order.totalAmount),
    status: order.invoiceStatus || order.status, paymentStatus: "Chưa ghi nhận thanh toán", isDemo: false,
  });
}

$("#printInvoice").addEventListener("click", () => window.print());
$("#downloadInvoice").addEventListener("click", () => {
  if (!activeInvoice) return;
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hóa đơn ${escapeHtml(activeInvoice.id)}</title><style>body{font-family:Arial,sans-serif;max-width:760px;margin:35px auto;padding:0 20px;color:#17345f}p{line-height:1.6;font-size:14px;overflow-wrap:anywhere}.invoice-top{border-bottom:2px solid #2563c9;padding-bottom:15px}.invoice-brand{color:#2563c9;font-weight:bold}.invoice-customer{display:flex;gap:40px;margin:22px 0}.invoice-customer>div{flex:1}.invoice-status{color:#986213}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:12px 6px;text-align:right;border-bottom:1px solid #ddd}th:first-child,td:first-child{text-align:left}th{background:#edf5ff}.invoice-totals{max-width:290px;margin:24px 0 24px auto}.invoice-totals>div{display:flex;justify-content:space-between;gap:10px;margin:12px 0}.invoice-totals>div:last-child{font-size:18px;border-top:1px solid #ccc;padding-top:12px}.invoice-footnote{border-top:1px dashed #ccc;padding-top:15px;font-size:12px;color:#64748b}@media(max-width:480px){.invoice-customer{display:block}}@media print{@page{size:A4;margin:15mm}body{margin:0;padding:0}tr{break-inside:avoid}}</style></head><body>${invoiceMarkup(activeInvoice)}</body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `hoa-don-${activeInvoice.id}.html`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

export function openCheckoutHistory(customer = null) {
  const list = $("#checkoutHistoryList");
  try {
    const orders = getCheckoutOrders(customer?.email);
    list.innerHTML = orders.length ? orders.map((order, index) => `
      <article class="checkout-history-order"><div><span class="demo-badge">${escapeHtml(order.status)}</span><time datetime="${escapeHtml(order.createdAt)}">${escapeHtml(new Date(order.createdAt).toLocaleString("vi-VN"))}</time></div>
        <h3>${escapeHtml(order.pharmacy.name)}</h3><p>${escapeHtml(order.items.map((item) => `${item.name} × ${item.quantity}`).join(" · "))}</p><div><strong>${money(order.total)}</strong><button class="outline-button" type="button" data-invoice-index="${index}">Xem hóa đơn</button></div></article>
    `).join("") : '<p class="checkout-history-empty">Chưa có đơn hàng demo. Chọn “Thử đặt hàng demo” để bắt đầu.</p>';
    list.querySelectorAll("[data-invoice-index]").forEach((button) => button.addEventListener("click", () => {
      $("#checkoutHistoryDialog").close();
      showInvoice(orders[Number(button.dataset.invoiceIndex)]);
    }));
  } catch {
    list.innerHTML = '<p class="checkout-error">Không đọc được lịch sử đơn hàng. Hãy kiểm tra quyền lưu trữ của trình duyệt.</p>';
  }
  $("#checkoutHistoryDialog").showModal();
}

document.querySelectorAll(".shop-dialog").forEach((dialog) => {
  dialog.querySelector("[data-close-dialog]").addEventListener("click", () => dialog.close());
});
