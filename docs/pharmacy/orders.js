// Đơn đặt online cho khu vực chủ hiệu thuốc: thông báo, hóa đơn xuất kho, vận chuyển và theo dõi.
// Dùng chung logic với trang khách hàng (../medicine-order.js) để dữ liệu đơn luôn đồng nhất.
import {
  countPendingOnlineOrders,
  initOwnerOrderEvents,
  renderOwnerOnlineOrders,
  startOwnerOrderWatch,
} from "../medicine-order.js";

const PROFILE_KEY = "smartPharmacyPharmacyProfile_v1";
const $ = (selector) => document.querySelector(selector);

function readProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "null") || {}; } catch { return {}; }
}
function isLoggedIn() { return !$("#appShell").classList.contains("hidden"); }

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.remove("hidden", "error");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 5000);
}

function refreshPendingCount() {
  const pending = isLoggedIn() ? countPendingOnlineOrders(readProfile()) : 0;
  const badge = $("#ordersNavBadge");
  badge.textContent = pending;
  badge.hidden = !pending;
  $("#overviewOrdersCount").textContent = pending;
  $("#overviewOrdersBanner").hidden = !pending;
}

function showOrdersView() {
  renderOwnerOnlineOrders(readProfile());
}

document.querySelector('.nav-item[data-view="orders"]').addEventListener("click", showOrdersView);
$("#overviewOrdersBanner button").addEventListener("click", showOrdersView);

initOwnerOrderEvents();
startOwnerOrderWatch(() => (isLoggedIn() ? readProfile() : null), { onNewOrder: showToast });
refreshPendingCount();
setInterval(refreshPendingCount, 3000);
document.querySelector("#logoutButton")?.addEventListener("click", () => setTimeout(refreshPendingCount, 0));
