const ApiError = require('../utils/ApiError');
const sqlDb = require('../db/mysql');
const logger = require('../config/logger');
const formatValidationIssues = require('../utils/formatValidationIssues');

const GENERIC_SERVER_MESSAGE = 'Đã xảy ra lỗi máy chủ nội bộ.';

const { scrub: redactDiagnosticText } = require('../utils/toLoggableError');

const CLIENT_ERROR_MESSAGES = {
  400: 'Yêu cầu không hợp lệ.',
  413: 'Kích thước request vượt quá giới hạn cho phép.',
  415: 'Định dạng hoặc encoding của request không được hỗ trợ.'
};
const libraryClientStatus = (err) => {
  const status = err?.status ?? err?.statusCode;
  return Number.isInteger(status) && status >= 400 && status < 500 && err?.expose === true ? status : null;
};

const PUBLIC_FIELDS = new Set([
  'email', 'password', 'role', 'isVerified', 'isActive', 'reason',
  'id', 'page', 'limit', 'sortOrder', 'q', 'request'
]);

const safeField = (field) => {
  const normalized = String(field || '').split('.').filter(Boolean).join('.');
  const parts = normalized.split('.');
  if (parts.length > 0 && parts.every((part) => PUBLIC_FIELDS.has(part))) return normalized;
  return 'request';
};

const validationMessage = (kind) => {
  switch (kind) {
    case 'required': return 'Trường bắt buộc.';
    case 'enum': return 'Giá trị không hợp lệ.';
    case 'cast': return 'Định dạng giá trị không hợp lệ.';
    case 'minlength': return 'Giá trị ngắn hơn mức cho phép.';
    case 'maxlength': return 'Giá trị dài hơn mức cho phép.';
    case 'min': return 'Giá trị nhỏ hơn mức cho phép.';
    case 'max': return 'Giá trị lớn hơn mức cho phép.';
    case 'match': return 'Định dạng không hợp lệ.';
    default: return 'Giá trị không hợp lệ.';
  }
};

const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  let statusCode = 500;
  let message = GENERIC_SERVER_MESSAGE;
  let details;

  if (err?.type === 'entity.too.large') {
    statusCode = 413;
    message = 'Kích thước request vượt quá giới hạn cho phép.';
  } else if (err?.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'Dữ liệu JSON không hợp lệ.';
  } else if (err?.type === 'encoding.unsupported' || err?.type === 'charset.unsupported') {
    statusCode = 415;
    message = 'Định dạng hoặc encoding của request không được hỗ trợ.';
  } else if (err?.code === 11000) {
    statusCode = 409;
    const fields = Object.keys(err.keyPattern || {});
    const field = fields[0];
    // Do not inspect/return err.keyValue: it may contain personally identifiable data.
    message = field === 'email' ? 'Email đã được sử dụng.' : 'Giá trị đã tồn tại.';
    if (field) details = [{ field: safeField(field), message: field === 'email' ? 'Email đã được sử dụng.' : 'Giá trị đã tồn tại.' }];
  } else if (err?.name === 'ZodError' && Array.isArray(err.issues)) {
    statusCode = 400;
    message = 'Dữ liệu đầu vào không hợp lệ.';
    details = formatValidationIssues(err.issues).map((item) => ({
      field: safeField(item.field),
      message: item.message
    }));
  } else if (err instanceof sqlDb.Error.ValidationError) {
    statusCode = 400;
    message = 'Dữ liệu không hợp lệ.';
    details = Object.entries(err.errors || {}).map(([field, item]) => ({
      field: safeField(field),
      message: validationMessage(item?.kind)
    }));
  } else if (err instanceof sqlDb.Error.CastError) {
    statusCode = 400;
    const field = safeField(err.path);
    details = [{ field, message: 'Định dạng giá trị không hợp lệ.' }];
    message = 'Dữ liệu không hợp lệ.';
  } else if (err instanceof ApiError) {
    if (err.statusCode >= 400 && err.statusCode < 500) {
      statusCode = err.statusCode;
      message = err.message;
      if (Array.isArray(err.details)) {
        details = err.details.map((item) => ({
          field: safeField(item?.field),
          message: typeof item?.message === 'string' ? item.message : 'Giá trị không hợp lệ.'
        }));
      }
    } else {
      // Keep only the valid server status from ApiError; never expose 5xx details.
      statusCode = err.statusCode >= 500 && err.statusCode <= 599 ? err.statusCode : 500;
    }
  }

  if (statusCode === 500 && (err?.dependencyName === 'mysql' ||
    ['PROTOCOL_CONNECTION_LOST','ECONNREFUSED','ETIMEDOUT','ECONNRESET'].includes(err?.code) ||
    /mysql|database connection/i.test(String(err?.message || '').slice(0, 100)) ||
    err?.dependencyName === 'redis' ||
    /^(Redis|ReplyError|MaxRetriesPerRequestError)$/.test(err?.name || '') ||
    /redis|connection is closed|stream isn't writeable/i.test(String(err?.message || '').slice(0, 200)))) {
    statusCode = 503;
    message = GENERIC_SERVER_MESSAGE;
  }
  const libraryStatus = libraryClientStatus(err);
  if (statusCode === 500 && libraryStatus) {
    statusCode = libraryStatus;
    message = CLIENT_ERROR_MESSAGES[statusCode] || CLIENT_ERROR_MESSAGES[400];
  }

  if (statusCode === 503) res.set('Retry-After', '5');
  if (statusCode >= 500) {
    message = GENERIC_SERVER_MESSAGE;
    details = undefined;
    const log = req.log || logger;
    log.error({
      requestId: req.id,
      errorName: err?.name,
      errorCode: typeof err?.code === 'string' || typeof err?.code === 'number' ? err.code : undefined,
      statusCode,
      method: req.method,
      route: typeof req.route?.path === 'string' ? req.route.path : 'unmatched',
      dependency: typeof err?.dependencyName === 'string' ? err.dependencyName : undefined,
      errorMessage: redactDiagnosticText(err?.message),
      stack: redactDiagnosticText(err?.stack)
    }, 'Request failed');
  }

  const body = { success: false, message, code: err instanceof ApiError && statusCode === err.statusCode
    ? err.code
    : ({ 400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN',
      404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE',
      415: 'UNSUPPORTED_MEDIA_TYPE', 429: 'RATE_LIMITED', 503: 'SERVICE_UNAVAILABLE' }[statusCode] || 'INTERNAL_ERROR') };
  if (Array.isArray(details) && details.length > 0) body.details = details;
  if (req.id) body.requestId = req.id;

  return res.status(statusCode).json(body);
};

module.exports = errorHandler;
module.exports.redactDiagnosticText = redactDiagnosticText;
