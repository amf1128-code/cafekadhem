-- ============================================================
-- 031: Idempotency keys for orders and pickup_orders.
--
-- Client populates from a session UUID + cart signature so accidental
-- double-submits are rejected at the DB layer. USER_FLOWS_SPEC.md §10.
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_unique
  ON orders (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE pickup_orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS pickup_orders_idempotency_unique
  ON pickup_orders (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
