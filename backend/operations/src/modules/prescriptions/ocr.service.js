const fs = require('fs/promises');
const { ocrLang } = require('../../config/env');
const AppError = require('../../utils/AppError');

// Import dạng lib để tránh chế độ debug của pdf-parse@1 khi require('pdf-parse')
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

let workerPromise = null;

// Dùng lại 1 worker Tesseract cho mọi request (khởi tạo tốn vài giây,
// lần đầu sẽ tải dữ liệu ngôn ngữ vie/eng về máy).
function getWorker() {
  if (!workerPromise) {
    const { createWorker } = require('tesseract.js');
    workerPromise = createWorker(ocrLang).catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

async function extractText(filePath, mimeType) {
  if (mimeType === 'application/pdf') {
    const { text } = await pdfParse(await fs.readFile(filePath));
    if (text && text.trim().length >= 20) return text;
    // PDF scan (chỉ chứa ảnh) cần chuyển sang ảnh trước khi OCR -> xem README
    throw new AppError(422, 'PDF không có lớp chữ (bản scan). Vui lòng tải ảnh chụp đơn thuốc.');
  }

  const worker = await getWorker();
  const { data } = await worker.recognize(filePath);
  return data.text || '';
}

async function shutdownOcr() {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}

module.exports = { extractText, shutdownOcr };
