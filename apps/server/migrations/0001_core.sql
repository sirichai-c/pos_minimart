-- โครงข้อมูลหลักของ MVP ตาม implementation plan ส่วน 5.3
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','cashier')),
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,                       -- เก็บ hash ของ token ไม่เก็บ token
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT UNIQUE,
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX products_name ON products(name);

CREATE TABLE inventory_balances (
  product_id TEXT PRIMARY KEY REFERENCES products(id),
  on_hand INTEGER NOT NULL CHECK (on_hand >= 0),  -- ห้ามติดลบ (R02)
  version INTEGER NOT NULL DEFAULT 0              -- ใช้ต่อใน M4S ตรวจนับ
);

CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  kind TEXT NOT NULL CHECK (kind IN ('opening','receipt','adjustment','sale','void')),
  quantity INTEGER NOT NULL CHECK (quantity <> 0),            -- บวกเข้า ลบออก
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  reason TEXT,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX stock_movements_product ON stock_movements(product_id, created_at);

CREATE TABLE shifts (
  id TEXT PRIMARY KEY,
  opened_by TEXT NOT NULL REFERENCES users(id),
  opened_at TEXT NOT NULL,
  opening_cash INTEGER NOT NULL CHECK (opening_cash >= 0),
  closed_by TEXT REFERENCES users(id),
  closed_at TEXT,
  expected_cash INTEGER,
  counted_cash INTEGER,
  variance INTEGER,
  close_snapshot TEXT
);
CREATE UNIQUE INDEX one_open_shift ON shifts((1)) WHERE closed_at IS NULL;  -- เปิดได้หนึ่งกะ

-- กะที่ปิดแล้วแก้ไม่ได้ (R05)
CREATE TRIGGER shifts_closed_immutable BEFORE UPDATE ON shifts
WHEN OLD.closed_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'shift is closed'); END;

CREATE TABLE cash_movements (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL REFERENCES shifts(id),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX cash_movements_shift ON cash_movements(shift_id);

CREATE TABLE sales (
  id TEXT PRIMARY KEY,
  bill_no TEXT NOT NULL UNIQUE,
  shift_id TEXT NOT NULL REFERENCES shifts(id),
  cashier_id TEXT NOT NULL REFERENCES users(id),
  total INTEGER NOT NULL CHECK (total >= 0),
  created_at TEXT NOT NULL
);
CREATE INDEX sales_shift ON sales(shift_id);
CREATE INDEX sales_created ON sales(created_at);

CREATE TABLE sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  line_no INTEGER NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  sku TEXT NOT NULL,                              -- snapshot ขณะขาย
  name TEXT NOT NULL,
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total INTEGER NOT NULL CHECK (line_total = unit_price * quantity),
  UNIQUE (sale_id, line_no)
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL UNIQUE REFERENCES sales(id),
  method TEXT NOT NULL CHECK (method = 'cash'),
  tendered INTEGER NOT NULL,
  change INTEGER NOT NULL CHECK (change >= 0),
  amount INTEGER NOT NULL,
  CHECK (tendered - change = amount)
);

CREATE TABLE sale_voids (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL UNIQUE REFERENCES sales(id),   -- void ได้ครั้งเดียว
  shift_id TEXT NOT NULL REFERENCES shifts(id),
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  approved_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- ข้อเท็จจริงการขายแก้ไม่ได้หลังบันทึก
CREATE TRIGGER sales_immutable BEFORE UPDATE ON sales BEGIN SELECT RAISE(ABORT, 'sales are immutable'); END;
CREATE TRIGGER sales_no_delete BEFORE DELETE ON sales BEGIN SELECT RAISE(ABORT, 'sales are immutable'); END;
CREATE TRIGGER sale_items_immutable BEFORE UPDATE ON sale_items BEGIN SELECT RAISE(ABORT, 'sales are immutable'); END;
CREATE TRIGGER payments_immutable BEFORE UPDATE ON payments BEGIN SELECT RAISE(ABORT, 'sales are immutable'); END;
CREATE TRIGGER stock_movements_immutable BEFORE UPDATE ON stock_movements BEGIN SELECT RAISE(ABORT, 'movements are append-only'); END;
CREATE TRIGGER stock_movements_no_delete BEFORE DELETE ON stock_movements BEGIN SELECT RAISE(ABORT, 'movements are append-only'); END;

CREATE TABLE idempotency_requests (
  key TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  payload_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  user_id TEXT REFERENCES users(id),
  data_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_events_entity ON audit_events(entity_type, created_at);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;

CREATE TABLE backup_runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('interval','shift_close','daily','manual')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  file_name TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  schema_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','ok','failed')),
  error TEXT,
  uploaded_at TEXT,
  upload_attempts INTEGER NOT NULL DEFAULT 0,
  upload_error TEXT,
  next_upload_at TEXT,
  pruned_at TEXT
);
CREATE INDEX backup_runs_started ON backup_runs(started_at);
