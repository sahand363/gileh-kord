import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DIST_DIR = path.resolve(__dirname, 'dist');
const DATA_DIR = process.env.GILEH_DATA_DIR || path.resolve(__dirname, 'data');
const ADMIN_USER = (process.env.ADMIN_USER || '').trim();
const ADMIN_PASS_HASH = (process.env.ADMIN_PASS_HASH || '').trim();
const LEGACY_ADMIN_PASS = (process.env.ADMIN_PASS || '').trim();
const MANAGERS_FILE = process.env.MANAGERS_FILE || '/etc/gileh-kord/managers.conf';

fs.mkdirSync(DATA_DIR, { recursive: true });
const SERVER_STORE_FILE = path.join(DATA_DIR, 'server_synced_store.json');
const SNAPSHOTS_FILE = path.join(DATA_DIR, 'server_snapshots.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'server_sessions.json');
const SECRET_KEY_FILE = path.join(DATA_DIR, 'server_hmac_secret.key');
const LOCAL_MANAGERS_FALLBACK = path.join(DATA_DIR, 'managers.conf');
const MAX_SNAPSHOTS = 30;

// Scrypt parameters (OWASP recommended interactive parameters)
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

// Brute-force rate limiting (5 failed attempts per 5 minutes per IP)
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const loginAttemptsByIp = new Map();

const INSECURE_PASSWORDS = new Set(['admin1234', 'admin', '123456', 'password', '']);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// ============================================================================
// Cryptographic Primitives: Salted scrypt & Constant-Time HMAC
// ============================================================================

function loadOrCreateServerSecret() {
  try {
    if (fs.existsSync(SECRET_KEY_FILE)) {
      const hex = fs.readFileSync(SECRET_KEY_FILE, 'utf-8').trim();
      if (hex.length >= 64) {
        return Buffer.from(hex, 'hex');
      }
    }
  } catch {
    // Generate new key below
  }
  const secret = crypto.randomBytes(32);
  try {
    fs.writeFileSync(SECRET_KEY_FILE, secret.toString('hex'), {
      encoding: 'utf-8',
      mode: 0o600
    });
  } catch {
    // Keep in-memory secret if filesystem is read-only
  }
  return secret;
}

const SERVER_HMAC_SECRET = loadOrCreateServerSecret();

function constantTimeHexEqual(hexA, hexB) {
  if (typeof hexA !== 'string' || typeof hexB !== 'string') return false;
  if (hexA.length !== hexB.length || hexA.length === 0 || hexA.length % 2 !== 0) {
    return false;
  }
  try {
    const bufA = Buffer.from(hexA, 'hex');
    const bufB = Buffer.from(hexB, 'hex');
    if (bufA.length !== bufB.length || bufA.length === 0) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function hashPasswordScrypt(plainPassword) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(
    String(plainPassword),
    salt,
    SCRYPT_KEYLEN,
    { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }
  );
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPasswordScrypt(plainPassword, storedHash) {
  if (!plainPassword || !storedHash || typeof storedHash !== 'string') {
    return false;
  }
  const parts = storedHash.trim().split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltHex = parts[4];
  const expectedHashHex = parts[5];

  if (!N || !r || !p || !saltHex || !expectedHashHex) return false;
  if (N > 65536 || r > 16 || p > 4) return false;

  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expectedBuf = Buffer.from(expectedHashHex, 'hex');
    if (salt.length < 8 || expectedBuf.length < 32) return false;

    const derived = crypto.scryptSync(
      String(plainPassword),
      salt,
      expectedBuf.length,
      { N, r, p }
    );
    return crypto.timingSafeEqual(derived, expectedBuf);
  } catch {
    return false;
  }
}

function resolveManagersFilePath() {
  try {
    const dir = path.dirname(MANAGERS_FILE);
    if (fs.existsSync(dir)) return MANAGERS_FILE;
  } catch {
    // Fallback to DATA_DIR
  }
  return LOCAL_MANAGERS_FALLBACK;
}

/**
 * Loads manager accounts and automatically migrates any legacy non-default plaintext
 * password into a salted scrypt hash on disk so plaintext is never retained.
 */
function loadAndMigrateManagers() {
  const managers = new Map();
  const targetFile = resolveManagersFilePath();
  let needsRewrite = false;

  if (fs.existsSync(targetFile)) {
    try {
      const lines = fs.readFileSync(targetFile, 'utf-8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const sepIdx = trimmed.indexOf(':');
        if (sepIdx === -1) continue;
        const u = trimmed.slice(0, sepIdx).trim();
        const secretVal = trimmed.slice(sepIdx + 1).trim();
        if (!u || !secretVal) continue;

        if (secretVal.startsWith('scrypt$')) {
          managers.set(u.toLowerCase(), { username: u, passHash: secretVal });
        } else if (!INSECURE_PASSWORDS.has(secretVal.toLowerCase())) {
          // One-way migration from legacy plaintext to salted scrypt hash
          const hashed = hashPasswordScrypt(secretVal);
          managers.set(u.toLowerCase(), { username: u, passHash: hashed });
          needsRewrite = true;
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  if (ADMIN_USER) {
    const key = ADMIN_USER.toLowerCase();
    if (ADMIN_PASS_HASH && ADMIN_PASS_HASH.startsWith('scrypt$')) {
      if (!managers.has(key)) {
        managers.set(key, { username: ADMIN_USER, passHash: ADMIN_PASS_HASH });
        needsRewrite = true;
      }
    } else if (
      LEGACY_ADMIN_PASS &&
      !INSECURE_PASSWORDS.has(LEGACY_ADMIN_PASS.toLowerCase()) &&
      !managers.has(key)
    ) {
      const hashed = hashPasswordScrypt(LEGACY_ADMIN_PASS);
      managers.set(key, { username: ADMIN_USER, passHash: hashed });
      needsRewrite = true;
    }
  }

  if (needsRewrite && managers.size > 0) {
    try {
      const serialized = Array.from(managers.values())
        .map((m) => `${m.username}:${m.passHash}`)
        .join('\n') + '\n';
      fs.writeFileSync(targetFile, serialized, { encoding: 'utf-8', mode: 0o600 });
    } catch {
      // Ignore if unprivileged
    }
  }

  return managers;
}

// Run migration check once on boot
const DUMMY_SCRYPT_HASH = hashPasswordScrypt('dummy_timing_defense_password_value');
loadAndMigrateManagers();

function verifyManagerCredentials(username, password) {
  const cleanUser = String(username || '').trim();
  const cleanPass = String(password || '').trim();
  if (!cleanUser || !cleanPass) {
    return { ok: false, reason: 'invalid_input' };
  }

  const managers = loadAndMigrateManagers();
  if (managers.size === 0) {
    return { ok: false, reason: 'not_configured' };
  }

  const record = managers.get(cleanUser.toLowerCase());
  if (!record) {
    // Constant-time dummy scrypt evaluation to prevent username enumeration
    verifyPasswordScrypt(cleanPass, DUMMY_SCRYPT_HASH);
    return { ok: false, reason: 'invalid_credentials' };
  }

  if (verifyPasswordScrypt(cleanPass, record.passHash)) {
    return { ok: true, username: record.username };
  }

  return { ok: false, reason: 'invalid_credentials' };
}

// ============================================================================
// Cryptographically Signed Server-Side Sessions & CSRF Tokens
// ============================================================================

function signSessionId(sessionId) {
  const mac = crypto
    .createHmac('sha256', SERVER_HMAC_SECRET)
    .update(String(sessionId))
    .digest('hex');
  return `${sessionId}.${mac}`;
}

function verifySignedSessionToken(signedToken) {
  if (!signedToken || typeof signedToken !== 'string') return null;
  const dotIdx = signedToken.indexOf('.');
  if (dotIdx <= 0) return null;

  const sessionId = signedToken.slice(0, dotIdx);
  const providedMac = signedToken.slice(dotIdx + 1);
  if (!/^[a-f0-9]{64}$/i.test(sessionId) || !/^[a-f0-9]{64}$/i.test(providedMac)) {
    return null;
  }

  const expectedMac = crypto
    .createHmac('sha256', SERVER_HMAC_SECRET)
    .update(sessionId)
    .digest('hex');

  if (!constantTimeHexEqual(providedMac, expectedMac)) {
    return null;
  }
  return sessionId;
}

function hashValueSha256(val) {
  return crypto.createHash('sha256').update(String(val)).digest('hex');
}

function readSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
      const now = Date.now();
      const valid = {};
      for (const [idHash, session] of Object.entries(raw || {})) {
        if (session && typeof session.expiresAt === 'number' && session.expiresAt > now) {
          valid[idHash] = session;
        }
      }
      return valid;
    }
  } catch {
    // Ignore
  }
  return {};
}

function writeSessions(sessions) {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), {
      encoding: 'utf-8',
      mode: 0o600
    });
  } catch {
    // Ignore
  }
}

function createServerSession(username, rememberDays = 30) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const signedToken = signSessionId(sessionId);
  const csrfToken = crypto.randomBytes(32).toString('hex');

  const idHash = hashValueSha256(sessionId);
  const clampedDays = Math.min(30, Math.max(1, Number(rememberDays) || 1));
  const maxAgeSeconds = clampedDays * 24 * 60 * 60;
  const now = Date.now();
  const expiresAt = now + maxAgeSeconds * 1000;

  const sessions = readSessions();
  sessions[idHash] = {
    username,
    csrfToken,
    createdAt: new Date(now).toISOString(),
    expiresAt
  };
  writeSessions(sessions);

  return { signedToken, csrfToken, maxAgeSeconds, expiresAt };
}

function revokeServerSession(sessionId) {
  if (!sessionId) return;
  const idHash = hashValueSha256(sessionId);
  const sessions = readSessions();
  if (sessions[idHash]) {
    delete sessions[idHash];
    writeSessions(sessions);
  }
}

function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try {
      list[k] = decodeURIComponent(v);
    } catch {
      list[k] = v;
    }
  }
  return list;
}

function extractSignedToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.gk_session) {
    return cookies.gk_session;
  }
  const authHeader = req.headers['authorization'] || '';
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

function getAuthenticatedSession(req) {
  const signedToken = extractSignedToken(req);
  const sessionId = verifySignedSessionToken(signedToken);
  if (!sessionId) return null;

  const idHash = hashValueSha256(sessionId);
  const sessions = readSessions();
  const session = sessions[idHash];
  if (!session || session.expiresAt <= Date.now()) {
    return null;
  }
  return { ...session, sessionId, signedToken };
}

/**
 * Verifies CSRF protection for state-changing requests (POST, PUT, DELETE, PATCH):
 * 1. Validates Origin / Referer header matches the host when present.
 * 2. Verifies X-CSRF-Token header against the session's cryptographic csrfToken in constant time.
 */
function verifyCsrfProtection(req, activeSession) {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return { ok: true };
  }

  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().trim();
  const origin = (req.headers.origin || '').toString().trim();
  const referer = (req.headers.referer || '').toString().trim();

  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return { ok: false, reason: 'Cross-origin request rejected (Origin mismatch)' };
      }
    } catch {
      return { ok: false, reason: 'Malformed Origin header' };
    }
  } else if (referer && host) {
    try {
      const refererHost = new URL(referer).host;
      if (refererHost !== host) {
        return { ok: false, reason: 'Cross-origin request rejected (Referer mismatch)' };
      }
    } catch {
      return { ok: false, reason: 'Malformed Referer header' };
    }
  }

  if (!activeSession || !activeSession.csrfToken) {
    return { ok: false, reason: 'Missing session CSRF context' };
  }

  const providedCsrf = (req.headers['x-csrf-token'] || '').toString().trim();
  if (!constantTimeHexEqual(providedCsrf, activeSession.csrfToken)) {
    return { ok: false, reason: 'توکن امنیتی CSRF نامعتبر است یا منقضی شده است.' };
  }

  return { ok: true };
}

function buildCookieHeaders(req, signedToken, maxAgeSeconds) {
  const isHttps =
    req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket.encrypted);
  const sessionCookie = [
    `gk_session=${encodeURIComponent(signedToken)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`
  ];
  if (isHttps) {
    sessionCookie.push('Secure');
  }
  // Explicitly expire any legacy insecure gk_app_auth cookie
  const purgeLegacyCookie =
    'gk_app_auth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  return [sessionCookie.join('; '), purgeLegacyCookie];
}

function isClientRateLimited(ip) {
  const now = Date.now();
  const entry = loginAttemptsByIp.get(ip);
  if (!entry) return false;
  if (now - entry.firstAttemptAt > LOGIN_WINDOW_MS) {
    loginAttemptsByIp.delete(ip);
    return false;
  }
  return entry.count >= MAX_LOGIN_ATTEMPTS;
}

function recordFailedLoginAttempt(ip) {
  const now = Date.now();
  const entry = loginAttemptsByIp.get(ip);
  if (!entry || now - entry.firstAttemptAt > LOGIN_WINDOW_MS) {
    loginAttemptsByIp.set(ip, { count: 1, firstAttemptAt: now });
  } else {
    entry.count += 1;
  }
}

function clearFailedLoginAttempts(ip) {
  loginAttemptsByIp.delete(ip);
}

// ============================================================================
// Data & Snapshot Persistence
// ============================================================================

function stripDemoItems(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((item) => item && !item.isDemo);
}

function readServerStore() {
  try {
    if (fs.existsSync(SERVER_STORE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SERVER_STORE_FILE, 'utf-8'));
      return {
        version: 3,
        updatedAt: parsed.updatedAt || null,
        lastActor: parsed.lastActor || 'کاربر',
        lastAction: parsed.lastAction || 'همگام‌سازی',
        products: stripDemoItems(parsed.products),
        purchases: stripDemoItems(parsed.purchases),
        suppliers: stripDemoItems(parsed.suppliers),
        employees: stripDemoItems(parsed.employees),
        revenues: stripDemoItems(parsed.revenues),
        timesheets: stripDemoItems(parsed.timesheets),
        expenses: stripDemoItems(parsed.expenses),
        inventory: stripDemoItems(parsed.inventory),
        menuItems: stripDemoItems(parsed.menuItems),
        settings: parsed.settings || {}
      };
    }
  } catch {
    // Return empty default
  }
  return {
    version: 3,
    updatedAt: null,
    lastActor: '',
    lastAction: '',
    products: [],
    purchases: [],
    suppliers: [],
    employees: [],
    revenues: [],
    timesheets: [],
    expenses: [],
    inventory: [],
    menuItems: [],
    settings: {}
  };
}

function writeServerStore(data) {
  fs.writeFileSync(SERVER_STORE_FILE, JSON.stringify(data, null, 2), {
    encoding: 'utf-8',
    mode: 0o600
  });
}

function readSnapshots() {
  try {
    if (fs.existsSync(SNAPSHOTS_FILE)) {
      const list = JSON.parse(fs.readFileSync(SNAPSHOTS_FILE, 'utf-8'));
      return Array.isArray(list) ? list : [];
    }
  } catch {
    // Ignore
  }
  return [];
}

function recordSnapshot(actor, actionSummary, state) {
  const snapshots = readSnapshots();
  const snap = {
    id: `snap_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`,
    timestamp: state.updatedAt || new Date().toISOString(),
    actor: actor || 'کاربر',
    actionSummary: actionSummary || 'بروزرسانی اطلاعات',
    counts: {
      purchases: (state.purchases || []).length,
      revenues: (state.revenues || []).length,
      employees: (state.employees || []).length,
      menuItems: (state.menuItems || []).length
    },
    state
  };
  snapshots.unshift(snap);
  const trimmed = snapshots.slice(0, MAX_SNAPSHOTS);
  fs.writeFileSync(SNAPSHOTS_FILE, JSON.stringify(trimmed, null, 2), {
    encoding: 'utf-8',
    mode: 0o600
  });
  return snap;
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > 20 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(reqUrl.pathname);
  const clientIp =
    (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown';

  if (pathname.startsWith('/api/')) {
    let rawBody = Buffer.alloc(0);
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
      try {
        rawBody = await readRawBody(req);
      } catch {
        sendJson(res, 400, { error: { code: 400, message: 'بدنه درخواست نامعتبر است' } });
        return;
      }
    }

    if (pathname === '/api/health' || pathname === '/api/status') {
      sendJson(res, 200, {
        app: 'GILEH KORD',
        status: 'ok',
        timestamp: new Date().toISOString()
      });
      return;
    }

    // Login Endpoint: Verifies salted scrypt hash & issues HMAC-signed session + CSRF token
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      if (isClientRateLimited(clientIp)) {
        sendJson(res, 429, {
          ok: false,
          error: {
            code: 429,
            message: 'تعداد تلاش‌های ناموفق بیش از حد مجاز است. لطفاً ۵ دقیقه دیگر تلاش کنید.'
          }
        });
        return;
      }

      try {
        const parsed = JSON.parse(rawBody.toString('utf-8') || '{}');
        const user = String(parsed.username || '').trim();
        const pass = String(parsed.password || '').trim();
        const rememberDays = Number(parsed.rememberDays) || 30;

        const verification = verifyManagerCredentials(user, pass);
        if (verification.reason === 'not_configured') {
          sendJson(res, 503, {
            ok: false,
            error: {
              code: 503,
              message:
                'حساب مدیر روی سرور تنظیم نشده است. در ترمینال سرور دستور sudo gk را اجرا کرده و از گزینه ۸ رمز عبور مدیر را تعیین کنید.'
            }
          });
          return;
        }

        if (!verification.ok) {
          recordFailedLoginAttempt(clientIp);
          sendJson(res, 401, {
            ok: false,
            error: {
              code: 401,
              message: 'نام کاربری یا رمز عبور نادرست است.'
            }
          });
          return;
        }

        clearFailedLoginAttempts(clientIp);
        const session = createServerSession(verification.username, rememberDays);
        const cookieHeaders = buildCookieHeaders(
          req,
          session.signedToken,
          session.maxAgeSeconds
        );

        sendJson(
          res,
          200,
          {
            ok: true,
            username: verification.username,
            token: session.signedToken,
            csrfToken: session.csrfToken,
            expiresAt: session.expiresAt
          },
          { 'Set-Cookie': cookieHeaders }
        );
      } catch {
        sendJson(res, 400, {
          ok: false,
          error: { code: 400, message: 'ساختار درخواست ورود نامعتبر است.' }
        });
      }
      return;
    }

    // Require valid HMAC-signed server session for all other /api/* routes
    const activeSession = getAuthenticatedSession(req);
    if (!activeSession) {
      sendJson(res, 401, {
        error: {
          code: 401,
          message: 'نشست کاربری معتبر نیست یا منقضی شده است. لطفاً مجدداً وارد شوید.'
        }
      });
      return;
    }

    // Enforce CSRF token & Origin check on all state-changing operations
    const csrfCheck = verifyCsrfProtection(req, activeSession);
    if (!csrfCheck.ok) {
      sendJson(res, 403, {
        error: {
          code: 403,
          message: csrfCheck.reason || 'درخواست به دلیل محافظت امنیتی CSRF رد شد.'
        }
      });
      return;
    }

    if (pathname === '/api/auth/session' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        username: activeSession.username,
        csrfToken: activeSession.csrfToken,
        expiresAt: activeSession.expiresAt
      });
      return;
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      revokeServerSession(activeSession.sessionId);
      const clearCookies = buildCookieHeaders(req, '', 0);
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearCookies });
      return;
    }

    if (pathname === '/api/sync/meta' && req.method === 'GET') {
      const store = readServerStore();
      sendJson(res, 200, {
        updatedAt: store.updatedAt,
        lastActor: store.lastActor,
        lastAction: store.lastAction,
        counts: {
          purchases: store.purchases.length,
          revenues: store.revenues.length,
          employees: store.employees.length,
          menuItems: store.menuItems.length
        }
      });
      return;
    }

    if (pathname === '/api/sync/state' && req.method === 'GET') {
      const store = readServerStore();
      sendJson(res, 200, {
        updatedAt: store.updatedAt || new Date().toISOString(),
        state: {
          version: 3,
          exportedAt: store.updatedAt || new Date().toISOString(),
          products: store.products,
          purchases: store.purchases,
          suppliers: store.suppliers,
          employees: store.employees,
          revenues: store.revenues,
          timesheets: store.timesheets,
          expenses: store.expenses,
          inventory: store.inventory,
          menuItems: store.menuItems,
          settings: store.settings
        }
      });
      return;
    }

    if (
      (pathname === '/api/sync/push' || pathname === '/api/import/backup') &&
      req.method === 'POST'
    ) {
      try {
        const body = JSON.parse(rawBody.toString('utf-8') || '{}');
        const incoming = body.state ? body.state : body;
        const actor = activeSession.username;
        const actionSummary = String(
          body.actionSummary || 'همگام‌سازی کامل اطلاعات'
        ).trim();
        const now = new Date().toISOString();

        const newState = {
          version: 3,
          updatedAt: now,
          lastActor: actor,
          lastAction: actionSummary,
          products: stripDemoItems(incoming.products),
          purchases: stripDemoItems(incoming.purchases),
          suppliers: stripDemoItems(incoming.suppliers),
          employees: stripDemoItems(incoming.employees),
          revenues: stripDemoItems(incoming.revenues),
          timesheets: stripDemoItems(incoming.timesheets),
          expenses: stripDemoItems(incoming.expenses),
          inventory: stripDemoItems(incoming.inventory),
          menuItems: stripDemoItems(incoming.menuItems),
          settings: incoming.settings || {}
        };

        writeServerStore(newState);
        const snap = recordSnapshot(actor, actionSummary, newState);

        sendJson(res, 200, {
          ok: true,
          imported: true,
          updatedAt: now,
          snapshotId: snap.id,
          importedProducts: newState.products.length,
          importedSuppliers: newState.suppliers.length,
          importedEmployees: newState.employees.length,
          importedPurchases: newState.purchases.length
        });
      } catch {
        sendJson(res, 400, {
          error: { code: 400, message: 'ساختار داده ارسالی معتبر نیست' }
        });
      }
      return;
    }

    if (pathname === '/api/sync/history' && req.method === 'GET') {
      const snaps = readSnapshots().map((s) => ({
        id: s.id,
        timestamp: s.timestamp,
        actor: s.actor,
        actionSummary: s.actionSummary,
        counts: s.counts
      }));
      sendJson(res, 200, { items: snaps });
      return;
    }

    if (pathname === '/api/sync/revert' && req.method === 'POST') {
      try {
        const body = JSON.parse(rawBody.toString('utf-8') || '{}');
        const snapId = String(body.snapshotId || '').trim();
        const actor = activeSession.username;
        const snaps = readSnapshots();
        const target = snaps.find((s) => s.id === snapId);
        if (!target || !target.state) {
          sendJson(res, 404, {
            error: { code: 404, message: 'نسخه مورد نظر در تاریخچه یافت نشد.' }
          });
          return;
        }

        const now = new Date().toISOString();
        const restoredState = {
          ...target.state,
          updatedAt: now,
          lastActor: actor,
          lastAction: `بازگشت به نسخه: ${target.actionSummary}`
        };

        writeServerStore(restoredState);
        recordSnapshot(
          actor,
          `بازگشت به نسخه قبلی (${target.actionSummary})`,
          restoredState
        );

        sendJson(res, 200, {
          ok: true,
          updatedAt: now,
          state: {
            version: 3,
            exportedAt: now,
            products: restoredState.products,
            purchases: restoredState.purchases,
            suppliers: restoredState.suppliers,
            employees: restoredState.employees,
            revenues: restoredState.revenues,
            timesheets: restoredState.timesheets,
            expenses: restoredState.expenses,
            inventory: restoredState.inventory,
            menuItems: restoredState.menuItems,
            settings: restoredState.settings
          }
        });
      } catch {
        sendJson(res, 400, {
          error: { code: 400, message: 'خطا در بازگردانی نسخه' }
        });
      }
      return;
    }

    if (pathname === '/api/products' && req.method === 'GET') {
      const store = readServerStore();
      sendJson(res, 200, { items: store.products });
      return;
    }

    if (pathname === '/api/purchases' && req.method === 'GET') {
      const store = readServerStore();
      sendJson(res, 200, { items: store.purchases });
      return;
    }

    if (pathname === '/api/purchases' && req.method === 'POST') {
      try {
        const input = JSON.parse(rawBody.toString('utf-8') || '{}');
        const store = readServerStore();
        const now = new Date().toISOString();
        const newPurchase = {
          id: input.id || `purch_${crypto.randomUUID()}`,
          productId: input.productId || `prod_${crypto.randomUUID()}`,
          productName: String(input.productName || '').trim(),
          quantity: Number(input.quantity) || 1,
          unit: String(input.unit || 'کیلوگرم'),
          totalAmount: Math.round(Number(input.totalAmount) || 0),
          currency: 'IRT',
          purchaseDate: String(input.purchaseDate || now.slice(0, 10)),
          employeeId: input.employeeId || undefined,
          employeeNameSnapshot: input.employeeNameSnapshot || undefined,
          supplierName: input.supplierName || undefined,
          invoiceNumber: input.invoiceNumber || undefined,
          notes: input.notes || undefined,
          isDemo: false,
          createdAt: now,
          updatedAt: now
        };
        store.purchases = [
          newPurchase,
          ...store.purchases.filter((p) => p.id !== newPurchase.id)
        ];
        store.updatedAt = now;
        store.lastActor = activeSession.username;
        store.lastAction = `ثبت خرید: ${newPurchase.productName}`;
        writeServerStore(store);
        recordSnapshot(activeSession.username, store.lastAction, store);
        sendJson(res, 201, { purchase: newPurchase, product: null });
      } catch {
        sendJson(res, 400, { error: { code: 400, message: 'خطا در ثبت خرید' } });
      }
      return;
    }

    if (pathname.startsWith('/api/purchases/') && req.method === 'PUT') {
      try {
        const id = pathname.replace('/api/purchases/', '').trim();
        const input = JSON.parse(rawBody.toString('utf-8') || '{}');
        const store = readServerStore();
        const idx = store.purchases.findIndex((p) => p.id === id);
        if (idx === -1) {
          sendJson(res, 404, { error: { code: 404, message: 'فاکتور خرید یافت نشد' } });
          return;
        }
        const now = new Date().toISOString();
        const updated = {
          ...store.purchases[idx],
          ...input,
          id,
          isDemo: false,
          updatedAt: now
        };
        store.purchases[idx] = updated;
        store.updatedAt = now;
        store.lastActor = activeSession.username;
        store.lastAction = `ویرایش خرید: ${updated.productName}`;
        writeServerStore(store);
        recordSnapshot(activeSession.username, store.lastAction, store);
        sendJson(res, 200, updated);
      } catch {
        sendJson(res, 400, { error: { code: 400, message: 'خطا در ویرایش خرید' } });
      }
      return;
    }

    sendJson(res, 404, { error: { code: 404, message: 'مسیر API یافت نشد' } });
    return;
  }

  let filePath = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname);

  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const indexFile = path.join(DIST_DIR, 'index.html');
      fs.readFile(indexFile, (indexErr, content) => {
        if (indexErr) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Frontend build not found. Run "npm run build" first.');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache'
        });
        res.end(content);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const isHashedAsset = pathname.startsWith('/assets/');

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal Server Error');
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': isHashedAsset
          ? 'public, max-age=31536000, immutable'
          : 'no-cache'
      });
      res.end(content);
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`GILEH KORD server listening on http://${HOST}:${PORT}`);
});
