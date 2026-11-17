// Đặt thuốc online: danh sách thuốc theo từng nhà thuốc, giỏ hàng và thanh toán.
// Hoạt động độc lập với danh sách nhà thuốc, nên khi đóng cửa sổ, kết quả tìm kiếm vẫn còn nguyên.
// Đây là bản demo frontend (dữ liệu lưu trong trình duyệt); chưa đồng bộ với máy chủ.

const CART_KEY = "smartPharmacyMedicineCart_v1";
const ORDERS_KEY = "smartPharmacyMedicineOrders_v1";
const PAYMENT_LABEL = "Thanh toán tại nhà (COD)";
const STATUS = {
  pending: "Chờ nhà thuốc xác nhận",
  exported: "Đã xuất kho, chờ vận chuyển",
  shipping: "Đang giao hàng",
  completed: "Đã giao thành công",
  rejected: "Nhà thuốc từ chối",
};
const CARRIERS = ["Giao hàng nhanh", "Giao hàng tiết kiệm", "Viettel Post", "J&T Express", "Nhà thuốc tự giao"];
const STOCK_USED_KEY = "smartPharmacyMedicineStockUsed_v1";

// Thuốc không kê đơn (OTC). Thuốc kê đơn không hỗ trợ đặt trực tuyến.
const CATALOG = [
  { id: "para500", name: "Paracetamol 500mg (hộp 10 vỉ)", price: 15000 },
  { id: "ibu200", name: "Ibuprofen 200mg (hộp 10 vỉ)", price: 20000 },
  { id: "vitc500", name: "Vitamin C 500mg (hộp 20 viên)", price: 45000 },
  { id: "loratadine", name: "Loratadine 10mg (hộp 10 viên)", price: 25000 },
  { id: "nuocmuoi", name: "Nước muối sinh lý 0.9% (chai 500ml)", price: 12000 },
  { id: "sirohoh", name: "Siro ho thảo dược (chai 100ml)", price: 65000 },
  { id: "oresol", name: "Oresol bù nước (gói)", price: 5000 },
  { id: "vienngam", name: "Viên ngậm đau họng (hộp 20 viên)", price: 35000 },
  { id: "caodan", name: "Cao dán giảm đau (miếng)", price: 18000 },
  { id: "khautrang", name: "Khẩu trang y tế (hộp 50 cái)", price: 35000 },
  { id: "mentieu", name: "Men tiêu hóa (hộp 20 gói)", price: 60000 },
  { id: "berberin", name: "Berberin 100mg (hộp 20 viên)", price: 15000 },
];

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (value) => `${Number(value || 0).toLocaleString("vi-VN")} VNĐ`;
const normalize = (value) => String(value ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "d")
  .toLowerCase().trim();
const pharmacyKeyOf = (pharmacy) => `${normalize(pharmacy.name)}|${normalize(pharmacy.address)}`;

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

// Tồn kho demo, cố định theo nhà thuốc và thuốc để không đổi mỗi lần mở.
function baseStock(pharmacyKey, medicineId) {
  let hash = 0;
  for (const ch of `${pharmacyKey}#${medicineId}`) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 8 === 0 ? 0 : 3 + (hash % 27);
}
function stockUsed() { return readJson(STOCK_USED_KEY, {}); }
function stockFor(pharmacyKey, medicineId) {
  return Math.max(0, baseStock(pharmacyKey, medicineId) - (stockUsed()[`${pharmacyKey}#${medicineId}`] || 0));
}

let cart = readJson(CART_KEY, []);
let session = null;        // { pharmacy, key, selected: Map<medicineId, qty> }
let checkoutState = null;  // { items, source: "cart" | "direct" }
let getCustomer = () => null;
let onCreateAccount = () => {};
let ui = {};

function saveCart() { writeJson(CART_KEY, cart); }
function cartCount() { return cart.reduce((sum, item) => sum + item.quantity, 0); }
function cartTotal() { return cart.reduce((sum, item) => sum + item.price * item.quantity, 0); }

export function getMedicineOrders(email) {
  const target = String(email || "").toLowerCase();
  if (!target) return [];
  return readJson(ORDERS_KEY, []).filter((order) => order.customerEmail === target);
}

function buildUi() {
  const html = `
  <div class="mo-root">
    <button class="mo-cart-fab" id="moCartFab" type="button" aria-label="Mở giỏ hàng thuốc">
      🛒 <span>Giỏ hàng</span> <span class="mo-badge" id="moBadge">0</span>
    </button>

    <div class="mo-overlay" id="moOrderOverlay" hidden role="dialog" aria-modal="true" aria-labelledby="moOrderTitle">
      <div class="mo-modal">
        <button class="mo-close" type="button" data-mo-close aria-label="Đóng">×</button>
        <p class="mo-tag">ĐẶT THUỐC ONLINE</p>
        <h2 id="moOrderTitle"></h2>
        <p class="mo-muted" id="moOrderAddress"></p>
        <input class="mo-search" id="moSearch" type="search" placeholder="Tìm tên thuốc..." autocomplete="off" />
        <div class="mo-list" id="moList"></div>
        <div class="mo-notice" id="moNotice" hidden></div>
        <div class="mo-footer">
          <div class="mo-selection">Đã chọn <b id="moSelCount">0</b> sản phẩm · <strong id="moSelTotal">0 VNĐ</strong></div>
          <div class="mo-footer-actions">
            <button class="mo-btn-primary" id="moBuyNow" type="button" disabled>Mua ngay</button>
            <button class="mo-btn-outline" id="moAddCart" type="button" disabled>Thêm vào giỏ hàng</button>
          </div>
        </div>
      </div>
    </div>

    <div class="mo-overlay" id="moCartOverlay" hidden role="dialog" aria-modal="true" aria-labelledby="moCartTitle">
      <div class="mo-modal mo-modal-wide">
        <button class="mo-close" type="button" data-mo-close aria-label="Đóng">×</button>
        <p class="mo-tag">GIỎ HÀNG</p>
        <h2 id="moCartTitle">Giỏ hàng của bạn</h2>
        <div id="moCartBody"></div>
      </div>
    </div>

    <div class="mo-overlay" id="moCheckoutOverlay" hidden role="dialog" aria-modal="true" aria-labelledby="moCheckoutTitle">
      <div class="mo-modal mo-modal-wide">
        <button class="mo-close" type="button" data-mo-close aria-label="Đóng">×</button>
        <div id="moCheckoutBody" class="mo-checkout">
          <form class="mo-checkout-form" id="moCheckoutForm">
            <h3 id="moCheckoutTitle">Thông tin mua hàng</h3>
            <label>Email<input name="email" type="email" required autocomplete="email" placeholder="you@example.com" /></label>
            <label>Họ và tên<input name="name" required maxlength="100" autocomplete="name" /></label>
            <label>Số điện thoại<input name="phone" type="tel" required pattern="(0|\\+84)[0-9]{9,10}" autocomplete="tel" /></label>
            <div class="mo-grid3">
              <label>Tỉnh/thành<input name="province" maxlength="60" /></label>
              <label>Quận/huyện<input name="district" maxlength="60" /></label>
              <label>Phường/xã<input name="ward" maxlength="60" /></label>
            </div>
            <label>Địa chỉ cụ thể<input name="address" required minlength="5" maxlength="200" autocomplete="street-address" /></label>
            <label>Ghi chú (tùy chọn)<textarea name="note" rows="2" maxlength="300"></textarea></label>

            <h3>Thanh toán</h3>
            <div class="mo-cod"><span aria-hidden="true">💵</span><div><b>Thanh toán tại nhà (COD)</b><small>Trả tiền mặt khi nhận thuốc.</small></div></div>

            <button class="mo-btn-primary mo-wide" type="submit">ĐẶT HÀNG</button>
          </form>
          <aside class="mo-summary">
            <h3>Đơn hàng</h3>
            <div id="moSummaryItems"></div>
            <div class="mo-sum-row"><span>Tạm tính</span><b id="moSubtotal"></b></div>
            <div class="mo-sum-row"><span>Phí vận chuyển</span><span>Tính sau khi nhà thuốc xác nhận</span></div>
            <div class="mo-sum-total"><span>Tổng cộng</span><strong id="moGrandTotal"></strong></div>
          </aside>
        </div>
        <div class="mo-success" id="moSuccess" hidden></div>
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML("beforeend", html);
  const $ = (id) => document.getElementById(id);
  ui = {
    fab: $("moCartFab"), badge: $("moBadge"),
    orderOverlay: $("moOrderOverlay"), orderTitle: $("moOrderTitle"), orderAddress: $("moOrderAddress"),
    search: $("moSearch"), list: $("moList"), notice: $("moNotice"),
    selCount: $("moSelCount"), selTotal: $("moSelTotal"), buyNow: $("moBuyNow"), addCart: $("moAddCart"),
    cartOverlay: $("moCartOverlay"), cartBody: $("moCartBody"),
    checkoutOverlay: $("moCheckoutOverlay"), checkoutBody: $("moCheckoutBody"), checkoutForm: $("moCheckoutForm"),
    summaryItems: $("moSummaryItems"), subtotal: $("moSubtotal"), grandTotal: $("moGrandTotal"),
    success: $("moSuccess"),
  };
}

function anyOverlayOpen() {
  return [ui.orderOverlay, ui.cartOverlay, ui.checkoutOverlay].some((el) => !el.hidden);
}
function setOverlay(el, open) {
  el.hidden = !open;
  document.body.classList.toggle("mo-locked", anyOverlayOpen());
}
function closeAll() {
  setOverlay(ui.orderOverlay, false);
  setOverlay(ui.cartOverlay, false);
  setOverlay(ui.checkoutOverlay, false);
}

function updateBadge() { ui.badge.textContent = cartCount(); }

// ---------- Cửa sổ thuốc của một nhà thuốc ----------

function selectedItems() {
  if (!session) return [];
  return [...session.selected].map(([medicineId, quantity]) => {
    const medicine = CATALOG.find((m) => m.id === medicineId);
    return {
      key: session.key,
      pharmacyName: session.pharmacy.name,
      pharmacyAddress: session.pharmacy.address,
      medicineId,
      name: medicine.name,
      price: medicine.price,
      quantity,
      maxQuantity: stockFor(session.key, medicineId),
    };
  });
}

function updateFooter() {
  const items = selectedItems();
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  ui.selCount.textContent = count;
  ui.selTotal.textContent = money(total);
  ui.buyNow.disabled = !count;
  ui.addCart.disabled = !count;
}

function setQuantity(medicineId, value) {
  const stock = stockFor(session.key, medicineId);
  const qty = Math.max(0, Math.min(stock, Math.floor(Number(value) || 0)));
  if (qty) session.selected.set(medicineId, qty);
  else session.selected.delete(medicineId);
  const row = ui.list.querySelector(`[data-id="${medicineId}"] input`);
  if (row) row.value = qty;
  updateFooter();
}

function openMedicineOrder(pharmacy) {
  const name = pharmacy?.name || "Nhà thuốc";
  const address = pharmacy?.address || "";
  const key = pharmacyKeyOf({ name, address });
  session = { pharmacy: { name, address }, key, selected: new Map() };

  ui.orderTitle.textContent = name;
  ui.orderAddress.textContent = address;
  ui.search.value = "";
  ui.notice.hidden = true;
  ui.notice.innerHTML = "";
  ui.list.innerHTML = CATALOG.map((medicine) => {
    const stock = stockFor(key, medicine.id);
    const disabled = stock ? "" : "disabled";
    return `
      <article class="mo-item" data-id="${escapeHtml(medicine.id)}" data-name="${escapeHtml(normalize(medicine.name))}">
        <div class="mo-item-info">
          <h4>${escapeHtml(medicine.name)}</h4>
          <p>${stock ? `Còn ${stock} sản phẩm` : '<span class="mo-out">Hết hàng</span>'}</p>
        </div>
        <strong class="mo-price">${money(medicine.price)}</strong>
        <div class="mo-qty">
          <button type="button" data-step="-1" aria-label="Giảm số lượng" ${disabled}>−</button>
          <input type="number" min="0" max="${stock}" value="0" inputmode="numeric" aria-label="Số lượng ${escapeHtml(medicine.name)}" ${disabled} />
          <button type="button" data-step="1" aria-label="Tăng số lượng" ${disabled}>+</button>
        </div>
      </article>`;
  }).join("");

  setOverlay(ui.orderOverlay, true);
  updateFooter();
}

function addToCart(items) {
  for (const item of items) {
    const existing = cart.find((row) => row.key === item.key && row.medicineId === item.medicineId);
    if (existing) existing.quantity = Math.min(existing.quantity + item.quantity, item.maxQuantity);
    else cart.push({ ...item });
  }
  saveCart();
  updateBadge();
}

function resetSelection() {
  session.selected.clear();
  ui.list.querySelectorAll(".mo-item input").forEach((input) => { input.value = 0; });
  updateFooter();
}

// ---------- Giỏ hàng ----------

function renderCart() {
  if (!cart.length) {
    ui.cartBody.innerHTML = `
      <div class="mo-empty"><span>🛒</span><h3>Giỏ hàng đang trống</h3>
      <p>Chọn nhà thuốc, bấm “Đặt thuốc online” và thêm thuốc vào giỏ.</p></div>`;
    return;
  }
  ui.cartBody.innerHTML = `
    <div class="mo-table-wrap">
      <table class="mo-table">
        <thead><tr><th>Ảnh</th><th>Tên sản phẩm</th><th>Đơn giá</th><th>Số lượng</th><th>Thành tiền</th><th>Xoá</th></tr></thead>
        <tbody>
          ${cart.map((item, index) => `
            <tr>
              <td><div class="mo-thumb">✚</div></td>
              <td><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.pharmacyName)}</small></td>
              <td>${money(item.price)}</td>
              <td>
                <div class="mo-qty">
                  <button type="button" data-cart-step="-1" data-index="${index}" aria-label="Giảm">−</button>
                  <input type="number" min="1" max="${item.maxQuantity}" value="${item.quantity}" data-cart-input="${index}" aria-label="Số lượng" />
                  <button type="button" data-cart-step="1" data-index="${index}" aria-label="Tăng" ${item.quantity >= item.maxQuantity ? "disabled" : ""}>+</button>
                </div>
              </td>
              <td><b>${money(item.price * item.quantity)}</b></td>
              <td><button type="button" class="mo-trash" data-remove="${index}" aria-label="Xoá">🗑</button></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div class="mo-cart-total"><span>Tổng tiền</span><strong>${money(cartTotal())}</strong></div>
    <div class="mo-cart-actions">
      <button class="mo-btn-primary" type="button" id="moCheckoutCart">Tiến hành đặt hàng</button>
    </div>
    <p class="mo-muted">Mỗi nhà thuốc sẽ nhận một đơn hàng riêng. Đơn thuốc kê đơn không hỗ trợ đặt trực tuyến.</p>`;
}

// ---------- Thanh toán ----------

function openCheckout(items, source) {
  checkoutState = { items, source };
  const customer = getCustomer();
  const form = ui.checkoutForm;
  form.reset();
  if (customer?.email) form.elements.email.value = customer.email;
  if (customer?.name) form.elements.name.value = customer.name;
  ui.checkoutBody.hidden = false;
  ui.success.hidden = true;

  const groups = groupByPharmacy(items);
  ui.summaryItems.innerHTML = [...groups.values()].map((group) => `
    <div class="mo-sum-group">
      <p class="mo-sum-pharmacy">${escapeHtml(group[0].pharmacyName)}</p>
      ${group.map((item) => `<div class="mo-sum-item"><span>${escapeHtml(item.name)} × ${item.quantity}</span><b>${money(item.price * item.quantity)}</b></div>`).join("")}
    </div>`).join("");
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  ui.subtotal.textContent = money(total);
  ui.grandTotal.textContent = money(total);
  setOverlay(ui.checkoutOverlay, true);
}

function groupByPharmacy(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.key)) groups.set(item.key, []);
    groups.get(item.key).push(item);
  }
  return groups;
}

function submitOrders(event) {
  event.preventDefault();
  const form = ui.checkoutForm;
  if (!checkoutState?.items.length) return;
  const data = Object.fromEntries(new FormData(form));
  const address = [data.address, data.ward, data.district, data.province].map((part) => String(part || "").trim()).filter(Boolean).join(", ");
  const paymentMethod = PAYMENT_LABEL;
  const createdAt = new Date().toISOString();
  const stamp = Date.now().toString(36).toUpperCase();

  const orders = [...groupByPharmacy(checkoutState.items).values()].map((group, index) => {
    const total = group.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const quantity = group.reduce((sum, item) => sum + item.quantity, 0);
    return {
      id: `DT${stamp}${index + 1}`,
      statusCode: "pending",
      status: STATUS.pending,
      pharmacyName: group[0].pharmacyName,
      pharmacyAddress: group[0].pharmacyAddress,
      customer: data.name,
      customerEmail: String(data.email || "").toLowerCase(),
      phone: data.phone,
      shippingAddress: address,
      note: data.note || "",
      paymentMethod,
      medicine: group.map((item) => `${item.name} × ${item.quantity}`).join(", "),
      quantity,
      total,
      date: createdAt,
      items: group.map(({ name, quantity: qty, price, medicineId }) => ({ name, quantity: qty, price, medicineId })),
    };
  });

  writeJson(ORDERS_KEY, [...orders, ...readJson(ORDERS_KEY, [])]);

  if (checkoutState.source === "cart") {
    cart = [];
    saveCart();
    updateBadge();
  }

  rememberOrders(orders.map((order) => order.id));
  renderRecentOrders();

  const hasAccount = accountExists(data.email);
  const loggedIn = Boolean(getCustomer()?.email);
  ui.checkoutBody.hidden = true;
  ui.success.hidden = false;
  ui.success.innerHTML = `
    <div class="mo-success-icon">✓</div>
    <h2>Đặt hàng thành công!</h2>
    <p class="mo-muted">Thanh toán: ${escapeHtml(paymentMethod)}. Nhà thuốc sẽ xác nhận và giao thuốc cho bạn.</p>
    <ul class="mo-success-list">
      ${orders.map((order) => `<li><b>Mã đơn: ${escapeHtml(order.id)}</b> · ${escapeHtml(order.pharmacyName)} · ${money(order.total)}</li>`).join("")}
    </ul>
    <div class="ol-tip">
      <p><b>Hãy lưu lại mã đơn</b> và số điện thoại <b>${escapeHtml(data.phone)}</b>. Bạn dùng hai thông tin này ở mục “Tra cứu đơn thuốc” để xem tình trạng và thông tin vận chuyển. Đơn cũng được lưu trên thiết bị này.</p>
    </div>
    <div class="ol-tip ol-tip-account">
      ${loggedIn
        ? `<p>Bạn đã đăng nhập. Đơn này sẽ có trong Lịch sử đơn thuốc, hoặc bạn có thể tra cứu ngay tình trạng đơn.</p>
      <button class="mo-btn-outline" type="button" data-go-lookup="${escapeHtml(orders[0]?.id || "")}" data-lookup-phone="${escapeHtml(data.phone)}">Tra cứu đơn</button>`
        : `<p>${hasAccount
          ? `Email <b>${escapeHtml(data.email)}</b> đã có tài khoản. Đăng nhập để xem tất cả đơn trong Lịch sử đơn thuốc.`
          : `Chưa có tài khoản? Tạo tài khoản bằng email <b>${escapeHtml(data.email)}</b> để xem toàn bộ đơn của bạn trong Lịch sử đơn thuốc.`}</p>
      <button class="mo-btn-outline" type="button" data-create-account="${escapeHtml(data.email)}">${hasAccount ? "Đăng nhập" : "Tạo tài khoản"}</button>`}
    </div>
    <button class="mo-btn-primary" type="button" id="moBackToSearch">Quay lại tìm nhà thuốc</button>`;
}

// ---------- Khởi tạo ----------

export function initMedicineOrder({ getCustomer: customerGetter, onCreateAccount: accountHandler } = {}) {
  if (customerGetter) getCustomer = customerGetter;
  if (accountHandler) onCreateAccount = accountHandler;
  buildUi();
  updateBadge();

  ui.search.addEventListener("input", () => {
    const query = normalize(ui.search.value);
    ui.list.querySelectorAll(".mo-item").forEach((row) => {
      row.hidden = Boolean(query) && !row.dataset.name.includes(query);
    });
  });

  ui.list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-step]");
    if (!button || !session) return;
    const medicineId = button.closest(".mo-item").dataset.id;
    const current = session.selected.get(medicineId) || 0;
    setQuantity(medicineId, current + Number(button.dataset.step));
  });

  ui.list.addEventListener("change", (event) => {
    const input = event.target.closest(".mo-item input");
    if (!input || !session) return;
    setQuantity(input.closest(".mo-item").dataset.id, input.value);
  });

  ui.buyNow.addEventListener("click", () => {
    const items = selectedItems();
    if (!items.length) return;
    closeAll();
    openCheckout(items, "direct");
  });

  ui.addCart.addEventListener("click", () => {
    const items = selectedItems();
    if (!items.length) return;
    addToCart(items);
    const count = items.reduce((sum, item) => sum + item.quantity, 0);
    resetSelection();
    ui.notice.hidden = false;
    ui.notice.innerHTML = `
      <div><b>✓ Đã thêm ${count} sản phẩm vào giỏ hàng</b></div>
      <div class="mo-notice-actions">
        <button class="mo-btn-outline" type="button" data-notice="continue">Tiếp tục mua</button>
        <button class="mo-btn-primary" type="button" data-notice="cart">Xem giỏ hàng</button>
      </div>`;
  });

  ui.notice.addEventListener("click", (event) => {
    const action = event.target.closest("[data-notice]")?.dataset.notice;
    if (action === "continue") ui.notice.hidden = true;
    if (action === "cart") {
      setOverlay(ui.orderOverlay, false);
      renderCart();
      setOverlay(ui.cartOverlay, true);
    }
  });

  ui.fab.addEventListener("click", () => {
    renderCart();
    setOverlay(ui.cartOverlay, true);
  });

  ui.cartBody.addEventListener("click", (event) => {
    const step = event.target.closest("[data-cart-step]");
    const remove = event.target.closest("[data-remove]");
    const checkoutButton = event.target.closest("#moCheckoutCart");
    if (step) {
      const item = cart[Number(step.dataset.index)];
      item.quantity = Math.max(1, Math.min(item.maxQuantity, item.quantity + Number(step.dataset.cartStep)));
    } else if (remove) {
      cart.splice(Number(remove.dataset.remove), 1);
    } else if (checkoutButton) {
      setOverlay(ui.cartOverlay, false);
      openCheckout([...cart], "cart");
      return;
    } else {
      return;
    }
    saveCart();
    updateBadge();
    renderCart();
  });

  ui.cartBody.addEventListener("change", (event) => {
    const input = event.target.closest("[data-cart-input]");
    if (!input) return;
    const item = cart[Number(input.dataset.cartInput)];
    item.quantity = Math.max(1, Math.min(item.maxQuantity, Math.floor(Number(input.value) || 1)));
    saveCart();
    updateBadge();
    renderCart();
  });

  ui.checkoutForm.addEventListener("submit", submitOrders);
  ui.success.addEventListener("click", (event) => {
    if (event.target.closest("#moBackToSearch")) {
      closeAll();
      checkoutState = null;
      return;
    }
    const goLookup = event.target.closest("[data-go-lookup]");
    if (goLookup) {
      const { goLookup: code, lookupPhone: phone } = goLookup.dataset;
      closeAll();
      checkoutState = null;
      const section = document.querySelector("#orderLookup");
      const form = section?.querySelector("#orderLookupForm");
      if (form) {
        form.elements.code.value = code || "";
        form.elements.phone.value = phone || "";
        if (code && phone) form.requestSubmit();
      }
      section?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const account = event.target.closest("[data-create-account]");
    if (account) {
      const email = account.dataset.createAccount;
      closeAll();
      checkoutState = null;
      onCreateAccount(email, accountExists(email));
    }
  });
  initOwnerOrderEvents();
  initOrderLookup();

  document.querySelectorAll(".mo-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-mo-close]")) {
        if (overlay === ui.checkoutOverlay) checkoutState = null;
        setOverlay(overlay, false);
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !anyOverlayOpen()) return;
    [ui.checkoutOverlay, ui.cartOverlay, ui.orderOverlay].forEach((overlay) => {
      if (!overlay.hidden && overlay === ui.checkoutOverlay) checkoutState = null;
    });
    closeAll();
  });
}

export { openMedicineOrder };


// ---------- Phía nhà thuốc: đơn đặt online, hóa đơn xuất kho, vận chuyển ----------

let currentOwnerPharmacy = null;
let ownerTimer = null;
let ownerNotice = "";

const statusCodeOf = (order) => order.statusCode || "pending";
const readOrders = () => readJson(ORDERS_KEY, []);
const writeOrders = (orders) => writeJson(ORDERS_KEY, orders);
const medicineIdOf = (item) => item.medicineId || CATALOG.find((m) => m.name === item.name)?.id || "";
const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString("vi-VN") : "");
const formatDay = (day) => (day ? new Date(`${day}T00:00:00`).toLocaleDateString("vi-VN") : "");

function ordersOfPharmacy(pharmacy) {
  const key = pharmacyKeyOf(pharmacy);
  return readOrders()
    .filter((order) => pharmacyKeyOf({ name: order.pharmacyName, address: order.pharmacyAddress }) === key)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function renderOwnerAlert(pending) {
  const box = document.querySelector("#onlineOrderAlert");
  if (!box) return;
  const parts = [];
  if (pending) parts.push(`<b>🔔 Bạn có ${pending} đơn thuốc online chờ xác nhận.</b>`);
  if (ownerNotice) parts.push(`<span>${escapeHtml(ownerNotice)}</span> <button type="button" class="mo-btn-small" data-action="dismiss-notice">Ẩn</button>`);
  box.hidden = !parts.length;
  box.innerHTML = parts.join(" ");
}

function updateOwnerBadges(orders) {
  const pending = orders.filter((order) => statusCodeOf(order) === "pending").length;
  const badge = document.querySelector("#onlineOrderBadge");
  if (badge) {
    badge.textContent = pending;
    badge.hidden = !pending;
  }
  renderOwnerAlert(pending);
  return pending;
}

export function renderOwnerOnlineOrders(pharmacy) {
  currentOwnerPharmacy = pharmacy || null;
  const list = document.querySelector("#onlineOrderList");
  if (!list) return;
  const hasProfile = Boolean(pharmacy?.name && pharmacy?.address);
  const orders = hasProfile ? ordersOfPharmacy(pharmacy) : [];
  updateOwnerBadges(orders);
  if (!hasProfile) {
    list.innerHTML = '<p class="empty-state">Hãy lưu thông tin hiệu thuốc (tên và địa chỉ) ở tab “Thông tin hiệu thuốc” để nhận đơn đặt online.</p>';
    return;
  }
  list.innerHTML = `
    <datalist id="carrierList">${CARRIERS.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("")}</datalist>
    ${orders.length ? orders.map(orderCard).join("") : '<p class="empty-state">Chưa có đơn đặt thuốc online.</p>'}`;
}

function itemsTable(order) {
  const rows = (order.items || []).map((item) =>
    `<tr><td>${escapeHtml(item.name)}</td><td>${item.quantity}</td><td>${money(item.price)}</td><td>${money(item.price * item.quantity)}</td></tr>`).join("");
  return `<table class="oo-table"><thead><tr><th>Thuốc</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function invoiceMarkup(order) {
  const id = escapeHtml(order.id);
  return `
    <section class="oo-invoice" id="inv-${id}">
      <div class="oo-invoice-head">
        <div>
          <p class="oo-invoice-title">HÓA ĐƠN XUẤT KHO</p>
          <small>Số: ${escapeHtml(order.invoice.no)} · Ngày ${escapeHtml(formatDateTime(order.invoice.date))}</small>
        </div>
        <button class="mo-btn-small oo-no-print" type="button" data-action="print" data-order="${id}">In hóa đơn</button>
      </div>
      <p><b>Nhà thuốc:</b> ${escapeHtml(order.pharmacyName)} – ${escapeHtml(order.pharmacyAddress)}</p>
      <p><b>Khách hàng:</b> ${escapeHtml(order.customer)} · ${escapeHtml(order.phone)}</p>
      <p><b>Giao tới:</b> ${escapeHtml(order.shippingAddress)}</p>
      ${itemsTable(order)}
      <p class="oo-invoice-total">Tổng thu khi giao (COD): ${money(order.total)}</p>
    </section>`;
}

function trackingForm(order) {
  const t = order.tracking || {};
  const id = escapeHtml(order.id);
  return `
    <form class="oo-tracking" data-tracking-form="${id}">
      <h4>Thông tin vận chuyển & theo dõi</h4>
      <div class="oo-form-row">
        <label>Đơn vị vận chuyển<input name="carrier" list="carrierList" required maxlength="60" value="${escapeHtml(t.carrier || "")}" /></label>
        <label>Mã vận đơn<input name="trackingNumber" required maxlength="60" value="${escapeHtml(t.trackingNumber || "")}" /></label>
        <label>Ngày dự kiến giao<input name="expectedDate" type="date" value="${escapeHtml(t.expectedDate || "")}" /></label>
      </div>
      <label>Ghi chú cho khách (tùy chọn)<input name="note" maxlength="200" value="${escapeHtml(t.note || "")}" /></label>
      <button class="mo-btn-primary" type="submit">Lưu thông tin theo dõi</button>
    </form>`;
}

function orderCard(order) {
  const code = statusCodeOf(order);
  const id = escapeHtml(order.id);
  let actions = "";
  if (code === "pending") {
    actions = `<button class="mo-btn-primary" type="button" data-action="confirm" data-order="${id}">Xác nhận & xuất kho</button>
      <button class="mo-btn-danger" type="button" data-action="reject" data-order="${id}">Từ chối</button>`;
  } else if (code === "shipping") {
    actions = `<button class="mo-btn-primary" type="button" data-action="complete" data-order="${id}">Xác nhận đã giao</button>`;
  }
  return `
    <article class="oo-card">
      <header class="oo-head">
        <div><strong>Đơn #${id}</strong><small>${escapeHtml(formatDateTime(order.date))}</small></div>
        <span class="oo-status oo-${code}">${escapeHtml(STATUS[code] || order.status)}</span>
      </header>
      <div class="oo-info">
        <p><b>Khách hàng:</b> ${escapeHtml(order.customer)} · ${escapeHtml(order.phone)}</p>
        <p><b>Giao tới:</b> ${escapeHtml(order.shippingAddress)}</p>
        <p><b>Thanh toán:</b> COD (thu tiền khi giao)</p>
        ${order.note ? `<p><b>Ghi chú:</b> ${escapeHtml(order.note)}</p>` : ""}
      </div>
      ${itemsTable(order)}
      <div class="oo-total">Tổng cộng: <b>${money(order.total)}</b></div>
      ${actions ? `<div class="oo-actions">${actions}</div>` : ""}
      ${order.invoice ? invoiceMarkup(order) : ""}
      ${code === "exported" || code === "shipping" ? trackingForm(order) : ""}
      ${order.trackingText ? `<p class="oo-track">🚚 ${escapeHtml(order.trackingText)}</p>` : ""}
    </article>`;
}

function changeOrder(orderId, mutate) {
  const orders = readOrders();
  const order = orders.find((item) => item.id === orderId);
  if (!order) return;
  mutate(order, orders);
  writeOrders(orders);
  ownerNotice = "";
  renderOwnerOnlineOrders(currentOwnerPharmacy);
}

const setStatus = (order, code) => { order.statusCode = code; order.status = STATUS[code]; };

function confirmOrder(orderId) {
  const order = readOrders().find((item) => item.id === orderId);
  if (!order) return;
  const key = pharmacyKeyOf({ name: order.pharmacyName, address: order.pharmacyAddress });
  const short = order.items.filter((item) => stockFor(key, medicineIdOf(item)) < item.quantity);
  if (short.length) {
    ownerNotice = `Không đủ hàng để xuất đơn #${order.id}: ${short.map((item) => item.name).join(", ")}.`;
    renderOwnerOnlineOrders(currentOwnerPharmacy);
    return;
  }
  const used = stockUsed();
  order.items.forEach((item) => {
    const k = `${key}#${medicineIdOf(item)}`;
    used[k] = (used[k] || 0) + item.quantity;
  });
  writeJson(STOCK_USED_KEY, used);
  changeOrder(orderId, (target) => {
    target.invoice = { no: `XK-${target.id}`, date: new Date().toISOString() };
    setStatus(target, "exported");
  });
}

function saveTracking(orderId, form) {
  const data = Object.fromEntries(new FormData(form));
  const carrier = String(data.carrier || "").trim();
  const trackingNumber = String(data.trackingNumber || "").trim();
  const expectedDate = data.expectedDate || "";
  changeOrder(orderId, (order) => {
    order.tracking = { carrier, trackingNumber, expectedDate, note: String(data.note || "").trim(), updatedAt: new Date().toISOString() };
    order.trackingText = [carrier, `Mã vận đơn: ${trackingNumber}`, expectedDate ? `Dự kiến giao: ${formatDay(expectedDate)}` : ""]
      .filter(Boolean).join(" · ");
    if (statusCodeOf(order) === "exported") setStatus(order, "shipping");
  });
  ownerNotice = `Đã lưu thông tin theo dõi cho đơn #${orderId}.`;
  renderOwnerOnlineOrders(currentOwnerPharmacy);
}

function printInvoice(orderId) {
  const invoice = document.getElementById(`inv-${orderId}`);
  if (!invoice) return;
  invoice.classList.add("printing");
  document.body.classList.add("oo-print");
  window.print();
  invoice.classList.remove("printing");
  document.body.classList.remove("oo-print");
}

export function initOwnerOrderEvents() {
  const list = document.querySelector("#onlineOrderList");
  const alertBox = document.querySelector("#onlineOrderAlert");
  if (!list) return;
  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const id = button.dataset.order;
    if (button.dataset.action === "confirm") confirmOrder(id);
    if (button.dataset.action === "reject") changeOrder(id, (order) => setStatus(order, "rejected"));
    if (button.dataset.action === "complete") changeOrder(id, (order) => setStatus(order, "completed"));
    if (button.dataset.action === "print") printInvoice(id);
  });
  list.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-tracking-form]");
    if (!form) return;
    event.preventDefault();
    saveTracking(form.dataset.trackingForm, form);
  });
  alertBox?.addEventListener("click", (event) => {
    if (!event.target.closest('[data-action="dismiss-notice"]')) return;
    ownerNotice = "";
    renderOwnerOnlineOrders(currentOwnerPharmacy);
  });
}

// Kiểm tra đơn mới mỗi 3 giây khi chủ nhà thuốc đang mở bảng quản lý.
export function countPendingOnlineOrders(pharmacy) {
  if (!pharmacy?.name || !pharmacy?.address) return 0;
  return ordersOfPharmacy(pharmacy).filter((order) => statusCodeOf(order) === "pending").length;
}

export function startOwnerOrderWatch(getPharmacy, { onNewOrder } = {}) {
  stopOwnerOrderWatch();
  let knownIds = null;
  let lastSignature = "";
  ownerTimer = setInterval(() => {
    const pharmacy = getPharmacy();
    if (!pharmacy?.name || !pharmacy?.address) return;
    currentOwnerPharmacy = pharmacy;
    const orders = ordersOfPharmacy(pharmacy);
    if (knownIds) {
      const fresh = orders.filter((order) => !knownIds.has(order.id));
      if (fresh.length) {
        ownerNotice = `Khách ${fresh[0].customer} vừa đặt đơn #${fresh[0].id}${fresh.length > 1 ? ` và ${fresh.length - 1} đơn khác` : ""}.`;
        onNewOrder?.(ownerNotice);
      }
    }
    knownIds = new Set(orders.map((order) => order.id));
    const signature = JSON.stringify(orders.map((order) => [order.id, statusCodeOf(order)])) + ownerNotice;
    if (signature === lastSignature) return;
    lastSignature = signature;
    const list = document.querySelector("#onlineOrderList");
    // Không vẽ lại khi chủ nhà thuốc đang nhập dở form vận chuyển.
    if (list?.contains(document.activeElement)) {
      lastSignature = "";
      updateOwnerBadges(orders);
      return;
    }
    renderOwnerOnlineOrders(pharmacy);
  }, 3000);
}

export function stopOwnerOrderWatch() {
  if (ownerTimer) clearInterval(ownerTimer);
  ownerTimer = null;
}


// ---------- Khách hàng: tra cứu đơn không cần tài khoản và đơn gần đây trên thiết bị ----------

const RECENT_KEY = "smartPharmacyRecentOrderIds_v1";
const ACCOUNTS_KEY = "smartPharmacyAccounts";

function accountExists(email) {
  const target = String(email || "").trim().toLowerCase();
  return readJson(ACCOUNTS_KEY, []).some((account) => String(account.email || "").toLowerCase() === target && account.role === "customer");
}

function rememberOrders(ids) {
  const recent = [...ids, ...readJson(RECENT_KEY, []).filter((id) => !ids.includes(id))].slice(0, 10);
  writeJson(RECENT_KEY, recent);
}

const digitsOf = (value) => String(value || "").replace(/\D/g, "").replace(/^84/, "0");

function customerOrderCard(order) {
  const code = statusCodeOf(order);
  return `
    <article class="oo-card">
      <header class="oo-head">
        <div><strong>Mã đơn: ${escapeHtml(order.id)}</strong><small>${escapeHtml(formatDateTime(order.date))}</small></div>
        <span class="oo-status oo-${code}">${escapeHtml(STATUS[code] || order.status)}</span>
      </header>
      <div class="oo-info">
        <p><b>Nhà thuốc:</b> ${escapeHtml(order.pharmacyName)} – ${escapeHtml(order.pharmacyAddress)}</p>
        <p><b>Giao tới:</b> ${escapeHtml(order.shippingAddress)}</p>
        <p><b>Thanh toán:</b> COD (thu tiền khi giao)</p>
      </div>
      ${itemsTable(order)}
      <div class="oo-total">Tổng cộng: <b>${money(order.total)}</b></div>
      ${order.invoice ? `<p class="ol-invoice">Hóa đơn xuất kho: <b>${escapeHtml(order.invoice.no)}</b> · ${escapeHtml(formatDateTime(order.invoice.date))}</p>` : ""}
      ${order.trackingText ? `<p class="oo-track">🚚 ${escapeHtml(order.trackingText)}</p>` : ""}
    </article>`;
}

function renderRecentOrders() {
  const box = document.querySelector("#orderLookupRecent");
  if (!box) return;
  const ids = readJson(RECENT_KEY, []);
  const orders = readOrders().filter((order) => ids.includes(order.id))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  box.hidden = !orders.length;
  box.innerHTML = orders.length
    ? `<h3 class="ol-subheading">Đơn gần đây trên thiết bị này</h3>${orders.map(customerOrderCard).join("")}`
    : "";
}

function initOrderLookup() {
  const section = document.querySelector("#orderLookup");
  if (!section) return;
  section.innerHTML = `
    <div class="ol-wrap">
      <p class="mo-tag">TRA CỨU ĐƠN THUỐC</p>
      <h2>Theo dõi đơn đặt thuốc</h2>
      <p class="mo-muted">Không cần tài khoản. Nhập mã đơn hoặc số điện thoại đã dùng khi đặt hàng (có thể nhập cả hai để xác minh chính xác hơn).</p>
      <form class="ol-form" id="orderLookupForm">
        <label>Mã đơn<input name="code" maxlength="40" autocomplete="off" placeholder="Ví dụ: DTMWJIY4KAV1" /></label>
        <label>Số điện thoại<input name="phone" type="tel" maxlength="20" autocomplete="tel" /></label>
        <button class="mo-btn-primary" type="submit">Tra cứu</button>
      </form>
      <p class="ol-message" id="orderLookupMessage" role="status"></p>
      <div id="orderLookupResult"></div>
      <div id="orderLookupRecent" hidden></div>
    </div>`;

  section.querySelector("#orderLookupForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    const code = String(data.code || "").trim().toUpperCase();
    const phone = digitsOf(data.phone);
    const message = section.querySelector("#orderLookupMessage");
    const result = section.querySelector("#orderLookupResult");
    if (!code && !phone) {
      message.textContent = "Vui lòng nhập mã đơn hoặc số điện thoại để tra cứu.";
      result.innerHTML = "";
      return;
    }

    // Có một trường: tìm theo trường đó. Có cả hai: yêu cầu khớp đồng thời để xác minh.
    const matches = readOrders().filter((item) => {
      const codeMatches = !code || String(item.id || "").toUpperCase() === code;
      const phoneMatches = !phone || digitsOf(item.phone) === phone;
      return codeMatches && phoneMatches;
    }).sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));

    if (!matches.length) {
      message.textContent = "Không tìm thấy đơn phù hợp. Vui lòng kiểm tra lại thông tin đã nhập.";
      result.innerHTML = "";
      return;
    }
    message.textContent = matches.length > 1
      ? `Tìm thấy ${matches.length} đơn hàng theo số điện thoại.`
      : "Đã tìm thấy đơn hàng.";
    result.innerHTML = matches.map((order) => customerOrderCard(order)).join("");
  });

  renderRecentOrders();
}
