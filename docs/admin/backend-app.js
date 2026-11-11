import { apiRequest, getSession, signIn, signOut, allPages } from '../api-client.js';
import { escapeHtml as esc, installStyles, submitForm } from '../api-ui.js';
import { openPharmacyDetails } from './pharmacy-details.js';
installStyles();
document.body.innerHTML = `<main class="api-page">
<header><div><a href="../index.html">← Trang khách hàng</a><h1>Quản trị hệ thống</h1></div><button id="logout" class="hidden">Đăng xuất</button></header>
<p id="status" role="status"></p>
<section id="auth"><h2>Đăng nhập quản trị</h2><form id="loginForm">
<label>Email<input name="email" type="email" required autocomplete="username"></label>
<label>Mật khẩu<input name="password" type="password" required autocomplete="current-password"></label>
<label>Mã xác thực<input name="totp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"><small>Để trống khi thiết lập MFA lần đầu.</small></label>
<button type="submit">Đăng nhập</button></form>
<div id="mfa" class="hidden"><h3>Thiết lập ứng dụng xác thực</h3>
<p>Thêm tài khoản bằng khóa sau trong ứng dụng Authenticator, rồi nhập mã 6 chữ số.</p>
<code id="mfaSecret"></code><form id="mfaForm"><label>Mã xác thực<input name="code" required pattern="[0-9]{6}" maxlength="6" inputmode="numeric" autocomplete="one-time-code"></label><button type="submit">Xác nhận MFA</button></form></div></section>
<div id="workspace" class="hidden"><button id="reload">Tải lại dữ liệu</button><p id="stats"></p>
<section><h2>Hồ sơ nhà thuốc</h2><div id="stores"></div></section>
<section><h2>Tài khoản</h2><div id="accounts"></div></section>
<section><h2>Danh mục thuốc dùng chung</h2><form id="medicineForm">
<input name="id" type="hidden"><label>Tên thuốc<input name="name" maxlength="200" required></label>
<label>Hoạt chất<input name="active_ingredient" maxlength="200"></label><label>Hàm lượng<input name="strength" maxlength="50"></label>
<label>Dạng bào chế<input name="dosage_form" maxlength="50"></label><label>Nhóm thuốc<input name="category" maxlength="80"></label>
<label>Đơn vị<input name="unit" maxlength="30"></label><label>Loại thuốc<select name="is_prescription"><option value="0">Không kê đơn</option><option value="1">Kê đơn</option></select></label>
<button type="submit">Lưu thuốc</button><button type="reset">Hủy chỉnh sửa</button></form><div id="medicines"></div></section>
</div></main>`;
const $ = selector => document.querySelector(selector), status = $('#status');
let enrollmentToken, medicines = [], pharmacies = [];
$('#loginForm').onsubmit = event => submitForm(event, async values => {
  const data = await signIn(values.email, values.password, { totp: values.totp });
  if (data.mfaEnrollmentRequired) {
    enrollmentToken = data.enrollmentToken;
    const setup = await apiRequest('/api/v1/admin/mfa/setup', { method: 'POST', token: enrollmentToken, body: { currentPassword: values.password } });
    $('#mfaSecret').textContent = new URL(setup.data.uri).searchParams.get('secret');
    $('#mfa').classList.remove('hidden'); status.textContent = 'Hãy xác nhận mã từ ứng dụng xác thực.';
    $('#loginForm').reset(); return;
  }
  if (data.user?.role !== 'ADMIN') { await signOut(); throw new Error('Hãy dùng tài khoản quản trị.'); }
  event.target.reset(); await openWorkspace();
}, status);
$('#mfaForm').onsubmit = event => submitForm(event, async values => {
  await apiRequest('/api/v1/admin/mfa/confirm', { method: 'POST', token: enrollmentToken, body: { code: values.code } });
  enrollmentToken = null; $('#mfaSecret').textContent = ''; $('#mfa').classList.add('hidden'); event.target.reset();
  status.textContent = 'Đã bật MFA. Chờ mã mới xuất hiện trong ứng dụng rồi đăng nhập lại bằng email, mật khẩu và mã mới.';
}, status);
async function openWorkspace() {
  const me = await apiRequest('/api/v1/me');
  if (me.data.user.role !== 'ADMIN') throw new Error('Tài khoản không có quyền quản trị.');
  $('#auth').classList.add('hidden'); $('#workspace').classList.remove('hidden'); $('#logout').classList.remove('hidden');
  await reload();
}
async function reload() {
  const [accounts, stores, catalog] = await Promise.all([
    allPages('/api/admin/accounts'), allPages('/api/admin/pharmacies?status=all'), allPages('/api/medicines'),
  ]);
  medicines = catalog;
  pharmacies = stores;
  $('#stats').textContent = `${accounts.length} tài khoản · ${stores.length} nhà thuốc · ${stores.filter(p => p.verification_status === 'pending').length} hồ sơ chờ duyệt`;
  const statusLabel = { approved: 'Đã duyệt', pending: 'Chờ duyệt', rejected: 'Từ chối' };
  $('#stores').innerHTML = stores.map(store => `<article><b>${esc(store.name)}</b><p>${esc(store.address)} · ${esc(store.phone)}</p>
    <p>${statusLabel[store.verification_status]} · Tọa độ: ${store.lat}, ${store.lng}</p>
    <button type="button" data-store-details="${store.id}" aria-haspopup="dialog" aria-label="Xem chi tiết ${esc(store.name)}">Xem chi tiết</button>
    <button data-store="${store.id}" data-verification="approved">Duyệt</button>
    <button data-store="${store.id}" data-verification="rejected">Từ chối</button></article>`).join('') || '<p>Chưa có hồ sơ nhà thuốc.</p>';
  $('#accounts').innerHTML = accounts.map(account => `<article><b>${esc(account.name)}</b> · ${esc(account.email)} · ${esc(account.role)}
    <p>${account.is_active ? 'Hoạt động' : 'Đã khóa'}</p>${account.role === 'ADMIN' ? '' : `<button data-account="${account.id}" data-active="${!account.is_active}">${account.is_active ? 'Khóa tài khoản' : 'Mở khóa'}</button>`}</article>`).join('');
  $('#medicines').innerHTML = medicines.map(medicine => `<article><b>${esc(medicine.name)}</b> · ${esc(medicine.strength)} · ${medicine.is_prescription ? 'Kê đơn' : 'Không kê đơn'}
    <button data-edit="${medicine.id}">Sửa</button><button data-remove="${medicine.id}">Ngừng sử dụng</button></article>`).join('') || '<p>Chưa có thuốc. Hãy thêm thuốc để chủ nhà thuốc có thể nhập kho.</p>';
  status.textContent = 'Đã tải dữ liệu hệ thống.';
}
$('#stores').onclick = async event => {
  const detailsButton = event.target.closest('[data-store-details]');
  if (detailsButton) {
    const pharmacy = pharmacies.find(store => String(store.id) === detailsButton.dataset.storeDetails);
    if (pharmacy) openPharmacyDetails(pharmacy, { loadDetails: async () => {
      const result = await apiRequest(`/api/admin/pharmacies/${pharmacy.id}`);
      return result.data;
    } });
    return;
  }
  const button = event.target.closest('[data-store]'); if (!button) return; button.disabled = true;
  try {
    await apiRequest(`/api/admin/pharmacies/${button.dataset.store}/verification`, { method: 'PATCH', body: { status: button.dataset.verification } });
    await reload(); status.textContent = 'Đã cập nhật hồ sơ và quyền tài khoản chủ nhà thuốc.';
  } catch (error) { status.textContent = error.message; button.disabled = false; }
};
$('#accounts').onclick = async event => {
  const button = event.target.closest('[data-account]'); if (!button) return; button.disabled = true;
  try {
    await apiRequest(`/api/v1/admin/users/${button.dataset.account}/active`, { method: 'PATCH',
      headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { isActive: button.dataset.active === 'true' } });
    await reload();
  } catch (error) { status.textContent = error.message; button.disabled = false; }
};
$('#medicineForm').onsubmit = event => submitForm(event, async values => {
  const { id, ...body } = values;
  await apiRequest(id ? `/api/medicines/${id}` : '/api/medicines', { method: id ? 'PUT' : 'POST', body });
  event.target.reset(); await reload(); status.textContent = 'Đã lưu danh mục thuốc.';
}, status);
$('#medicines').onclick = async event => {
  const edit = event.target.closest('[data-edit]'), remove = event.target.closest('[data-remove]');
  if (edit) {
    const medicine = medicines.find(item => String(item.id) === edit.dataset.edit), form = $('#medicineForm');
    for (const field of ['id', 'name', 'active_ingredient', 'strength', 'dosage_form', 'category', 'unit', 'is_prescription']) form.elements[field].value = medicine[field] ?? '';
    form.scrollIntoView({ behavior: 'smooth' });
  }
  if (remove && confirm('Ngừng sử dụng thuốc này trong danh mục?')) {
    try { await apiRequest(`/api/medicines/${remove.dataset.remove}`, { method: 'DELETE' }); await reload(); }
    catch (error) { status.textContent = error.message; }
  }
};
$('#logout').onclick = async () => {
  try { await signOut(); } catch (error) { status.textContent = error.message; }
  $('#auth').classList.remove('hidden'); $('#workspace').classList.add('hidden'); $('#logout').classList.add('hidden');
};
$('#reload').onclick = () => reload().catch(error => { status.textContent = error.message; });
if (getSession()?.user?.role === 'ADMIN') openWorkspace().catch(error => { status.textContent = error.message; });
