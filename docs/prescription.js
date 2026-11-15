// OCR runs in the browser. Only the engine/language files are downloaded; the image stays local.
const CDN = "https://cdn.jsdelivr.net/npm/";
let libraryPromise;

export function normalizeMedicine(value) {
  return String(value || "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/\s+/g, " ").trim();
}

const NUMBER = "\\d+(?:[.,]\\d+)?";
const UNIT = "(?:mcg|[µμ]g|mg|kg|g|ml|iu|ui|cfu|ufc|%)";
const SCALE = "(?:(?:tỉ|tỷ|ti|ty|triệu|trieu|nghìn|nghin|million|billion)\\s*)?";
const STRENGTH = new RegExp(`${NUMBER}\\s*${SCALE}${UNIT}(?:\\s*[+/]\\s*(?:${NUMBER}\\s*)?${SCALE}${UNIT})*(?:\\s*\\)\\s*/\\s*${NUMBER}\\s*${UNIT})?(?!\\p{L})`, "iu");
const NUMBERING = /^[\s'"‘’“”]*\(?\s*(\d{1,2})(?:\s*[.,)/:]\s*|\s*-\s+|\s+(?=\p{L}))/u;
const INSTRUCTION = /^(?:ngay\b|uong\b|sang\b|trua\b|chieu\b|toi\b|cach dung\b|lieu dung\b|sau an\b|truoc an\b|sau bua\b|truoc bua\b|moi\b|boi\b|nho\b|ngam\b|nhai\b|tiem\b|xit\b|sl\b|so luong\b)/;
const HEADER = /^(?:[dp]on\s*thuoc|toa thuoc|ho(?: va)? ten|benh nhan|nguoi benh|doi tuong|tuoi|dia chi|chan doan|bac si|bs\b|ngay ke|loi dan|ghi chu|tai kham|phong kham|benh vien|trung tam y te|luu y|tong cong|thanh tien|so ngay|so dien thoai|hoat chat|thanh phan|ham luong|ten thuoc|stt\b)/;
const VITALS = /^(?:sinh hieu|kham\b|can nang|chieu cao|nhip tho|nhiet do|mach\b|(?:ha|cn|lv|t)\s*[:.]?\s*\d)/;
const ADVICE = /^(?:dung theo chi dan|neu co bat thuong|den benh vien|hoac lien he|theo so dien thoai|khi (?:tai kham|kham lai)|mang theo don|boi (?:sang|toi))/;
const MEDICINE_START = /^(?:thuoc dieu tri|chi dinh (?:dung )?thuoc|danh sach thuoc|ten thuoc)\b/;
const MEDICINE_END = /^(?:loi dan|ghi chu|hen tai kham|khi (?:tai kham|kham lai))\b/;
const DOCUMENT_LABEL = /\b(?:(?:bo|so) y te|so ho so|ma (?:ho so|benh nhan|don thuoc)|so (?:the|bhyt|bhxh)|dien thoai|hotline|email|website|fax)\b|^(?:gioi tinh|nam sinh|can nang|chieu cao|huyet ap)(?:\s*[:=]|\s+\d)/;
const ADDRESS = /^(?:(?:no\.?|so)\s*)?(?:\d+[\d/.-]*\s+)?(?:(?:duong|pho|ngo|ngach|hem|thon|ap|phuong|quan|huyen|thi tran|thi xa|thanh pho|tinh|khu pho|khu do thi|to dan pho|dia diem|co so|chi nhanh)\b|(?:d|p|q|h|tp|ng)\.\s*\p{L}|d\/?c\s*[:.])/u;
const SCHEDULE = /^(?:(?:tu|den)\s+)?(?:thu\s*[2-7]\b|chu nhat\b|gio (?:kham|lam viec|mo cua)\b|lich (?:kham|lam viec)\b)/;
const QUANTITY = /^(?:\d+(?:[.,]\d+)?\s*)?(?:vien|vi|hop|goi|ong|chai|lo|tuyp|mg|mcg|ml|iu|ui)\b/;
// Product classification is not part of the medicine name. Do not strip release forms such as (SR).
const CLASSIFICATION = /[([]\s*(?:NT|KDNT|KĐNT|TPCN|TPBVSK|thực\s*phẩm\s*(?:chức\s*năng|bảo\s*vệ\s*sức\s*khỏe))\s*[)\]]/iu;

function normalizeStrength(value) {
  return normalizeMedicine(value).replace(/[()\s]/g, "").replace(/,/g, ".").replace(/μ/g, "µ")
    .replace(/(?:ti|ty)(?=(?:cfu|ufc))/g, "billion").replace(/trieu(?=(?:cfu|ufc))/g, "million")
    .replace(/ufc/g, "cfu").replace(/µg/g, "mcg").replace(/ui/g, "iu");
}

function rowMarker(value) {
  const text = String(value || '');
  const strength = text.match(STRENGTH);
  // A wrapped value such as "1 tỉ CFU" is not row number 1.
  if (strength && /^[\s(]*$/.test(text.slice(0, strength.index))) return null;
  return text.match(NUMBERING);
}

function isDocumentLine(value) {
  const text = String(value || '').trim();
  const marker = rowMarker(text);
  const body = normalizeMedicine(marker ? text.slice(marker[0].length) : text);
  return HEADER.test(body) || INSTRUCTION.test(body) || VITALS.test(body) || ADVICE.test(body)
    || MEDICINE_START.test(body) || DOCUMENT_LABEL.test(body) || (ADDRESS.test(body) && !STRENGTH.test(body))
    || SCHEDULE.test(body) || /\b\d{1,2}[:h]\d{2}\b/.test(body)
    || /https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(body);
}

function cleanOcrLine(text) {
  // Recover a row after a short stray column fragment, e.g. "đề \\2. SUCRATE".
  // Document fields are rejected before this step so a patient/code prefix is never erased.
  const value = String(text || '').trim();
  if (rowMarker(value)) return value;
  return value
    .replace(/^[^\n]{0,12}[\\|]\s*(?=\(?\d{1,2}[.)/:]\s*\p{L})/u, '')
    .replace(/^[\p{P}\p{S}\d\s]{0,12}(?<!\d)(?=\d{1,2}\s*[.)/:]\s*\p{L})/u, '')
    .replace(/^[A-Za-z]\s*(?=\d{1,2}\s*[.)/:]\s*\p{L})/u, '');
}

function cleanOcrName(name) {
  let result = name.replace(/\[\s*(SR|XR|MR|CR|ER|DR|EC)\s*\]/giu, '($1)')
    .replace(/\(\s*(?:dưới\s*dạng|duoi\s*dang|dạng\s*bào\s*chế|dang\s*bao\s*che)(?=\s|:)[^()]*(?:\)|$)/giu, '')
    .replace(/\s*\(\s*/g, ' (').replace(/\s+\)/g, ')').replace(/\)\s*(?=[\p{L}(])/gu, ') ')
    .replace(/\s+/g, ' ').trim();
  const opens = (result.match(/\(/g) || []).length, closes = (result.match(/\)/g) || []).length;
  // The strength may be inside a parenthesis; parseMedicine cuts just before it.
  if (opens > closes && opens <= 4) result += ')'.repeat(opens-closes);
  return result;
}

function readableMedicineName(name, wordConfidences) {
  const words = name.match(/\p{L}+/gu) || [];
  const shortCode = /^(?:[A-Z][A-Z\d-]{1,7}|\d{1,2}-[A-Z]{2,5})$/.test(name);
  if ((!words.some(word => word.length >= 3) && !shortCode) || /^[\d.,\s]+\s+\p{L}/u.test(name)
    || /[$=!?<>\[\]{}|\\¤]/u.test(name) || /^(?:[.\s]*(?:mg|mcg|ml|iu|ui)\b)/i.test(name)) return false;
  let depth = 0;
  for (const char of name) {
    if (char === '(') depth++;
    if (char === ')' && --depth < 0) return false;
  }
  // Very weak name fragments are left in the collapsed original text for review.
  return !(wordConfidences.length >= 2 && wordConfidences.filter(value => value < 30).length > wordConfidences.length/2);
}

export function parseMedicine(value) {
  const raw = String(value);
  const marker = rowMarker(raw);
  const text = (marker ? raw.slice(marker[0].length) : raw).trim();
  const strength = text.match(STRENGTH);
  const name = (strength ? text.slice(0, strength.index) : text).split(CLASSIFICATION)[0]
    .replace(/\s*(?:\bSL\s*[:.]?|\bsố lượng\s*:|[x×]\s*\d|\d+\s*(?:viên|vỉ|hộp|gói|ống|chai|lọ|tuýp)\b|\b(?:uống|ngày uống|cách dùng)\b).*$/iu, "")
    .replace(/[\s,:;\-–(]+$/u, "").trim();
  return { name, strength: strength ? strength[0].replace(/[()\s]+/g, "").replace(/,/g, ".") : "" };
}

function uniqueMedicines(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = normalizeMedicine(`${item.name} ${item.strength}`);
    if (item.name.length < 2 || !/\p{L}/u.test(item.name) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function lineBounds(line) {
  const box = line?.bbox;
  return box && ['x0', 'y0', 'x1', 'y1'].every(key => Number.isFinite(box[key])) ? box : null;
}

function mergeLines(previous, line) {
  const confidences = [previous.confidence, line.confidence].filter(Number.isFinite);
  const left = lineBounds(previous), right = lineBounds(line);
  return { ...previous, text: `${previous.text.trim()} ${line.text.trim()}`,
    words: [...(previous.words || []), ...(line.words || [])],
    bbox: left && right ? {x0: Math.min(left.x0, right.x0), y0: Math.min(left.y0, right.y0), x1: Math.max(left.x1, right.x1), y1: Math.max(left.y1, right.y1)} : previous.bbox,
    confidence: confidences.length ? Math.min(...confidences) : undefined };
}

function sourceLines(data) {
  const structured = data.lines?.length ? data.lines : (data.blocks || []).flatMap(block =>
    (block.paragraphs || []).flatMap(paragraph => paragraph.lines || []));
  return structured.length ? structured : String(data.text || '').split(/\r?\n/).map(text => ({ text }));
}

function medicineSection(readings) {
  const lines = readings.flatMap(sourceLines).filter(line => lineBounds(line));
  const starts = lines.filter(line => MEDICINE_START.test(normalizeMedicine(line.text)) && !STRENGTH.test(line.text));
  const top = starts.length ? Math.min(...starts.map(line => line.bbox.y1)) : null;
  const first = lines.filter(line => Number(rowMarker(cleanOcrLine(line.text))?.[1]) === 1 && (STRENGTH.test(line.text) || CLASSIFICATION.test(line.text)));
  const anchor = top ?? (first.length ? Math.min(...first.map(line => line.bbox.y0)) : null);
  const ends = lines.filter(line => anchor != null && line.bbox.y0 > anchor && MEDICINE_END.test(normalizeMedicine(line.text)));
  return {top, bottom: ends.length ? Math.min(...ends.map(line => line.bbox.y0)) : null,
    first: first.length ? Math.min(...first.map(line => line.bbox.y0)) : null};
}

function medicineSectionLines(data, section) {
  const lines = sourceLines(data);
  const start = lines.findIndex(line => MEDICINE_START.test(normalizeMedicine(line.text)) && !STRENGTH.test(line.text));
  const anchor = start >= 0 ? start : lines.findIndex(line => rowMarker(cleanOcrLine(line.text)) && STRENGTH.test(line.text));
  const end = lines.findIndex((line,index) => anchor >= 0 && index > anchor && MEDICINE_END.test(normalizeMedicine(line.text)));
  return lines.filter((line,index) => {
    const box = lineBounds(line);
    if (box && section && (section.top != null || section.bottom != null)) {
      const middle = (box.y0+box.y1)/2;
      return (section.top == null || middle > section.top) && (section.bottom == null || middle < section.bottom);
    }
    return index > start && (end < 0 || index < end);
  });
}

function medicineRectangle(readings, width, height) {
  // Use coordinates and rotation from the same reading. Tesseract's rectangle
  // keeps bounding boxes in page coordinates, so recovered rows can be merged.
  const reference = readings.find(data => medicineSection([data]).top != null);
  if (!reference) return null;
  const section = medicineSection([reference]);
  const padding = Math.max(24, Math.round(width*0.03));
  const top = Math.max(0, Math.floor(section.top-padding));
  const bottom = Math.min(height, Math.ceil((section.bottom ?? height)+padding));
  if (bottom-top < 60 || bottom-top > height*0.92) return null;
  return {rotateAuto: false, rotateRadians: reference.rotateRadians || 0,
    rectangle: {left: 0, top, width, height: bottom-top}};
}

function printedAliases(rawText) {
  const aliases = [], stack = [];
  const text = rawText.replace(CLASSIFICATION, '');
  const add = body => {
    for (const part of body.split(/\s*\+\s*(?=\p{L})/u)) {
      if (!STRENGTH.test(part) || isDocumentLine(part)) continue;
      const alias = parseMedicine(part);
      alias.name = cleanOcrName(alias.name);
      if (readableMedicineName(alias.name, [])) aliases.push(alias);
    }
  };
  for (let index=0; index<text.length; index++) {
    if (text[index] === '(') stack.push(index+1);
    if (text[index] === ')' && stack.length) add(text.slice(stack.pop(),index));
  }
  for (const start of stack) add(text.slice(start));
  return uniqueMedicines(aliases);
}

function prescriptionCandidates(data, section) {
  const source = medicineSectionLines(data, section).flatMap(line => {
    const parts = String(line.text || '').split(/\s+(?=[‘’'"“”]*\(?\d{1,2}\s*[.)/]\s+\p{L})/u).filter(text => text.trim());
    return parts.filter(text => !isDocumentLine(text)).map(text => ({...line, text: cleanOcrLine(text), sharedBounds: parts.length > 1}));
  });
  const lines = [];
  for (const line of source) {
    const previous = lines.at(-1);
    const strength = String(line.text || "").match(STRENGTH);
    const normalized = normalizeMedicine(line.text);
    const left = lineBounds(previous), right = lineBounds(line);
    const sameBaseline = left && right && Math.abs((left.y0+left.y1-right.y0-right.y1)/2) < Math.max(left.y1-left.y0, right.y1-right.y0)*0.45
      && right.x0 >= left.x1 && right.x0-left.x1 < Math.max(left.y1-left.y0, right.y1-right.y0)*2;
    const continuation = strength && !rowMarker(line.text) && !HEADER.test(normalized) && !INSTRUCTION.test(normalized)
      && (/^[\s(+/]*$/.test(String(line.text).slice(0, strength.index)) || /[/+\-–]\s*$/.test(previous?.text || '') || /^[\p{Ll}]/u.test(line.text.trim()) || sameBaseline);
    if (previous && rowMarker(previous.text) && continuation && (!STRENGTH.test(previous.text) || /[+/]\s*$/.test(previous.text) || /^\s*[+/]/.test(line.text))) {
      lines[lines.length - 1] = mergeLines(previous, line);
    } else lines.push(line);
  }
  const candidates = lines.flatMap((line, index) => {
    const rawText = String(line.text || "").trim();
    const marker = rowMarker(rawText);
    const normalized = normalizeMedicine(marker ? rawText.slice(marker[0].length) : rawText);
    if (isDocumentLine(rawText) || QUANTITY.test(normalized) ||
      (!marker && /^\s*\(/.test(rawText)) ||
      (!marker && !STRENGTH.test(rawText) && !CLASSIFICATION.test(rawText))) return [];
    const item = parseMedicine(rawText);
    item.name = cleanOcrName(item.name);
    if (!uniqueMedicines([item]).length) return [];
    // A short code without a dose/classification is too weak to be a medicine;
    // table rules can otherwise be recognized as numbered tokens such as "EE".
    if (/^[A-Z]{2}$/.test(item.name) && !item.strength && !CLASSIFICATION.test(rawText)) return [];
    const lineConfidence = Number.isFinite(line.confidence) ? line.confidence
      : Number.isFinite(data.confidence) ? data.confidence : null;
    const name = normalizeMedicine(item.name);
    const nameWords = new Set(name.match(/[\p{L}\p{N}]+/gu) || []);
    const wordConfidences = (line.words || []).filter(word => {
      const text = normalizeMedicine(word.text).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      return text.length > 0 && nameWords.has(text) && Number.isFinite(word.confidence);
    }).map(word => word.confidence);
    if (!readableMedicineName(item.name, wordConfidences)) return [];
    const confidence = wordConfidences.length ? Math.min(lineConfidence ?? 100, ...wordConfidences) : lineConfidence;
    const unparsedTail = (rawText.split(CLASSIFICATION)[1] || "").replace(CLASSIFICATION, "")
      .replace(/\s*(?:[x×]\s*\d|SL\s*[:.]?|=\s*\d).*$/iu, "").trim();
    const suspicious = /[^\p{L}\p{N}\s().+/'’\-–]/u.test(item.name) ||
      /\d+(?:[.,]\d+)?\s*[+/]\s*$/.test(item.name) ||
      (!marker && CLASSIFICATION.test(rawText)) ||
      (!item.strength && CLASSIFICATION.test(rawText) && /[\p{L}\p{N}]/u.test(unparsedTail));
    return [{ ...item, aliases: printedAliases(rawText), rawText, confidence, suspicious, bbox: lineBounds(line), sharedBounds: line.sharedBounds, index,
      number: marker ? Number(marker[1]) : null }];
  });
  const hasNumberedRows = candidates.some(item => item.number != null);
  return candidates.map((item, index) => {
    const previous = candidates.slice(0, index).reverse().find(row => row.number != null)?.number;
    const next = candidates.slice(index+1).find(row => row.number != null)?.number;
    return { ...item, suspicious: item.suspicious || (hasNumberedRows && item.number == null),
      order: item.number ?? (previous != null ? previous + 0.5 : next != null ? next - 0.5 : index + 1) };
  });
}

export function parsePrescriptionMedicines(text) {
  return uniqueMedicines(prescriptionCandidates({ text }).map(({ name, strength }) => ({ name, strength })));
}

function candidateScore(item) {
  return (item.confidence ?? 50) - (item.suspicious ? 25 : 0) + (item.number != null ? 4 : 0);
}

function normalizedMedicineName(value) {
  return normalizeMedicine(value).replace(/[()]/g, ' ').replace(/\s*([/,+-])\s*/g, '$1').replace(/\s+/g, ' ').trim();
}

function medicineKey(item) {
  return `${normalizedMedicineName(item.name)}\n${normalizeStrength(item.strength)}`;
}

function sameMedicineFamily(a, b) {
  if (a.number != null && b.number != null && a.number !== b.number) return false;
  if (separateRows(a, b)) return false;
  const core = item => normalizeMedicine(item.name.split('(')[0]);
  if (core(a).length < 4 || core(a) !== core(b) || normalizeStrength(a.strength) !== normalizeStrength(b.strength)) return false;
  const release = item => (normalizeMedicine(item.name).match(/\b(?:sr|xr|mr|cr|er|dr|retard)\b/g) || []).sort().join(' ');
  if (release(a) !== release(b)) return false;
  const notes = item => new Set(normalizeMedicine(item.name.slice(item.name.indexOf('(') + 1))
    .replace(/\b(?:capsules?|tablets?|caplets?|vien|nang)\b/g, '')
    .match(/[\p{L}\p{N}]+/gu) || []);
  if (!a.name.includes('(') || !b.name.includes('(')) return true;
  const left = notes(a), right = notes(b);
  return left.size === right.size && [...left].every(word => right.has(word));
}

function separateRows(a, b) {
  if (!a.bbox || !b.bbox) return false;
  const height = Math.max(a.bbox.y1-a.bbox.y0, b.bbox.y1-b.bbox.y0, 1);
  return Math.abs((a.bbox.y0+a.bbox.y1-b.bbox.y0-b.bbox.y1)/2) > height*2;
}

function samePrintedRow(a, b) {
  if (!a.bbox || !b.bbox || a.sharedBounds || b.sharedBounds) return false;
  if (a.number != null && b.number != null && a.number !== b.number) return false;
  const x = Math.max(0, Math.min(a.bbox.x1, b.bbox.x1)-Math.max(a.bbox.x0, b.bbox.x0));
  const y = Math.max(0, Math.min(a.bbox.y1, b.bbox.y1)-Math.max(a.bbox.y0, b.bbox.y0));
  const area = box => Math.max(1, (box.x1-box.x0)*(box.y1-box.y0));
  const vertical = y / Math.max(1, Math.min(a.bbox.y1-a.bbox.y0, b.bbox.y1-b.bbox.y0));
  const horizontal = x / Math.max(1, Math.min(a.bbox.x1-a.bbox.x0, b.bbox.x1-b.bbox.x0));
  return x*y/(area(a.bbox)+area(b.bbox)-x*y) > 0.65 || (vertical > 0.75 && horizontal > 0.8);
}

function isPrintedAliasOf(fragment, original) {
  if (original.number == null || (fragment.number != null && fragment.number !== original.number)) return false;
  if (separateRows(fragment, original)) return false;
  const keys = new Set((original.aliases || []).map(medicineKey));
  return keys.has(medicineKey(fragment)) || (fragment.aliases || []).some(alias => keys.has(medicineKey(alias)));
}

// Merge evidence from every pass. A row absent from the best overall pass must
// still survive; conflicting readings of the same printed row remain flagged.
export function selectPrescriptionReadings(readings) {
  const section = medicineSection(readings);
  const passes = readings.map(data => prescriptionCandidates(data, section));
  const groups = [];
  passes.forEach((items, pass) => items.forEach(item => {
    const label = medicineKey(item);
    const compatible = rows => item.number == null || !rows.some(other => other.number != null)
      || rows.some(other => other.number === item.number || (other.number != null && medicineKey(other) === label));
    let group = groups.find(rows => item.number != null && rows.some(other => other.number === item.number && !separateRows(item, other)));
    group ||= groups.find(rows => compatible(rows) && rows.some(other => medicineKey(other) === label));
    group ||= groups.find(rows => compatible(rows) && !rows.some(other => other.pass === pass) && rows.some(other => samePrintedRow(item, other)));
    group ||= groups.find(rows => compatible(rows) && rows.some(other => isPrintedAliasOf(item, other) || isPrintedAliasOf(other, item)));
    group ||= groups.find(rows => compatible(rows) && !rows.some(other => other.pass === pass) && rows.some(other => sameMedicineFamily(item, other)));
    if (group) group.push({...item, pass});
    else groups.push([{...item, pass}]);
  }));
  // A later full row can explain aliases that were separate groups in an earlier
  // sparse pass. Reconcile those groups after all readings have been collected.
  for (let left=0; left<groups.length; left++) for (let right=left+1; right<groups.length; right++) {
    const a=groups[left], b=groups[right];
    const aNumbers=new Set(a.map(item=>item.number).filter(number=>number != null));
    const bNumbers=new Set(b.map(item=>item.number).filter(number=>number != null));
    if (aNumbers.size && bNumbers.size && ![...aNumbers].some(number=>bNumbers.has(number))) continue;
    if (a.some(item=>b.some(other=>isPrintedAliasOf(item,other) || isPrintedAliasOf(other,item)))) {
      a.push(...b); groups.splice(right,1); right--;
    }
  }
  const numberedGroups = new Map();
  for (const group of groups) for (const number of new Set(group.map(item => item.number).filter(number => number != null))) {
    numberedGroups.set(number, (numberedGroups.get(number) || 0) + 1);
  }
  const selectedGroups = groups.map(alternatives => {
    const support = new Map();
    for (const item of alternatives) {
      const key = medicineKey(item);
      if (!support.has(key)) support.set(key, new Set());
      support.get(key).add(item.pass);
    }
    const score = item => candidateScore(item) + (support.get(medicineKey(item)).size-1)*8;
    const primary = alternatives.filter(item => !alternatives.some(other => medicineKey(item) !== medicineKey(other) && isPrintedAliasOf(item, other)));
    const eligible = primary.length ? primary : alternatives;
    let selected = eligible.reduce((best, other) => score(other) > score(best) ? other : best, eligible[0]);
    // Prefer a readable continuation over a truncated brand name, without guessing spelling.
    const moreComplete = eligible.filter(other => {
      const sameName = normalizeMedicine(other.name) === normalizeMedicine(selected.name);
      const longerName = normalizeMedicine(other.name.split('(')[0]).startsWith(normalizeMedicine(selected.name.split('(')[0])+' ');
      const keepsStrength = !selected.strength || normalizeStrength(other.strength) === normalizeStrength(selected.strength);
      return (sameName || longerName) && keepsStrength && (longerName || (!selected.strength && other.strength))
        && candidateScore(other) >= candidateScore(selected)-10;
    }).sort((a,b) => Number(Boolean(b.strength))-Number(Boolean(a.strength)) || b.name.length-a.name.length);
    if (moreComplete.length) selected = moreComplete[0];
    const rowNumbers = [...new Set(alternatives.map(item => item.number).filter(number => number != null))];
    const key = medicineKey(selected);
    const conflict = alternatives.some(other => medicineKey(other) !== key && !sameMedicineFamily(selected, other) && !isPrintedAliasOf(other, selected));
    const singlePass = passes.length > 1 && new Set(alternatives.map(item => item.pass)).size === 1;
    return { ...selected, rowNumbers, rowNumber: selected.number ?? rowNumbers[0] ?? null,
      needsReview: selected.suspicious || conflict || singlePass || rowNumbers.some(number => numberedGroups.get(number)>1)
        || (!selected.strength && !CLASSIFICATION.test(selected.rawText))
        || selected.confidence == null || selected.confidence < 80 };
  }).sort((a,b) => (a.rowNumber ?? a.order)-(b.rowNumber ?? b.order)
    || (a.bbox && b.bbox ? a.bbox.y0-b.bbox.y0 || a.bbox.x0-b.bbox.x0 : 0));
  const seen = new Set();
  return selectedGroups.flatMap(selected => {
    const key = medicineKey(selected);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ name: selected.name, strength: selected.strength, rawText: selected.rawText,
      confidence: selected.confidence, rowNumber: selected.rowNumber, rowNumbers: selected.rowNumbers, needsReview: selected.needsReview }];
  });
}

export function parseMedicineList(text) {
  // Keep ingredient commas inside parentheses and decimal commas in strengths.
  // A newline always starts another medicine, even if the previous bracket was mistyped.
  const parts = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    let start = 0, depth = 0;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (char === '(') depth++;
      if (char === ')') depth = Math.max(0, depth-1);
      const decimal = char === ',' && /\d/.test(line[index-1] || '') && /\d/.test(line[index+1] || '');
      if (!depth && (char === ';' || (char === ',' && !decimal))) {
        parts.push(line.slice(start, index)); start = index+1;
      }
    }
    parts.push(line.slice(start));
  }
  return uniqueMedicines(parts.map(parseMedicine));
}

export function medicineLabel(item) {
  return [item.name, item.strength].filter(Boolean).join(" ");
}

export function matchesMedicine(requested, stock) {
  const medicine = parseMedicine(stock.name || "");
  const strength = normalizeStrength(stock.strength || medicine.strength);
  return normalizedMedicineName(requested.name) === normalizedMedicineName(medicine.name) &&
    (!requested.strength || normalizeStrength(requested.strength) === strength);
}

export async function preparePrescriptionImage(file, signal) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    signal.throwIfAborted();
    // Aim for readable text while bounding memory use on phones, even for large camera photos.
    const scale = Math.min(3, Math.max(1, 1800 / bitmap.width),
      3000 / Math.max(bitmap.width, bitmap.height), Math.sqrt(4000000 / (bitmap.width * bitmap.height)));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const enhanced = document.createElement("canvas");
    enhanced.width = width; enhanced.height = height;
    const ctx = enhanced.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    const natural = document.createElement('canvas');
    natural.width = width; natural.height = height;
    natural.getContext('2d').drawImage(enhanced, 0, 0);
    const image = ctx.getImageData(0, 0, width, height);
    const gray = new Uint8Array(width * height);
    const histogram = new Uint32Array(256);
    for (let i = 0; i < gray.length; i++) {
      gray[i] = Math.round(image.data[i * 4] * 0.299 + image.data[i * 4 + 1] * 0.587 + image.data[i * 4 + 2] * 0.114);
      histogram[gray[i]]++;
    }
    let low = 0, high = 255, count = 0;
    while (low < 255 && count + histogram[low] < gray.length * 0.01) count += histogram[low++];
    count = 0;
    while (high > low && count + histogram[high] < gray.length * 0.005) count += histogram[high--];
    const range = Math.max(30, high - low);
    if (high > low) {
      for (let i = 0; i < gray.length; i++) gray[i] = Math.max(0, Math.min(255, Math.round((gray[i] - low) * 255 / range)));
    }
    // Mild edge enhancement helps small print without discarding grayscale details.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const neighbours = gray[y * width + Math.max(0, x - 1)] + gray[y * width + Math.min(width - 1, x + 1)] +
          gray[Math.max(0, y - 1) * width + x] + gray[Math.min(height - 1, y + 1) * width + x];
        const value = Math.max(0, Math.min(255, Math.round(gray[i] * 1.6 - neighbours * 0.15)));
        image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = value;
      }
    }
    ctx.putImageData(image, 0, 0);
    // Local thresholding provides an independent reading for photos with shadows/uneven lighting.
    const stride = width + 1;
    const integral = new Uint32Array(stride * (height + 1));
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let x = 0; x < width; x++) {
        sum += gray[y * width + x];
        integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + sum;
      }
    }
    const radius = Math.max(12, Math.round(width / 50));
    for (let y = 0; y < height; y++) {
      const top = Math.max(0, y - radius), bottom = Math.min(height, y + radius + 1);
      for (let x = 0; x < width; x++) {
        const left = Math.max(0, x - radius), right = Math.min(width, x + radius + 1);
        const mean = (integral[bottom * stride + right] - integral[top * stride + right] -
          integral[bottom * stride + left] + integral[top * stride + left]) / ((bottom - top) * (right - left));
        const i = y * width + x;
        image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = gray[i] < mean - 12 ? 0 : 255;
      }
    }
    const binary = document.createElement("canvas");
    binary.width = width; binary.height = height;
    binary.getContext("2d").putImageData(image, 0, 0);
    signal.throwIfAborted();
    return { enhanced, binary, natural };
  } finally {
    bitmap.close();
  }
}

function loadLibrary() {
  if (!libraryPromise) {
    libraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timer = setTimeout(() => fail(), 25000);
      const fail = () => {
        clearTimeout(timer);
        script.remove();
        libraryPromise = null;
        reject(new Error("Không tải được công cụ đọc ảnh. Hãy thử lại hoặc nhập tên thuốc."));
      };
      script.src = `${CDN}tesseract.js@5.1.1/dist/tesseract.min.js`;
      script.onload = () => {
        clearTimeout(timer);
        if (window.Tesseract?.createWorker) resolve(window.Tesseract);
        else fail();
      };
      script.onerror = fail;
      document.head.append(script);
    });
  }
  return libraryPromise;
}

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function readPrescriptionImage(file, { signal, onProgress = () => {}, onText = () => {} }) {
  const timeoutSignal = AbortSignal.timeout(90000);
  const operation = AbortSignal.any([...(signal ? [signal] : []), timeoutSignal]);
  let worker;
  let finished = false;
  let images;
  let pass = 0;
  const totalPasses = 5;
  let reportedProgress = 0;
  const progress = value => {
    reportedProgress = Math.max(reportedProgress, Math.min(1, value));
    onProgress(reportedProgress);
  };
  try {
    images = await preparePrescriptionImage(file, operation);
    const { createWorker } = await abortable(loadLibrary(), operation);
    let rejectWorkerError;
    const workerError = new Promise((_, reject) => { rejectWorkerError = reject; });
    // A worker that finishes initializing after cancellation must also be released.
    // Tesseract downloads vie/eng LSTM data from its official @tesseract.js-data packages on jsDelivr.
    const creating = createWorker("vie+eng", 1, {
      workerPath: `${CDN}tesseract.js@5.1.1/dist/worker.min.js`,
      corePath: `${CDN}tesseract.js-core@5.1.1`,
      // Tesseract already rejects the job promise; avoid an additional uncaught browser error.
      errorHandler: error => rejectWorkerError(new Error(String(error))),
      logger: event => {
        if (!operation.aborted && event.status === "recognizing text") progress((pass + event.progress) / totalPasses);
      },
    }).then(created => {
      if (operation.aborted || finished) {
        void created.terminate();
        throw operation.reason || new DOMException("Đã dừng đọc ảnh", "AbortError");
      }
      worker = created;
      return created;
    });
    await abortable(Promise.race([creating, workerError]), operation);
    const recognize = (image, segmentation, options = {}) => abortable(Promise.race([worker.recognize(image, {
      rotateAuto: true, tessedit_pageseg_mode: segmentation,
      preserve_interword_spaces: "1", user_defined_dpi: "300", ...options,
    }), workerError]), operation);
    const readings = [];
    const addReading = data => {
      readings.push(data);
      onText(readings.map((reading, index) => `Lần đọc ${index+1}\n${reading.text || sourceLines(reading).map(line => line.text).join('\n')}`).join('\n\n'));
      progress((pass+1) / totalPasses);
    };
    const variants = [[images.enhanced, '3'], [images.natural, '11'], [images.binary, '6']];
    for (pass = 0; pass < variants.length; pass++) {
      operation.throwIfAborted();
      const data = (await recognize(...variants[pass])).data;
      addReading(data);
    }
    const region = medicineRectangle(readings, images.enhanced.width, images.enhanced.height);
    if (region) {
      for (const image of [images.enhanced, images.natural]) {
        operation.throwIfAborted();
        addReading((await recognize(image, '6', region)).data);
        pass++;
      }
    }
    progress(1);
    return selectPrescriptionReadings(readings);
  } finally {
    finished = true;
    if (worker) await worker.terminate();
    if (images) {
      for (const canvas of Object.values(images)) canvas.width = canvas.height = 1;
    }
  }
}
