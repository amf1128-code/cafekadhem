-- Per-pickup-order tokens so each guest can land on a private page showing
-- their order details + a QR code. The QR encodes the same /pickup/:token
-- URL, so a host can scan a guest's phone at handoff to verify the order
-- without looking it up by name in admin.

ALTER TABLE pickup_orders
  ADD COLUMN pickup_token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE;

-- Public read by token. The id column is still admin-gated by the existing
-- "Public can read own pickup orders" policy (which is permissive today).
-- Admins keep their existing manage-all policy.
-- No new policies needed; the existing SELECT policies cover token lookups.

-- Backfill existing rows already received random tokens via the DEFAULT
-- expression at ALTER TABLE time, so no UPDATE statement is required.
