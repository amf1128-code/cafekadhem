-- ============================================================
-- 047: notification_blasts table.
--
-- One row per "blast" (admin-composed bulk message to attendees of
-- a specific event). Per-recipient delivery results live in the
-- existing notifications_log via dedup_key='blast:<blast_id>:<guest_id>'.
--
-- Spec: Notification Blast Feature (per-user, 2026-05-06).
-- Deviation log entry in IMPLEMENTATION_PLAN.md.
-- ============================================================

CREATE TABLE IF NOT EXISTS notification_blasts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  audience      TEXT NOT NULL
    CHECK (audience IN ('yes_only', 'yes_and_maybe', 'all_invited')),
  email_subject TEXT NOT NULL,
  email_body    TEXT NOT NULL,
  sms_body      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  sent_count    INTEGER NOT NULL DEFAULT 0,
  failed_count  INTEGER NOT NULL DEFAULT 0,
  -- started_at: set when status flips to 'sending'. Used by the
  -- 10-minute stuck-sending recovery: if status='sending' and
  -- started_at < now() - 10 min, the next send-blast call may
  -- reset and retry. Per-recipient dedup_key prevents double-sends.
  started_at    TIMESTAMPTZ,
  sent_at       TIMESTAMPTZ,
  created_by    UUID,        -- auth.uid() of the admin who created it
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_blasts_event_idx
  ON notification_blasts (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notification_blasts_status_idx
  ON notification_blasts (status) WHERE status IN ('pending', 'sending');

ALTER TABLE notification_blasts ENABLE ROW LEVEL SECURITY;

-- Admin-only access. The send-blast edge function uses service_role,
-- which bypasses RLS — these policies cover the admin UI's CRUD only.
CREATE POLICY "admin reads blasts" ON notification_blasts
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "admin inserts blasts" ON notification_blasts
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "admin updates blasts" ON notification_blasts
  FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "admin deletes blasts" ON notification_blasts
  FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE TRIGGER notification_blasts_updated_at
  BEFORE UPDATE ON notification_blasts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE notification_blasts IS
  'One-time bulk notifications to attendees of a specific event. Per-recipient delivery results in notifications_log.dedup_key=blast:<id>:<guest_id>. See USER_FLOWS_SPEC.md §8.';
