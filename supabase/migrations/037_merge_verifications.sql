-- ============================================================
-- 037: Verify-then-merge tokens for spec §3.4 Case B.
--
-- A merge verification is created when upsert_guest detects a
-- single-channel collision against the caller's cached guest_id.
-- The user clicks the link → confirm_merge_verification → merge_guests.
-- ============================================================

CREATE TABLE IF NOT EXISTS merge_verifications (
  token         TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  keep_guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  drop_guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
  consumed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merge_verifications_expires_idx
  ON merge_verifications (expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE merge_verifications ENABLE ROW LEVEL SECURITY;
-- No public policies; access exclusively via RPCs below.

CREATE OR REPLACE FUNCTION request_merge_verification(
  p_keep_id UUID,
  p_drop_id UUID,
  p_channel TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
BEGIN
  IF p_channel NOT IN ('email', 'sms') THEN
    RAISE EXCEPTION 'invalid_channel';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM guests WHERE id = p_keep_id)
     OR NOT EXISTS (SELECT 1 FROM guests WHERE id = p_drop_id) THEN
    RAISE EXCEPTION 'guest_not_found';
  END IF;

  INSERT INTO merge_verifications (keep_guest_id, drop_guest_id, channel)
  VALUES (p_keep_id, p_drop_id, p_channel)
  RETURNING token INTO v_token;

  RETURN jsonb_build_object('token', v_token);
END;
$$;

CREATE OR REPLACE FUNCTION confirm_merge_verification(
  p_token TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record      merge_verifications;
  v_merge_result JSONB;
BEGIN
  SELECT * INTO v_record
    FROM merge_verifications
   WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_token');
  END IF;

  IF v_record.consumed_at IS NOT NULL THEN
    -- Already consumed — return the kept guest_id so the client can
    -- still set localStorage correctly.
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'already_consumed',
      'guest_id', v_record.keep_guest_id
    );
  END IF;

  IF v_record.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;

  v_merge_result := merge_guests(v_record.keep_guest_id, v_record.drop_guest_id);

  UPDATE merge_verifications
     SET consumed_at = now()
   WHERE token = p_token;

  RETURN jsonb_build_object(
    'ok', true,
    'guest_id', v_record.keep_guest_id,
    'merge', v_merge_result
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION request_merge_verification(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION confirm_merge_verification(TEXT) FROM PUBLIC;
-- request: called server-side from send-notification (service role) or by
--   the SECURITY DEFINER upsert_guest path. Do not expose to anon.
GRANT EXECUTE ON FUNCTION request_merge_verification(UUID, UUID, TEXT) TO service_role, authenticated;
-- confirm: anon can call with a valid token (the token is the credential).
GRANT EXECUTE ON FUNCTION confirm_merge_verification(TEXT) TO anon, authenticated;
