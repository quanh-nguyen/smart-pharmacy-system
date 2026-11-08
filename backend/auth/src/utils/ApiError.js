class ApiError extends Error {
  constructor(statusCode, message, details = undefined, code = undefined) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
      ? statusCode : 500;
    this.isOperational = this.statusCode >= 400 && this.statusCode < 500;
    if (details !== undefined) this.details = details;
    this.code = code || ({ 400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN',
      404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 429: 'RATE_LIMITED',
      503: 'SERVICE_UNAVAILABLE' }[this.statusCode] || 'INTERNAL_ERROR');
    Error.captureStackTrace?.(this, this.constructor);
  }
}
module.exports = ApiError;
