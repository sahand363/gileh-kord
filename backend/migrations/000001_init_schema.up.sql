-- GILEH KORD Relational Schema (Version 1)
-- Canonical Currency: Iranian Toman (IRT) stored as 64-bit integers.
-- Dates: Gregorian ISO-8601 (YYYY-MM-DD for business dates, RFC3339 for timestamps).

-- 1. Products Catalog
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL DEFAULT 'عمومی',
    last_unit TEXT NOT NULL DEFAULT 'کیلوگرم',
    last_price INTEGER NOT NULL DEFAULT 0 CHECK (last_price >= 0),
    last_purchase_date TEXT NOT NULL DEFAULT '',
    total_purchases_count INTEGER NOT NULL DEFAULT 0 CHECK (total_purchases_count >= 0),
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_normalized_name ON products(normalized_name);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_last_purchase_date ON products(last_purchase_date DESC);

-- 2. Suppliers Directory
CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'عمومی',
    phone TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT 'رشت',
    notes TEXT NOT NULL DEFAULT '',
    total_purchases_amount INTEGER NOT NULL DEFAULT 0 CHECK (total_purchases_amount >= 0),
    purchases_count INTEGER NOT NULL DEFAULT 0 CHECK (purchases_count >= 0),
    last_purchase_date TEXT NOT NULL DEFAULT '',
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);

-- 3. Employees & Performance Multipliers
CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'کارمند',
    phone TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    performance_coefficient REAL NOT NULL DEFAULT 1.0 CHECK (performance_coefficient > 0),
    expected_schedule_json TEXT NOT NULL DEFAULT '{}',
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(is_active);

-- 4. Purchases (Core Procurement Table)
CREATE TABLE IF NOT EXISTS purchases (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    quantity REAL NOT NULL CHECK (quantity > 0),
    unit TEXT NOT NULL,
    total_amount INTEGER NOT NULL CHECK (total_amount > 0),
    currency TEXT NOT NULL DEFAULT 'IRT',
    purchase_date TEXT NOT NULL,
    employee_id TEXT,
    employee_name_snapshot TEXT NOT NULL DEFAULT '',
    supplier_id TEXT,
    supplier_name TEXT NOT NULL DEFAULT '',
    invoice_number TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(purchase_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_product_id ON purchases(product_id);
CREATE INDEX IF NOT EXISTS idx_purchases_employee_id ON purchases(employee_id);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier_id ON purchases(supplier_id);

-- 5. Kitchen & Warehouse Inventory
CREATE TABLE IF NOT EXISTS inventory (
    id TEXT PRIMARY KEY,
    product_name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'مواد اولیه',
    current_stock REAL NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
    min_stock_threshold REAL NOT NULL DEFAULT 0 CHECK (min_stock_threshold >= 0),
    unit TEXT NOT NULL DEFAULT 'کیلوگرم',
    alert_enabled INTEGER NOT NULL DEFAULT 0 CHECK (alert_enabled IN (0, 1)),
    last_updated TEXT NOT NULL,
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_product_name ON inventory(product_name);

-- 6. Operational Expenses
CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    expense_date TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date DESC);

-- 7. Daily Revenue Records & Itemized Entries
CREATE TABLE IF NOT EXISTS revenues (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL UNIQUE,
    mode TEXT NOT NULL CHECK (mode IN ('daily_total', 'detailed')),
    daily_total_amount INTEGER NOT NULL DEFAULT 0 CHECK (daily_total_amount >= 0),
    cash_amount INTEGER NOT NULL DEFAULT 0 CHECK (cash_amount >= 0),
    card_amount INTEGER NOT NULL DEFAULT 0 CHECK (card_amount >= 0),
    online_amount INTEGER NOT NULL DEFAULT 0 CHECK (online_amount >= 0),
    notes TEXT NOT NULL DEFAULT '',
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revenues_date ON revenues(date DESC);

CREATE TABLE IF NOT EXISTS revenue_entries (
    id TEXT PRIMARY KEY,
    revenue_id TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    quantity REAL,
    unit_price INTEGER,
    amount INTEGER NOT NULL CHECK (amount > 0),
    payment_method TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (revenue_id) REFERENCES revenues(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_revenue_entries_revenue_id ON revenue_entries(revenue_id);

-- 8. Employee Timesheets & Shift Edit History
CREATE TABLE IF NOT EXISTS timesheets (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    date TEXT NOT NULL,
    clock_in TEXT NOT NULL,
    clock_out TEXT NOT NULL,
    overnight INTEGER NOT NULL DEFAULT 0 CHECK (overnight IN (0, 1)),
    break_minutes INTEGER NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
    net_minutes INTEGER NOT NULL CHECK (net_minutes > 0),
    notes TEXT NOT NULL DEFAULT '',
    edit_history_json TEXT NOT NULL DEFAULT '[]',
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_timesheets_employee_date ON timesheets(employee_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_timesheets_date ON timesheets(date DESC);

-- 9. Application Settings
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
