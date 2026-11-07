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
const ADMIN_USER = (process.env.ADMIN_USER || 'admin').trim();
const ADMIN_PASS = (process.env.ADMIN_PASS || 'admin1234').trim();
const MANAGERS_FILE = process.env.MANAGERS_FILE || '/etc/gileh-kord/managers.conf';

fs.mkdirSync(DATA_DIR, { recursive: true });
const SERVER_STORE_FILE = path.join(DATA_DIR, 'server_synced_store.json');
const SNAPSHOTS_FILE = path.join(DATA_DIR, 'server_snapshots.json');
const MAX_SNAPSHOTS = 30;

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
  fs.writeFileSync(SERVER_STORE_FILE, JSON.stringify(data, null, 2), 'utf-8');
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
  fs.writeFileSync(SNAPSHOTS_FILE, JSON.stringify(trimmed, null, 2), 'utf-8');
  return snap;
}

function verifyManagerCredentials(username, password) {
  const cleanUser = String(username || '').trim().toLowerCase();
  const cleanPass = String(password || '').trim();
  if (!cleanUser || !cleanPass) return false;

  if (cleanUser === ADMIN_USER.toLowerCase() && cleanPass === ADMIN_PASS) {
    return true;
  }

  try {
    if (fs.existsSync(MANAGERS_FILE)) {
      const lines = fs.readFileSync(MANAGERS_FILE, 'utf-8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const sepIdx = trimmed.indexOf(':');
        if (sepIdx === -1) continue;
        const u = trimmed.slice(0, sepIdx).trim().toLowerCase();
        const p = trimmed.slice(sepIdx + 1).trim();
        if (u === cleanUser && p === cleanPass) {
          return true;
        }
      }
    }
  } catch {
    // Fallback to env credentials
  }

  return false;
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

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(reqUrl.pathname);

  if (pathname.startsWith('/api/')) {
    let rawBody = Buffer.alloc(0);
    if (req.method === 'POST' || req.method === 'PUT') {
      try {
        rawBody = await readRawBody(req);
      } catch {
        sendJson(res, 400, { error: { message: 'بدنه درخواست نامعتبر است' } });
        return;
      }
    }

    if (pathname === '/api/health' || pathname === '/api/status') {
      sendJson(res, 200, {
        app: 'GILEH KORD',
        status: 'ok',
        dataDir: DATA_DIR,
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      try {
        const parsed = JSON.parse(rawBody.toString('utf-8') || '{}');
        const user = String(parsed.username || '').trim();
        const pass = String(parsed.password || '').trim();
        if (verifyManagerCredentials(user, pass)) {
          sendJson(res, 200, { ok: true, username: user });
        } else {
          sendJson(res, 401, { ok: false, error: 'Invalid credentials' });
        }
      } catch {
        sendJson(res, 400, { ok: false, error: 'Bad request' });
      }
      return;
    }

    // 1. Check Sync Metadata (used by new browsers to ask if user wants latest data)
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

    // 2. Pull Full State (Purchases, Revenues, Timesheets, Employees, Menu, etc.)
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

    // 3. Push Full State & Record Revertible Snapshot
    if ((pathname === '/api/sync/push' || pathname === '/api/import/backup') && req.method === 'POST') {
      try {
        const body = JSON.parse(rawBody.toString('utf-8') || '{}');
        const incoming = body.state ? body.state : body;
        const actor = String(body.actor || 'کاربر').trim();
        const actionSummary = String(body.actionSummary || 'همگام‌سازی کامل اطلاعات').trim();
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
        sendJson(res, 400, { error: { message: 'ساختار داده ارسالی معتبر نیست' } });
      }
      return;
    }

    // 4. List Snapshots for Manager Revert Tab
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

    // 5. Revert to a Selected Snapshot
    if (pathname === '/api/sync/revert' && req.method === 'POST') {
      try {
        const body = JSON.parse(rawBody.toString('utf-8') || '{}');
        const snapId = String(body.snapshotId || '').trim();
        const actor = String(body.actor || 'مدیر').trim();
        const snaps = readSnapshots();
        const target = snaps.find((s) => s.id === snapId);
        if (!target || !target.state) {
          sendJson(res, 404, { error: { message: 'نسخه مورد نظر در تاریخچه یافت نشد.' } });
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
        recordSnapshot(actor, `بازگشت به نسخه قبلی (${target.actionSummary})`, restoredState);

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
        sendJson(res, 400, { error: { message: 'خطا در بازگردانی نسخه' } });
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

    sendJson(res, 404, { error: { message: 'مسیر API یافت نشد' } });
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
