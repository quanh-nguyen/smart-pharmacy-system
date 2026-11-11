const express = require('express');
const cors = require('cors');
const { errorHandler, notFound } = require('./middlewares/errorHandler');

const pharmaciesRoutes = require('./modules/pharmacies/pharmacies.routes');
const pharmaciesAdminRoutes = require('./modules/pharmacies/pharmacies.admin.routes');
const medicinesRoutes = require('./modules/medicines/medicines.routes');
const inventoryRoutes = require('./modules/inventory/inventory.routes');
const searchRoutes = require('./modules/search/search.routes');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/pharmacies', pharmaciesRoutes);
app.use('/api/admin/pharmacies', pharmaciesAdminRoutes); // can header x-admin-key
app.use('/api/medicines', medicinesRoutes);
app.use('/api', inventoryRoutes); // /pharmacies/:id/inventory, /medicines/:id/availability
app.use('/api/search', searchRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
