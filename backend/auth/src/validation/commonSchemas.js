const { z } = require('zod');

const emailSchema = z.string().trim().toLowerCase().max(254, 'Email không được vượt quá 254 ký tự.').email('Email không hợp lệ.');
const passwordSchema = z.string().min(8, 'Mật khẩu phải có ít nhất 8 ký tự.').superRefine((password, ctx) => {
  if (Buffer.byteLength(password, 'utf8') > 72) ctx.addIssue({ code: 'custom', message: 'Mật khẩu không được vượt quá 72 byte.' });
});
const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID phải gồm đúng 24 ký tự hexadecimal.');
const objectIdParamsSchema = z.object({ id: objectIdSchema }).strict();
const paginationQuerySchema = z.object({
  page: z.coerce.number().int('page phải là số nguyên.').min(1, 'page phải lớn hơn hoặc bằng 1.').default(1),
  limit: z.coerce.number().int('limit phải là số nguyên.').min(1, 'limit phải lớn hơn hoặc bằng 1.').max(100, 'limit không được vượt quá 100.').default(20),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
}).strict();
const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
}).strict();
const verificationHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().max(512).optional()
}).strict();

module.exports = { emailSchema, passwordSchema, objectIdSchema, objectIdParamsSchema, paginationQuerySchema, searchQuerySchema, verificationHistoryQuerySchema };
