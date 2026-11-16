-- ============================================================
-- 016a: onboarding review fixes
--   - currency can't change once setup is done (amounts aren't converted)
--   - change_member_role / remove_member re-check the caller after the
--     owners lock, and remove_member refuses the last owner, so two
--     Owners acting at once can't leave the agency with none
--   - demoting someone withdraws pending invites their new role
--     couldn't send
--   - owner invites and owner-invite acceptance take the owners lock,
--     so concurrent requests can't exceed the plan's owner limit
-- ============================================================

CREATE OR REPLACE FUNCTION public.complete_agency_setup(p_language TEXT, p_currency TEXT)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agency UUID := public.current_user_agency_id();
BEGIN
  IF v_agency IS NULL OR public.current_user_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only the owner can do that' USING ERRCODE = '42501';
  END IF;
  IF p_language IS NULL OR p_language NOT IN ('en', 'sw', 'fr', 'pt', 'es', 'ar') THEN
    RAISE EXCEPTION 'Pick a language';
  END IF;
  IF p_currency IS NULL OR p_currency NOT IN ('KES', 'TZS', 'UGX', 'USD') THEN
    RAISE EXCEPTION 'Pick a currency';
  END IF;
  -- Amounts are stored as plain numbers, so the currency is fixed once set up.
  IF EXISTS (SELECT 1 FROM agencies WHERE id = v_agency AND setup_completed_at IS NOT NULL AND currency <> p_currency) THEN
    RAISE EXCEPTION 'The currency can''t be changed after setup';
  END IF;
  UPDATE agencies
     SET language = p_language,
         currency = p_currency,
         setup_completed_at = coalesce(setup_completed_at, now())
   WHERE id = v_agency;
  UPDATE users SET language = p_language WHERE id = auth.uid();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.complete_agency_setup(TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.complete_agency_setup(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_invite(p_email TEXT, p_role TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role   TEXT := public.current_user_role();
  v_agency UUID := public.current_user_agency_id();
  v_email  TEXT := lower(btrim(p_email));
  v_code   TEXT;
  v_id     UUID;
  v_exp    TIMESTAMPTZ;
BEGIN
  IF v_agency IS NULL
     OR NOT (   (v_role = 'owner'   AND p_role IN ('owner', 'manager', 'agent'))
             OR (v_role = 'manager' AND p_role = 'agent')) THEN
    RAISE EXCEPTION 'You are not allowed to invite that role' USING ERRCODE = '42501';
  END IF;

  IF v_email IS NULL OR position('@' IN v_email) = 0 THEN
    RAISE EXCEPTION 'Enter a valid email address';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_agency::text || ':' || v_email, 0));

  IF EXISTS (
    SELECT 1
      FROM users u
      LEFT JOIN auth.users au ON au.id = u.id
     WHERE u.agency_id = v_agency
       AND (lower(btrim(u.email)) = v_email OR lower(btrim(au.email)) = v_email)
  ) THEN
    RAISE EXCEPTION 'That person is already a member of this agency';
  END IF;

  IF EXISTS (
    SELECT 1 FROM agency_invites
     WHERE agency_id = v_agency AND email = v_email
       AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'There is already a pending invite for this email';
  END IF;

  PERFORM public._assert_member_capacity(v_agency);
  IF p_role = 'owner' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('owners:' || v_agency::text, 0));
    PERFORM public._assert_owner_capacity(v_agency);
  END IF;

  v_code := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO agency_invites (agency_id, email, role, token_hash, invited_by)
  VALUES (v_agency, v_email, p_role,
          encode(extensions.digest(v_code, 'sha256'), 'hex'), auth.uid())
  RETURNING id, expires_at INTO v_id, v_exp;

  RETURN jsonb_build_object('invite_id', v_id, 'code', v_code, 'expires_at', v_exp);
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_invite(p_code TEXT, p_full_name TEXT, p_terms_accepted BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_code   TEXT := lower(p_code);
  v_name   TEXT := btrim(p_full_name);
  v_email  TEXT;
  v_invite agency_invites%ROWTYPE;
  v_max    INTEGER;
  v_owners INTEGER;
  c        RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT coalesce(p_terms_accepted, false) THEN
    RAISE EXCEPTION 'Accept the Terms and Privacy Notice to continue';
  END IF;
  IF v_name IS NULL OR length(v_name) < 2 THEN
    RAISE EXCEPTION 'Enter your full name';
  END IF;
  IF v_code IS NULL OR v_code !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid or expired invite';
  END IF;

  SELECT * INTO v_invite
    FROM agency_invites
   WHERE token_hash = encode(extensions.digest(v_code, 'sha256'), 'hex')
   FOR UPDATE;

  IF NOT FOUND
     OR v_invite.accepted_at IS NOT NULL
     OR v_invite.revoked_at IS NOT NULL
     OR v_invite.expires_at <= now() THEN
    RAISE EXCEPTION 'Invalid or expired invite';
  END IF;

  SELECT lower(btrim(email)) INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS DISTINCT FROM v_invite.email THEN
    RAISE EXCEPTION 'This invite is for a different email address';
  END IF;

  IF EXISTS (SELECT 1 FROM users WHERE id = v_uid) THEN
    RAISE EXCEPTION 'This account already belongs to an agency';
  END IF;

  IF NOT public._agency_is_comped(v_invite.agency_id) THEN
    SELECT t.max_members INTO v_max
      FROM agencies a JOIN subscription_tiers t ON t.key = a.subscription_tier
     WHERE a.id = v_invite.agency_id;
    IF v_max IS NOT NULL THEN
      SELECT * INTO c FROM public._subscription_counts(v_invite.agency_id);
      IF c.members + 1 > v_max THEN
        RAISE EXCEPTION 'Your plan allows % team members. Upgrade to add more.', v_max
          USING ERRCODE = 'P0001', HINT = 'member_limit';
      END IF;
    END IF;
    IF v_invite.role = 'owner' THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('owners:' || v_invite.agency_id::text, 0));
      SELECT t.max_owners INTO v_max
        FROM agencies a JOIN subscription_tiers t ON t.key = a.subscription_tier
       WHERE a.id = v_invite.agency_id;
      SELECT count(*) INTO v_owners FROM users
       WHERE agency_id = v_invite.agency_id AND role = 'owner' AND deactivated_at IS NULL;
      IF v_max IS NOT NULL AND v_owners + 1 > v_max THEN
        RAISE EXCEPTION 'Your plan allows % %. Upgrade to add more.', v_max, CASE WHEN v_max = 1 THEN 'owner' ELSE 'owners' END
          USING ERRCODE = 'P0001', HINT = 'owner_limit';
      END IF;
    END IF;
  END IF;

  PERFORM set_config('ams.system_write', 'on', true);

  INSERT INTO users (id, agency_id, role, full_name, email, terms_accepted_at, language)
  SELECT v_uid, v_invite.agency_id, v_invite.role, v_name, v_invite.email, now(), a.language
    FROM agencies a WHERE a.id = v_invite.agency_id;

  UPDATE agency_invites
     SET accepted_at = now(), accepted_by = v_uid
   WHERE id = v_invite.id;

  PERFORM set_config('ams.system_write', 'off', true);

  RETURN jsonb_build_object('agency_id', v_invite.agency_id, 'role', v_invite.role);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.accept_invite(TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.accept_invite(TEXT, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.change_member_role(p_user_id UUID, p_role TEXT)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role   TEXT := public.current_user_role();
  v_agency UUID := public.current_user_agency_id();
  v_target users%ROWTYPE;
BEGIN
  IF v_agency IS NULL OR v_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only the owner can do that' USING ERRCODE = '42501';
  END IF;

  IF p_role IS NULL OR p_role NOT IN ('owner', 'manager', 'agent') THEN
    RAISE EXCEPTION 'Role must be owner, manager or agent' USING ERRCODE = '22023';
  END IF;

  -- Serialise owner changes within the agency.
  PERFORM pg_advisory_xact_lock(hashtextextended('owners:' || v_agency::text, 0));

  -- Re-check the caller after the lock: another Owner may have just
  -- demoted or removed them.
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND agency_id = v_agency
                   AND role = 'owner' AND deactivated_at IS NULL) THEN
    RAISE EXCEPTION 'Only the owner can do that' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_target
    FROM users
   WHERE id = p_user_id AND agency_id = v_agency
   FOR UPDATE;

  IF NOT FOUND OR v_target.deactivated_at IS NOT NULL THEN
    RAISE EXCEPTION 'Pick an active member of this agency' USING ERRCODE = '22023';
  END IF;

  IF v_target.role = p_role THEN
    RETURN;
  END IF;

  IF v_target.role = 'owner'
     AND NOT EXISTS (SELECT 1 FROM users
                      WHERE agency_id = v_agency AND role = 'owner' AND deactivated_at IS NULL
                        AND id <> v_target.id) THEN
    RAISE EXCEPTION 'The last owner cannot be changed or removed' USING ERRCODE = '42501';
  END IF;

  IF p_role = 'owner' THEN
    PERFORM public._assert_owner_capacity(v_agency);
  END IF;

  UPDATE users SET role = p_role WHERE id = v_target.id;

  -- Pending invites the new role could not have sent are withdrawn
  -- (reduces usage, so allowed while read-only).
  PERFORM set_config('ams.system_write', 'on', true);
  UPDATE agency_invites
     SET revoked_at = now()
   WHERE agency_id = v_agency
     AND invited_by = v_target.id
     AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
     AND (p_role = 'agent' OR (p_role = 'manager' AND role IN ('owner', 'manager')));
  PERFORM set_config('ams.system_write', 'off', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.change_member_role(UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.change_member_role(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_member(p_user_id UUID, p_reassign_to UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role     TEXT := public.current_user_role();
  v_agency   UUID := public.current_user_agency_id();
  v_target   users%ROWTYPE;
  v_client   UUID;
  v_clients  INTEGER := 0;
  v_policies INTEGER := 0;
  v_swept    INTEGER;
  v_invites  INTEGER;
BEGIN
  IF v_agency IS NULL OR v_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only the owner can do that' USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot remove yourself' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('owners:' || v_agency::text, 0));

  -- Re-check the caller after the lock (see change_member_role).
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND agency_id = v_agency
                   AND role = 'owner' AND deactivated_at IS NULL) THEN
    RAISE EXCEPTION 'Only the owner can do that' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_target
    FROM users
   WHERE id = p_user_id AND agency_id = v_agency
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pick an active member of this agency' USING ERRCODE = '22023';
  END IF;
  IF v_target.deactivated_at IS NOT NULL THEN
    RAISE EXCEPTION 'Pick an active member of this agency' USING ERRCODE = '22023';
  END IF;
  IF v_target.role = 'owner'
     AND NOT EXISTS (SELECT 1 FROM users
                      WHERE agency_id = v_agency AND role = 'owner' AND deactivated_at IS NULL
                        AND id <> v_target.id) THEN
    RAISE EXCEPTION 'The last owner cannot be changed or removed' USING ERRCODE = '42501';
  END IF;
  -- (The caller is an active Owner other than the target, so removing an
  -- Owner never leaves the agency without one.)

  PERFORM 1 FROM users
   WHERE id = p_reassign_to AND id <> v_target.id
     AND agency_id = v_agency AND deactivated_at IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pick an active member of this agency' USING ERRCODE = '22023';
  END IF;

  -- Removing a member reduces usage, so it must work while read-only.
  PERFORM set_config('ams.system_write', 'on', true);

  FOR v_client IN
    SELECT id FROM clients
     WHERE agency_id = v_agency AND assigned_agent_id = v_target.id
     ORDER BY id
     FOR UPDATE
  LOOP
    v_policies := v_policies + public._reassign_client_unchecked(v_client, p_reassign_to);
    v_clients  := v_clients + 1;
  END LOOP;

  UPDATE policies
     SET agent_id = p_reassign_to,
         updated_at = now()
   WHERE agency_id = v_agency
     AND agent_id = v_target.id
     AND status IN ('active', 'pending');
  GET DIAGNOSTICS v_swept = ROW_COUNT;
  v_policies := v_policies + v_swept;

  UPDATE agency_invites
     SET revoked_at = now()
   WHERE agency_id = v_agency
     AND invited_by = v_target.id
     AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now();
  GET DIAGNOSTICS v_invites = ROW_COUNT;

  DELETE FROM agent_rates WHERE agency_id = v_agency AND user_id = v_target.id;

  UPDATE users SET deactivated_at = now() WHERE id = v_target.id;

  PERFORM set_config('ams.system_write', 'off', true);

  RETURN jsonb_build_object(
    'clients_moved',   v_clients,
    'policies_moved',  v_policies,
    'invites_revoked', v_invites);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.remove_member(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.remove_member(UUID, UUID) TO authenticated;
