-- ============================================================
-- 048: Resumable bulk invite jobs.
--
-- Replaces the existing fire-and-forget loop in EventBulkInvite.tsx
-- with a preview/confirm/resume pattern.
--
-- Flow:
--   1. Admin selects guests in the UI.
--   2. Frontend POSTs to bulk-invite edge fn (action='preview') with
--      the selected guest list. Edge fn creates a job row + recipient
--      rows, categorizing each as 'will_send' or 'skipped' with reason.
--      Returns the job_id + the categorized list.
--   3. UI shows the preview. Admin clicks "Send N invites".
--   4. Frontend POSTs (action='confirm', job_id). Edge fn flips status
--      to 'sending', processes recipients with bounded concurrency,
--      writes per-row results.
--   5. UI polls the recipients table for live progress.
--   6. After completion, "Retry failed" creates a new job containing
--      only the failed rows from the previous job.
--
-- Survives a tab close because state lives in Postgres, not in JS.
-- USER_FLOWS_SPEC.md §8.
-- ============================================================

CREATE TABLE IF NOT EXISTS bulk_invite_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_by       UUID,
  status           TEXT NOT NULL DEFAULT 'preview'
    CHECK (status IN ('preview', 'sending', 'completed', 'failed', 'cancelled')),
  total_recipients INTEGER NOT NULL DEFAULT 0,
  retry_of_job_id  UUID REFERENCES bulk_invite_jobs(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bulk_invite_jobs_event_idx
  ON bulk_invite_jobs (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bulk_invite_jobs_status_idx
  ON bulk_invite_jobs (status) WHERE status IN ('preview', 'sending');

CREATE TABLE IF NOT EXISTS bulk_invite_job_recipients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID NOT NULL REFERENCES bulk_invite_jobs(id) ON DELETE CASCADE,
  guest_id        UUID REFERENCES guests(id) ON DELETE SET NULL,
  -- Resolved during preview. Stored so the confirm pass doesn't need
  -- to re-derive contactability from the (possibly-changed) guest row.
  channel         TEXT CHECK (channel IN ('sms', 'email')),
  resolved_email  TEXT,
  resolved_phone  TEXT,
  invite_id       UUID REFERENCES invites(id) ON DELETE SET NULL,
  notification_id UUID REFERENCES notifications_log(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'will_send', 'sent', 'failed', 'skipped')),
  skip_reason     TEXT,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS bulk_invite_job_recipients_job_status_idx
  ON bulk_invite_job_recipients (job_id, status);
CREATE INDEX IF NOT EXISTS bulk_invite_job_recipients_guest_idx
  ON bulk_invite_job_recipients (guest_id);

ALTER TABLE bulk_invite_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_invite_job_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin reads invite jobs" ON bulk_invite_jobs
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin writes invite jobs" ON bulk_invite_jobs
  FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin reads invite recipients" ON bulk_invite_job_recipients
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin writes invite recipients" ON bulk_invite_job_recipients
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE TRIGGER bulk_invite_jobs_updated_at
  BEFORE UPDATE ON bulk_invite_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE bulk_invite_jobs IS
  'Resumable bulk invite jobs. Preview state captured in bulk_invite_job_recipients before confirm. USER_FLOWS_SPEC.md §8.';
