-- =============================================================================
-- VSM Growth Operations — 0041 Assets & inventory (Block 30)
-- Laptops, cameras, phones, SIMs and other kit issued to people; acknowledgement of receipt; returns (also at
-- exit); repairs and servicing; purchase details kept apart so only asset managers / finance see the cost.
--
-- Rules:
--   * Status and holder change only through the RPCs below (issue / return / repair), never by a plain UPDATE.
--   * Nothing is deleted: kit is RETIRED or marked LOST. DELETE is revoked.
--   * An employee sees only the kit they hold; managers see their team's kit; assets.view sees all.
--   * Exit: starting an exit adds one IT clearance item per held asset; returning the asset ticks it; an
--     employee cannot be marked EXITED while still holding kit (return it or mark it LOST first).
-- =============================================================================

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  asset_tag text not null check (asset_tag ~ '^[A-Z0-9][A-Z0-9-]{1,30}$'),
  name text not null check (length(trim(name)) between 2 and 120),
  category text not null check (category in ('LAPTOP','DESKTOP','MONITOR','PHONE','TABLET','SIM','CAMERA','LENS',
    'LIGHTING','AUDIO','STORAGE','NETWORK','ACCESSORY','FURNITURE','VEHICLE','SOFTWARE','OTHER')),
  brand text check (brand is null or length(brand) <= 80),
  model text check (model is null or length(model) <= 120),
  serial_no text check (serial_no is null or length(serial_no) <= 120),
  identifier text check (identifier is null or length(identifier) <= 120), -- IMEI, SIM number, licence key ref…
  status text not null default 'IN_STOCK' check (status in ('IN_STOCK','ISSUED','IN_REPAIR','LOST','RETIRED')),
  condition text not null default 'GOOD' check (condition in ('NEW','GOOD','FAIR','DAMAGED')),
  location text check (location is null or length(location) <= 120),
  warranty_until date,
  current_holder_id uuid references employees(id) on delete set null,
  issued_at timestamptz,
  notes text check (notes is null or length(notes) <= 2000),
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, asset_tag),
  check ((status = 'ISSUED') = (current_holder_id is not null) or status = 'IN_REPAIR')
);
create unique index if not exists assets_serial_uq on assets(org_id, lower(serial_no)) where serial_no is not null;
create index if not exists assets_holder_idx on assets(org_id, current_holder_id) where current_holder_id is not null;
create index if not exists assets_status_idx on assets(org_id, status, category);

-- Purchase details: cost and vendor stay out of the employee-visible table.
create table if not exists asset_financials (
  asset_id uuid primary key references assets(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  purchase_date date,
  purchase_cost numeric(12,2) check (purchase_cost is null or purchase_cost >= 0),
  vendor text check (vendor is null or length(vendor) <= 120),
  invoice_ref text check (invoice_ref is null or length(invoice_ref) <= 80),
  useful_life_months int not null default 36 check (useful_life_months between 1 and 240),
  updated_at timestamptz not null default now()
);

create table if not exists asset_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  issued_by uuid references employees(id) on delete set null,
  issued_at timestamptz not null default now(),
  condition_out text not null check (condition_out in ('NEW','GOOD','FAIR','DAMAGED')),
  expected_return date,
  issue_note text check (issue_note is null or length(issue_note) <= 1000),
  acknowledged_at timestamptz,
  returned_at timestamptz,
  returned_to uuid references employees(id) on delete set null,
  condition_in text check (condition_in is null or condition_in in ('NEW','GOOD','FAIR','DAMAGED','LOST')),
  return_note text check (return_note is null or length(return_note) <= 1000),
  check ((returned_at is null) = (condition_in is null))
);
-- One open assignment per asset.
create unique index if not exists asset_assignments_open_uq on asset_assignments(asset_id) where returned_at is null;
create index if not exists asset_assignments_emp_idx on asset_assignments(org_id, employee_id, issued_at desc);

create table if not exists asset_maintenance (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  kind text not null check (kind in ('ISSUE','REPAIR','SERVICE','INSPECTION','UPGRADE')),
  status text not null default 'OPEN' check (status in ('OPEN','IN_PROGRESS','DONE','CANCELLED')),
  description text not null check (length(trim(description)) between 3 and 2000),
  vendor text check (vendor is null or length(vendor) <= 120),
  cost numeric(12,2) check (cost is null or cost >= 0),
  reported_by uuid references employees(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references employees(id) on delete set null,
  resolution text check (resolution is null or length(resolution) <= 2000),
  next_due date,
  check ((status in ('DONE','CANCELLED')) = (closed_at is not null))
);
create index if not exists asset_maintenance_asset_idx on asset_maintenance(asset_id, opened_at desc);
create index if not exists asset_maintenance_open_idx on asset_maintenance(org_id, status) where status in ('OPEN','IN_PROGRESS');

-- Exit clearance items can point at the asset they are about.
alter table exit_clearance_items add column if not exists asset_id uuid references assets(id) on delete set null;
create unique index if not exists exit_clearance_asset_uq on exit_clearance_items(employee_id, asset_id) where asset_id is not null;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
create or replace function seed_assets(p_org uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into role_permissions(org_id, role, permission)
  select p_org, r.role::app_role, r.perm from (values
    ('ADMIN','assets.view'),('ADMIN','assets.manage'),
    ('HR_MANAGER','assets.view'),('HR_MANAGER','assets.manage'),
    ('OPERATIONS_MANAGER','assets.view'),('OPERATIONS_MANAGER','assets.manage')) r(role, perm)
  on conflict do nothing
$$;
revoke all on function seed_assets(uuid) from public, anon, authenticated;
select seed_assets(id) from organizations;
create or replace function seed_assets_on_sa() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.role = 'SUPER_ADMIN' then perform seed_assets(new.org_id); end if;
  return new;
end $$;
drop trigger if exists employees_seed_y_assets on employees;
create trigger employees_seed_y_assets after insert on employees for each row execute function seed_assets_on_sa();

create or replace function can_see_asset(p_holder uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select has_perm('assets.view') or has_perm('assets.manage')
      or p_holder = current_employee_id()
      or (p_holder is not null and has_perm('people.view_team') and is_in_my_team(p_holder))
$$;
revoke all on function can_see_asset(uuid) from public, anon;
grant execute on function can_see_asset(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row security
-- ---------------------------------------------------------------------------
alter table assets enable row level security;
alter table asset_financials enable row level security;
alter table asset_assignments enable row level security;
alter table asset_maintenance enable row level security;

drop policy if exists assets_read on assets;
create policy assets_read on assets for select to authenticated
  using (org_id = current_org_id() and can_see_asset(current_holder_id));
drop policy if exists assets_insert on assets;
create policy assets_insert on assets for insert to authenticated
  with check (org_id = current_org_id() and has_perm('assets.manage'));
drop policy if exists assets_update on assets;
create policy assets_update on assets for update to authenticated
  using (org_id = current_org_id() and has_perm('assets.manage'))
  with check (org_id = current_org_id() and has_perm('assets.manage'));

drop policy if exists asset_fin_read on asset_financials;
create policy asset_fin_read on asset_financials for select to authenticated
  using (org_id = current_org_id() and (has_perm('assets.manage') or has_perm('finance.view') or has_perm('finance.manage')));
drop policy if exists asset_fin_write on asset_financials;
create policy asset_fin_write on asset_financials for insert to authenticated
  with check (org_id = current_org_id() and has_perm('assets.manage'));
drop policy if exists asset_fin_update on asset_financials;
create policy asset_fin_update on asset_financials for update to authenticated
  using (org_id = current_org_id() and has_perm('assets.manage'))
  with check (org_id = current_org_id() and has_perm('assets.manage'));

drop policy if exists asset_assign_read on asset_assignments;
create policy asset_assign_read on asset_assignments for select to authenticated
  using (org_id = current_org_id() and (employee_id = current_employee_id() or can_see_asset(employee_id)));

drop policy if exists asset_maint_read on asset_maintenance;
create policy asset_maint_read on asset_maintenance for select to authenticated
  using (org_id = current_org_id() and (
    reported_by = current_employee_id()
    or exists (select 1 from assets a where a.id = asset_id and can_see_asset(a.current_holder_id))));
drop policy if exists asset_maint_insert on asset_maintenance;
create policy asset_maint_insert on asset_maintenance for insert to authenticated
  with check (org_id = current_org_id() and has_perm('assets.manage') and reported_by = current_employee_id());

-- Writes to assignments and maintenance status go through the functions below.
revoke insert, update, delete on asset_assignments from authenticated, anon;
revoke update, delete on asset_maintenance from authenticated, anon;
revoke delete on assets, asset_financials from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Guards: auto tag, org refs, status/holder only via RPC
-- ---------------------------------------------------------------------------
create or replace function assets_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  if tg_op = 'INSERT' then
    if new.asset_tag is null or trim(new.asset_tag) = '' then
      perform pg_advisory_xact_lock(hashtext('asset_tag:' || new.org_id::text));
      select coalesce(max(nullif(regexp_replace(asset_tag, '^AST-0*', ''), '')::int), 0) + 1 into v_n
        from assets where org_id = new.org_id and asset_tag ~ '^AST-[0-9]+$';
      new.asset_tag := 'AST-' || lpad(v_n::text, 4, '0');
    end if;
    new.asset_tag := upper(trim(new.asset_tag));
    new.created_by := coalesce(new.created_by, current_employee_id());
    if coalesce(current_setting('app.asset_rpc', true), '') <> 'on' then
      new.status := case when new.status in ('IN_STOCK','RETIRED') then new.status else 'IN_STOCK' end;
      new.current_holder_id := null; new.issued_at := null;
    end if;
  else
    if new.org_id <> old.org_id then raise exception 'assets cannot move between organisations' using errcode='42501'; end if;
    if coalesce(current_setting('app.asset_rpc', true), '') <> 'on' then
      if new.current_holder_id is distinct from old.current_holder_id or new.issued_at is distinct from old.issued_at then
        raise exception 'issue or return the asset instead of editing the holder' using errcode='P0001';
      end if;
      if new.status is distinct from old.status then
        -- Plain edits may only retire stock kit or bring retired/lost kit back to stock.
        if not ((old.status = 'IN_STOCK' and new.status = 'RETIRED')
             or (old.status in ('RETIRED','LOST') and new.status = 'IN_STOCK')) then
          raise exception 'use Issue, Return or Repair to change this asset''s status' using errcode='P0001';
        end if;
      end if;
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists assets_guard on assets;
create trigger assets_guard before insert or update on assets for each row execute function assets_guard();

create or replace function asset_fin_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from assets a where a.id = new.asset_id and a.org_id = new.org_id) then
    raise exception 'asset not found' using errcode='P0002';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists asset_fin_guard on asset_financials;
create trigger asset_fin_guard before insert or update on asset_financials for each row execute function asset_fin_guard();

create or replace function asset_maint_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from assets a where a.id = new.asset_id and a.org_id = new.org_id) then
    raise exception 'asset not found' using errcode='P0002';
  end if;
  return new;
end $$;
drop trigger if exists asset_maint_guard on asset_maintenance;
create trigger asset_maint_guard before insert on asset_maintenance for each row execute function asset_maint_guard();

-- Audit trail on every change.
create or replace function audit_asset_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform _audit(new.org_id, 'asset.' || lower(tg_table_name) || '.' || lower(tg_op), tg_table_name, new.id::text, '{}'::jsonb);
  return null;
end $$;
drop trigger if exists assets_audit on assets;
create trigger assets_audit after insert or update on assets for each row execute function audit_asset_row();
drop trigger if exists asset_maint_audit on asset_maintenance;
create trigger asset_maint_audit after insert or update on asset_maintenance for each row execute function audit_asset_row();

-- ---------------------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------------------
create or replace function asset_issue(p_asset uuid, p_employee uuid, p_condition text default null,
                                       p_expected_return date default null, p_note text default null)
returns asset_assignments language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a assets; v_e employees; v_row asset_assignments; v_me uuid := current_employee_id();
begin
  if not has_perm('assets.manage') then raise exception 'not authorized to issue assets' using errcode='42501'; end if;
  select * into v_a from assets where id = p_asset and org_id = current_org_id() for update;
  if v_a.id is null then raise exception 'asset not found' using errcode='P0002'; end if;
  if v_a.status <> 'IN_STOCK' then raise exception 'only in-stock assets can be issued (this one is %)', lower(replace(v_a.status,'_',' ')) using errcode='P0001'; end if;
  select * into v_e from employees where id = p_employee and org_id = v_a.org_id;
  if v_e.id is null then raise exception 'employee not found' using errcode='P0002'; end if;
  if v_e.status = 'EXITED' then raise exception 'cannot issue to someone who has exited' using errcode='P0001'; end if;
  if p_expected_return is not null and p_expected_return < current_date then raise exception 'expected return date is in the past' using errcode='P0001'; end if;

  insert into asset_assignments(org_id, asset_id, employee_id, issued_by, condition_out, expected_return, issue_note)
  values (v_a.org_id, v_a.id, v_e.id, v_me, coalesce(p_condition, v_a.condition), p_expected_return, nullif(trim(p_note), ''))
  returning * into v_row;

  perform set_config('app.asset_rpc', 'on', true);
  update assets set status = 'ISSUED', current_holder_id = v_e.id, issued_at = v_row.issued_at,
    condition = coalesce(p_condition, condition) where id = v_a.id;
  perform set_config('app.asset_rpc', 'off', true);

  perform notify(v_a.org_id, v_e.id, 'SYSTEM', 'Asset issued to you: ' || v_a.name,
    v_a.asset_tag || ' — please open My assets and confirm you received it.', '/my-assets', 'asset.issue:' || v_row.id);
  perform _audit(v_a.org_id, 'asset.issued', 'asset', v_a.id::text, jsonb_build_object('employee_id', v_e.id, 'assignment_id', v_row.id));
  return v_row;
end $$;

create or replace function asset_return(p_asset uuid, p_condition text, p_note text default null)
returns asset_assignments language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a assets; v_row asset_assignments; v_me uuid := current_employee_id(); v_status text;
begin
  if not has_perm('assets.manage') then raise exception 'not authorized to take returns' using errcode='42501'; end if;
  if p_condition is null or p_condition not in ('NEW','GOOD','FAIR','DAMAGED','LOST') then
    raise exception 'choose the condition it came back in' using errcode='P0001';
  end if;
  if p_condition in ('DAMAGED','LOST') and coalesce(trim(p_note), '') = '' then
    raise exception 'add a note when an asset comes back damaged or is lost' using errcode='P0001';
  end if;
  select * into v_a from assets where id = p_asset and org_id = current_org_id() for update;
  if v_a.id is null then raise exception 'asset not found' using errcode='P0002'; end if;
  select * into v_row from asset_assignments where asset_id = v_a.id and returned_at is null for update;
  if v_row.id is null then raise exception 'this asset is not issued to anyone' using errcode='P0001'; end if;

  update asset_assignments set returned_at = now(), returned_to = v_me, condition_in = p_condition,
    return_note = nullif(trim(p_note), '') where id = v_row.id returning * into v_row;

  v_status := case p_condition when 'LOST' then 'LOST' when 'DAMAGED' then 'IN_REPAIR' else 'IN_STOCK' end;
  perform set_config('app.asset_rpc', 'on', true);
  update assets set status = v_status, current_holder_id = null, issued_at = null,
    condition = case when p_condition = 'LOST' then condition else p_condition end where id = v_a.id;
  perform set_config('app.asset_rpc', 'off', true);

  if p_condition = 'DAMAGED' then
    insert into asset_maintenance(org_id, asset_id, kind, description, reported_by)
    values (v_a.org_id, v_a.id, 'REPAIR', 'Returned damaged: ' || trim(p_note), v_me);
  end if;

  -- Tick the matching exit clearance item, if there is one.
  update exit_clearance_items set completed_at = now(), completed_by = v_me,
    notes = coalesce(notes || E'\n', '') || 'Returned ' || lower(p_condition) || ' on ' || to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY')
  where employee_id = v_row.employee_id and asset_id = v_a.id and completed_at is null;

  perform _audit(v_a.org_id, 'asset.returned', 'asset', v_a.id::text,
    jsonb_build_object('employee_id', v_row.employee_id, 'condition', p_condition, 'assignment_id', v_row.id));
  return v_row;
end $$;

-- The holder confirms they received the item.
create or replace function asset_acknowledge(p_assignment uuid)
returns asset_assignments language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row asset_assignments;
begin
  select * into v_row from asset_assignments where id = p_assignment and org_id = current_org_id() for update;
  if v_row.id is null then raise exception 'not found' using errcode='P0002'; end if;
  if v_row.employee_id <> current_employee_id() then raise exception 'only the person holding it can confirm receipt' using errcode='42501'; end if;
  if v_row.returned_at is not null then raise exception 'this item has already been returned' using errcode='P0001'; end if;
  if v_row.acknowledged_at is null then
    update asset_assignments set acknowledged_at = now() where id = v_row.id returning * into v_row;
    perform _audit(v_row.org_id, 'asset.acknowledged', 'asset', v_row.asset_id::text, jsonb_build_object('assignment_id', v_row.id));
  end if;
  return v_row;
end $$;

-- Anyone holding an asset (or an asset manager) can report a problem with it.
create or replace function asset_report_issue(p_asset uuid, p_description text)
returns asset_maintenance language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a assets; v_row asset_maintenance; v_me uuid := current_employee_id(); r record;
begin
  select * into v_a from assets where id = p_asset and org_id = current_org_id();
  if v_a.id is null then raise exception 'asset not found' using errcode='P0002'; end if;
  if not (v_a.current_holder_id = v_me or has_perm('assets.manage')) then
    raise exception 'you can only report problems with kit you hold' using errcode='42501';
  end if;
  if coalesce(length(trim(p_description)), 0) < 3 then raise exception 'describe the problem' using errcode='P0001'; end if;
  if (select count(*) from asset_maintenance where reported_by = v_me and opened_at > now() - interval '1 hour') >= 10 then
    raise exception 'too many reports in the last hour' using errcode='P0001';
  end if;
  insert into asset_maintenance(org_id, asset_id, kind, description, reported_by)
  values (v_a.org_id, v_a.id, 'ISSUE', left(trim(p_description), 2000), v_me) returning * into v_row;
  for r in
    select e.id from employees e
    where e.org_id = v_a.org_id and e.status <> 'EXITED' and e.id <> v_me and employee_has_perm(e.id, 'assets.manage')
    limit 20
  loop
    perform notify(v_a.org_id, r.id, 'SYSTEM', 'Problem reported: ' || v_a.name || ' (' || v_a.asset_tag || ')',
      left(trim(p_description), 140), '/assets/' || v_a.id, 'asset.issue_report:' || v_row.id);
  end loop;
  return v_row;
end $$;

-- Move a maintenance ticket along. Sending kit for repair parks it as IN_REPAIR; closing it puts it back.
create or replace function asset_maintenance_update(p_id uuid, p_status text, p_resolution text default null,
                                                    p_cost numeric default null, p_vendor text default null, p_next_due date default null)
returns asset_maintenance language plpgsql security definer set search_path = public, pg_temp as $$
declare v_m asset_maintenance; v_a assets; v_me uuid := current_employee_id(); v_open int;
begin
  if not has_perm('assets.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_status not in ('OPEN','IN_PROGRESS','DONE','CANCELLED') then raise exception 'unknown status' using errcode='P0001'; end if;
  select * into v_m from asset_maintenance where id = p_id and org_id = current_org_id() for update;
  if v_m.id is null then raise exception 'not found' using errcode='P0002'; end if;
  if v_m.status in ('DONE','CANCELLED') then raise exception 'this ticket is already closed' using errcode='P0001'; end if;
  if p_cost is not null and p_cost < 0 then raise exception 'cost cannot be negative' using errcode='P0001'; end if;

  update asset_maintenance set status = p_status,
    resolution = coalesce(nullif(trim(p_resolution), ''), resolution),
    cost = coalesce(p_cost, cost), vendor = coalesce(nullif(trim(p_vendor), ''), vendor),
    next_due = coalesce(p_next_due, next_due),
    closed_at = case when p_status in ('DONE','CANCELLED') then now() end,
    closed_by = case when p_status in ('DONE','CANCELLED') then v_me end
  where id = v_m.id returning * into v_m;

  select * into v_a from assets where id = v_m.asset_id for update;
  perform set_config('app.asset_rpc', 'on', true);
  if p_status = 'IN_PROGRESS' and v_a.status = 'IN_STOCK' then
    update assets set status = 'IN_REPAIR' where id = v_a.id;
  elsif p_status in ('DONE','CANCELLED') and v_a.status = 'IN_REPAIR' then
    select count(*) into v_open from asset_maintenance where asset_id = v_a.id and status in ('OPEN','IN_PROGRESS');
    if v_open = 0 then
      update assets set status = case when current_holder_id is not null then 'ISSUED' else 'IN_STOCK' end,
        condition = case when p_status = 'DONE' and condition = 'DAMAGED' then 'GOOD' else condition end
      where id = v_a.id;
    end if;
  end if;
  perform set_config('app.asset_rpc', 'off', true);
  return v_m;
end $$;

-- What an employee holds (safe columns only; used by My assets and the profile).
create or replace function my_assets(p_employee uuid default null)
returns table (assignment_id uuid, asset_id uuid, asset_tag text, name text, category text, brand text, model text,
               serial_no text, condition text, issued_at timestamptz, expected_return date, acknowledged_at timestamptz,
               open_issues int)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, a.id, a.asset_tag, a.name, a.category, a.brand, a.model, a.serial_no, a.condition,
         s.issued_at, s.expected_return, s.acknowledged_at,
         (select count(*)::int from asset_maintenance m where m.asset_id = a.id and m.status in ('OPEN','IN_PROGRESS'))
  from asset_assignments s join assets a on a.id = s.asset_id
  where s.returned_at is null and s.org_id = current_org_id()
    and s.employee_id = coalesce(p_employee, current_employee_id())
    and (coalesce(p_employee, current_employee_id()) = current_employee_id() or can_see_asset(coalesce(p_employee, current_employee_id())))
  order by s.issued_at desc
$$;

-- ---------------------------------------------------------------------------
-- Exit integration
-- ---------------------------------------------------------------------------
create or replace function asset_exit_items(p_employee uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  insert into exit_clearance_items(org_id, employee_id, category, title, asset_id)
  select a.org_id, a.current_holder_id, 'IT', left('Return ' || a.name || ' (' || a.asset_tag || ')', 160), a.id
  from assets a where a.current_holder_id = p_employee and a.status in ('ISSUED','IN_REPAIR')
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function asset_exit_items(uuid) from public, anon, authenticated;

create or replace function employees_asset_exit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_held int;
begin
  if new.status is distinct from old.status then
    if new.status = 'NOTICE' then perform asset_exit_items(new.id); end if;
    if new.status = 'EXITED' then
      select count(*) into v_held from assets where current_holder_id = new.id;
      if v_held > 0 then
        raise exception '% still holds % asset(s). Take them back (or mark them lost) under Assets first.', new.full_name, v_held
          using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists employees_asset_exit on employees;
create trigger employees_asset_exit before update of status on employees for each row execute function employees_asset_exit();

-- Exit items created when HR adds exit clearance manually also pick up held kit.
create or replace function exit_clearance_pull_assets() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.asset_id is null and pg_trigger_depth() = 1 then perform asset_exit_items(new.employee_id); end if;
  return null;
end $$;
drop trigger if exists exit_clearance_pull_assets on exit_clearance_items;
create trigger exit_clearance_pull_assets after insert on exit_clearance_items for each row execute function exit_clearance_pull_assets();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant select, insert, update on assets, asset_financials to authenticated;
grant select on asset_assignments to authenticated;
grant select, insert on asset_maintenance to authenticated;
revoke all on function asset_issue(uuid, uuid, text, date, text) from public, anon;
revoke all on function asset_return(uuid, text, text) from public, anon;
revoke all on function asset_acknowledge(uuid) from public, anon;
revoke all on function asset_report_issue(uuid, text) from public, anon;
revoke all on function asset_maintenance_update(uuid, text, text, numeric, text, date) from public, anon;
revoke all on function my_assets(uuid) from public, anon;
grant execute on function asset_issue(uuid, uuid, text, date, text), asset_return(uuid, text, text),
  asset_acknowledge(uuid), asset_report_issue(uuid, text),
  asset_maintenance_update(uuid, text, text, numeric, text, date), my_assets(uuid) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table assets; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table asset_assignments; exception when duplicate_object then null; end;
  end if;
end $$;
