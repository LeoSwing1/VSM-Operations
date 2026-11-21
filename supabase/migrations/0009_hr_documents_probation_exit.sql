-- =============================================================================
-- 0009 HR completion: private employee documents, probation reviews, exit clearance
-- =============================================================================
create table employee_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  category text not null check (category in ('IDENTITY','EDUCATION','EMPLOYMENT','TAX','BANK','POLICY','OTHER')),
  title text not null check (length(trim(title)) between 2 and 160),
  storage_path text not null unique,
  original_name text not null check (length(original_name) between 1 and 255),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  expires_on date,
  uploaded_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  check (storage_path like org_id::text || '/' || employee_id::text || '/%')
);
create index employee_documents_employee_idx on employee_documents(org_id, employee_id, created_at desc);

create table probation_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  reviewer_id uuid references employees(id) on delete set null,
  due_date date not null,
  reviewed_on date,
  status text not null default 'DRAFT' check (status in ('DRAFT','SUBMITTED','APPROVED','CANCELLED')),
  recommendation text check (recommendation in ('CONFIRM','EXTEND','EXIT')),
  ratings jsonb not null default '{}' check (jsonb_typeof(ratings)='object'),
  comments text,
  next_review_date date,
  approved_by uuid references employees(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (next_review_date is null or next_review_date > due_date),
  check ((status <> 'APPROVED') or (recommendation is not null and approved_at is not null))
);
create index probation_reviews_employee_idx on probation_reviews(org_id, employee_id, due_date desc);

create table exit_clearance_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  category text not null check (category in ('MANAGER','IT','FINANCE','HR','ADMIN','OTHER')),
  title text not null check (length(trim(title)) between 2 and 160),
  owner_id uuid references employees(id) on delete set null,
  due_date date,
  completed_at timestamptz,
  completed_by uuid references employees(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  check ((completed_at is null) = (completed_by is null))
);
create index exit_clearance_employee_idx on exit_clearance_items(org_id, employee_id, completed_at);

create or replace function hr_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger probation_reviews_touch before update on probation_reviews for each row execute function hr_updated_at();

-- Private bucket. Never expose employee documents through public URLs.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('employee-private','employee-private',false,10485760,
  array['application/pdf','image/jpeg','image/png','image/webp','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public=false, file_size_limit=10485760,
  allowed_mime_types=excluded.allowed_mime_types;

alter table employee_documents enable row level security;
alter table probation_reviews enable row level security;
alter table exit_clearance_items enable row level security;

create policy employee_documents_read on employee_documents for select to authenticated
using (org_id=current_org_id() and (employee_id=current_employee_id() or has_perm('people.manage') or (has_perm('people.view_team') and is_in_my_team(employee_id))));
create policy employee_documents_insert on employee_documents for insert to authenticated
with check (org_id=current_org_id() and has_perm('people.manage') and uploaded_by=current_employee_id());
create policy employee_documents_delete on employee_documents for delete to authenticated
using (org_id=current_org_id() and has_perm('people.manage'));

create policy probation_reviews_read on probation_reviews for select to authenticated
using (org_id=current_org_id() and (employee_id=current_employee_id() or has_perm('people.manage') or (has_perm('people.view_team') and is_in_my_team(employee_id))));
create policy probation_reviews_insert on probation_reviews for insert to authenticated
with check (org_id=current_org_id() and has_perm('people.manage') and reviewer_id=current_employee_id());
create policy probation_reviews_update on probation_reviews for update to authenticated
using (org_id=current_org_id() and has_perm('people.manage'))
with check (org_id=current_org_id() and has_perm('people.manage'));
create policy probation_reviews_delete on probation_reviews for delete to authenticated
using (org_id=current_org_id() and has_perm('people.manage') and status='DRAFT');

create policy exit_clearance_read on exit_clearance_items for select to authenticated
using (org_id=current_org_id() and (employee_id=current_employee_id() or has_perm('people.manage') or (has_perm('people.view_team') and is_in_my_team(employee_id))));
create policy exit_clearance_insert on exit_clearance_items for insert to authenticated
with check (org_id=current_org_id() and has_perm('people.manage'));
create policy exit_clearance_update on exit_clearance_items for update to authenticated
using (org_id=current_org_id() and has_perm('people.manage'))
with check (org_id=current_org_id() and has_perm('people.manage'));
create policy exit_clearance_delete on exit_clearance_items for delete to authenticated
using (org_id=current_org_id() and has_perm('people.manage') and completed_at is null);

-- Storage paths are org_id/employee_id/document_id-filename. The bucket is private.
create policy employee_private_read on storage.objects for select to authenticated
using (bucket_id='employee-private' and (storage.foldername(name))[1]=current_org_id()::text and exists (
  select 1 from employees e where e.id::text=(storage.foldername(name))[2] and e.org_id=current_org_id()
  and (e.id=current_employee_id() or has_perm('people.manage') or (has_perm('people.view_team') and is_in_my_team(e.id)))
));
create policy employee_private_insert on storage.objects for insert to authenticated
with check (bucket_id='employee-private' and (storage.foldername(name))[1]=current_org_id()::text and has_perm('people.manage') and exists (
  select 1 from employees e where e.id::text=(storage.foldername(name))[2] and e.org_id=current_org_id()
));
create policy employee_private_delete on storage.objects for delete to authenticated
using (bucket_id='employee-private' and (storage.foldername(name))[1]=current_org_id()::text and has_perm('people.manage'));

-- Record auditable HR events for probation approvals and exit checklist completion.
create or replace function audit_hr_record() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into audit_events(org_id,actor_employee_id,actor_user_id,action,entity,entity_id,metadata)
  values (coalesce(new.org_id,old.org_id),current_employee_id(),auth.uid(),
    lower(tg_table_name)||'.'||lower(tg_op),tg_table_name,coalesce(new.id,old.id)::text,
    jsonb_build_object('employee_id',coalesce(new.employee_id,old.employee_id)));
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger probation_reviews_audit after insert or update or delete on probation_reviews for each row execute function audit_hr_record();
create trigger exit_clearance_audit after insert or update or delete on exit_clearance_items for each row execute function audit_hr_record();
create trigger employee_documents_audit after insert or delete on employee_documents for each row execute function audit_hr_record();

-- Issue controlled employment letters from an immutable employee-data snapshot.
create table employee_letters (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  letter_type text not null check (letter_type in ('OFFER','APPOINTMENT','EXPERIENCE','RELIEVING')),
  reference_no text not null,
  issued_on date not null default current_date,
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object'),
  status text not null default 'ISSUED' check (status in ('ISSUED','REVOKED')),
  issued_by uuid references employees(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(org_id, reference_no),
  check ((status='REVOKED') = (revoked_at is not null))
);
create index employee_letters_employee_idx on employee_letters(org_id, employee_id, issued_on desc);
alter table employee_letters enable row level security;
create policy employee_letters_read on employee_letters for select to authenticated
using (org_id=current_org_id() and (employee_id=current_employee_id() or has_perm('people.manage')));
create policy employee_letters_insert on employee_letters for insert to authenticated
with check (org_id=current_org_id() and has_perm('people.manage') and issued_by=current_employee_id() and status='ISSUED');
create policy employee_letters_update on employee_letters for update to authenticated
using (org_id=current_org_id() and has_perm('people.manage'))
with check (org_id=current_org_id() and has_perm('people.manage'));
create trigger employee_letters_audit after insert or update on employee_letters for each row execute function audit_hr_record();

-- State transitions are RPC-only so callers cannot forge a probation approval
-- or update the employee status outside the same database transaction.
create or replace function submit_probation_review(p_review_id uuid, p_comments text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r probation_reviews;
begin
  if not has_perm('people.manage') then raise exception 'people.manage required' using errcode='42501'; end if;
  select * into r from probation_reviews where id=p_review_id and org_id=current_org_id() for update;
  if not found or r.status<>'DRAFT' then raise exception 'review is missing or not in draft' using errcode='P0001'; end if;
  update probation_reviews set status='SUBMITTED', reviewed_on=current_date, comments=left(p_comments,4000)
  where id=p_review_id and org_id=current_org_id();
end $$;

create or replace function decide_probation_review(p_review_id uuid, p_recommendation text, p_comments text default null, p_next_review_date date default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r probation_reviews; emp_status employment_status;
begin
  if not has_perm('people.manage') then raise exception 'people.manage required' using errcode='42501'; end if;
  if p_recommendation is null or p_recommendation not in ('CONFIRM','EXTEND','EXIT') then raise exception 'invalid recommendation'; end if;
  select * into r from probation_reviews where id=p_review_id and org_id=current_org_id() for update;
  if not found or r.status<>'SUBMITTED' then raise exception 'review is missing or not submitted' using errcode='P0001'; end if;
  select status into emp_status from employees where id=r.employee_id and org_id=current_org_id() for update;
  if emp_status is distinct from 'PROBATION'::employment_status then raise exception 'employee is not currently on probation' using errcode='P0001'; end if;
  if p_recommendation='EXTEND' and (p_next_review_date is null or p_next_review_date<=r.due_date) then
    raise exception 'extension requires a next review date after the current due date';
  end if;
  update probation_reviews set status='APPROVED', recommendation=p_recommendation,
    comments=left(p_comments,4000), reviewed_on=current_date,
    next_review_date=case when p_recommendation='EXTEND' then p_next_review_date else null end,
    approved_by=current_employee_id(), approved_at=now()
  where id=p_review_id and org_id=current_org_id();
  if p_recommendation='CONFIRM' then
    update employees set status='ACTIVE' where id=r.employee_id and org_id=current_org_id() and status='PROBATION';
  elsif p_recommendation='EXIT' then
    update employees set status='NOTICE' where id=r.employee_id and org_id=current_org_id() and status='PROBATION';
  end if;
end $$;

create or replace function revoke_employee_letter(p_letter_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not has_perm('people.manage') then raise exception 'people.manage required' using errcode='42501'; end if;
  update employee_letters set status='REVOKED', revoked_at=now(), revoked_by=current_employee_id()
  where id=p_letter_id and org_id=current_org_id() and status='ISSUED';
  if not found then raise exception 'issued letter not found' using errcode='P0001'; end if;
end $$;

revoke all on function submit_probation_review(uuid,text), decide_probation_review(uuid,text,text,date), revoke_employee_letter(uuid) from public, anon;
grant execute on function submit_probation_review(uuid,text), decide_probation_review(uuid,text,text,date), revoke_employee_letter(uuid) to authenticated;
revoke update, delete on probation_reviews from authenticated;
revoke update on employee_letters from authenticated;

-- Enforce organization boundaries on every employee/reviewer/actor foreign key.
create or replace function guard_hr_org_refs() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from employees e where e.id=new.employee_id and e.org_id=new.org_id) then
    raise exception 'employee must belong to the same organization' using errcode='23514';
  end if;
  if tg_table_name='employee_documents' and new.uploaded_by is not null and not exists (select 1 from employees e where e.id=new.uploaded_by and e.org_id=new.org_id) then
    raise exception 'uploader must belong to the same organization' using errcode='23514';
  end if;
  if tg_table_name='probation_reviews' then
    if new.reviewer_id is not null and not exists (select 1 from employees e where e.id=new.reviewer_id and e.org_id=new.org_id) then raise exception 'reviewer must belong to the same organization' using errcode='23514'; end if;
    if new.approved_by is not null and not exists (select 1 from employees e where e.id=new.approved_by and e.org_id=new.org_id) then raise exception 'approver must belong to the same organization' using errcode='23514'; end if;
  end if;
  if tg_table_name='exit_clearance_items' then
    if new.owner_id is not null and not exists (select 1 from employees e where e.id=new.owner_id and e.org_id=new.org_id) then raise exception 'clearance owner must belong to the same organization' using errcode='23514'; end if;
    if new.completed_by is not null and not exists (select 1 from employees e where e.id=new.completed_by and e.org_id=new.org_id) then raise exception 'clearance actor must belong to the same organization' using errcode='23514'; end if;
  end if;
  if tg_table_name='employee_letters' then
    if new.issued_by is not null and not exists (select 1 from employees e where e.id=new.issued_by and e.org_id=new.org_id) then raise exception 'issuer must belong to the same organization' using errcode='23514'; end if;
    if new.revoked_by is not null and not exists (select 1 from employees e where e.id=new.revoked_by and e.org_id=new.org_id) then raise exception 'revoker must belong to the same organization' using errcode='23514'; end if;
  end if;
  return new;
end $$;
create trigger employee_documents_org_guard before insert or update on employee_documents for each row execute function guard_hr_org_refs();
create trigger probation_reviews_org_guard before insert or update on probation_reviews for each row execute function guard_hr_org_refs();
create trigger exit_clearance_org_guard before insert or update on exit_clearance_items for each row execute function guard_hr_org_refs();
create trigger employee_letters_org_guard before insert or update on employee_letters for each row execute function guard_hr_org_refs();
