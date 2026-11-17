// Tài khoản test cho chế độ demo (lưu trong localStorage của trình duyệt).
//   Email: test@gmail.com   Mật khẩu: test1234
// Có ở cả "Khách hàng" và "Nhà thuốc". Chỉ thêm khi chưa có, không ghi đè dữ liệu đã đổi.
(function seedTestAccounts() {
  const EMAIL = "test@gmail.com";
  const PASSWORD = "test1234";
  function read(key) {
    try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value : []; }
    catch { return []; }
  }
  function ensure(key, matcher, account) {
    try {
      const list = read(key);
      if (list.some(matcher)) return;
      list.push(account);
      localStorage.setItem(key, JSON.stringify(list));
    } catch { /* localStorage bị chặn: bỏ qua */ }
  }
  const createdAt = new Date().toISOString();
  // Trang chủ: đăng nhập bằng "Khách hàng" / "Chủ cửa hàng"
  ensure("smartPharmacyAccounts", (a) => a.email === EMAIL && a.role === "customer",
    { email: EMAIL, password: PASSWORD, role: "customer", name: "Khách Test", createdAt });
  ensure("smartPharmacyAccounts", (a) => a.email === EMAIL && a.role === "owner",
    { email: EMAIL, password: PASSWORD, role: "owner", name: "", createdAt });
  // Cổng riêng cho chủ hiệu thuốc (/pharmacy/)
  ensure("smartPharmacyOwnerAccounts_v1", (a) => a.email === EMAIL,
    { name: "Nhà thuốc Test", email: EMAIL, password: PASSWORD });
})();
