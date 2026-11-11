// Tách văn bản OCR của đơn thuốc thành các dòng thuốc + so khớp với danh mục.
// Thuần JS, không phụ thuộc DB -> dễ viết test.
const { normalize, similarity } = require('../../utils/text');

const UNIT = '(?:mg|mcg|µg|g|ml|iu|ui|%)';
const NUM = '\\d+(?:[.,]\\d+)?';
const STRENGTH_RE = new RegExp(`${NUM}\\s*${UNIT}(?:\\s*/\\s*${NUM}\\s*${UNIT})?(?!\\p{L})`, 'iu');
const QTY_RE =
  /(?:SL|S\.L|số lượng)\s*[:.]?\s*(\d+)|[x×]\s*(\d+)|(\d+)\s*(?:viên|vỉ|hộp|gói|ống|chai|lọ|tuýp|tube)(?!\p{L})/iu;
const NUMBERING_RE = /^\s*\d{1,2}\s*[.)/-]\s+/;
const DATE_RE = /ngày\s*(\d{1,2})\s*tháng\s*(\d{1,2})\s*năm\s*(\d{4})|(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/iu;
const DOCTOR_RE = /^(?:bac si|y si|bs)\b/;
const INSTRUCTION_PREFIXES = [
  'ngay ', 'uong', 'sang', 'trua', 'chieu', 'toi ', 'dung', 'cach dung',
  'moi ', 'boi ', 'nho ', 'ngam', 'tiem', 'xit',
];

function parseQuantity(text) {
  const m = text.match(QTY_RE);
  if (!m) return null;
  const n = Number(m[1] || m[2] || m[3]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseDate(line) {
  const m = line.match(DATE_RE);
  if (!m) return null;
  const [d, mo, y] = m[1] ? [m[1], m[2], m[3]] : [m[4], m[5], m[6]];
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDrugLine(line) {
  const body = line.replace(NUMBERING_RE, '').trim();
  const strengthMatch = body.match(STRENGTH_RE);
  let name;
  if (strengthMatch) {
    name = body.slice(0, strengthMatch.index);
  } else {
    // Không có hàm lượng: cắt tại phần số lượng (nếu có)
    const qty = body.match(QTY_RE);
    name = qty ? body.slice(0, qty.index) : body;
  }
  name = name.replace(/[\s,:;\-–(]+$/u, '').trim();
  if (name.length < 2) return null;
  return {
    rawText: line.trim(),
    drugName: name,
    strength: strengthMatch ? strengthMatch[0].replace(/\s+/g, '') : undefined,
    quantity: parseQuantity(body.slice(strengthMatch ? strengthMatch.index : 0)) || 1,
    instructions: '',
  };
}

function parsePrescriptionText(text = '') {
  const result = { items: [], doctorName: undefined, issuedAt: undefined };
  let current = null;

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const n = normalize(line);

    const date = parseDate(line);
    if (date) {
      result.issuedAt = result.issuedAt || date;
      continue;
    }

    if (DOCTOR_RE.test(n)) {
      const name = line.includes(':') ? line.slice(line.lastIndexOf(':') + 1) : line.replace(/^\S+\s+\S+/, '');
      if (name.trim()) result.doctorName = name.trim();
      continue;
    }

    if (current && INSTRUCTION_PREFIXES.some((p) => n.startsWith(p))) {
      current.instructions = [current.instructions, line].filter(Boolean).join(' ');
      continue;
    }

    // Dòng "SL: 20 viên" nằm riêng ngay dưới tên thuốc
    if (current && /^(sl|so luong)\b/.test(n)) {
      current.quantity = parseQuantity(line) || current.quantity;
      continue;
    }

    if (NUMBERING_RE.test(line) || STRENGTH_RE.test(line)) {
      const item = parseDrugLine(line);
      if (item) {
        result.items.push(item);
        current = item;
      }
    }
    // Các dòng khác (họ tên, chẩn đoán, tiêu đề...) bỏ qua
  }

  return result;
}

// So khớp tên thuốc OCR với danh mục: catalog = [{ id, name, activeIngredient, strength }]
function scoreDrug(item, drug) {
  const itemName = normalize(item.drugName);
  const drugName = normalize(drug.name);
  let score = Math.max(
    similarity(itemName, drugName),
    drug.activeIngredient ? similarity(itemName, drug.activeIngredient) * 0.95 : 0,
  );
  // OCR thường dính thêm chữ: "Amoxicillin (Amoxicilin)" chứa "amoxicillin"
  if (drugName.length >= 4 && itemName.split(' ').includes(drugName.split(' ')[0]) && itemName.includes(drugName)) {
    score = Math.max(score, 0.9);
  }
  if (item.strength && drug.strength && normalize(item.strength) === normalize(drug.strength).replace(/\s/g, '')) {
    score = Math.min(1, score + 0.05);
  }
  return score;
}

function matchDrugs(items, catalog, { threshold = 0.6 } = {}) {
  return items.map((item) => {
    let best = null;
    let bestScore = 0;
    for (const drug of catalog) {
      const s = scoreDrug(item, drug);
      if (s > bestScore) {
        bestScore = s;
        best = drug;
      }
    }
    const matched = best && bestScore >= threshold;
    return {
      ...item,
      drugId: matched ? best.id : null,
      matchScore: Math.round(bestScore * 100) / 100,
    };
  });
}

module.exports = { parsePrescriptionText, matchDrugs, parseQuantity };
