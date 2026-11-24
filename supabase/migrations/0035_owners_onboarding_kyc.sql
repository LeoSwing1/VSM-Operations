-- =============================================================================
-- 0035 · Owners, who-can-add-whom, admins in every group, KYC onboarding, public profile cards.
--  • Owners: at most 2 per organisation — the Super Admin plus one co-owner chosen by the Super Admin. Full access.
--  • Adding people: people.manage (HR Manager / Admin) adds anyone below their level; people.onboard (HR post)
--    adds executives, employees and interns; people.add_team (managers / team leads) adds executives, employees
--    and interns who report to themselves. Employees can add nobody, and nobody deletes employees (exit instead).
--  • Owners and Admins are automatically members of every group chat.
--  • KYC: personal details form + supporting documents → HR verifies (kyc.verify). Auto chat message on joining.
--  • employee_card(): the basic, non-sensitive profile anyone in the company may see (for chat name links).
-- =============================================================================

-- ---------- Owners ----------
alter table employees add column if not exists is_owner boolean not null default false;
update employees set is_owner = true where role = 'SUPER_ADMIN' and not is_owner;

create or replace function guard_owners() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.role = 'SUPER_ADMIN' then new.is_owner := true; return new; end if;
  if tg_op = 'UPDATE' and new.is_owner is not distinct from old.is_owner then return new; end if;
  if tg_op = 'INSERT' and not new.is_owner then return new; end if;
  if auth.uid() is not null and not is_super_admin() and not is_owner_session() then
    raise exception 'Only the Super Admin can choose the co-owner.' using errcode = '42501';
  end if;
  if new.is_owner then
    if new.role not in ('ADMIN') then raise exception 'A co-owner must have the Admin role.' using errcode = '23514'; end if;
    if (select count(*) from employees where org_id = new.org_id and is_owner and status <> 'EXITED' and id <> new.id) >= 2 then
      raise exception 'There can only be 2 owners (the Super Admin and one co-owner).' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists employees_guard_owners on employees;
create trigger employees_guard_owners before insert or update of is_owner, role on employees for each row execute function guard_owners();

-- has_perm: owners have every permission (same as the Super Admin). Keep employee_has_perm() in sync.
create or replace function has_perm(p text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select case
      when e.role = 'SUPER_ADMIN' or e.is_owner then true
      when exists (select 1 from employee_permission_overrides o where o.employee_id = e.id and o.permission = p
                   and o.effect = 'DENY' and (o.expires_at is null or o.expires_at > now())) then false
      when exists (select 1 from employee_permission_overrides o where o.employee_id = e.id and o.permission = p
                   and o.effect = 'GRANT' and (o.expires_at is null or o.expires_at > now())) then true
      when exists (select 1 from role_permissions rp where rp.org_id = e.org_id and rp.role = e.role and rp.permission = p) then true
      else not is_sensitive_permission(p) and exists (
        select 1 from designations d where d.org_id = e.org_id and d.is_active and e.designation is not null
          and lower(d.title) = lower(e.designation) and p = any(d.grants))
    end
    from employees e where e.user_id = auth.uid() and e.status <> 'EXITED' limit 1), false)
$$;
create or replace function employee_has_perm(p_emp uuid, p text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select case
      when e.role = 'SUPER_ADMIN' or e.is_owner then true
      when exists (select 1 from employee_permission_overrides o where o.employee_id = e.id and o.permission = p
                   and o.effect = 'DENY' and (o.expires_at is null or o.expires_at > now())) then false
      when exists (select 1 from employee_permission_overrides o where o.employee_id = e.id and o.permission = p
                   and o.effect = 'GRANT' and (o.expires_at is null or o.expires_at > now())) then true
      when exists (select 1 from role_permissions rp where rp.org_id = e.org_id and rp.role = e.role and rp.permission = p) then true
      else not is_sensitive_permission(p) and exists (
        select 1 from designations d where d.org_id = e.org_id and d.is_active and e.designation is not null
          and lower(d.title) = lower(e.designation) and p = any(d.grants))
    end
    from employees e where e.id = p_emp and e.status <> 'EXITED'), false)
$$;
revoke all on function employee_has_perm(uuid, text) from public, anon, authenticated;

create or replace function my_context() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'employee_id', e.id, 'org_id', e.org_id, 'org_name', o.name, 'timezone', o.timezone,
    'full_name', e.full_name, 'email', e.official_email, 'designation', e.designation,
    'role', e.role, 'role_level', role_level(e.role), 'photo_url', e.photo_url, 'is_owner', e.is_owner,
    'employee_code', e.employee_code,
    'permissions', case when e.role = 'SUPER_ADMIN' or e.is_owner then to_jsonb(array['*'])
      else coalesce((select jsonb_agg(ep.permission order by ep.permission) from effective_permissions(e.id) ep), '[]'::jsonb) end
  )
  from employees e join organizations o on o.id = e.org_id
  where e.user_id = auth.uid() and e.status <> 'EXITED'
  limit 1
$$;

-- KYC data (Aadhaar/PAN/bank) is sensitive: only the Super Admin may delegate kyc.* beyond the seeded roles,
-- and a post can never grant it.
create or replace function is_sensitive_permission(p text) returns boolean language sql immutable as $$
 select p like 'payroll.%' or p like 'salary.%' or p like 'finance.%' or p like 'kyc.%'
   or p in ('roles.manage','audit.view','settings.manage','communication.moderate','communication.channel_manage',
            'teams.manage','time.approve_all','quality.manage','calendar.manage','people.reset_password')
$$;

-- ---------- Who may add whom ----------
create or replace function can_add_employee(p_role app_role, p_manager uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select current_employee_id() is not null and (
    (has_perm('people.manage') and can_manage_role(p_role))
    or (p_role in ('SALES_EXECUTIVE','EMPLOYEE','INTERN') and has_perm('people.onboard'))
    or (p_role in ('SALES_EXECUTIVE','EMPLOYEE','INTERN') and has_perm('people.add_team') and p_manager = current_employee_id()))
$$;
grant execute on function can_add_employee(app_role, uuid) to authenticated;

drop policy if exists employees_insert on employees;
create policy employees_insert on employees for insert to authenticated
  with check (org_id = current_org_id() and can_add_employee(role, manager_id) and not is_owner);
-- Nobody deletes people from the app: they are exited (records stay for payroll, audit and law).
revoke delete on employees from authenticated;

create or replace function employees_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := current_employee_id(); v_sa boolean := is_super_admin();
begin
  if auth.uid() is null then return new; end if;   -- service role / migrations
  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id then raise exception 'org_id is immutable' using errcode='42501'; end if;
    if new.user_id is distinct from old.user_id and not v_sa and my_level() < 90 then
      raise exception 'only administrators can relink accounts' using errcode='42501';
    end if;
    if new.role <> old.role and old.id = v_me then
      raise exception 'you cannot change your own role' using errcode='42501';
    end if;
    -- Nobody edits a colleague at or above their own level (Super Admin excepted); owners only by the Super Admin.
    if old.id <> v_me and not v_sa and (role_level(old.role) >= my_level() or old.is_owner) then
      raise exception 'you can only manage people below your level' using errcode='42501';
    end if;
    if new.role <> old.role and not has_perm('roles.manage') and not has_perm('people.manage') then
      raise exception 'people.manage required to change roles' using errcode='42501';
    end if;
    if new.role <> old.role and not can_manage_role(new.role) then
      raise exception 'you can only assign roles below your own level' using errcode='42501';
    end if;
  else
    if not can_add_employee(new.role, new.manager_id) then
      raise exception 'You can''t add someone with that role. Managers add executives and interns to their own team; HR adds everyone else.' using errcode='42501';
    end if;
  end if;
  return new;
end $$;

create or replace function seed_access_0035(p_org uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into role_permissions(org_id, role, permission)
  select p_org, r.role::app_role, r.perm from (values
    ('ADMIN','people.onboard'),('HR_MANAGER','people.onboard'),
    ('OPERATIONS_MANAGER','people.add_team'),('DEPARTMENT_MANAGER','people.add_team'),('TEAM_LEAD','people.add_team'),('PROJECT_MANAGER','people.add_team'),
    ('ADMIN','kyc.verify'),('HR_MANAGER','kyc.verify')) r(role, perm)
  on conflict do nothing
$$;
revoke all on function seed_access_0035(uuid) from public, anon, authenticated;
select seed_access_0035(id) from organizations;
create or replace function seed_access_on_sa() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.role = 'SUPER_ADMIN' then perform seed_access_0035(new.org_id); end if;
  return new;
end $$;
drop trigger if exists employees_seed_w_access on employees;
create trigger employees_seed_w_access after insert on employees for each row execute function seed_access_on_sa();
-- The HR post (not the HR Manager role) can onboard executives and interns.
update designations set grants = (select array_agg(distinct g) from unnest(grants || array['people.onboard','people.view_all']) g)
 where lower(title) in ('hr executive','hr', 'hr generalist', 'hr associate') and not ('people.onboard' = any(grants));

-- ---------- Owners & Admins are in every group ----------
create or replace function add_leaders_to_channel() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.channel_type = 'DIRECT' then return new; end if;
  insert into chat_channel_members(channel_id, employee_id, member_role)
  select new.id, e.id, 'MODERATOR' from employees e
   where e.org_id = new.org_id and e.status <> 'EXITED' and (e.is_owner or e.role in ('SUPER_ADMIN','ADMIN'))
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists chat_channels_add_leaders on chat_channels;
create trigger chat_channels_add_leaders after insert on chat_channels for each row execute function add_leaders_to_channel();
-- A new owner/admin joins every existing group.
create or replace function add_leader_to_channels() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status <> 'EXITED' and (new.is_owner or new.role in ('SUPER_ADMIN','ADMIN'))
     and (tg_op = 'INSERT' or not (old.is_owner or old.role in ('SUPER_ADMIN','ADMIN'))) then
    insert into chat_channel_members(channel_id, employee_id, member_role)
    select c.id, new.id, 'MODERATOR' from chat_channels c where c.org_id = new.org_id and c.channel_type <> 'DIRECT' and c.archived_at is null
    on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists employees_join_all_groups on employees;
create trigger employees_join_all_groups after insert or update of role, is_owner on employees for each row execute function add_leader_to_channels();
insert into chat_channel_members(channel_id, employee_id, member_role)
select c.id, e.id, 'MODERATOR' from chat_channels c join employees e on e.org_id = c.org_id
 where c.channel_type <> 'DIRECT' and c.archived_at is null and e.status <> 'EXITED' and (e.is_owner or e.role in ('SUPER_ADMIN','ADMIN'))
on conflict do nothing;

-- ---------- Public profile card ----------
-- What any colleague may see about anyone in the company (no salary, documents, KYC or personal contact details).
create or replace function employee_card(p_emp uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code, 'designation', e.designation,
    'role', e.role, 'is_owner', e.is_owner, 'photo_url', e.photo_url, 'official_email', e.official_email, 'status', e.status,
    'work_location', e.work_location, 'joining_date', e.joining_date,
    'department', (select name from departments where id = e.department_id),
    'manager', (select jsonb_build_object('id', m.id, 'full_name', m.full_name) from employees m where m.id = e.manager_id),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('name', t.name, 'role', tm.member_role) order by t.name)
                       from org_team_members tm join org_teams t on t.id = tm.team_id where tm.employee_id = e.id), '[]'))
  from employees e where e.id = p_emp and e.org_id = current_org_id() and current_employee_id() is not null
$$;
revoke all on function employee_card(uuid) from public, anon;
grant execute on function employee_card(uuid) to authenticated;

-- ---------- KYC ----------
create or replace function kyc_required_docs() returns text[] language sql immutable as $$
  select array['PHOTO','AADHAAR','PAN','ADDRESS_PROOF','BANK_PROOF','EDUCATION']
$$;

create table if not exists kyc_profiles (
  employee_id uuid primary key references employees(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  status text not null default 'NOT_STARTED' check (status in ('NOT_STARTED','DRAFT','SUBMITTED','CHANGES_REQUESTED','VERIFIED')),
  date_of_birth date check (date_of_birth between '1940-01-01' and current_date - interval '16 years'),
  father_name text check (length(father_name) <= 120),
  personal_email text check (personal_email is null or personal_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  personal_phone text check (personal_phone is null or personal_phone ~ '^\+?[0-9]{10,13}$'),
  current_address text check (length(current_address) <= 400),
  permanent_address text check (length(permanent_address) <= 400),
  emergency_name text check (length(emergency_name) <= 120),
  emergency_relation text check (length(emergency_relation) <= 40),
  emergency_phone text check (emergency_phone is null or emergency_phone ~ '^\+?[0-9]{10,13}$'),
  blood_group text check (blood_group is null or blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  highest_education text check (length(highest_education) <= 160),
  pan text check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  aadhaar_last4 text check (aadhaar_last4 is null or aadhaar_last4 ~ '^[0-9]{4}$'),   -- never the full Aadhaar number
  bank_account_holder text check (length(bank_account_holder) <= 120),
  bank_account_no text check (bank_account_no is null or bank_account_no ~ '^[0-9]{9,18}$'),
  bank_ifsc text check (bank_ifsc is null or bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  declaration_accepted boolean not null default false,
  requested_at timestamptz, submitted_at timestamptz,
  reviewed_by uuid references employees(id), reviewed_at timestamptz,
  review_note text check (length(review_note) <= 1000),
  updated_at timestamptz not null default now()
);
create table if not exists kyc_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  doc_type text not null check (doc_type in ('PHOTO','AADHAAR','PAN','ADDRESS_PROOF','BANK_PROOF','EDUCATION','EXPERIENCE','RELIEVING','OTHER')),
  storage_path text not null unique,
  original_name text not null check (length(original_name) between 1 and 255),
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  size_bytes bigint not null check (size_bytes between 1 and 5242880),
  status text not null default 'PENDING' check (status in ('PENDING','VERIFIED','REJECTED','REPLACED')),
  review_note text check (length(review_note) <= 500),
  reviewed_by uuid references employees(id), reviewed_at timestamptz,
  uploaded_at timestamptz not null default now(),
  check (storage_path like org_id::text || '/' || employee_id::text || '/%')
);
create index if not exists kyc_documents_emp on kyc_documents(employee_id, doc_type, uploaded_at desc);
drop trigger if exists kyc_profiles_touch on kyc_profiles;
create trigger kyc_profiles_touch before update on kyc_profiles for each row execute function touch_updated_at();

alter table kyc_profiles enable row level security;
alter table kyc_documents enable row level security;
drop policy if exists kyc_read on kyc_profiles;
create policy kyc_read on kyc_profiles for select to authenticated
  using (org_id = current_org_id() and (employee_id = current_employee_id() or has_perm('kyc.verify')));
drop policy if exists kyc_self_update on kyc_profiles;
create policy kyc_self_update on kyc_profiles for update to authenticated
  using (employee_id = current_employee_id() and status in ('NOT_STARTED','DRAFT','CHANGES_REQUESTED'))
  with check (employee_id = current_employee_id() and status in ('NOT_STARTED','DRAFT','CHANGES_REQUESTED'));
revoke insert, update, delete on kyc_profiles from authenticated;
grant update (date_of_birth, father_name, personal_email, personal_phone, current_address, permanent_address, emergency_name,
  emergency_relation, emergency_phone, blood_group, highest_education, pan, aadhaar_last4, bank_account_holder, bank_account_no,
  bank_ifsc, declaration_accepted) on kyc_profiles to authenticated;
drop policy if exists kyc_docs_read on kyc_documents;
create policy kyc_docs_read on kyc_documents for select to authenticated
  using (org_id = current_org_id() and (employee_id = current_employee_id() or has_perm('kyc.verify')));
drop policy if exists kyc_docs_insert on kyc_documents;
create policy kyc_docs_insert on kyc_documents for insert to authenticated
  with check (org_id = current_org_id() and employee_id = current_employee_id() and status = 'PENDING' and reviewed_by is null
              and exists (select 1 from kyc_profiles k where k.employee_id = current_employee_id() and k.status in ('NOT_STARTED','DRAFT','CHANGES_REQUESTED')));
revoke update, delete on kyc_documents from authenticated;

-- A new upload of the same type replaces the older pending/rejected one (nothing is deleted).
create or replace function kyc_doc_replace() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update kyc_documents set status = 'REPLACED'
   where employee_id = new.employee_id and doc_type = new.doc_type and id <> new.id and status in ('PENDING','REJECTED')
     and new.doc_type not in ('EDUCATION','EXPERIENCE','OTHER');
  update kyc_profiles set status = 'DRAFT' where employee_id = new.employee_id and status = 'NOT_STARTED';
  return new;
end $$;
drop trigger if exists kyc_documents_replace on kyc_documents;
create trigger kyc_documents_replace after insert on kyc_documents for each row execute function kyc_doc_replace();
create or replace function kyc_profile_draft() returns trigger language plpgsql as $$
begin
  if new.status = 'NOT_STARTED' and old.status = 'NOT_STARTED' then new.status := 'DRAFT'; end if;
  return new;
end $$;
drop trigger if exists kyc_profiles_draft on kyc_profiles;
create trigger kyc_profiles_draft before update on kyc_profiles for each row execute function kyc_profile_draft();

insert into storage.buckets(id, name, public) values ('kyc-documents', 'kyc-documents', false) on conflict (id) do nothing;
drop policy if exists "kyc upload own" on storage.objects;
create policy "kyc upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'kyc-documents' and (storage.foldername(name))[1] = current_org_id()::text
              and (storage.foldername(name))[2] = current_employee_id()::text);
drop policy if exists "kyc read" on storage.objects;
create policy "kyc read" on storage.objects for select to authenticated
  using (bucket_id = 'kyc-documents' and (storage.foldername(name))[1] = current_org_id()::text
         and ((storage.foldername(name))[2] = current_employee_id()::text or has_perm('kyc.verify')));

-- Send the "please complete your KYC" chat message (from the sender to the employee) + notification.
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
    'Hi ' || v_first || ' 👋 VSM family mein welcome! Please apna KYC complete kar do — Menu → My KYC (/kyc).' || chr(10) ||
    'Form mein personal details, emergency contact aur bank details bharo, aur ye documents upload karo:' || chr(10) ||
    '• Passport-size photo' || chr(10) || '• Aadhaar (masked copy — sirf last 4 digits dikhne chahiye)' || chr(10) ||
    '• PAN card' || chr(10) || '• Address proof' || chr(10) || '• Cancelled cheque / passbook' || chr(10) || '• Highest qualification certificate' || chr(10) ||
    'Submit karte hi HR verify karega. Koi doubt ho toh yahin message karo.');
  perform notify(e.org_id, e.id, 'SYSTEM', 'Complete your KYC', 'Fill the form and upload your documents so HR can verify them.', '/kyc', 'kyc-request-' || e.id || '-' || to_char(now(), 'YYYYMMDDHH24MI'));
end $$;
revoke all on function kyc_send_request(uuid, uuid) from public, anon, authenticated;

create or replace function kyc_on_employee_created() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.role = 'SUPER_ADMIN' then return new; end if;
  insert into kyc_profiles(employee_id, org_id) values (new.id, new.org_id) on conflict do nothing;
  if current_employee_id() is not null then perform kyc_send_request(new.id, current_employee_id()); end if;
  return new;
end $$;
drop trigger if exists employees_kyc_request on employees;
create trigger employees_kyc_request after insert on employees for each row execute function kyc_on_employee_created();
insert into kyc_profiles(employee_id, org_id) select id, org_id from employees where role <> 'SUPER_ADMIN' and status <> 'EXITED' on conflict do nothing;

-- HR: (re)send the KYC reminder.
create or replace function kyc_remind(p_emp uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_perm('kyc.verify') and not has_perm('people.manage') then raise exception 'Only HR can send KYC reminders.' using errcode = '42501'; end if;
  if not exists (select 1 from employees where id = p_emp and org_id = current_org_id()) then raise exception 'Unknown employee.' using errcode = '42501'; end if;
  if exists (select 1 from kyc_profiles where employee_id = p_emp and status = 'VERIFIED') then raise exception 'KYC is already verified.'; end if;
  perform kyc_send_request(p_emp, current_employee_id());
end $$;

-- Employee submits: checks the required fields and documents.
create or replace function kyc_submit() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare k kyc_profiles; v_missing text[]; d text; v_hr record;
begin
  select * into k from kyc_profiles where employee_id = current_employee_id() for update;
  if k.employee_id is null then raise exception 'No KYC form for your account.' using errcode = '42501'; end if;
  if k.status not in ('NOT_STARTED','DRAFT','CHANGES_REQUESTED') then raise exception 'Your KYC is already submitted.'; end if;
  v_missing := array_remove(array[
    case when k.date_of_birth is null then 'date of birth' end, case when k.father_name is null then 'father''s name' end,
    case when k.personal_phone is null then 'personal phone' end, case when k.current_address is null then 'current address' end,
    case when k.permanent_address is null then 'permanent address' end, case when k.emergency_name is null or k.emergency_phone is null then 'emergency contact' end,
    case when k.pan is null then 'PAN' end, case when k.aadhaar_last4 is null then 'Aadhaar last 4 digits' end,
    case when k.bank_account_no is null or k.bank_ifsc is null or k.bank_account_holder is null then 'bank details' end,
    case when not k.declaration_accepted then 'the declaration' end], null);
  foreach d in array kyc_required_docs() loop
    if not exists (select 1 from kyc_documents where employee_id = k.employee_id and doc_type = d and status in ('PENDING','VERIFIED')) then
      v_missing := v_missing || (lower(replace(d, '_', ' ')) || ' document');
    end if;
  end loop;
  if cardinality(v_missing) > 0 then raise exception 'Still missing: %.', array_to_string(v_missing, ', '); end if;
  update kyc_profiles set status = 'SUBMITTED', submitted_at = now() where employee_id = k.employee_id;
  for v_hr in select e.id from employees e where e.org_id = k.org_id and e.status <> 'EXITED' and e.id <> k.employee_id
                and employee_has_perm(e.id, 'kyc.verify') and e.role <> 'SUPER_ADMIN' loop
    perform notify(k.org_id, v_hr.id, 'SYSTEM', 'KYC submitted · ' || (select full_name from employees where id = k.employee_id),
      'Documents are ready to verify.', '/people/kyc?e=' || k.employee_id, 'kyc-sub-' || k.employee_id || '-' || extract(epoch from now())::bigint);
  end loop;
end $$;

-- HR reviews one document.
create or replace function kyc_review_document(p_doc uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d kyc_documents;
begin
  select * into d from kyc_documents where id = p_doc and org_id = current_org_id() for update;
  if d.id is null or not has_perm('kyc.verify') then raise exception 'Only HR can verify KYC documents.' using errcode = '42501'; end if;
  if d.employee_id = current_employee_id() then raise exception 'You can''t verify your own documents.' using errcode = '42501'; end if;
  if p_decision not in ('VERIFIED','REJECTED') then raise exception 'Unknown decision.'; end if;
  if p_decision = 'REJECTED' and length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Say why the document is rejected.'; end if;
  update kyc_documents set status = p_decision, review_note = nullif(trim(p_note), ''), reviewed_by = current_employee_id(), reviewed_at = now() where id = p_doc;
end $$;

-- HR decides the whole KYC. Verified → PAN/bank copied into payroll details where those are still empty.
create or replace function kyc_review(p_emp uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare k kyc_profiles; d text; v_sender uuid := current_employee_id();
begin
  select * into k from kyc_profiles where employee_id = p_emp and org_id = current_org_id() for update;
  if k.employee_id is null or not has_perm('kyc.verify') then raise exception 'Only HR can verify KYC.' using errcode = '42501'; end if;
  if p_emp = current_employee_id() then raise exception 'You can''t verify your own KYC.' using errcode = '42501'; end if;
  if k.status <> 'SUBMITTED' then raise exception 'Only submitted KYC can be reviewed.'; end if;
  if p_decision = 'VERIFIED' then
    foreach d in array kyc_required_docs() loop
      if not exists (select 1 from kyc_documents where employee_id = p_emp and doc_type = d and status = 'VERIFIED') then
        raise exception 'Verify every required document first (% is not verified).', lower(replace(d, '_', ' '));
      end if;
    end loop;
    update kyc_profiles set status = 'VERIFIED', reviewed_by = v_sender, reviewed_at = now(), review_note = nullif(trim(p_note), '') where employee_id = p_emp;
    insert into employee_statutory(employee_id, org_id) values (p_emp, k.org_id) on conflict do nothing;
    update employee_statutory set pan = coalesce(pan, k.pan), bank_account_no = coalesce(bank_account_no, k.bank_account_no),
           bank_ifsc = coalesce(bank_ifsc, k.bank_ifsc), bank_account_holder = coalesce(bank_account_holder, k.bank_account_holder)
     where employee_id = p_emp;
    perform notify(k.org_id, p_emp, 'SYSTEM', 'KYC verified ✓', 'Thanks — HR has verified your documents.', '/kyc', 'kyc-ok-' || p_emp);
  elsif p_decision = 'CHANGES_REQUESTED' then
    if length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Tell them what to fix.'; end if;
    update kyc_profiles set status = 'CHANGES_REQUESTED', reviewed_by = v_sender, reviewed_at = now(), review_note = trim(p_note) where employee_id = p_emp;
    perform notify(k.org_id, p_emp, 'SYSTEM', 'KYC needs changes', left(trim(p_note), 160), '/kyc', 'kyc-chg-' || p_emp || '-' || extract(epoch from now())::bigint);
  else
    raise exception 'Unknown decision.';
  end if;
  perform log_audit('kyc.' || lower(p_decision), 'employee', p_emp::text, '{}');   -- no numbers in the audit log
end $$;
revoke all on function kyc_submit(), kyc_review_document(uuid, text, text), kyc_review(uuid, text, text), kyc_remind(uuid) from public, anon;
grant execute on function kyc_submit(), kyc_review_document(uuid, text, text), kyc_review(uuid, text, text), kyc_remind(uuid) to authenticated;

-- Employees can't delete key results (even on their own OKR); OKR admins and managers of the owner can.
drop policy if exists kr_write on okr_key_results;
drop policy if exists kr_insert on okr_key_results;
create policy kr_insert on okr_key_results for insert to authenticated
  with check (org_id = current_org_id() and can_edit_objective(objective_id));
drop policy if exists kr_update on okr_key_results;
create policy kr_update on okr_key_results for update to authenticated
  using (org_id = current_org_id() and can_edit_objective(objective_id)) with check (org_id = current_org_id() and can_edit_objective(objective_id));
drop policy if exists kr_delete on okr_key_results;
create policy kr_delete on okr_key_results for delete to authenticated
  using (org_id = current_org_id() and (has_perm('okr.manage')
         or exists (select 1 from okr_objectives o where o.id = objective_id and o.owner_id <> current_employee_id() and can_edit_objective(o.id))));

-- Teams the signed-in person may add members to (for the "Add to team" picker).
create or replace function my_manageable_teams() returns table(id uuid, name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.name from org_teams t where t.org_id = current_org_id() and t.is_active and can_manage_team(t.id) order by t.name
$$;
revoke all on function my_manageable_teams() from public, anon;
grant execute on function my_manageable_teams() to authenticated;
