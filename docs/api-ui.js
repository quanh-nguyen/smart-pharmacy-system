export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const money = value => `${Number(value).toLocaleString('vi-VN')} VNĐ`;
export function installStyles() {
  const link = document.createElement('link'); link.rel = 'stylesheet';
  link.href = new URL('./api-workspace.css', import.meta.url); document.head.append(link);
}
export async function submitForm(event, action, status) {
  event.preventDefault(); const button = event.target.querySelector('button[type=submit],button:not([type])');
  if (button) button.disabled = true;
  try { await action(Object.fromEntries(new FormData(event.target))); }
  catch (error) { status.textContent = error.message; }
  finally { if (button) button.disabled = false; }
}
