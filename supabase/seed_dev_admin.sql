-- LOCAL DEVELOPMENT ONLY. Creates a confirmed admin account:
--   email:    admin@nexora.com
--   username: admin
--   password: Admin@1234
--
-- Do NOT run this on a production project, and do not commit a real password
-- to a shared repository. For any hosted project, sign up through the app
-- instead and run only the last statement (the admin_users insert).
--
-- Run after both migrations. Safe to run twice: it skips an existing account.
-- NOT YET RUN against Postgres. Written for Supabase, where pgcrypto lives in
-- the "extensions" schema.

do $$
declare
  v_id    uuid;
  v_email text := 'admin@nexora.com';
begin
  select id into v_id from auth.users where email = v_email;

  if v_id is null then
    v_id := gen_random_uuid();

    -- The on_auth_user_created trigger creates the profile, balances and stamina.
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
      extensions.crypt('Admin@1234', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(),
      '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_id,
      jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
      'email', v_id::text, now(), now(), now()
    );
  end if;

  -- Username (display name) for the leaderboard and dashboard.
  update public.profiles set display_name = 'admin' where id = v_id;

  -- Grant admin.
  insert into public.admin_users (user_id) values (v_id) on conflict (user_id) do nothing;
end $$;
