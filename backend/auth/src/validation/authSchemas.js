const { z } = require('zod');
const { Roles, SELF_REGISTERABLE_ROLES } = require('../constants/roles');
const { emailSchema, passwordSchema } = require('./commonSchemas');

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  role: z.preprocess(
    (value) => typeof value === 'string' ? value.trim().toUpperCase() : value,
    z.enum(SELF_REGISTERABLE_ROLES, {
      error: `Role chỉ được là ${Roles.CUSTOMER} hoặc ${Roles.PHARMACY}.`
    })
  ).optional()
}).strict();

const loginSchema = z.object({
  totp: z.string().regex(/^\d{6}$/).optional(),
  email: emailSchema,
  password: z.string().min(1, 'Mật khẩu là bắt buộc.').max(1024)
}).strict();

const verificationSchema = z.object({
  isVerified: z.boolean(),
  reason: z.string().trim().max(500, 'Lý do không được vượt quá 500 ký tự.').optional()
}).strict();

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: passwordSchema
}).strict();
const refreshSchema = z.object({ refreshToken: z.string().min(60).max(120) }).strict();
const accountStatusSchema = z.object({ isActive: z.boolean() }).strict();
const totpCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
module.exports = { registerSchema, loginSchema, verificationSchema,
  changePasswordSchema, refreshSchema, accountStatusSchema, totpCodeSchema };
