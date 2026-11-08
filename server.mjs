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
const DATA_DIR = path.resolve(process.env.GILEH_DATA_DIR || path.resolve(__dirname, 'data'));
const ADMIN_USER = (process.env.ADMIN_USER || '').trim();
const ADMIN_PASS_HASH = (process.env.ADMIN_PASS_HASH || '').trim();
const LEGACY_ADMIN_PASS = (process.env.ADMIN_PASS || '').trim();
const MANAGERS_FILE = process.env.MANAGERS_FILE || '/etc/gileh-kord/managers.conf';

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
try {
  fs.chmodSync(DATA_DIR, 0o700);
} catch {
  // Ignore on filesystems that do not support chmod
}

const SERVER_STORE_FILE = path.join(DATA_DIR, 'server_synced_store.json');
const SNAPSHOTS_FILE = path.join(DATA_DIR, 'server_snapshots.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'server_sessions.json');
const SECRET_KEY_FILE = path.join(DATA_DIR, 'server_hmac_secret.key');
const AUDIT_LOG_FILE = path.join(DATA_DIR, 'audit.log');
const LOCAL_MANAGERS_FALLBACK = path.join(DATA_DIR, 'managers.conf');

const MAX_SNAPSHOTS = 30;
const MAX_ARRAY_ITEMS = 10000;
const MAX_STRING_LEN = 1000;
const MAX_SAFE_TOMAN = 999_999_999_999;

// Scrypt parameters
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

// Rate Limiting Windows
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const API_WINDOW_MS = 60 * 1000;
const MAX_MUTATION_REQUESTS_PER_MIN = 30;
const MAX_GENERAL_REQUESTS_PER_MIN = 120;

const loginAttemptsByIp = new Map();
const mutationRateByIp = new Map();
const generalRateByIp = new Map();

const INSECURE_PASSWORDS = new Set(['admin1234', 'admin', '123456', 'password', '12345678', '']);

const FORBIDDEN_STATIC_EXTENSIONS = new Set([
  '.db',
  '.sqlite',
  '.sqlite3',
  '.wal',
  '.shm',
  '.env',
  '.conf',
  '.log',
  '.key',
  '.pem',
  '.tmp',
  '.bak',
  '.sh',
  '.mjs'
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// ============================================================================
// 1. Concurrency Mutex & Atomic File Operations
// ============================================================================

class AsyncMutex {
  constructor() {
    this._queue = Promise.resolve();
  }

  runExclusive(fn) {
    const next = this._queue.then(() => fn(), () => fn());
    this._queue = next.catch(() => {});
    return next;
  }
}

const stateMutex = new AsyncMutex();

function assertPathWithinDirectory(targetPath, allowedRootDir) {
  const resolvedRoot = path.resolve(allowedRootDir);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path traversal attempt blocked');
  }
  return resolvedTarget;
}

/**
 * Writes data atomically to disk by writing to a mode-0600 temporary file,
 * flushing via fsync, and renaming over the destination path.
 */
function writeFileAtomic(targetPath, contentObjOrString) {
  const safePath = assertPathWithinDirectory(targetPath, DATA_DIR);
  const payload =
    typeof contentObjOrString === 'string'
      ? contentObjOrString
      : JSON.stringify(contentObjOrString, null, 2);

  const tmpPath = `${safePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  let fd = null;
  try {
    fd = fs.openSync(tmpPath, 'w', 0o600);
    fs.writeFileSync(fd, payload, 'utf-8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmpPath, safePath);
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close error
      }
    }
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup error
    }
    throw err;
  }
}

// ============================================================================
// 2. Structured Audit Logging (Zero Credential / Token Exposure)
// ============================================================================

const SENSITIVE_LOG_KEYS = new Set([
  'password',
  'pass',
  'passhash',
  'passwordhash',
  'token',
  'signedtoken',
  'sessionid',
  'csrftoken',
  'cookie',
  'authorization',
  'secret'
]);

function redactSensitiveMeta(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const clean = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE_LOG_KEYS.has(k.toLowerCase())) {
      clean[k] = '[REDACTED]';
    } else if (typeof v === 'string') {
      clean[k] = v.replace(/[\r\n\t\x00-\x1F\x7F]/g, ' ').slice(0, 200);
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      clean[k] = v;
    }
  }
  return clean;
}

function writeAuditLog(event, actor, ip, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    actor: String(actor || 'anonymous').replace(/[\r\n\x00-\x1F]/g, '').slice(0, 64),
    ip: String(ip || 'unknown').replace(/[\r\n\x00-\x1F]/g, '').slice(0, 64),
    details: redactSensitiveMeta(details)
  };
  const line = JSON.stringify(entry) + '\n';
  try {
    const safeLogPath = assertPathWithinDirectory(AUDIT_LOG_FILE, DATA_DIR);
    fs.appendFileSync(safeLogPath, line, { encoding: 'utf-8', mode: 0o600 });
  } catch {
    // Fallback to stdout if disk append fails
  }
  console.log(`[AUDIT] ${entry.event} | actor=${entry.actor} | ip=${entry.ip}`);
}

// ============================================================================
// 3. Strict Server-Side Input Validation & Sanitization
// ============================================================================

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_ID_REGEX = /^[A-Za-z0-9_\-:]{1,96}$/;

function sanitizeText(input, maxLen = MAX_STRING_LEN) {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, maxLen);
}

function isValidISODate(dateStr) {
  if (typeof dateStr !== 'string' || !ISO_DATE_REGEX.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function isValidSafeId(id) {
  return typeof id === 'string' && SAFE_ID_REGEX.test(id.trim());
}

function validateTomanInteger(val, allowZero = false) {
  const num = Number(val);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return null;
  if (allowZero ? num < 0 : num <= 0) return null;
  if (num > MAX_SAFE_TOMAN) return null;
  return num;
}

function validateAndSanitizePurchase(raw, idx = 0) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`ساختار ردیف خرید شماره ${idx + 1} نامعتبر است.`);
  }
  const id = sanitizeText(raw.id, 96) || `purch_${crypto.randomUUID()}`;
  if (!isValidSafeId(id)) {
    throw new Error(`شناسه خرید در ردیف ${idx + 1} نامعتبر است.`);
  }
  const productName = sanitizeText(raw.productName, 160);
  if (!productName) {
    throw new Error(`نام محصول در ردیف ${idx + 1} الزامی است.`);
  }
  const quantity = Number(raw.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000_000) {
    throw new Error(`مقدار خرید در ردیف ${idx + 1} نامعتبر است.`);
  }
  const rawAmount = raw.totalAmount !== undefined ? raw.totalAmount : raw.price;
  const totalAmount = validateTomanInteger(Math.round(Number(rawAmount)), false);
  if (totalAmount === null) {
    throw new Error(`مبلغ خرید در ردیف ${idx + 1} باید عدد صحیح و بزرگ‌تر از صفر باشد.`);
  }
  const purchaseDate = sanitizeText(raw.purchaseDate || raw.date, 10);
  if (!isValidISODate(purchaseDate)) {
    throw new Error(`تاریخ خرید در ردیف ${idx + 1} نامعتبر است.`);
  }
  const unit = sanitizeText(raw.unit, 40) || 'کیلوگرم';
  const now = new Date().toISOString();

  return {
    id,
    productId: sanitizeText(raw.productId, 96) || `prod_${crypto.randomUUID()}`,
    productName,
    quantity,
    unit,
    totalAmount,
    currency: 'IRT',
    purchaseDate,
    employeeId: sanitizeText(raw.employeeId, 96) || undefined,
    employeeNameSnapshot: sanitizeText(raw.employeeNameSnapshot, 120) || undefined,
    supplierName: sanitizeText(raw.supplierName || raw.supplier, 160) || undefined,
    invoiceNumber: sanitizeText(raw.invoiceNumber || raw.invoice, 80) || undefined,
    notes: sanitizeText(raw.notes, 500) || undefined,
    isDemo: false,
    createdAt: sanitizeText(raw.createdAt, 40) || now,
    updatedAt: sanitizeText(raw.updatedAt, 40) || now
  };
}

/**
 * Validates and sanitizes an entire backup / sync state payload before any restore or write.
 * Rejects invalid structures, strips demo records, and prevents prototype pollution.
 */
function validateAndSanitizeBackupState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('ساختار داده پشتیبان یا همگام‌سازی نامعتبر است.');
  }

  const checkArray = (arr, name) => {
    if (arr === undefined || arr === null) return [];
    if (!Array.isArray(arr)) {
      throw new Error(`فیلد ${name} باید یک آرایه معتبر باشد.`);
    }
    if (arr.length > MAX_ARRAY_ITEMS) {
      throw new Error(`تعداد آیتم‌های ${name} بیش از حد مجاز است.`);
    }
    return arr.filter((item) => item && typeof item === 'object' && !item.isDemo);
  };

  const rawPurchases = checkArray(raw.purchases, 'purchases');
  const seenPurchaseIds = new Set();
  const purchases = rawPurchases.map((p, idx) => {
    const clean = validateAndSanitizePurchase(p, idx);
    if (seenPurchaseIds.has(clean.id)) {
      throw new Error(`شناسه خرید تکراری (${clean.id}) در داده ارسالی وجود دارد.`);
    }
    seenPurchaseIds.add(clean.id);
    return clean;
  });

  const products = checkArray(raw.products, 'products').map((p, idx) => {
    const name = sanitizeText(p.name, 160);
    if (!name) throw new Error(`نام کالا در ردیف ${idx + 1} خالی است.`);
    const lastPrice = validateTomanInteger(Math.round(Number(p.lastPrice || 0)), true);
    if (lastPrice === null) throw new Error(`قیمت کالا در ردیف ${idx + 1} نامعتبر است.`);
    const lastPurchaseDate = sanitizeText(p.lastPurchaseDate, 10);
    return {
      id: sanitizeText(p.id, 96) || `prod_${crypto.randomUUID()}`,
      name,
      normalizedName: sanitizeText(p.normalizedName || name.toLowerCase(), 160),
      category: sanitizeText(p.category, 80) || 'عمومی',
      lastUnit: sanitizeText(p.lastUnit, 40) || 'کیلوگرم',
      lastPrice,
      lastPurchaseDate: isValidISODate(lastPurchaseDate) ? lastPurchaseDate : '',
      totalPurchasesCount: Math.max(0, Math.trunc(Number(p.totalPurchasesCount) || 0)),
      isDemo: false
    };
  });

  const suppliers = checkArray(raw.suppliers, 'suppliers').map((s, idx) => {
    const name = sanitizeText(s.name, 160);
    if (!name) throw new Error(`نام تأمین‌کننده در ردیف ${idx + 1} خالی است.`);
    return {
      id: sanitizeText(s.id, 96) || `sup_${crypto.randomUUID()}`,
      name,
      category: sanitizeText(s.category, 80) || 'عمومی',
      phone: sanitizeText(s.phone, 40) || 'ثبت‌نشده',
      city: sanitizeText(s.city, 80) || 'رشت',
      notes: sanitizeText(s.notes, 400) || undefined,
      lastPurchaseDate: isValidISODate(sanitizeText(s.lastPurchaseDate, 10))
        ? sanitizeText(s.lastPurchaseDate, 10)
        : undefined,
      totalPurchasesAmount:
        validateTomanInteger(Math.round(Number(s.totalPurchasesAmount || 0)), true) ?? 0,
      purchasesCount: Math.max(0, Math.trunc(Number(s.purchasesCount) || 0)),
      isDemo: false
    };
  });

  const employees = checkArray(raw.employees, 'employees').map((e, idx) => {
    const name = sanitizeText(e.name, 120);
    if (!name) throw new Error(`نام کارمند در ردیف ${idx + 1} خالی است.`);
    const coeff = Number(e.performanceCoefficient);
    const now = new Date().toISOString();
    return {
      id: sanitizeText(e.id, 96) || `emp_${crypto.randomUUID()}`,
      name,
      role: sanitizeText(e.role, 80) || 'کارمند',
      phone: sanitizeText(e.phone, 40) || undefined,
      notes: sanitizeText(e.notes, 400) || undefined,
      isActive: e.isActive !== false,
      performanceCoefficient:
        Number.isFinite(coeff) && coeff > 0 && coeff <= 10 ? Number(coeff.toFixed(2)) : 1.0,
      expectedSchedule:
        e.expectedSchedule && typeof e.expectedSchedule === 'object'
          ? e.expectedSchedule
          : undefined,
      isDemo: false,
      createdAt: sanitizeText(e.createdAt, 40) || now,
      updatedAt: sanitizeText(e.updatedAt, 40) || now
    };
  });

  const revenues = checkArray(raw.revenues, 'revenues').map((r, idx) => {
    const date = sanitizeText(r.date, 10);
    if (!isValidISODate(date)) {
      throw new Error(`تاریخ درآمد در ردیف ${idx + 1} نامعتبر است.`);
    }
    const mode = r.mode === 'detailed' ? 'detailed' : 'daily_total';
    const dailyTotalAmount =
      validateTomanInteger(Math.round(Number(r.dailyTotalAmount || 0)), true) ?? 0;
    const entries = Array.isArray(r.entries)
      ? r.entries.slice(0, 500).map((ent) => ({
          id: sanitizeText(ent.id, 96) || `rev_item_${crypto.randomUUID()}`,
          category: sanitizeText(ent.category, 80) || 'فروش غذا (سالن)',
          description: sanitizeText(ent.description, 200) || 'فروش',
          quantity:
            ent.quantity !== undefined && Number(ent.quantity) > 0
              ? Number(ent.quantity)
              : undefined,
          unitPrice:
            ent.unitPrice !== undefined && Number(ent.unitPrice) > 0
              ? Math.round(Number(ent.unitPrice))
              : undefined,
          amount: validateTomanInteger(Math.round(Number(ent.amount || 0)), false) ?? 1,
          paymentMethod: sanitizeText(ent.paymentMethod, 60) || undefined,
          notes: sanitizeText(ent.notes, 300) || undefined,
          createdAt: sanitizeText(ent.createdAt, 40) || new Date().toISOString()
        }))
      : [];
    const now = new Date().toISOString();
    return {
      id: sanitizeText(r.id, 96) || `rev_${date}`,
      date,
      mode,
      dailyTotalAmount,
      cashAmount:
        r.cashAmount !== undefined
          ? validateTomanInteger(Math.round(Number(r.cashAmount)), true) ?? undefined
          : undefined,
      cardAmount:
        r.cardAmount !== undefined
          ? validateTomanInteger(Math.round(Number(r.cardAmount)), true) ?? undefined
          : undefined,
      onlineAmount:
        r.onlineAmount !== undefined
          ? validateTomanInteger(Math.round(Number(r.onlineAmount)), true) ?? undefined
          : undefined,
      notes: sanitizeText(r.notes, 400) || undefined,
      entries,
      isDemo: false,
      createdAt: sanitizeText(r.createdAt, 40) || now,
      updatedAt: sanitizeText(r.updatedAt, 40) || now
    };
  });

  const timesheets = checkArray(raw.timesheets, 'timesheets').map((t, idx) => {
    const date = sanitizeText(t.date, 10);
    if (!isValidISODate(date)) {
      throw new Error(`تاریخ تایم‌شیت در ردیف ${idx + 1} نامعتبر است.`);
    }
    const netMinutes = Math.trunc(Number(t.netMinutes) || 0);
    if (netMinutes <= 0 || netMinutes > 1440) {
      throw new Error(`مدت کارکرد در ردیف ${idx + 1} نامعتبر است.`);
    }
    const now = new Date().toISOString();
    return {
      id: sanitizeText(t.id, 96) || `ts_${crypto.randomUUID()}`,
      employeeId: sanitizeText(t.employeeId, 96),
      date,
      clockIn: sanitizeText(t.clockIn, 10),
      clockOut: sanitizeText(t.clockOut, 10),
      overnight: Boolean(t.overnight),
      breakMinutes: Math.max(0, Math.min(720, Math.trunc(Number(t.breakMinutes) || 0))),
      netMinutes,
      notes: sanitizeText(t.notes, 400) || undefined,
      editHistory: Array.isArray(t.editHistory) ? t.editHistory.slice(0, 50) : [],
      isDemo: false,
      createdAt: sanitizeText(t.createdAt, 40) || now,
      updatedAt: sanitizeText(t.updatedAt, 40) || now
    };
  });

  const expenses = checkArray(raw.expenses, 'expenses').map((e, idx) => {
    const title = sanitizeText(e.title, 160);
    if (!title) throw new Error(`عنوان هزینه در ردیف ${idx + 1} الزامی است.`);
    const amount = validateTomanInteger(Math.round(Number(e.amount || 0)), false);
    if (amount === null) throw new Error(`مبلغ هزینه در ردیف ${idx + 1} نامعتبر است.`);
    const expenseDate = sanitizeText(e.expenseDate, 10);
    if (!isValidISODate(expenseDate)) {
      throw new Error(`تاریخ هزینه در ردیف ${idx + 1} نامعتبر است.`);
    }
    return {
      id: sanitizeText(e.id, 96) || `exp_${crypto.randomUUID()}`,
      title,
      category: sanitizeText(e.category, 80) || 'سایر هزینه‌ها',
      amount,
      expenseDate,
      notes: sanitizeText(e.notes, 400) || undefined,
      isDemo: false,
      createdAt: sanitizeText(e.createdAt, 40) || new Date().toISOString()
    };
  });

  const inventory = checkArray(raw.inventory, 'inventory').map((inv, idx) => {
    const productName = sanitizeText(inv.productName, 160);
    if (!productName) throw new Error(`نام کالای انبار در ردیف ${idx + 1} الزامی است.`);
    return {
      id: sanitizeText(inv.id, 96) || `inv_${crypto.randomUUID()}`,
      productName,
      category: sanitizeText(inv.category, 80) || 'مواد اولیه',
      currentStock: Math.max(0, Number(inv.currentStock) || 0),
      minStockThreshold: Math.max(0, Number(inv.minStockThreshold) || 0),
      unit: sanitizeText(inv.unit, 40) || 'کیلوگرم',
      alertEnabled: Boolean(inv.alertEnabled),
      lastUpdated: isValidISODate(sanitizeText(inv.lastUpdated, 10))
        ? sanitizeText(inv.lastUpdated, 10)
        : new Date().toISOString().slice(0, 10),
      isDemo: false
    };
  });

  const menuItems = checkArray(raw.menuItems, 'menuItems').map((m, idx) => {
    const name = sanitizeText(m.name, 160);
    if (!name) throw new Error(`نام آیتم منو در ردیف ${idx + 1} الزامی است.`);
    const price = validateTomanInteger(Math.round(Number(m.price || 0)), true);
    if (price === null) throw new Error(`قیمت آیتم منو در ردیف ${idx + 1} نامعتبر است.`);
    const now = new Date().toISOString();
    return {
      id: sanitizeText(m.id, 96) || `menu_${crypto.randomUUID()}`,
      name,
      category: sanitizeText(m.category, 80) || 'غذای اصلی و کباب‌ها',
      price,
      isAvailable: m.isAvailable !== false,
      description: sanitizeText(m.description, 300) || undefined,
      isDemo: false,
      createdAt: sanitizeText(m.createdAt, 40) || now,
      updatedAt: sanitizeText(m.updatedAt, 40) || now
    };
  });

  const rawSettings =
    raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings)
      ? raw.settings
      : {};
  const coeff = Number(rawSettings.globalRevenueCoefficient);
  const settings = {
    restaurantName: sanitizeText(rawSettings.restaurantName, 100) || 'گیله‌کُرد',
    branchName: sanitizeText(rawSettings.branchName, 100) || '',
    serverAddress: '',
    defaultUnit: sanitizeText(rawSettings.defaultUnit, 40) || 'کیلوگرم',
    currency: 'IRT',
    reportingCurrency: rawSettings.reportingCurrency === 'RIAL' ? 'RIAL' : 'TOMAN',
    lastSelectedEmployeeId: sanitizeText(rawSettings.lastSelectedEmployeeId, 96),
    globalRevenueCoefficient:
      Number.isFinite(coeff) && coeff > 0 && coeff <= 10 ? Number(coeff.toFixed(4)) : 0.6,
    showDemoBadges: Boolean(rawSettings.showDemoBadges),
    demoSeedInitialized: true,
    lastSyncAt: new Date().toISOString()
  };

  return {
    products,
    purchases,
    suppliers,
    employees,
    revenues,
    timesheets,
    expenses,
    inventory,
    menuItems,
    settings
  };
}

// ============================================================================
// 4. Cryptographic Primitives: Salted scrypt & Constant-Time HMAC
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
    writeFileAtomic(SECRET_KEY_FILE, secret.toString('hex'));
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
      const serialized =
        Array.from(managers.values())
          .map((m) => `${m.username}:${m.passHash}`)
          .join('\n') + '\n';
      fs.writeFileSync(targetFile, serialized, { encoding: 'utf-8', mode: 0o600 });
    } catch {
      // Ignore if unprivileged
    }
  }

  return managers;
}

const DUMMY_SCRYPT_HASH = hashPasswordScrypt('dummy_timing_defense_password_value');
loadAndMigrateManagers();

function verifyManagerCredentials(username, password) {
  const cleanUser = sanitizeText(username, 64);
  const cleanPass = String(password || '').trim();
  if (!cleanUser || !cleanPass || cleanPass.length > 256) {
    return { ok: false, reason: 'invalid_input' };
  }

  const managers = loadAndMigrateManagers();
  if (managers.size === 0) {
    return { ok: false, reason: 'not_configured' };
  }

  const record = managers.get(cleanUser.toLowerCase());
  if (!record) {
    verifyPasswordScrypt(cleanPass, DUMMY_SCRYPT_HASH);
    return { ok: false, reason: 'invalid_credentials' };
  }

  if (verifyPasswordScrypt(cleanPass, record.passHash)) {
    return { ok: true, username: record.username };
  }

  return { ok: false, reason: 'invalid_credentials' };
}

// ============================================================================
// 5. Cryptographically Signed Server-Side Sessions & CSRF Protection
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
    writeFileAtomic(SESSIONS_FILE, sessions);
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
  return { ...session, sessionId };
}

function verifyCsrfProtection(req, activeSession) {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return { ok: true };
  }

  const host = (req.headers['x-forwarded-host'] || req.headers.host || '')
    .toString()
    .trim();
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
  const purgeLegacyCookie =
    'gk_app_auth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  return [sessionCookie.join('; '), purgeLegacyCookie];
}

// ============================================================================
// 6. Rate Limiting (Login & Sensitive API Endpoints)
// ============================================================================

function checkSlidingWindowLimit(map, key, maxRequests, windowMs) {
  const now = Date.now();
  const entry = map.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    map.set(key, { count: 1, windowStart: now });
    return { limited: false };
  }
  entry.count += 1;
  if (entry.count > maxRequests) {
    return { limited: true };
  }
  return { limited: false };
}

function isLoginRateLimited(ip) {
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
// 7. Atomic Data & Snapshot Store with Revision Tracking
// ============================================================================

function readServerStore() {
  try {
    if (fs.existsSync(SERVER_STORE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SERVER_STORE_FILE, 'utf-8'));
      return {
        version: 3,
        revision: Math.max(0, Math.trunc(Number(parsed.revision) || 1)),
        updatedAt: parsed.updatedAt || null,
        lastActor: parsed.lastActor || 'کاربر',
        lastAction: parsed.lastAction || 'همگام‌سازی',
        products: Array.isArray(parsed.products) ? parsed.products : [],
        purchases: Array.isArray(parsed.purchases) ? parsed.purchases : [],
        suppliers: Array.isArray(parsed.suppliers) ? parsed.suppliers : [],
        employees: Array.isArray(parsed.employees) ? parsed.employees : [],
        revenues: Array.isArray(parsed.revenues) ? parsed.revenues : [],
        timesheets: Array.isArray(parsed.timesheets) ? parsed.timesheets : [],
        expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
        inventory: Array.isArray(parsed.inventory) ? parsed.inventory : [],
        menuItems: Array.isArray(parsed.menuItems) ? parsed.menuItems : [],
        settings: parsed.settings || {}
      };
    }
  } catch {
    // Return empty default
  }
  return {
    version: 3,
    revision: 0,
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
  writeFileAtomic(SERVER_STORE_FILE, data);
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
    id: `snap_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    revision: state.revision || 1,
    timestamp: state.updatedAt || new Date().toISOString(),
    actor: sanitizeText(actor, 64) || 'کاربر',
    actionSummary: sanitizeText(actionSummary, 160) || 'بروزرسانی اطلاعات',
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
  writeFileAtomic(SNAPSHOTS_FILE, trimmed);
  return snap;
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > 15 * 1024 * 1024) {
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

// ============================================================================
// 8. HTTP Server & Route Handlers
// ============================================================================

const server = http.createServer(async (req, res) => {
  const rawUrl = req.url || '/';
  if (rawUrl.includes('\0') || rawUrl.includes('%00')) {
    sendJson(res, 400, { error: { code: 400, message: 'درخواست نامعتبر است.' } });
    return;
  }

  let reqUrl;
  try {
    reqUrl = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);
  } catch {
    sendJson(res, 400, { error: { code: 400, message: 'آدرس درخواست نامعتبر است.' } });
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(reqUrl.pathname);
  } catch {
    sendJson(res, 400, { error: { code: 400, message: 'مسیر درخواست نامعتبر است.' } });
    return;
  }

  const clientIp =
    (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown';

  if (pathname.startsWith('/api/')) {
    // General API rate limit check
    const genLimit = checkSlidingWindowLimit(
      generalRateByIp,
      clientIp,
      MAX_GENERAL_REQUESTS_PER_MIN,
      API_WINDOW_MS
    );
    if (genLimit.limited) {
      sendJson(res, 429, {
        error: { code: 429, message: 'تعداد درخواست‌ها بیش از حد مجاز است. لطفاً کمی صبر کنید.' }
      });
      return;
    }

    let rawBody = Buffer.alloc(0);
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
      try {
        rawBody = await readRawBody(req);
      } catch {
        sendJson(res, 400, { error: { code: 400, message: 'بدنه درخواست نامعتبر یا بیش از حد بزرگ است.' } });
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

    // Login Endpoint (Salted scrypt + HttpOnly Signed Session Cookie + Audit Log)
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      if (isLoginRateLimited(clientIp)) {
        writeAuditLog('AUTH_LOGIN_RATE_LIMITED', 'anonymous', clientIp);
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
        const user = sanitizeText(parsed.username, 64);
        const pass = String(parsed.password || '').trim();
        const rememberDays = Math.min(30, Math.max(1, Number(parsed.rememberDays) || 30));

        const verification = verifyManagerCredentials(user, pass);
        if (verification.reason === 'not_configured') {
          writeAuditLog('AUTH_LOGIN_UNCONFIGURED', user || 'anonymous', clientIp);
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
          writeAuditLog('AUTH_LOGIN_FAILED', user || 'anonymous', clientIp, {
            reason: verification.reason
          });
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

        writeAuditLog('AUTH_LOGIN_SUCCESS', verification.username, clientIp, {
          rememberDays
        });

        // Session token is set ONLY in the HttpOnly cookie — never exposed in the JSON body
        sendJson(
          res,
          200,
          {
            ok: true,
            username: verification.username,
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

    // Require valid HMAC-signed server session for all other /api/* endpoints
    const activeSession = getAuthenticatedSession(req);
    if (!activeSession) {
      writeAuditLog('API_UNAUTHORIZED_ACCESS', 'anonymous', clientIp, {
        path: pathname,
        method: req.method
      });
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
      writeAuditLog('API_CSRF_REJECTED', activeSession.username, clientIp, {
        path: pathname,
        reason: csrfCheck.reason
      });
      sendJson(res, 403, {
        error: {
          code: 403,
          message: csrfCheck.reason || 'درخواست به دلیل محافظت امنیتی CSRF رد شد.'
        }
      });
      return;
    }

    // Rate limit state-mutating operations
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
      const mutLimit = checkSlidingWindowLimit(
        mutationRateByIp,
        `${clientIp}:${activeSession.username}`,
        MAX_MUTATION_REQUESTS_PER_MIN,
        API_WINDOW_MS
      );
      if (mutLimit.limited) {
        sendJson(res, 429, {
          error: {
            code: 429,
            message: 'تعداد عملیات‌های ثبت/همگام‌سازی بیش از حد مجاز در دقیقه است.'
          }
        });
        return;
      }
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
      writeAuditLog('AUTH_LOGOUT', activeSession.username, clientIp);
      const clearCookies = buildCookieHeaders(req, '', 0);
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearCookies });
      return;
    }

    if (pathname === '/api/sync/meta' && req.method === 'GET') {
      const store = readServerStore();
      sendJson(res, 200, {
        revision: store.revision,
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
      writeAuditLog('SYNC_STATE_PULL', activeSession.username, clientIp, {
        revision: store.revision
      });
      sendJson(res, 200, {
        revision: store.revision,
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

    // Atomic, Mutex-Locked Sync Push & Backup Import with Optimistic Concurrency Check
    if (
      (pathname === '/api/sync/push' || pathname === '/api/import/backup') &&
      req.method === 'POST'
    ) {
      await stateMutex.runExclusive(async () => {
        try {
          const body = JSON.parse(rawBody.toString('utf-8') || '{}');
          const incomingRaw = body.state ? body.state : body;
          const baseRevision =
            body.baseRevision !== undefined && body.baseRevision !== null
              ? Number(body.baseRevision)
              : null;
          const forceOverwrite = Boolean(body.forceOverwrite);

          const currentStore = readServerStore();

          // Version conflict detection: prevent stale client from overwriting newer server state
          if (
            pathname === '/api/sync/push' &&
            !forceOverwrite &&
            baseRevision !== null &&
            Number.isFinite(baseRevision) &&
            currentStore.revision > 0 &&
            baseRevision < currentStore.revision
          ) {
            writeAuditLog(
              'SYNC_CONFLICT_REJECTED',
              activeSession.username,
              clientIp,
              {
                clientBaseRevision: baseRevision,
                serverRevision: currentStore.revision
              }
            );
            sendJson(res, 409, {
              error: {
                code: 409,
                message:
                  'اطلاعات روی سرور توسط دستگاه دیگری بروزرسانی شده است. لطفاً ابتدا آخرین نسخه سرور را دریافت کنید.',
                serverRevision: currentStore.revision,
                updatedAt: currentStore.updatedAt,
                lastActor: currentStore.lastActor,
                lastAction: currentStore.lastAction
              }
            });
            return;
          }

          const validated = validateAndSanitizeBackupState(incomingRaw);
          const actor = activeSession.username;
          const actionSummary =
            sanitizeText(body.actionSummary, 160) || 'همگام‌سازی کامل اطلاعات';
          const now = new Date().toISOString();
          const nextRevision = (currentStore.revision || 0) + 1;

          const newState = {
            version: 3,
            revision: nextRevision,
            updatedAt: now,
            lastActor: actor,
            lastAction: actionSummary,
            ...validated
          };

          writeServerStore(newState);
          const snap = recordSnapshot(actor, actionSummary, newState);

          writeAuditLog(
            pathname === '/api/import/backup' ? 'BACKUP_IMPORTED' : 'SYNC_STATE_PUSH',
            actor,
            clientIp,
            {
              revision: nextRevision,
              snapshotId: snap.id,
              purchases: newState.purchases.length,
              revenues: newState.revenues.length
            }
          );

          sendJson(res, 200, {
            ok: true,
            imported: true,
            revision: nextRevision,
            updatedAt: now,
            snapshotId: snap.id,
            importedProducts: newState.products.length,
            importedSuppliers: newState.suppliers.length,
            importedEmployees: newState.employees.length,
            importedPurchases: newState.purchases.length
          });
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : 'ساختار داده ارسالی معتبر نیست.';
          sendJson(res, 400, {
            error: { code: 400, message: msg }
          });
        }
      });
      return;
    }

    if (pathname === '/api/sync/history' && req.method === 'GET') {
      const snaps = readSnapshots().map((s) => ({
        id: s.id,
        revision: s.revision || 1,
        timestamp: s.timestamp,
        actor: s.actor,
        actionSummary: s.actionSummary,
        counts: s.counts
      }));
      sendJson(res, 200, { items: snaps });
      return;
    }

    if (pathname === '/api/sync/revert' && req.method === 'POST') {
      await stateMutex.runExclusive(async () => {
        try {
          const body = JSON.parse(rawBody.toString('utf-8') || '{}');
          const snapId = sanitizeText(body.snapshotId, 96);
          if (!isValidSafeId(snapId)) {
            sendJson(res, 400, { error: { code: 400, message: 'شناسه نسخه نامعتبر است.' } });
            return;
          }

          const actor = activeSession.username;
          const snaps = readSnapshots();
          const target = snaps.find((s) => s.id === snapId);
          if (!target || !target.state) {
            sendJson(res, 404, {
              error: { code: 404, message: 'نسخه مورد نظر در تاریخچه یافت نشد.' }
            });
            return;
          }

          const validatedRestored = validateAndSanitizeBackupState(target.state);
          const currentStore = readServerStore();
          const nextRevision = (currentStore.revision || 0) + 1;
          const now = new Date().toISOString();

          const restoredState = {
            version: 3,
            revision: nextRevision,
            updatedAt: now,
            lastActor: actor,
            lastAction: `بازگشت به نسخه: ${target.actionSummary}`,
            ...validatedRestored
          };

          writeServerStore(restoredState);
          recordSnapshot(
            actor,
            `بازگشت به نسخه قبلی (${target.actionSummary})`,
            restoredState
          );

          writeAuditLog('SNAPSHOT_REVERTED', actor, clientIp, {
            targetSnapshotId: snapId,
            newRevision: nextRevision
          });

          sendJson(res, 200, {
            ok: true,
            revision: nextRevision,
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
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'خطا در بازگردانی نسخه';
          sendJson(res, 400, { error: { code: 400, message: msg } });
        }
      });
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
      await stateMutex.runExclusive(async () => {
        try {
          const input = JSON.parse(rawBody.toString('utf-8') || '{}');
          const newPurchase = validateAndSanitizePurchase(input, 0);
          const store = readServerStore();
          const now = new Date().toISOString();
          const nextRevision = (store.revision || 0) + 1;

          store.purchases = [
            newPurchase,
            ...store.purchases.filter((p) => p.id !== newPurchase.id)
          ];
          store.revision = nextRevision;
          store.updatedAt = now;
          store.lastActor = activeSession.username;
          store.lastAction = `ثبت خرید: ${newPurchase.productName}`;

          writeServerStore(store);
          recordSnapshot(activeSession.username, store.lastAction, store);

          writeAuditLog('PURCHASE_CREATED', activeSession.username, clientIp, {
            purchaseId: newPurchase.id,
            amount: newPurchase.totalAmount,
            revision: nextRevision
          });

          sendJson(res, 201, {
            revision: nextRevision,
            purchase: newPurchase,
            product: null
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'خطا در ثبت خرید';
          sendJson(res, 400, { error: { code: 400, message: msg } });
        }
      });
      return;
    }

    if (pathname.startsWith('/api/purchases/') && req.method === 'PUT') {
      await stateMutex.runExclusive(async () => {
        try {
          const id = sanitizeText(pathname.replace('/api/purchases/', ''), 96);
          if (!isValidSafeId(id)) {
            sendJson(res, 400, { error: { code: 400, message: 'شناسه خرید نامعتبر است' } });
            return;
          }
          const input = JSON.parse(rawBody.toString('utf-8') || '{}');
          const store = readServerStore();
          const idx = store.purchases.findIndex((p) => p.id === id);
          if (idx === -1) {
            sendJson(res, 404, { error: { code: 404, message: 'فاکتور خرید یافت نشد' } });
            return;
          }

          const merged = { ...store.purchases[idx], ...input, id };
          const updated = validateAndSanitizePurchase(merged, 0);
          const now = new Date().toISOString();
          const nextRevision = (store.revision || 0) + 1;

          store.purchases[idx] = updated;
          store.revision = nextRevision;
          store.updatedAt = now;
          store.lastActor = activeSession.username;
          store.lastAction = `ویرایش خرید: ${updated.productName}`;

          writeServerStore(store);
          recordSnapshot(activeSession.username, store.lastAction, store);

          writeAuditLog('PURCHASE_UPDATED', activeSession.username, clientIp, {
            purchaseId: updated.id,
            amount: updated.totalAmount,
            revision: nextRevision
          });

          sendJson(res, 200, updated);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'خطا در ویرایش خرید';
          sendJson(res, 400, { error: { code: 400, message: msg } });
        }
      });
      return;
    }

    sendJson(res, 404, { error: { code: 404, message: 'مسیر API یافت نشد' } });
    return;
  }

  // ============================================================================
  // Static File Serving with Strict Path Traversal & Extension Protection
  // ============================================================================

  const segments = pathname.split('/').filter(Boolean);
  if (segments.some((seg) => seg === '..' || seg.startsWith('.'))) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(pathname).toLowerCase();
  if (FORBIDDEN_STATIC_EXTENSIONS.has(ext) || (ext === '.json' && pathname !== '/manifest.json')) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  let candidatePath;
  try {
    candidatePath = assertPathWithinDirectory(
      path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname),
      DIST_DIR
    );
  } catch {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(candidatePath, (err, stats) => {
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
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY'
        });
        res.end(content);
      });
      return;
    }

    // Verify realpath to block symlink escapes outside DIST_DIR
    fs.realpath(candidatePath, (realErr, realTarget) => {
      if (realErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }
      try {
        assertPathWithinDirectory(realTarget, DIST_DIR);
      } catch {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }

      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const isHashedAsset = pathname.startsWith('/assets/');

      fs.readFile(realTarget, (readErr, content) => {
        if (readErr) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Internal Server Error');
          return;
        }
        res.writeHead(200, {
          'Content-Type': contentType,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': isHashedAsset
            ? 'public, max-age=31536000, immutable'
            : 'no-cache'
        });
        res.end(content);
      });
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`GILEH KORD server listening on http://${HOST}:${PORT}`);
});
