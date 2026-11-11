import { apiRequest, getSession, signIn, signOut, allPages } from '../api-client.js';
import { escapeHtml as esc, money, installStyles, submitForm } from '../api-ui.js';
installStyles();
document.body.innerHTML = `<main class="api-page">
<header><div><a href="../index.html">← Tìm nhà thuốc</a><h1>Quản lý nhà thuốc</h1></div><button id="logout" class="hidden">Đăng xuất</button></header>
<p id="status" role="status"></p>
<section id="auth"><h2>Đăng nhập hoặc tạo tài khoản chủ nhà thuốc</h2><form id="ownerAuthForm">
<label>Họ và tên<input name="name" maxlength="100" autocomplete="name"></label>
<label>Email<input name="email" type="email" required autocomplete="username"></label>
<label>Mật khẩu<input name="password" type="password" required minlength="8" maxlength="72" autocomplete="current-password"></label>
<label>Thao tác<select name="mode"><option value="login">Đăng nhập</option><option value="register">Tạo tài khoản</option></select></label>
<button type="submit">Tiếp tục</button></form></section>
<div id="workspace" class="hidden">
<section><h2>Hồ sơ nhà thuốc</h2><p id="verification" class="notice"></p><form id="profileForm">
<label>Tên nhà thuốc<input name="name" required maxlength="150"></label>
<label>Địa chỉ<input name="address" required maxlength="255"></label>
<label>Quận / huyện<input name="district" maxlength="100"></label><label>Điện thoại<input name="phone" maxlength="20"></label>
<label>Vĩ độ<input name="lat" type="number" step="any" min="-90" max="90" required></label>
<label>Kinh độ<input name="lng" type="number" step="any" min="-180" max="180" required></label>
<button type="button" id="gps">Lấy tọa độ hiện tại</button><span></span>
<label>Mở cửa<input name="opening_time" type="time"></label><label>Đóng cửa<input name="closing_time" type="time"></label>
<small class="full">Để trống cả hai giờ nếu mở cửa cả ngày.</small><button type="submit">Lưu hồ sơ</button></form></section>
<section><h2>Tồn kho và giá bán</h2><p>Chọn thuốc từ danh mục hệ thống. Cập nhật kho sau khi nhà thuốc được duyệt.</p><form id="inventoryForm">
<label>Thuốc<select name="medicineId" required id="medicineSelect"></select></label>
<label>Giá bán (VNĐ)<input name="price" type="number" step="1" min="0" max="999999999999" required></label>
<label>Số lượng<input name="quantity" type="number" step="1" min="0" max="2147483647" required></label>
<button type="submit">Lưu tồn kho</button></form><div id="inventory"></div></section>
<section><h2>Đơn hàng</h2><button id="reload">Tải lại</button><div id="orders"></div><button id="moreOrders" class="hidden">Trang tiếp theo</button></section>
</div></main>`;
const $ = selector => document.querySelector(selector);
const status = $('#status'); let pharmacy, inventory = [], orderPage = 1;
$('#ownerAuthForm').onsubmit = event => submitForm(event, async values => {
  const data = await signIn(values.email, values.password, { register: values.mode === 'register', role: 'PHARMACY', name: values.name });
  if (data.user?.role !== 'PHARMACY') { await signOut(); throw new Error('Hãy dùng tài khoản chủ nhà thuốc.'); }
  event.target.reset(); await openWorkspace();
}, status);
$('#logout').onclick = async () => {
  try { await signOut(); } catch (error) { status.textContent = error.message; }
  $('#auth').classList.remove('hidden'); $('#workspace').classList.add('hidden'); $('#logout').classList.add('hidden');
};
async function openWorkspace() {
  await apiRequest('/api/v1/me');
  $('#auth').classList.add('hidden'); $('#workspace').classList.remove('hidden'); $('#logout').classList.remove('hidden');
  await reload();
}
async function reload() {
  const data = await apiRequest('/api/owner/workspace'); pharmacy = data.pharmacy; inventory = data.inventory;
  status.textContent = pharmacy ? `Đang quản lý ${pharmacy.name}.` : 'Hãy tạo hồ sơ nhà thuốc để gửi quản trị viên duyệt.';
  $('#verification').textContent = ({ approved: 'Đã được duyệt', pending: 'Đang chờ duyệt', rejected: 'Hồ sơ bị từ chối; hãy cập nhật và liên hệ quản trị viên.' })[pharmacy?.verification_status] || 'Chưa có hồ sơ';
  const form = $('#profileForm');
  for (const field of ['name', 'address', 'district', 'phone', 'lat', 'lng', 'opening_time', 'closing_time']) {
    form.elements[field].value = pharmacy?.[field]?.toString().slice(0, field.includes('_time') ? 5 : undefined) || '';
  }
  const medicines = await allPages('/api/medicines');
  $('#medicineSelect').innerHTML = '<option value="">Chọn thuốc</option>' + medicines.map(m => `<option value="${m.id}">${esc(m.name)} ${esc(m.strength)}</option>`).join('');
  $('#inventoryForm').querySelector('button').disabled = pharmacy?.verification_status !== 'approved';
  $('#inventory').innerHTML = inventory.map(item => `<article><b>${esc(item.name)}</b> — ${money(item.price)} — Tồn: ${item.quantity}
    <button data-edit="${item.medicine_id}">Sửa</button><button data-remove="${item.medicine_id}">Xóa khỏi kho</button></article>`).join('') || '<p>Chưa có thuốc trong kho.</p>';
  orderPage = 1; await loadOrders();
}
$('#profileForm').onsubmit = event => submitForm(event, async values => {
  const body = { ...values, lat: Number(values.lat), lng: Number(values.lng), opening_time: values.opening_time || null, closing_time: values.closing_time || null };
  await apiRequest(pharmacy ? `/api/pharmacies/${pharmacy.id}` : '/api/pharmacies', { method: pharmacy ? 'PUT' : 'POST', body });
  await reload(); status.textContent = 'Đã lưu hồ sơ nhà thuốc.';
}, status);
$('#gps').onclick = () => navigator.geolocation.getCurrentPosition(position => {
  $('#profileForm').elements.lat.value = position.coords.latitude; $('#profileForm').elements.lng.value = position.coords.longitude;
}, () => { status.textContent = 'Chưa lấy được vị trí. Bạn có thể nhập tọa độ nhà thuốc.'; }, { timeout: 8000, maximumAge: 60000 });
$('#inventoryForm').onsubmit = event => submitForm(event, async values => {
  if (!pharmacy) throw new Error('Hãy lưu hồ sơ nhà thuốc trước.');
  await apiRequest(`/api/pharmacies/${pharmacy.id}/inventory/${values.medicineId}`, { method: 'PUT', body: { price: Number(values.price), quantity: Number(values.quantity) } });
  event.target.reset(); await reload(); status.textContent = 'Đã lưu tồn kho.';
}, status);
$('#inventory').onclick = async event => {
  const edit = event.target.closest('[data-edit]'), remove = event.target.closest('[data-remove]');
  if (edit) {
    const item = inventory.find(i => String(i.medicine_id) === edit.dataset.edit); const form = $('#inventoryForm');
    form.elements.medicineId.value = item.medicine_id; form.elements.price.value = item.price; form.elements.quantity.value = item.quantity;
    form.scrollIntoView({ behavior: 'smooth' });
  }
  if (remove && confirm('Xóa thuốc này khỏi kho?')) {
    try { await apiRequest(`/api/pharmacies/${pharmacy.id}/inventory/${remove.dataset.remove}`, { method: 'DELETE' }); await reload(); }
    catch (error) { status.textContent = error.message; }
  }
};
const actions = { pending: ['confirmed', 'rejected'], confirmed: ['preparing', 'rejected'], preparing: ['delivering'], delivering: ['completed'] };
const names = { confirmed: 'Xác nhận', rejected: 'Từ chối', preparing: 'Chuẩn bị hàng', delivering: 'Giao hàng', completed: 'Hoàn tất', pending: 'Chờ xác nhận', cancelled: 'Đã hủy' };
async function loadOrders() {
  if (!pharmacy) { $('#orders').textContent = 'Chưa có đơn hàng.'; return; }
  const data = await apiRequest(`/api/orders?page=${orderPage}&limit=20`);
  $('#orders').innerHTML = data.items.map(order => `<article><b>Đơn #${order.id} — ${esc(order.customer?.name)}</b><p>${esc(names[order.status])} · ${money(order.totalAmount)}</p>
    <p>${esc(order.shippingAddress)} · ${esc(order.phone)}</p><button data-detail="${order.id}">Xem thuốc</button>
    ${(actions[order.status] || []).map(action => `<button data-order="${order.id}" data-status="${action}">${esc(names[action])}</button>`).join('')}<div id="detail-${order.id}"></div></article>`).join('') || '<p>Chưa có đơn hàng.</p>';
  $('#moreOrders').classList.toggle('hidden', orderPage * 20 >= data.total);
}
$('#orders').onclick = async event => {
  const action = event.target.closest('[data-order]'), detail = event.target.closest('[data-detail]');
  try {
    if (detail) {
      const order = await apiRequest(`/api/orders/${detail.dataset.detail}`);
      $(`#detail-${order.id}`).textContent = order.items.map(item => `${item.name} × ${item.quantity}`).join('; ');
    }
    if (action) {
      const note = action.dataset.status === 'rejected' ? prompt('Lý do từ chối') : undefined;
      if (action.dataset.status === 'rejected' && !note) return;
      await apiRequest(`/api/orders/${action.dataset.order}/status`, { method: 'PATCH', body: { status: action.dataset.status, ...(note ? { note } : {}) } });
      await reload();
    }
  } catch (error) { status.textContent = error.message; }
};
$('#reload').onclick = () => reload().catch(error => { status.textContent = error.message; });
$('#moreOrders').onclick = () => { orderPage++; loadOrders().catch(error => { status.textContent = error.message; }); };
if (getSession()?.user?.role === 'PHARMACY') openWorkspace().catch(error => { status.textContent = error.message; });
