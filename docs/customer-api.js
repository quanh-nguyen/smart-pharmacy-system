import { apiRequest, allPages } from './api-client.js';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const labels = { pending: 'Chờ xác nhận', confirmed: 'Đã xác nhận', preparing: 'Đang chuẩn bị',
  delivering: 'Đang giao', completed: 'Hoàn tất', rejected: 'Đã từ chối', cancelled: 'Đã hủy' };
export async function renderApiHistory(page = 1) {
  const target = document.querySelector('#customerOrderHistory');
  target.textContent = 'Đang tải lịch sử đơn hàng…';
  try {
    const data = await apiRequest(`/api/orders?page=${page}&limit=20`);
    document.querySelector('#customerHistoryCount').textContent = `${data.total} đơn`;
    target.innerHTML = data.items.length ? data.items.map(order => `<article class="customer-order-card">
      <div class="customer-order-top"><strong>Đơn #${order.id}</strong><span>${escape(labels[order.status] || order.status)}</span></div>
      <p>${escape(order.pharmacy?.name)}</p><p>${escape(order.shippingAddress)}</p>
      <div class="customer-order-bottom"><span>${new Date(order.createdAt).toLocaleString('vi-VN')}</span>
      <strong>${Number(order.totalAmount).toLocaleString('vi-VN')} VNĐ</strong></div></article>`).join('')
      : '<p>Bạn chưa có đơn hàng nào.</p>';
    const navigation = document.createElement('div');
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
  const panel = document.createElement('section'); panel.className = 'customer-history-card';
  panel.innerHTML = `<h2>Đặt thuốc tại nhà thuốc đã đăng ký</h2>
    <form id="apiStoreSearch" class="dashboard-form"><label>Tên hoặc địa chỉ nhà thuốc<input name="query" required maxlength="100"></label><button class="primary">Tìm nhà thuốc</button></form>
    <p id="apiOrderStatus" role="status"></p><div id="apiStoreResults"></div><div id="apiInventory"></div>`;
  document.querySelector('.customer-demo-note').before(panel);
  const status = panel.querySelector('#apiOrderStatus');
  panel.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault(); status.textContent = 'Đang tìm…';
    try {
      const stores = await allPages(`/api/pharmacies?q=${encodeURIComponent(new FormData(event.target).get('query'))}`);
      status.textContent = `${stores.length} nhà thuốc trong hệ thống. Chỉ các nhà thuốc đã được duyệt mới nhận đơn.`;
      const list = panel.querySelector('#apiStoreResults'); list.replaceChildren();
      for (const store of stores) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button';
        button.textContent = `${store.name} — ${store.address}`;
        button.onclick = () => loadInventory(store); list.append(button);
      }
    } catch (error) { status.textContent = error.message; }
  });
  async function loadInventory(store) {
    const target = panel.querySelector('#apiInventory'); target.textContent = 'Đang tải kho thuốc…';
    try {
      const items = [];
      for (let page = 1; ; page++) {
        const result = await apiRequest(`/api/pharmacies/${store.id}/inventory?in_stock=true&limit=50&page=${page}`);
        items.push(...result.data);
        if (items.length >= result.pagination.total || !result.data.length) break;
      }
      // Prescription medicines need the separate upload/review/confirmation API workflow.
      const available = items.filter(item => !item.is_prescription);
      target.innerHTML = `<h3>${escape(store.name)}</h3>${available.length ? `<form class="dashboard-form" id="apiOrderForm">
        <label>Thuốc không kê đơn<select name="drugId">${available.map(item => `<option value="${item.medicine_id}">${escape(item.name)} — ${Number(item.price).toLocaleString('vi-VN')} VNĐ</option>`).join('')}</select></label>
        <label>Số lượng<input name="quantity" type="number" min="1" max="100" value="1" required></label>
        <label>Địa chỉ nhận hàng<input name="shippingAddress" minlength="5" maxlength="300" required autocomplete="street-address"></label>
        <label>Số điện thoại<input name="phone" type="tel" pattern="(0|\\+84)[0-9]{9,10}" required autocomplete="tel"></label>
        <button class="primary" type="submit">Đặt hàng</button></form>` : '<p>Nhà thuốc chưa cập nhật thuốc không kê đơn còn hàng.</p>'}`;
      target.querySelector('form')?.addEventListener('submit', async event => {
        event.preventDefault(); const submit = event.target.querySelector('button'); submit.disabled = true;
        const values = Object.fromEntries(new FormData(event.target));
        try {
          const order = await apiRequest('/api/orders', { method: 'POST', body: {
            pharmacyId: store.id, items: [{ drugId: Number(values.drugId), quantity: Number(values.quantity) }],
            shippingAddress: values.shippingAddress, phone: values.phone,
          } });
          status.textContent = `Đã tạo đơn #${order.id}.`; await renderApiHistory();
          await loadInventory(store);
        } catch (error) { status.textContent = error.message; submit.disabled = false; }
      });
    } catch (error) { target.textContent = error.message; }
  }
}
