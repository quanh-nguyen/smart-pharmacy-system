const ApiError = require('../utils/ApiError');
const formatValidationIssues = require('../utils/formatValidationIssues');

const REQUEST_PARTS = ['params', 'query', 'body'];

// Validate several request sections in one middleware.
// Example: validateRequest({ params: idSchema, query: paginationSchema, body: bodySchema }).
const validateRequest = (schemas = {}, { prefixParts = true } = {}) => {
  if (!schemas || typeof schemas !== 'object' || Array.isArray(schemas)) {
    throw new TypeError('validateRequest cần một object chứa các schema.');
  }

  const entries = Object.entries(schemas);

  if (entries.length === 0) {
    throw new TypeError('validateRequest cần ít nhất một schema.');
  }

  for (const [part, schema] of entries) {
    if (!REQUEST_PARTS.includes(part)) {
      throw new TypeError(`Phần request không được hỗ trợ: ${part}`);
    }

    if (!schema || typeof schema.safeParse !== 'function') {
      throw new TypeError(`Schema cho ${part} không hợp lệ.`);
    }
  }

  return (req, res, next) => {
    const validated = { ...(req.validated || {}) };
    const details = [];

    for (const [part, schema] of entries) {
      const result = schema.safeParse(req[part]);

      if (!result.success) {
        details.push(...formatValidationIssues(result.error.issues, prefixParts ? part : ''));
        continue;
      }

      validated[part] = result.data;
    }

    if (details.length > 0) {
      return next(new ApiError(400, 'Dữ liệu đầu vào không hợp lệ.', details));
    }

    req.validated = validated;

    // req.query is a getter in Express 5, so never assign to it.
    // Set parsed body/params for existing controllers; query is accessed via req.validated.query.
    if (Object.hasOwn(validated, 'body')) req.body = validated.body;
    if (Object.hasOwn(validated, 'params')) req.params = validated.params;

    return next();
  };
};

module.exports = validateRequest;
