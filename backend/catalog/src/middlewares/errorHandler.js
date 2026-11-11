function notFound(req, res) {
  res.status(404).json({ success: false, message: `Khong tim thay ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'JSON khong hop le' });
  }
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    success: false,
    message: status >= 500 ? 'Loi he thong' : err.message,
  });
}

module.exports = { notFound, errorHandler };
