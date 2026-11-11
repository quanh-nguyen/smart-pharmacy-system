// Static hosting: set this to the HTTPS backend origin to enable MySQL accounts/orders.
// null keeps the existing standalone demo. The Node server supplies its own same-origin config.
window.SMART_PHARMACY_CONFIG = Object.freeze({ apiBaseUrl: null });
