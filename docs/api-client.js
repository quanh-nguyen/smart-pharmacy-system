const configured = window.SMART_PHARMACY_CONFIG?.apiBaseUrl;
export const apiEnabled = typeof configured === 'string';
const base = apiEnabled ? configured.replace(/\/$/, '') : '';
if (base && !/^https:\/\//i.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(base)) {
  throw new Error('Backend URL must use HTTPS (HTTP is allowed for localhost).');
}
const sessionKey = 'smartPharmacyApiSession_v1';
let refreshing;
export function getSession() {
  try { return JSON.parse(sessionStorage.getItem(sessionKey) || 'null'); } catch { return null; }
}
export function clearSession() { sessionStorage.removeItem(sessionKey); }
export function saveSession(data) {
  const session = { user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken };
  sessionStorage.setItem(sessionKey, JSON.stringify(session));
  return session;
}
async function send(path, { method = 'GET', body, token, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method, cache: 'no-store', signal: AbortSignal.timeout(20000),
    headers: { ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body !== undefined ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `Yêu cầu thất bại (${response.status}).`);
    error.status = response.status; error.details = data?.details;
    throw error;
  }
  return data;
}
export async function apiRequest(path, options = {}) {
  const session = getSession();
  const authenticated = options.auth !== false;
  try { return await send(path, { ...options, token: options.token || (authenticated ? session?.accessToken : null) }); }
  catch (error) {
    if (error.status !== 401 || !authenticated || options.token) throw error;
    if (!session?.refreshToken) { clearSession(); throw error; }
    // Parallel dashboard requests share a single rotation; a used refresh token must never be replayed.
    if (getSession()?.accessToken === session.accessToken) {
      refreshing ||= send('/api/v1/auth/refresh', { method: 'POST', body: { refreshToken: session.refreshToken } })
        .then(result => saveSession({ ...result.data, user: session.user }))
        .catch(refreshError => { if (refreshError.status === 401) clearSession(); throw refreshError; })
        .finally(() => { refreshing = null; });
      await refreshing;
    }
    return send(path, { ...options, token: getSession()?.accessToken });
  }
}
export async function signIn(email, password, { name, role, register = false, totp } = {}) {
  const result = await apiRequest(`/api/v1/auth/${register ? 'register' : 'login'}`, {
    method: 'POST', auth: false,
    body: { email, password, ...(register ? { role, ...(name ? { name } : {}) } : {}), ...(totp ? { totp } : {}) },
  });
  if (result.data.accessToken) saveSession(result.data);
  return result.data;
}
export async function signOut() {
  try {
    if (getSession()) await apiRequest('/api/v1/auth/logout', {
      method: 'POST', body: {}, headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
  } finally { clearSession(); }
}
export async function allPages(path) {
  const rows = [];
  for (let page = 1; ; page++) {
    const result = await apiRequest(`${path}${path.includes('?') ? '&' : '?'}limit=50&page=${page}`);
    rows.push(...result.data);
    if (rows.length >= result.pagination.total || !result.data.length) return rows;
  }
}
