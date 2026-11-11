// Bỏ dấu tiếng Việt + chuẩn hóa để so khớp tên thuốc
function normalize(str = '') {
  return String(str)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9%.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

// Độ giống nhau 0..1
function similarity(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  const maxLen = Math.max(x.length, y.length);
  return 1 - levenshtein(x, y) / maxLen;
}

module.exports = { normalize, levenshtein, similarity };
