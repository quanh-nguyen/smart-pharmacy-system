// Pure policy functions: no DB/provider dependencies, runnable with node:test.
const MAX_BACKOFF_MS = 600_000;
const parseRetryAfter = (value, now = Date.now()) => {
  if (value == null) return 0;
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) return Math.min(Number(raw) * 1000, MAX_BACKOFF_MS);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed - now, 0), MAX_BACKOFF_MS) : 0;
};
const classifyDelivery = (response) => {
  if (response.ok) return { kind: 'sent' };
  if ([408, 425, 429].includes(response.status) || response.status >= 500) {
    return { kind: 'retry', retryAfter: response.headers?.get?.('retry-after') };
  }
  return { kind: 'dead_letter', reason: 'PROVIDER_PERMANENT_ERROR' };
};
const computeRetryDelay = ({ attempt, retryAfter, now, random = Math.random }) => {
  const exponential = Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6));
  const jitter = Math.floor(Math.max(0, Math.min(1, random())) * exponential * 0.2);
  return Math.min(MAX_BACKOFF_MS, Math.max(parseRetryAfter(retryAfter, now), exponential + jitter));
};
module.exports = { MAX_BACKOFF_MS, classifyDelivery, parseRetryAfter, computeRetryDelay };
