-- ============================================================
-- 054: Drop the redundant `confirmed` order status.
--
-- `confirmed` and `paid` had no functional difference: no
-- notification fired on either transition, only `paid` fed
-- revenue, and the only consumer (the admin badge) cycled
-- pending → confirmed → paid → pending with no enforced
-- semantics. Operators have to click twice to get to `paid`,
-- which is the actual end state the rest of the app cares
-- about.
--
-- This migration:
--   1. Migrates any existing `confirmed` rows to `paid`. We're
--      collapsing toward `paid` because (a) revenue reporting
--      already counted only `paid`, so this preserves what the
--      operator actually saw, and (b) `confirmed` was only
--      reachable by an explicit click toward `paid`.
--   2. Replaces the CHECK constraint with the new enum.
--
-- pickup_orders.status keeps its own enum (incl. `confirmed`
-- and `picked_up`) — that flow is out of scope for this change.
-- ============================================================

UPDATE orders SET status = 'paid' WHERE status = 'confirmed';

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'paid', 'cancelled'));
