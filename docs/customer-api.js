import { apiRequest, allPages } from './api-client.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = value => `${Number(value || 0).toLocaleString('vi-VN')} VNĐ`;
const statusLabels = {
  pending: 'Chờ nhà thuốc xác nhận', confirmed: 'Đã xác nhận', preparing: 'Đang chuẩn bị hàng',
  delivering: 'Đang giao hàng', completed: 'Đã giao thành công', rejected: 'Nhà thuốc từ chối', cancelled: 'Đã hủy'
};
const statusOrder = ['pending', 'confirmed', 'preparing', 'delivering', 'completed'];
const cartKey = 'smartPharmacyApiCart_v1';
let cart = readCart();
let stores = [];
let activeStore = null;
let activeInventory = [];

function readCart() {
  try { const value = JSON.parse(localStorage.getItem(cartKey) || '[]'); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function saveCart() { localStorage.setItem(cartKey, JSON.stringify(cart)); }
function cartCount() { return cart.reduce((sum, item) => sum + item.quantity, 0); }
function cartTotal() { return cart.reduce((sum, item) => sum + item.price * item.quantity, 0); }
function statusText(status) { return statusLabels[status] || status || 'Chưa xác định'; }

export async function renderApiHistory(page = 1) {
  const target = document.querySelector('#customerOrderHistory');
  if (!target) return;
  target.innerHTML = '<p>Đang tải lịch sử đơn hàng…</p>';
  try {
    const data = await apiRequest(`/api/orders?page=${page}&limit=20`);
    document.querySelector('#customerHistoryCount').textContent = `${data.total || 0} đơn`;
    target.innerHTML = data.items?.length ? data.items.map(order => `
      <article class="customer-order-card api-order-card">
        <div class="customer-order-top"><strong>Đơn #${escape(order.id)}</strong><span class="api-status-pill">${escape(statusText(order.status))}</span></div>
        <p><b>${escape(order.pharmacy?.name || 'Nhà thuốc')}</b></p>
        <p>${escape(order.shippingAddress)}</p>
        <div class="customer-order-bottom"><span>${new Date(order.createdAt).toLocaleString('vi-VN')}</span><strong>${money(order.totalAmount)}</strong></div>
        <button type="button" class="secondary-button api-track-button" data-track-order="${escape(order.id)}">Theo dõi đơn hàng</button>
        <div class="api-order-tracking" id="tracking-${escape(order.id)}"></div>
      </article>`).join('') : '<p>Bạn chưa có đơn hàng nào.</p>';
    const navigation = document.createElement('div'); navigation.className = 'api-pagination';
    for (const [title, next, show] of [['Trang trước', page - 1, page > 1], ['Trang sau', page + 1, page * 20 < data.total]]) {
      if (!show) continue;
      const button = document.createElement('button'); button.textContent = title; button.className = 'secondary-button';
      button.onclick = () => renderApiHistory(next); navigation.append(button);
    }
    target.append(navigation);
  } catch (error) {
    target.textContent = error.status === 401 ? 'Phiên đã hết hạn. Vui lòng đăng nhập lại.' : error.message;
  }
}

export function setupCustomerOrdering() {
  const panel = document.createElement('section'); panel.className = 'customer-history-card api-shopping-panel';
  panel.innerHTML = `
    <div class="api-section-heading"><div><p class="tag">MUA THUỐC TRỰC TUYẾN</p><h2>Cửa hàng nhà thuốc</h2><p>Tìm nhà thuốc, chọn nhiều loại thuốc và đặt hàng.</p></div>
      <button type="button" class="secondary-button" id="apiCartToggle">Giỏ hàng (<span id="apiCartCount">${cartCount()}</span>)</button></div>
    <form id="apiStoreSearch" class="api-store-search"><label for="apiStoreQuery">Tìm theo tên hoặc địa chỉ nhà thuốc</label><div><input id="apiStoreQuery" name="query" required maxlength="100" placeholder="Ví dụ: Nhà thuốc Minh Tâm, Cầu Giấy"><button class="primary">Tìm nhà thuốc</button></div></form>
    <p id="apiOrderStatus" class="api-order-status" role="status" aria-live="polite"></p>
    <div id="apiStoreResults" class="api-store-grid"></div>
    <section id="apiStorefront" class="api-storefront hidden"></section>
    <section id="apiCartPanel" class="api-cart-panel hidden"></section>`;
  const historyNote = document.querySelector('.customer-demo-note');
  (historyNote || document.querySelector('#customerOrderHistory')?.parentElement)?.before(panel);
  const status = panel.querySelector('#apiOrderStatus');
  const storeResults = panel.querySelector('#apiStoreResults');
  const storefront = panel.querySelector('#apiStorefront');
  const cartPanel = panel.querySelector('#apiCartPanel');

  panel.querySelector('#apiStoreSearch').addEventListener('submit', async event => {
    event.preventDefault(); status.textContent = 'Đang tìm nhà thuốc…'; storeResults.innerHTML = '';
    storefront.classList.add('hidden'); cartPanel.classList.add('hidden');
    try {
      stores = await allPages(`/api/pharmacies?q=${encodeURIComponent(new FormData(event.target).get('query'))}`);
      status.textContent = `${stores.length} nhà thuốc được tìm thấy. Chỉ nhà thuốc đã được duyệt mới có thể nhận đơn.`;
      storeResults.innerHTML = stores.map(store => `<article class="api-store-card"><div class="api-store-icon">＋</div><div><h3>${escape(store.name)}</h3><p>${escape(store.address)}</p><button type="button" class="secondary-button" data-open-store="${escape(store.id)}">Xem cửa hàng <span aria-hidden="true">→</span></button></div></article>`).join('') || '<p>Không tìm thấy nhà thuốc phù hợp.</p>';
    } catch (error) { status.textContent = error.message; }
  });

  storeResults.addEventListener('click', event => {
    const button = event.target.closest('[data-open-store]'); if (!button) return;
    const store = stores.find(item => String(item.id) === button.dataset.openStore);
    if (store) loadStore(store);
  });

  async function loadStore(store) {
    activeStore = store; storefront.classList.remove('hidden'); storefront.innerHTML = '<p>Đang tải danh mục thuốc…</p>';
    cartPanel.classList.add('hidden'); storefront.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const pages = [];
      for (let page = 1; ; page++) {
        const result = await apiRequest(`/api/pharmacies/${store.id}/inventory?in_stock=true&limit=50&page=${page}`);
        pages.push(...(result.data || []));
        if (pages.length >= (result.pagination?.total ?? pages.length) || !result.data?.length) break;
      }
      activeInventory = pages.filter(item => !item.is_prescription);
      storefront.innerHTML = `<div class="api-storefront-heading"><div><p class="tag">CỬA HÀNG NHÀ THUỐC</p><h3>${escape(store.name)}</h3><p>${escape(store.address)}</p></div><button class="secondary-button" type="button" id="apiBackStores">← Danh sách nhà thuốc</button></div>
        <div class="api-product-grid">${activeInventory.map(item => `<article class="api-product-card"><div class="api-product-symbol">✚</div><div class="api-product-info"><h4>${escape(item.name)}</h4><p>Kho còn ${Number(item.quantity).toLocaleString('vi-VN')}</p><strong>${money(item.price)}</strong></div><button type="button" class="primary" data-add-product="${escape(item.medicine_id)}" ${Number(item.quantity) < 1 ? 'disabled' : ''}>Thêm vào giỏ</button></article>`).join('') || '<p>Nhà thuốc chưa cập nhật thuốc không kê đơn còn hàng.</p>'}</div>
        <p class="api-prescription-note">Thuốc kê đơn chưa hỗ trợ đặt trực tiếp trong giỏ hàng. Vui lòng thực hiện quy trình xác nhận đơn thuốc phù hợp.</p>`;
      storefront.querySelector('#apiBackStores').onclick = () => { storefront.classList.add('hidden'); storeResults.scrollIntoView({ behavior: 'smooth' }); };
    } catch (error) { storefront.innerHTML = `<p class="api-error">${escape(error.message)}</p>`; }
  }

  storefront.addEventListener('click', event => {
    const button = event.target.closest('[data-add-product]'); if (!button || !activeStore) return;
    const product = activeInventory.find(item => String(item.medicine_id) === button.dataset.addProduct); if (!product) return;
    const existing = cart.find(item => String(item.pharmacyId) === String(activeStore.id) && String(item.drugId) === String(product.medicine_id));
    if (existing) existing.quantity = Math.min(existing.quantity + 1, Number(product.quantity));
    else cart.push({ pharmacyId: activeStore.id, pharmacyName: activeStore.name, drugId: product.medicine_id, name: product.name, price: Number(product.price), quantity: 1, maxQuantity: Number(product.quantity) });
    saveCart(); updateCartCount(); status.textContent = `Đã thêm ${product.name} vào giỏ hàng.`;
  });

  function updateCartCount() { panel.querySelector('#apiCartCount').textContent = cartCount(); }
  panel.querySelector('#apiCartToggle').onclick = () => { renderCart(); cartPanel.classList.toggle('hidden'); cartPanel.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  function renderCart() {
    updateCartCount();
    const groups = [...new Set(cart.map(item => String(item.pharmacyId)))];
    cartPanel.innerHTML = `<div class="api-cart-heading"><div><p class="tag">GIỎ HÀNG</p><h3>Thuốc đã chọn (${cartCount()})</h3></div><button type="button" class="secondary-button" id="apiCloseCart">Đóng</button></div>
      ${groups.length ? groups.map(id => { const items = cart.filter(item => String(item.pharmacyId) === id); return `<section class="api-cart-group"><h4>${escape(items[0].pharmacyName)}</h4>${items.map(item => `<div class="api-cart-row"><div><b>${escape(item.name)}</b><small>${money(item.price)} / sản phẩm</small></div><div class="api-quantity"><button type="button" data-qty="-1" data-key="${escape(item.pharmacyId)}:${escape(item.drugId)}" aria-label="Giảm">−</button><span>${item.quantity}</span><button type="button" data-qty="1" data-key="${escape(item.pharmacyId)}:${escape(item.drugId)}" aria-label="Tăng" ${item.quantity >= item.maxQuantity ? 'disabled' : ''}>＋</button><button type="button" class="api-remove" data-remove="${escape(item.pharmacyId)}:${escape(item.drugId)}">Xóa</button></div><strong>${money(item.price * item.quantity)}</strong></div>`).join('')}<p class="api-pharmacy-subtotal">Tạm tính nhà thuốc: <b>${money(items.reduce((sum, item) => sum + item.price * item.quantity, 0))}</b></p>
      <form class="api-checkout-form" data-checkout-pharmacy="${escape(id)}"><label>Địa chỉ nhận hàng<input name="shippingAddress" required minlength="5" maxlength="300" autocomplete="street-address" placeholder="Số nhà, đường, phường, tỉnh/thành"></label><label>Số điện thoại<input name="phone" type="tel" pattern="(0|\\+84)[0-9]{9,10}" required autocomplete="tel"></label><button class="primary" type="submit">Đặt đơn tại nhà thuốc này</button></form></section>`; }).join('') : '<p>Giỏ hàng đang trống. Hãy chọn nhà thuốc và thêm thuốc vào giỏ.</p>'}
      <div class="api-cart-total"><span>Tổng cộng tất cả nhà thuốc</span><strong>${money(cartTotal())}</strong></div>
      <p class="api-cart-hint">Mỗi nhà thuốc được tạo thành một đơn hàng riêng để quản lý tồn kho và giao hàng độc lập.</p>`;
    cartPanel.querySelector('#apiCloseCart').onclick = () => cartPanel.classList.add('hidden');
  }

  cartPanel.addEventListener('click', event => {
    const quantityButton = event.target.closest('[data-qty]'); const removeButton = event.target.closest('[data-remove]');
    if (!quantityButton && !removeButton) return;
    const key = (quantityButton || removeButton).dataset.key || (quantityButton || removeButton).dataset.remove;
    const item = cart.find(row => `${row.pharmacyId}:${row.drugId}` === key); if (!item) return;
    if (removeButton) cart = cart.filter(row => `${row.pharmacyId}:${row.drugId}` !== key);
    else item.quantity = Math.max(1, Math.min(item.maxQuantity, item.quantity + Number(quantityButton.dataset.qty)));
    saveCart(); renderCart();
  });

  cartPanel.addEventListener('submit', async event => {
    const form = event.target.closest('[data-checkout-pharmacy]'); if (!form) return;
    event.preventDefault(); const submit = form.querySelector('button[type="submit"]'); submit.disabled = true; submit.textContent = 'Đang tạo đơn…';
    const pharmacyId = form.dataset.checkoutPharmacy; const values = Object.fromEntries(new FormData(form));
    const items = cart.filter(item => String(item.pharmacyId) === pharmacyId);
    try {
      const order = await apiRequest('/api/orders', { method: 'POST', body: {
        pharmacyId: Number(pharmacyId), items: items.map(item => ({ drugId: Number(item.drugId), quantity: item.quantity })),
        shippingAddress: values.shippingAddress, phone: values.phone,
      } });
      cart = cart.filter(item => String(item.pharmacyId) !== pharmacyId); saveCart();
      status.textContent = `Đặt hàng thành công! Mã đơn #${order.id}.`; renderCart(); await renderApiHistory();
    } catch (error) { status.textContent = error.message; submit.disabled = false; submit.textContent = 'Đặt đơn tại nhà thuốc này'; }
  });

  document.querySelector('#customerOrderHistory')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-track-order]'); if (!button) return;
    const target = document.querySelector(`#tracking-${CSS.escape(button.dataset.trackOrder)}`);
    if (!target) return; target.innerHTML = '<p>Đang tải tiến trình…</p>'; button.disabled = true;
    try {
      const order = await apiRequest(`/api/orders/${encodeURIComponent(button.dataset.trackOrder)}`);
      const events = Array.isArray(order.statusHistory) ? order.statusHistory : [];
      const currentIndex = statusOrder.indexOf(order.status);
      target.innerHTML = `<div class="api-tracking-summary"><b>${escape(statusText(order.status))}</b><span>${money(order.totalAmount)}</span></div>
        <ol class="api-tracking-steps">${statusOrder.map((state, index) => `<li class="${index <= currentIndex ? 'is-done' : ''} ${state === order.status ? 'is-current' : ''}"><span class="api-step-dot"></span><div><b>${escape(statusText(state))}</b>${events.filter(item => (item.toStatus || item.status) === state).map(item => `<small>${new Date(item.createdAt || item.created_at || item.timestamp).toLocaleString('vi-VN')}${item.note ? ` · ${escape(item.note)}` : ''}</small>`).join('')}</div></li>`).join('')}</ol>
        ${['rejected', 'cancelled'].includes(order.status) ? `<p class="api-tracking-final">${escape(statusText(order.status))}</p>` : ''}
        <div class="api-tracking-items"><b>Chi tiết đơn hàng</b>${(order.items || []).map(item => `<p>${escape(item.name)} × ${item.quantity} — ${money(item.unitPrice * item.quantity)}</p>`).join('')}</div>`;
    } catch (error) { target.textContent = error.message; }
    finally { button.disabled = false; }
  });

  updateCartCount();
}
