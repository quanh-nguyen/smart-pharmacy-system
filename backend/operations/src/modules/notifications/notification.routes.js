const express = require('express');
const { authenticate } = require('../../middleware/auth');
const validate = require('../../middleware/validate');
const { z, idParams, pagination } = require('../../utils/schemas');
const service = require('./notification.service');

const router = express.Router();
router.use(authenticate);

const listQuery = pagination.extend({
  unread: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

router.get('/', validate({ query: listQuery }), async (req, res) => {
  res.json(await service.list(req.user.id, req.valid.query));
});

router.get('/unread-count', async (req, res) => {
  res.json(await service.unreadCount(req.user.id));
});

router.patch('/read-all', async (req, res) => {
  res.json(await service.markAllRead(req.user.id));
});

router.patch('/:id/read', validate({ params: idParams }), async (req, res) => {
  res.json(await service.markRead(req.user.id, req.valid.params.id));
});

module.exports = router;
