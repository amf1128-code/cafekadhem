-- ============================================================
-- 058: 'payment_unconfirmed' blast audience.
--
-- For guests who self-attested payment (status='yes', payment='pending')
-- but whose Venmo the host hasn't matched yet. Powers a "you marked it
-- paid but we haven't received it — mind checking?" nudge, distinct from
-- the "you haven't paid" reminder (which targets unpaid registrants).
-- ============================================================

ALTER TABLE notification_blasts
  DROP CONSTRAINT IF EXISTS notification_blasts_audience_check;

ALTER TABLE notification_blasts
  ADD CONSTRAINT notification_blasts_audience_check
  CHECK (audience IN (
    'yes_only',
    'yes_and_maybe',
    'all_invited',
    'unpaid_tickets',
    'maybes',
    'payment_unconfirmed'
  ));
