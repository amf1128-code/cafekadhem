-- ============================================================
-- 059: admin-editable message templates.
--
-- Copy for the reminder / nudge sends lives here so the admin can edit
-- it from the dashboard instead of in code. Both senders read it:
--   - send-notification (per-row) renders the template by key
--   - the bulk reminder buttons fetch + render it, then blast it
--
-- Placeholders, replaced at send time: {name} {event} {amount}
-- (per-row fills {name} with the guest's first name; the bulk one-click
--  sends use a generic "there" since the body is shared).
-- ============================================================

CREATE TABLE IF NOT EXISTS message_templates (
  key         TEXT PRIMARY KEY,
  subject     TEXT NOT NULL,
  email_body  TEXT NOT NULL,
  sms_body    TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

-- Admin-only (authenticated) CRUD via the dashboard. The edge functions
-- use the service role, which bypasses RLS.
CREATE POLICY "admin manages message_templates" ON message_templates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER message_templates_updated_at
  BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed current defaults. ON CONFLICT DO NOTHING so re-running is safe and
-- never clobbers admin edits.
INSERT INTO message_templates (key, subject, email_body, sms_body) VALUES
  (
    'payment_reminder',
    'We''re holding your spot for {event}, but get your ticket!',
    'Hi {name}! We''re holding your spot for {event}, but we don''t have your payment confirmed yet. Tickets are ${amount}. Tap below to pay and lock in your seat.',
    'We''re holding your spot for {event}, but we don''t have your ${amount} payment yet. Tap below to pay and lock in your seat:'
  ),
  (
    'maybe_nudge',
    'Still thinking about {event}?',
    'Hi {name}! You marked yourself as a maybe for {event}. Seats are limited — if you''re in, tap below to grab your spot before it fills up.',
    'Still thinking about {event}? Seats are limited — tap below to grab your spot before it fills up:'
  )
ON CONFLICT (key) DO NOTHING;
