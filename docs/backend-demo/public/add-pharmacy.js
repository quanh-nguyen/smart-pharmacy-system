(() => {
  const form = document.querySelector("#addPharmacyForm");
  const status = document.querySelector("#addPharmacyStatus");
  const storageKey = "smartPharmacyPublicSuggestions";

  function showStatus(message, kind) {
    status.textContent = message;
    status.className = `add-pharmacy-status visible ${kind}`;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const website = document.querySelector("#newPharmacyWebsite").value.trim();
    if (website) {
      try {
        const parsed = new URL(website);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Invalid protocol");
      } catch {
        showStatus("Địa chỉ website chưa hợp lệ. Hãy nhập URL bắt đầu bằng https:// hoặc http://.", "error");
        return;
      }
    }

    const suggestion = {
      id: `suggestion-${Date.now()}`,
      name: document.querySelector("#newPharmacyName").value.trim(),
      address: document.querySelector("#newPharmacyAddress").value.trim(),
      phone: document.querySelector("#newPharmacyPhone").value.trim(),
      hours: document.querySelector("#newPharmacyHours").value.trim(),
      website,
      note: document.querySelector("#newPharmacyNote").value.trim(),
      createdAt: new Date().toISOString(),
      status: "pending-local-draft",
    };

    try {
      const existing = JSON.parse(localStorage.getItem(storageKey) || "[]");
      if (!Array.isArray(existing)) throw new Error("Invalid saved data");
      existing.push(suggestion);
      localStorage.setItem(storageKey, JSON.stringify(existing));
      showStatus("Đã lưu bản nháp đề xuất trên trình duyệt này. Đề xuất CHƯA được gửi đến ban quản trị và chưa xuất hiện trên bản đồ vì website chưa kết nối máy chủ nhận dữ liệu.", "success");
      form.reset();
    } catch {
      showStatus("Không thể lưu bản nháp trong trình duyệt này. Hãy kiểm tra cài đặt lưu trữ của trình duyệt và thử lại.", "error");
    }
  });
})();
