const { z } = require('zod');

// ID trong MySQL là INT UNSIGNED AUTO_INCREMENT; nhận cả số và chuỗi số
const idSchema = z.coerce.number({ invalid_type_error: 'ID không hợp lệ' }).int('ID không hợp lệ').positive('ID không hợp lệ');

const idParams = z.object({ id: idSchema });

const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const sameId = (a, b) => a !== null && a !== undefined && String(a) === String(b);

module.exports = { z, idSchema, idParams, pagination, sameId };
