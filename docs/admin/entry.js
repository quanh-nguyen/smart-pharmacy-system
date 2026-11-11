import { apiEnabled } from '../api-client.js';
if (apiEnabled) await import('./backend-app.js');
else await import('./app.js');
