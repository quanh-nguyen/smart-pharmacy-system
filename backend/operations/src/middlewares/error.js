const multer = require('multer');
const {
  UniqueConstraintError, ValidationError, ForeignKeyConstraintError, DatabaseError,
} = require('sequelize');
const AppError = require('../utils/AppError');

function notFound(req, res, next) {
  next(new AppError(404, `Không tìm thấy ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File quá lớn' : 'Lỗi tải file';
    return res.status(400).json({ error: message });
  }
  // UniqueConstraintError là lớp con của ValidationError -> kiểm tra trước
  if (err instanceof UniqueConstraintError) {
    return res.status(409).json({ error: 'Dữ liệu bị trùng', details: err.errors?.map((e) => e.path) });
  }
  if (err instanceof ValidationError) {
    return res.status(400).json({
      error: 'Dữ liệu không hợp lệ',
      details: err.errors?.map((e) => ({ field: e.path, message: e.message })),
    });
  }
  if (err instanceof ForeignKeyConstraintError) {
    return res.status(400).json({ error: 'Dữ liệu tham chiếu không tồn tại hoặc đang được sử dụng' });
  }
  if (err instanceof DatabaseError) {
    console.error('Database error:', err.parent?.sqlMessage || err.message);
    return res.status(500).json({ error: 'Lỗi cơ sở dữ liệu' });
  }
  console.error(err);
  return res.status(500).json({ error: 'Lỗi máy chủ' });
}

module.exports = { notFound, errorHandler };
