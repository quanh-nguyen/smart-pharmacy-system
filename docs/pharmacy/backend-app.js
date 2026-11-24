import { apiRequest, getSession, signIn, signOut } from '../api-client.js';
import { escapeHtml as esc, installStyles, submitForm } from '../api-ui.js';
installStyles();
document.body.innerHTML = `<main class="api-page">
<header><div><a href="../index.html">← Tìm nhà thuốc</a><h1>Thông tin nhà thuốc</h1></div><button id="logout" class="hidden">Đăng xuất</button></header>
<p id="status" role="status"></p>
<section id="auth"><h2>Đăng nhập hoặc tạo tài khoản chủ nhà thuốc</h2><form id="ownerAuthForm">
<label>Email<input name="email" type="email" required autocomplete="username"></label>
<label>Mật khẩu<input name="password" type="password" required minlength="8" maxlength="72" autocomplete="current-password"></label>
<label>Thao tác<select name="mode"><option value="login">Đăng nhập</option><option value="register">Tạo tài khoản</option></select></label>
<button type="submit">Tiếp tục</button></form></section>
<div id="workspace" class="hidden"><section><h2>Hồ sơ nhà thuốc</h2><p id="verification" class="notice"></p><p>Thông tin đang được đọc từ Backend. Bản Backend hiện tại chưa cung cấp API cho chủ nhà thuốc tự tạo, liên kết hoặc cập nhật hồ sơ; các thao tác này được giữ nguyên trạng thái chưa hỗ trợ để tránh tạo dữ liệu không gắn với tài khoản.</p><form id="profileForm" aria-readonly="true">
<label>Tên nhà thuốc<input name="name" required maxlength="150"></label><label>Địa chỉ<input name="address" required maxlength="255"></label>
<label>Quận / huyện<input name="district" maxlength="100"></label><label>Điện thoại liên hệ<input name="phone" type="tel" maxlength="20" required></label>
<label>Vĩ độ<input name="lat" type="number" step="any" min="-90" max="90" required></label><label>Kinh độ<input name="lng" type="number" step="any" min="-180" max="180" required></label>
<label>Giờ mở cửa<input name="opening_time" type="time"></label><label>Giờ đóng cửa<input name="closing_time" type="time"></label>
<small class="full">Để trống cả hai giờ nếu mở cửa cả ngày.</small><p class="notice">Chỉ xem được hồ sơ hiện có. Chưa thể lưu thay đổi bằng API hiện tại.</p></form></section><section><h2>Tin nhắn khách hàng</h2><p class="notice">Messenger hiện vẫn ở chế độ DEMO trên trình duyệt. Backend chưa có API hội thoại/tin nhắn, nên chưa thể đồng bộ giữa khách hàng và nhà thuốc hoặc giữa các thiết bị.</p></section></div></main>`;
const $ = selector => document.querySelector(selector); const status = $('#status'); let pharmacy;
$('#ownerAuthForm').onsubmit = event => submitForm(event, async values => {
 const data = await signIn(values.email, values.password, { register: values.mode === 'register', role: 'PHARMACY' });
 if (data.user?.role !== 'PHARMACY') { await signOut(); throw new Error('Hãy dùng tài khoản chủ nhà thuốc.'); }
 event.target.reset(); await openWorkspace();
}, status);
$('#logout').onclick = async () => { try { await signOut(); } catch (error) { status.textContent = error.message; } $('#auth').classList.remove('hidden'); $('#workspace').classList.add('hidden'); $('#logout').classList.add('hidden'); };
async function openWorkspace() { await apiRequest('/api/v1/me'); $('#auth').classList.add('hidden'); $('#workspace').classList.remove('hidden'); $('#logout').classList.remove('hidden'); await reload(); }
async function reload() {
 const data = await apiRequest('/api/owner/workspace'); pharmacy = data.pharmacy;
 status.textContent = pharmacy ? `Đang xem hồ sơ ${pharmacy.name}.` : 'Tài khoản đã đăng nhập nhưng Backend chưa có API để chủ nhà thuốc tạo hồ sơ.';
 $('#verification').textContent = ({ approved: 'Đã được duyệt', pending: 'Đang chờ duyệt', rejected: 'Hồ sơ bị từ chối; hãy cập nhật và liên hệ quản trị viên.' })[pharmacy?.verification_status] || 'Chưa có hồ sơ';
 const form = $('#profileForm');
 for (const field of ['name','address','district','phone','lat','lng','opening_time','closing_time']) {
   const input = form.elements[field]; if (input) { input.value = pharmacy?.[field]?.toString().slice(0, field.includes('_time') ? 5 : undefined) || ''; input.disabled = true; }
 }
}
if (getSession()?.user?.role === 'PHARMACY') openWorkspace().catch(error => { status.textContent = error.message; });
