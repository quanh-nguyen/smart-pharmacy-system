const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { clientOrigin } = require('./config/env');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();

app.use(helmet());
app.use(cors({ origin: clientOrigin }));
app.use(express.json({ limit: '1mb' }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/prescriptions', require('./modules/prescriptions/prescription.routes'));
app.use('/api/orders', require('./modules/orders/order.routes'));
app.use('/api/notifications', require('./modules/notifications/notification.routes'));
app.use('/api/symptoms', require('./modules/symptoms/symptom.routes'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
