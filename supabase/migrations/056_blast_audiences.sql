-- ============================================================
-- 056: extra notification_blasts audiences.
--
-- Adds two targeted audiences on top of the original three:
--   - 'unpaid_tickets' : status='yes' + payment_status in (unpaid,pending)
--                        on a ticketed event. Powers the one-click
--                        "Remind to pay" action on the Tickets page and
--                        the "Unpaid ticket holders" audience in the
--                        Blast composer.
--   - 'maybes'         : status='maybe'. Powers the one-click
--                        "Nudge maybes" action (no status change).
--
-- The payment_status narrowing for 'unpaid_tickets' lives in the
-- send-blast edge function + the composer's preview count, not in this
-- CHECK (which only governs the audience label written to the row).
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
    'maybes'
  ));
