// Normalize Zod issues into a stable API shape without exposing raw request values.
const formatValidationIssues = (issues, prefix = '') => {
  const details = [];

  for (const issue of issues || []) {
    const path = Array.isArray(issue.path) ? issue.path.join('.') : '';
    const keys = Array.isArray(issue.keys) ? issue.keys : [];

    if (keys.length > 0) {
      for (const key of keys) {
        const field = [prefix, path, key].filter(Boolean).join('.');
        details.push({ field: field || 'request', message: issue.message });
      }
      continue;
    }

    const field = [prefix, path].filter(Boolean).join('.') || 'request';
    details.push({ field, message: issue.message });
  }

  return details;
};

module.exports = formatValidationIssues;
