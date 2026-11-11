const statuses = { pending: 'Chờ duyệt', approved: 'Đã duyệt', verified: 'Đã duyệt', rejected: 'Từ chối' };
let dialog;
let revision = 0;

function createDialog() {
  const element = document.createElement('dialog');
  element.className = 'pharmacy-detail-dialog';
  element.setAttribute('aria-labelledby', 'pharmacy-detail-title');
  element.innerHTML = `
    <header class="pharmacy-detail-header">
      <div><p class="pharmacy-detail-eyebrow">HỒ SƠ NHÀ THUỐC</p><h2 id="pharmacy-detail-title"></h2></div>
      <button class="pharmacy-detail-close" type="button" aria-label="Đóng chi tiết nhà thuốc" autofocus>×</button>
    </header>
    <div class="pharmacy-detail-notice" role="status" aria-live="polite" hidden></div>
    <div class="pharmacy-detail-body">
      <figure class="pharmacy-detail-media">
        <img class="pharmacy-detail-image" hidden>
        <div class="pharmacy-detail-placeholder"><span aria-hidden="true">▧</span><p></p></div>
        <figcaption>Ảnh nhà thuốc</figcaption>
      </figure>
      <section class="pharmacy-detail-info" aria-labelledby="pharmacy-detail-info-title">
        <h3 id="pharmacy-detail-info-title">Thông tin chi tiết</h3>
        <dl class="pharmacy-detail-fields"></dl>
      </section>
    </div>
    <footer class="pharmacy-detail-footer"><button type="button">Đóng</button></footer>`;
  element.querySelector('.pharmacy-detail-close').onclick = () => element.close();
  element.querySelector('footer button').onclick = () => element.close();
  element.addEventListener('click', event => {
    if (event.target !== element) return;
    const rect = element.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) element.close();
  });
  element.addEventListener('close', () => {
    if (element.open) return;
    revision++;
    document.documentElement.classList.remove('pharmacy-details-open');
    const image = element.querySelector('img');
    image.onload = image.onerror = null;
    image.removeAttribute('src');
  });
  document.body.append(element);
  return element;
}

function text(value) {
  return value === null || value === undefined || String(value).trim() === '' ? 'Chưa cập nhật' : String(value);
}
function openingHours(pharmacy) {
  if (pharmacy.hours) return pharmacy.hours;
  const opening = pharmacy.opening_time, closing = pharmacy.closing_time;
  if (opening && closing) return `${opening.slice(0, 5)} – ${closing.slice(0, 5)}`;
  if (opening === null && closing === null) return 'Mở cửa cả ngày';
  return null;
}
function photoUrl(pharmacy) {
  const value = pharmacy.image_url || pharmacy.imageUrl || pharmacy.image || pharmacy.photo;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, document.baseURI);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function render(pharmacy, current) {
  dialog.querySelector('h2').textContent = pharmacy.name || 'Chi tiết nhà thuốc';
  const status = pharmacy.verification_status || pharmacy.status;
  const date = pharmacy.created_at || pharmacy.createdAt || pharmacy.date;
  const parsedDate = date ? new Date(date) : null;
  const coordinates = [pharmacy.lat, pharmacy.lng];
  const hasCoordinates = coordinates.every(value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)));
  const fields = [
    ['Mã nhà thuốc', pharmacy.id],
    ['Trạng thái', statuses[status] || status],
    ['Chủ sở hữu', pharmacy.owner_name || pharmacy.owner],
    ['Email chủ sở hữu', pharmacy.owner_email],
    ['Địa chỉ', pharmacy.address],
    ['Quận / huyện', pharmacy.district],
    ['Số điện thoại', pharmacy.phone],
    ['Giờ mở cửa', openingHours(pharmacy)],
    ['Tọa độ', hasCoordinates ? coordinates.join(', ') : null],
    ['Ngày đăng ký', parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toLocaleDateString('vi-VN') : null],
  ];
  if (pharmacy.description) fields.push(['Giới thiệu', pharmacy.description]);
  const list = dialog.querySelector('dl'); list.replaceChildren();
  for (const [label, value] of fields) {
    const row = document.createElement('div');
    const term = document.createElement('dt'); term.textContent = label;
    const detail = document.createElement('dd'); detail.textContent = text(value);
    row.append(term, detail); list.append(row);
  }
  const media = dialog.querySelector('figure');
  const image = media.querySelector('img');
  const placeholder = media.querySelector('.pharmacy-detail-placeholder');
  const caption = media.querySelector('figcaption');
  const url = photoUrl(pharmacy);
  image.onload = image.onerror = null; image.removeAttribute('src');
  image.hidden = true; placeholder.hidden = false; caption.hidden = true;
  const missingImage = () => {
    if (current !== revision || !dialog.open) return;
    dialog.classList.add('is-without-image');
    image.hidden = true; placeholder.hidden = false; caption.hidden = true;
    media.setAttribute('aria-busy', 'false');
    placeholder.querySelector('p').textContent = 'Nhà thuốc hiện tại chưa có hình ảnh';
  };
  if (!url) { missingImage(); return; }
  dialog.classList.remove('is-without-image');
  media.setAttribute('aria-busy', 'true');
  placeholder.querySelector('p').textContent = 'Đang tải hình ảnh…';
  image.alt = `Ảnh ${pharmacy.name || 'nhà thuốc'}`;
  image.decoding = 'async';
  image.onload = () => {
    if (current !== revision || !dialog.open) return;
    image.hidden = false; placeholder.hidden = true; caption.hidden = false;
    media.setAttribute('aria-busy', 'false');
  };
  image.onerror = missingImage;
  image.src = url;
}

export function openPharmacyDetails(pharmacy, { loadDetails } = {}) {
  dialog ||= createDialog();
  const current = ++revision;
  const notice = dialog.querySelector('.pharmacy-detail-notice');
  notice.replaceChildren(); notice.hidden = true;
  if (!dialog.open) dialog.showModal();
  document.documentElement.classList.add('pharmacy-details-open');
  render(pharmacy, current);
  if (!loadDetails) return;
  async function load() {
    notice.hidden = false; notice.textContent = 'Đang tải thông tin chi tiết…';
    try {
      const details = await loadDetails();
      if (current !== revision || !dialog.open) return;
      render({ ...pharmacy, ...details }, current); notice.hidden = true;
    } catch {
      if (current !== revision || !dialog.open) return;
      notice.textContent = 'Chưa tải được thông tin mới nhất của nhà thuốc. ';
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Thử lại';
      retry.onclick = load; notice.append(retry);
    }
  }
  void load();
}
