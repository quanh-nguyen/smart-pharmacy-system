const express = require('express');
const { authenticate, authorize } = require('../../middleware/auth');
const validate = require('../../middleware/validate');
const { z, idSchema, idParams } = require('../../utils/schemas');
const { QUESTION_TYPES, Q_STATUSES } = require('../../models/SymptomQuestionnaire');
const service = require('./symptom.service');

const router = express.Router();
router.use(authenticate);

const questionnaireBody = z.object({
  code: z.string().trim().regex(/^[a-z0-9-]{2,50}$/, 'code chỉ gồm a-z, 0-9, dấu gạch'),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).optional(),
  disclaimer: z.string().trim().max(2000).optional(),
  questions: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z][a-z0-9_]{0,49}$/, 'id câu hỏi dạng snake_case'),
        text: z.string().trim().min(3).max(500),
        type: z.enum(QUESTION_TYPES),
        options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1) })).max(30).optional(),
        required: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(50),
  rules: z
    .array(
      z.object({
        id: z.string().min(1).max(50),
        description: z.string().max(500).optional(),
        priority: z.number().int().min(1).max(100).optional(),
        redFlag: z.boolean().optional(),
        conditions: z.record(z.any()),
        suggestions: z.array(z.object({ drug: idSchema, note: z.string().max(500).optional() })).max(20).optional(),
        advice: z.string().max(1000).optional(),
      }),
    )
    .max(200),
});

// ---------- Khách hàng ----------
router.get('/questionnaires', async (req, res) => {
  res.json(await service.listApproved());
});

router.get('/questionnaires/:id', validate({ params: idParams }), async (req, res) => {
  res.json(await service.getApproved(req.valid.params.id));
});

router.post(
  '/questionnaires/:id/evaluate',
  authorize('customer'),
  validate({ params: idParams, body: z.object({ answers: z.record(z.any()) }) }),
  async (req, res) => {
    res.json(await service.evaluate(req.user, req.valid.params.id, req.valid.body.answers));
  },
);

// ---------- Quản trị viên ----------
const admin = express.Router();
admin.use(authorize('admin'));

admin.get(
  '/',
  validate({ query: z.object({ code: z.string().optional(), status: z.enum(Q_STATUSES).optional() }) }),
  async (req, res) => {
    res.json(await service.adminList(req.valid.query));
  },
);

admin.get('/:id', validate({ params: idParams }), async (req, res) => {
  res.json(await service.adminGet(req.valid.params.id));
});

admin.post('/', validate({ body: questionnaireBody }), async (req, res) => {
  res.status(201).json(await service.create(req.user, req.valid.body));
});

admin.put('/:id', validate({ params: idParams, body: questionnaireBody.partial() }), async (req, res) => {
  res.json(await service.update(req.valid.params.id, req.valid.body));
});

// Xem trước lỗi trước khi duyệt
admin.get('/:id/check', validate({ params: idParams }), async (req, res) => {
  const q = await service.adminGet(req.valid.params.id);
  const errors = await service.collectApprovalErrors(q);
  res.json({ valid: errors.length === 0, errors });
});

admin.post('/:id/approve', validate({ params: idParams }), async (req, res) => {
  res.json(await service.approve(req.user, req.valid.params.id));
});

admin.post('/:id/archive', validate({ params: idParams }), async (req, res) => {
  res.json(await service.archive(req.valid.params.id));
});

router.use('/admin/questionnaires', admin);

module.exports = router;
