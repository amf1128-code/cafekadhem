-- ============================================================
-- 043: Ambient identity tokens.
--
-- Long-lived (90-day) recognition tokens. Minted server-side per send
-- by send-notification and appended as ?as=<token> to every same-domain
-- link in the rendered body. When a recipient taps the link, the
-- frontend resolves the token to a guest_id and silently caches in
-- localStorage — recognition without forms.
--
-- NOT a credential for ticket access. Ticket pages still require the
-- separate ticket_token. Worst-case forwarded-email scenario: a recipient
-- briefly sees "Hi, Lina" until they click "not you?" — they cannot view
-- her tickets or change her RSVPs because every mutation is gated by
-- separate RPC checks. USER_FLOWS_SPEC.md §3a.2.
-- ============================================================

CREATE TABLE IF NOT EXISTS ambient_tokens (
  token       TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  guest_id    UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '90 days'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ambient_tokens_guest_idx
  ON ambient_tokens (guest_id);

-- Index on expires_at for cleanup queries (DELETE WHERE expires_at < ...).
-- Cannot use a partial WHERE expires_at > now() predicate — now() is
-- STABLE not IMMUTABLE, and Postgres rejects non-IMMUTABLE functions
-- in index predicates.
CREATE INDEX IF NOT EXISTS ambient_tokens_expires_idx
  ON ambient_tokens (expires_at);

ALTER TABLE ambient_tokens ENABLE ROW LEVEL SECURITY;
-- No public policies — RPC-only access.

CREATE OR REPLACE FUNCTION mint_ambient_token(p_guest_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM guests WHERE id = p_guest_id) THEN
    RAISE EXCEPTION 'guest_not_found';
  END IF;

  INSERT INTO ambient_tokens (guest_id) VALUES (p_guest_id)
  RETURNING token INTO v_token;

  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION resolve_ambient_token(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guest_id  UUID;
  v_first     TEXT;
  v_expires   TIMESTAMPTZ;
BEGIN
  SELECT a.guest_id, a.expires_at, g.first_name
    INTO v_guest_id, v_expires, v_first
    FROM ambient_tokens a
    JOIN guests g ON g.id = a.guest_id
   WHERE a.token = p_token;

  IF v_guest_id IS NULL OR v_expires < now() THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'guest_id', v_guest_id,
    'first_name', v_first
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION mint_ambient_token(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mint_ambient_token(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION resolve_ambient_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_ambient_token(TEXT) TO anon, authenticated;

-- Cleanup query for periodic maintenance (run manually or via pg_cron):
--   DELETE FROM ambient_tokens WHERE expires_at < now() - interval '7 days';
COMMENT ON TABLE ambient_tokens IS
  'Long-lived (90d) recognition tokens. ?as=<token> on notification links. Cleanup: DELETE WHERE expires_at < now() - 7d.';
