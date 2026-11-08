const AppError = require('../utils/AppError');

// Dùng: validate({ params: idParams, body: schema, query: schema })
// Dữ liệu đã kiểm tra được đặt vào req.valid.{params,query,body}
module.exports = function validate(schemas) {
  return (req, res, next) => {
    req.valid = {};
    for (const key of ['params', 'query', 'body']) {
      if (!schemas[key]) continue;
      const result = schemas[key].safeParse(req[key] ?? {});
      if (!result.success) {
        return next(new AppError(400, 'Dữ liệu không hợp lệ', result.error.flatten()));
      }
      req.valid[key] = result.data;
    }
    return next();
  };
};
