const express = require('express');
const { authenticate, authorize } = require('../../middleware/auth');
const validate = require('../../middleware/validate');
const { z, idSchema, idParams, pagination } = require('../../utils/schemas');
const { STATUSES } = require('./orderStateMachine');
const service = require('./order.service');

const router = express.Router();
router.use(authenticate);

const createBody = z
  .object({
    pharmacyId: idSchema,
    items: z
      .array(z.object({ drugId: idSchema, quantity: z.number().int().min(1).max(100) }))
      .max(50)
      .optional(),
    prescriptionId: idSchema.optional(),
    shippingAddress: z.string().trim().min(5).max(300),
    phone: z.string().trim().regex(/^(0|\+84)\d{9,10}$/, 'Số điện thoại không hợp lệ'),
    note: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.items?.length || d.prescriptionId, {
    message: 'Cần danh sách thuốc (items) hoặc prescriptionId',
  });

const listQuery = pagination.extend({
  status: z.enum(STATUSES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const statusBody = z.object({
  status: z.enum(STATUSES),
  note: z.string().trim().max(500).optional(),
});

// Khách tạo đơn (từ giỏ hàng hoặc từ đơn thuốc đã xác nhận)
router.post('/', authorize('customer'), validate({ body: createBody }), async (req, res) => {
  res.status(201).json(await service.create(req.user, req.valid.body));
});

// Lịch sử đơn: khách thấy đơn của mình, nhà thuốc thấy đơn gửi tới mình, admin thấy tất cả
router.get('/', validate({ query: listQuery }), async (req, res) => {
  res.json(await service.list(req.user, req.valid.query));
});

router.get('/:id', validate({ params: idParams }), async (req, res) => {
  res.json(await service.get(req.user, req.valid.params.id));
});

// Nhà thuốc xác nhận / từ chối / cập nhật; khách hủy hoặc xác nhận đã nhận
router.patch('/:id/status', validate({ params: idParams, body: statusBody }), async (req, res) => {
  res.json(await service.updateStatus(req.user, req.valid.params.id, req.valid.body));
});

router.post(
  '/:id/cancel',
  authorize('customer', 'admin'),
  validate({ params: idParams, body: z.object({ note: z.string().trim().max(500).optional() }) }),
  async (req, res) => {
    const { note } = req.valid.body;
    res.json(await service.updateStatus(req.user, req.valid.params.id, { status: 'cancelled', note }));
  },
);

module.exports = router;
