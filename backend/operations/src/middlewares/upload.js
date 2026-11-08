const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { uploadDir, maxUploadBytes } = require('../config/env');
const AppError = require('../utils/AppError');

const prescriptionDir = path.join(uploadDir, 'prescriptions');
fs.mkdirSync(prescriptionDir, { recursive: true });

const ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
};

const storage = multer.diskStorage({
  destination: prescriptionDir,
  // Tên file ngẫu nhiên, không dùng tên gốc của người dùng
  filename: (req, file, cb) => cb(null, crypto.randomUUID() + ALLOWED[file.mimetype]),
});

const uploadPrescription = multer({
  storage,
  limits: { fileSize: maxUploadBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED[file.mimetype]) return cb(null, true);
    return cb(new AppError(400, 'Chỉ chấp nhận ảnh JPG, PNG hoặc file PDF'));
  },
}).single('file');

module.exports = { uploadPrescription };
