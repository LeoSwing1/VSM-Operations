-- =============================================================================
-- VSM Growth Operations — 0043 Platform-wide activity log, chat-report alerts, English KYC message
--
-- 1) Every create / update / delete on every organisation table now lands in audit_events, whoever or whatever
--    did it: a person in the app, an integration or cron job (service key), or the database itself.
--    * Values are NOT copied (no salaries, message text, documents). Updates record which fields changed, plus
--      a few safe headline fields (status, role, title, name…), truncated.
--    * Tables that already write their own audit rows keep them and are skipped, so nothing is logged twice.
--    * Noisy internals (notification fan-out, read receipts, sync queues, usage counters) are skipped.
--    * Future migrations call audit_attach_all() at the end so new tables are covered too.
-- 2) Reporting a chat message alerts the moderators AND admins / owners / Super Admin; the reporter hears back
--    when it is reviewed.
-- 3) The automatic "complete your KYC" chat message is in plain English.
-- =============================================================================

create index if not exists audit_actor_time_idx on audit_events(org_id, actor_employee_id, created_at desc);
create index if not exists audit_action_time_idx on audit_events(org_id, action, created_at desc);

create or replace function audit_any_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  r jsonb;
  v_org uuid;
  v_id text;
  v_changed text[];
  v_meta jsonb := '{}';
  v_claims jsonb;
  v_source text;
begin
  if coalesce(current_setting('app.audit_off', true), '') = 'on' then return null; end if;
  r := coalesce(n, o);
  begin v_org := (r->>'org_id')::uuid; exception when others then return null; end;
  if v_org is null then return null; end if;
  -- During an organisation delete cascade the parent row is already gone: nothing to log against.
  if tg_op = 'DELETE' and not exists (select 1 from organizations where id = v_org) then return null; end if;

  v_id := coalesce(r->>'id', r->>'employee_id', r->>'asset_id', r->>'channel_id');

  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_changed
      from jsonb_object_keys(n) k
     where k not in ('updated_at', 'last_seen_at', 'last_activity_at', 'search_vector') and n->k is distinct from o->k;
    if v_changed is null then return null; end if;           -- touch-only update: not an activity
    v_meta := jsonb_build_object('changed', to_jsonb(v_changed));
  end if;

  -- A few safe, short headline fields so the log reads well without exposing contents.
  v_meta := v_meta || coalesce((
    select jsonb_object_agg(k, case when jsonb_typeof(r->k) = 'string' then to_jsonb(left(r->>k, 120)) else r->k end)
      from unnest(array['status','role','decision','kind','category','channel_type','template','reason','title','name',
                        'full_name','asset_tag','employee_code','event_type','provider','direction']) k
     where r ? k and jsonb_typeof(r->k) in ('string','boolean','number')
  ), '{}');

  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then v_claims := null;
  end;
  v_source := case
    when auth.uid() is not null then 'user'
    when coalesce(v_claims->>'role', current_setting('request.jwt.claim.role', true)) = 'service_role' then 'integration'
    else 'system' end;

  insert into audit_events(org_id, actor_employee_id, actor_user_id, action, entity, entity_id, metadata)
  values (v_org, current_employee_id(), auth.uid(),
          tg_table_name || '.' || case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end,
          tg_table_name, v_id, v_meta || jsonb_build_object('source', v_source));
  return null;
end $$;
revoke all on function audit_any_change() from public, anon, authenticated;

-- Attach the generic logger to every org table that isn't audited yet.
create or replace function audit_attach_all() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare t record; v_n int := 0;
begin
  for t in
    select c.relname
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind = 'r'
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped)
       and c.relname not in (
         'audit_events', 'notifications', 'notification_digest_items', 'chat_unread_reminders', 'ai_usage',
         'calendar_sync_queue', 'performance_snapshots', 'kpi_values', 'integration_status', 'push_subscriptions')
       -- already writes its own audit rows
       and not exists (select 1 from pg_trigger tg join pg_proc p on p.oid = tg.tgfoid
                        where tg.tgrelid = c.oid and not tg.tgisinternal and p.proname ilike '%audit%' and p.proname <> 'audit_any_change')
  loop
    execute format('drop trigger if exists zz_activity_log on %I', t.relname);
    execute format('create trigger zz_activity_log after insert or update or delete on %I for each row execute function audit_any_change()', t.relname);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function audit_attach_all() from public, anon, authenticated;
select audit_attach_all();

-- Sign-in / sign-out / failed sign-in, written by the app (failed attempts via the service key).
create or replace function audit_auth_event(p_action text, p_email text, p_ip text default null, p_detail text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare e employees;
begin
  if p_action not in ('auth.sign_in', 'auth.sign_out', 'auth.sign_in_failed') then raise exception 'unknown auth event'; end if;
  select * into e from employees where lower(official_email) = lower(trim(p_email)) order by (status = 'EXITED'), created_at desc limit 1;
  if e.id is null then return; end if;   -- unknown email: nothing to attach it to (and no enumeration)
  insert into audit_events(org_id, actor_employee_id, actor_user_id, action, entity, entity_id, metadata)
  values (e.org_id, case when p_action = 'auth.sign_in_failed' then null else e.id end, auth.uid(), p_action, 'employee', e.id::text,
          jsonb_strip_nulls(jsonb_build_object('ip', left(p_ip, 64), 'detail', left(p_detail, 120),
                                               'source', case when p_action = 'auth.sign_in_failed' then 'integration' else 'user' end)));
end $$;
revoke all on function audit_auth_event(text, text, text, text) from public, anon, authenticated;
grant execute on function audit_auth_event(text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Chat reports reach moderators + admins / owners / Super Admin
-- ---------------------------------------------------------------------------
create or replace function chat_report_alert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_who text; v_ch text;
begin
  select full_name into v_who from employees where id = new.reporter_id;
  select coalesce(name, 'a chat') into v_ch from chat_channels where id = new.channel_id;
  if tg_op = 'INSERT' then
    for r in
      select e.id from employees e
       where e.org_id = new.org_id and e.status <> 'EXITED' and e.id <> new.reporter_id
         and (e.role in ('SUPER_ADMIN', 'ADMIN') or e.is_owner or employee_has_perm(e.id, 'communication.moderate'))
       limit 50
    loop
      perform notify(new.org_id, r.id, 'SYSTEM', 'Chat message reported: ' || replace(initcap(new.reason), '_', ' '),
        coalesce(v_who, 'Someone') || ' reported a message in ' || v_ch || '. Review it in Chat moderation.',
        '/settings/chat-moderation', 'chat-report:' || new.id || ':' || r.id);
    end loop;
  elsif new.status is distinct from old.status and new.status in ('DISMISSED', 'ACTIONED') then
    perform notify(new.org_id, new.reporter_id, 'SYSTEM', 'Your chat report was reviewed',
      case new.status when 'ACTIONED' then 'Thanks — action was taken on the message you reported.'
                      else 'Thanks — the moderation team reviewed the message and closed the report.' end,
      '/chat/' || new.channel_id, 'chat-report-done:' || new.id);
  end if;
  return null;
end $$;
drop trigger if exists chat_report_alert on chat_message_reports;
create trigger chat_report_alert after insert or update of status on chat_message_reports
  for each row execute function chat_report_alert();

-- Admins, owners and the Super Admin can always open the moderation queue (and the reported messages).
create or replace function seed_moderation_for_admins(p_org uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into role_permissions(org_id, role, permission)
  values (p_org, 'ADMIN', 'communication.moderate'), (p_org, 'ADMIN', 'audit.view')
  on conflict do nothing
$$;
revoke all on function seed_moderation_for_admins(uuid) from public, anon, authenticated;
select seed_moderation_for_admins(id) from organizations;
create or replace function seed_moderation_on_sa() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.role = 'SUPER_ADMIN' then perform seed_moderation_for_admins(new.org_id); end if;
  return new;
end $$;
drop trigger if exists employees_seed_z_moderation on employees;
create trigger employees_seed_z_moderation after insert on employees for each row execute function seed_moderation_on_sa();

-- ---------------------------------------------------------------------------
-- KYC request message in English
-- ---------------------------------------------------------------------------
create or replace function kyc_send_request(p_emp uuid, p_sender uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare e employees; v_key text; v_ch uuid; v_first text;
begin
  select * into e from employees where id = p_emp;
  if e.id is null or e.role = 'SUPER_ADMIN' or p_sender is null or p_sender = p_emp then return; end if;
  if not exists (select 1 from employees where id = p_sender and org_id = e.org_id and status <> 'EXITED') then return; end if;
  insert into kyc_profiles(employee_id, org_id) values (e.id, e.org_id) on conflict do nothing;
  update kyc_profiles set requested_at = now() where employee_id = e.id;
  v_key := least(p_sender::text, p_emp::text) || ':' || greatest(p_sender::text, p_emp::text);
  insert into chat_channels(org_id, name, channel_type, direct_key, created_by)
  values (e.org_id, 'Direct message', 'DIRECT', v_key, p_sender)
  on conflict (org_id, direct_key) do update set direct_key = excluded.direct_key returning id into v_ch;
  insert into chat_channel_members(channel_id, employee_id, member_role) values (v_ch, p_sender, 'OWNER'), (v_ch, p_emp, 'MEMBER') on conflict do nothing;
  v_first := split_part(e.full_name, ' ', 1);
  insert into chat_messages(org_id, channel_id, author_id, body) values (e.org_id, v_ch, p_sender,
    'Hi ' || v_first || ', welcome to VSM! 👋 Please complete your KYC: open the menu and go to My KYC (/kyc).' || chr(10) ||
    'Fill in your personal details, emergency contact and bank details, then upload these documents:' || chr(10) ||
    '• Passport-size photo' || chr(10) ||
    '• Aadhaar (masked copy — only the last 4 digits should be visible)' || chr(10) ||
    '• PAN card' || chr(10) || '• Address proof' || chr(10) || '• Cancelled cheque or bank passbook' || chr(10) ||
    '• Highest qualification certificate' || chr(10) ||
    'HR will verify everything once you submit. If you have any questions, just reply here.');
  perform notify(e.org_id, e.id, 'SYSTEM', 'Complete your KYC', 'Fill the form and upload your documents so HR can verify them.', '/kyc', 'kyc-request-' || e.id || '-' || to_char(now(), 'YYYYMMDDHH24MI'));
end $$;
revoke all on function kyc_send_request(uuid, uuid) from public, anon, authenticated;
