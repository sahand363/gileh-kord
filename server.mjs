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
const ADMIN_PASS = (process.env.ADMIN_PASS || '').trim();
const MANAGERS_FILE = process.env.MANAGERS_FILE || '/etc/gileh-kord/managers.conf';

fs.mkdirSync(DATA_DIR, { recursive: true });
const SERVER_STORE_FILE = path.join(DATA_DIR, 'server_synced_store.json');
const SNAPSHOTS_FILE = path.join(DATA_DIR, 'server_snapshots.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'server_sessions.json');
const MAX_SNAPSHOTS = 30;

// Rate limiting for /api/auth/login (Max 5 failed attempts per 5 minutes per IP)
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const loginAttemptsByIp = new Map();

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

const INSECURE_PASSWORDS = new Set(['admin1234', 'admin', '123456', 'password', '']);

function constantTimeStringEqual(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB) && String(a).length === String(b).length;
}

function loadConfiguredManagers() {
  const managers = new Map();

  if (ADMIN_USER && ADMIN_PASS && !INSECURE_PASSWORDS.has(ADMIN_PASS.toLowerCase())) {
    managers.set(ADMIN_USER.toLowerCase(), {
      username: ADMIN_USER,
      password: ADMIN_PASS
    });
  }

  try {
    if (fs.existsSync(MANAGERS_FILE)) {
      const lines = fs.readFileSync(MANAGERS_FILE, 'utf-8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const sepIdx = trimmed.indexOf(':');
        if (sepIdx === -1) continue;
        const u = trimmed.slice(0, sepIdx).trim();
        const p = trimmed.slice(sepIdx + 1).trim();
        if (u && p && !INSECURE_PASSWORDS.has(p.toLowerCase())) {
          managers.set(u.toLowerCase(), { username: u, password: p });
        }
      }
    }
  } catch {
    // Ignore file read errors; fail closed if map remains empty
  }

  return managers;
}

function verifyManagerCredentials(username, password) {
  const cleanUser = String(username || '').trim();
  const cleanPass = String(password || '').trim();
  if (!cleanUser || !cleanPass) {
    return { ok: false, reason: 'invalid_input' };
  }

  const managers = loadConfiguredManagers();
  if (managers.size === 0) {
    return { ok: false, reason: 'not_configured' };
  }

  const record = managers.get(cleanUser.toLowerCase());
  if (!record) {
    // Perform dummy hash comparison to mitigate username enumeration timing
    constantTimeStringEqual(cleanPass, 'dummy_secret_value_for_timing');
    return { ok: false, reason: 'invalid_credentials' };
  }

  if (constantTimeStringEqual(cleanPass, record.password)) {
    return { ok: true, username: record.username };
  }

  return { ok: false, reason: 'invalid_credentials' };
}

// ============================================================================
// Server-Managed Session Store
// ============================================================================

function readSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
      const now = Date.now();
      const valid = {};
      for (const [tokenHash, session] of Object.entries(raw || {})) {
        if (session && typeof session.expiresAt === 'number' && session.expiresAt > now) {
          valid[tokenHash] = session;
        }
      }
      return valid;
    }
  } catch {
    // Ignore corrupted session file
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
    // Ignore write error
  }
}

function hashSessionToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

function createServerSession(username, rememberDays = 30) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(rawToken);
  const clampedDays = Math.min(30, Math.max(1, Number(rememberDays) || 1));
  const maxAgeSeconds = clampedDays * 24 * 60 * 60;
  const now = Date.now();
  const expiresAt = now + maxAgeSeconds * 1000;

  const sessions = readSessions();
  sessions[tokenHash] = {
    username,
    createdAt: new Date(now).toISOString(),
    expiresAt
  };
  writeSessions(sessions);

  return { rawToken, maxAgeSeconds, expiresAt };
}

function revokeServerSession(rawToken) {
  if (!rawToken) return;
  const tokenHash = hashSessionToken(rawToken);
  const sessions = readSessions();
  if (sessions[tokenHash]) {
    delete sessions[tokenHash];
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
    list[k] = decodeURIComponent(v);
  }
  return list;
}

function extractRequestToken(req) {
  const authHeader = req.headers['authorization'] || '';
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.gk_session) {
    return cookies.gk_session;
  }
  return null;
}

function getAuthenticatedSession(req) {
  const rawToken = extractRequestToken(req);
  if (!rawToken || rawToken.length < 32) return null;

  const tokenHash = hashSessionToken(rawToken);
  const sessions = readSessions();
  const session = sessions[tokenHash];
  if (!session || session.expiresAt <= Date.now()) {
    return null;
  }
  return { ...session, rawToken };
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
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function buildSessionCookieHeader(req, token, maxAgeSeconds) {
  const isHttps =
    req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket.encrypted);
  const parts = [
    `gk_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`
  ];
  if (isHttps) {
    parts.push('Secure');
  }
  return parts.join('; ');
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
    if (req.method === 'POST' || req.method === 'PUT') {
      try {
        rawBody = await readRawBody(req);
      } catch {
        sendJson(res, 400, { error: { code: 400, message: 'بدنه درخواست نامعتبر است' } });
        return;
      }
    }

    // Public Health Check (Redacted: does not expose filesystem paths)
    if (pathname === '/api/health' || pathname === '/api/status') {
      sendJson(res, 200, {
        app: 'GILEH KORD',
        status: 'ok',
        timestamp: new Date().toISOString()
      });
      return;
    }

    // Public Authentication Endpoint with Brute-Force Protection
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
                'رمز عبور امن روی سرور تنظیم نشده است. در ترمینال سرور دستور sudo gk را اجرا کرده و از گزینه ۸ رمز عبور مدیر را تعیین کنید.'
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
        const cookieHeader = buildSessionCookieHeader(
          req,
          session.rawToken,
          session.maxAgeSeconds
        );

        sendJson(
          res,
          200,
          {
            ok: true,
            username: verification.username,
            token: session.rawToken,
            expiresAt: session.expiresAt
          },
          { 'Set-Cookie': cookieHeader }
        );
      } catch {
        sendJson(res, 400, {
          ok: false,
          error: { code: 400, message: 'ساختار درخواست ورود نامعتبر است.' }
        });
      }
      return;
    }

    // All endpoints below require a valid server-verified session
    const activeSession = getAuthenticatedSession(req);
    if (!activeSession) {
      sendJson(res, 401, {
        error: {
          code: 401,
          message: 'دسترسی غیرمجاز. لطفاً ابتدا وارد حساب کاربری خود شوید.'
        }
      });
      return;
    }

    if (pathname === '/api/auth/session' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        username: activeSession.username,
        expiresAt: activeSession.expiresAt
      });
      return;
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      revokeServerSession(activeSession.rawToken);
      const clearCookie = buildSessionCookieHeader(req, '', 0);
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
      return;
    }

    // 1. Authenticated Sync Metadata
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

    // 2. Authenticated Full State Pull
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

    // 3. Authenticated Full State Push & Backup Import
    if (
      (pathname === '/api/sync/push' || pathname === '/api/import/backup') &&
      req.method === 'POST'
    ) {
      try {
        const body = JSON.parse(rawBody.toString('utf-8') || '{}');
        const incoming = body.state ? body.state : body;
        // Actor is bound to the authenticated server session username
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

    // 4. Authenticated Snapshot History
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

    // 5. Authenticated Snapshot Revert
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

    // 6. Authenticated Products & Purchases Endpoints
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
