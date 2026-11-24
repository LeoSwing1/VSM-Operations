-- =============================================================================
-- 0033 · Block 26 — AI assistant (Claude API). Settings + budget caps + usage metering.
-- Prompts and answers are NOT stored; only token counts per request. The assistant reads data through the
-- signed-in user's own session, so it can never see more than that person can already see.
-- =============================================================================
create table if not exists ai_settings (
  org_id uuid primary key references organizations(id) on delete cascade,
  enabled boolean not null default false,
  model text not null default 'claude-sonnet-5-5' check (model ~ '^claude-[a-z0-9.-]{3,60}$'),
  monthly_token_budget int not null default 3000000 check (monthly_token_budget between 10000 and 500000000),
  per_user_daily_requests int not null default 40 check (per_user_daily_requests between 1 and 1000),
  default_language text not null default 'HINGLISH' check (default_language in ('HINGLISH','ENGLISH','HINDI')),
  updated_at timestamptz not null default now()
);
insert into ai_settings(org_id) select id from organizations on conflict do nothing;
alter table ai_settings enable row level security;
drop policy if exists ai_settings_read on ai_settings;
create policy ai_settings_read on ai_settings for select to authenticated using (org_id = current_org_id());
drop policy if exists ai_settings_write on ai_settings;
create policy ai_settings_write on ai_settings for update to authenticated
  using (org_id = current_org_id() and has_perm('settings.manage')) with check (org_id = current_org_id() and has_perm('settings.manage'));
revoke insert, delete on ai_settings from authenticated;

create table if not exists ai_usage (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  feature text not null check (feature in ('ASK','DAILY_SUMMARY','CLIENT_REPORT','DRAFT')),
  model text not null,
  input_tokens int not null default 0 check (input_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  tool_calls int not null default 0,
  ok boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_org_time on ai_usage(org_id, created_at);
alter table ai_usage enable row level security;
drop policy if exists ai_usage_read on ai_usage;
create policy ai_usage_read on ai_usage for select to authenticated
  using (org_id = current_org_id() and (employee_id = current_employee_id() or has_perm('settings.manage')));
revoke insert, update, delete on ai_usage from authenticated;

-- Can the signed-in employee make one more AI request right now?
create or replace function ai_quota() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s ai_settings; v_emp uuid := current_employee_id(); v_month bigint; v_today int; v_reason text;
begin
  if v_emp is null then raise exception 'Not signed in.' using errcode = '42501'; end if;
  select * into s from ai_settings where org_id = current_org_id();
  select coalesce(sum(input_tokens + output_tokens), 0) into v_month from ai_usage
   where org_id = current_org_id() and created_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  select count(*) into v_today from ai_usage where employee_id = v_emp
   and created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_reason := case
    when s.org_id is null or not s.enabled then 'The AI assistant is switched off. An admin can turn it on in Settings → AI assistant.'
    when not has_perm('ai.use') then 'Your role doesn''t include the AI assistant.'
    when v_month >= s.monthly_token_budget then 'This month''s AI budget is used up. An admin can raise it in Settings → AI assistant.'
    when v_today >= s.per_user_daily_requests then 'You''ve reached today''s AI request limit. It resets at midnight.'
  end;
  return jsonb_build_object('allowed', v_reason is null, 'reason', v_reason, 'model', s.model, 'language', s.default_language,
    'month_tokens', v_month, 'month_budget', s.monthly_token_budget, 'today', v_today, 'daily_limit', s.per_user_daily_requests);
end $$;

create or replace function ai_record_usage(p_feature text, p_model text, p_in int, p_out int, p_tools int, p_ok boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if current_employee_id() is null then raise exception 'Not signed in.' using errcode = '42501'; end if;
  insert into ai_usage(org_id, employee_id, feature, model, input_tokens, output_tokens, tool_calls, ok)
  values (current_org_id(), current_employee_id(), p_feature, left(p_model, 80), greatest(0, coalesce(p_in, 0)),
          greatest(0, coalesce(p_out, 0)), greatest(0, coalesce(p_tools, 0)), coalesce(p_ok, true));
end $$;
revoke all on function ai_quota(), ai_record_usage(text, text, int, int, int, boolean) from public, anon;
grant execute on function ai_quota(), ai_record_usage(text, text, int, int, int, boolean) to authenticated;

-- Everyone may use it once an admin switches it on (it only sees what they can see). Interns excluded by default.
insert into role_permissions(org_id, role, permission)
select o.id, r.role::app_role, 'ai.use' from organizations o
cross join (values ('ADMIN'),('HR_MANAGER'),('OPERATIONS_MANAGER'),('DEPARTMENT_MANAGER'),('TEAM_LEAD'),('SALES_EXECUTIVE'),
                   ('PROJECT_MANAGER'),('EMPLOYEE')) r(role)
on conflict do nothing;

create or replace function seed_ai_on_sa() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.role = 'SUPER_ADMIN' then
    insert into ai_settings(org_id) values (new.org_id) on conflict do nothing;
    insert into role_permissions(org_id, role, permission)
    select new.org_id, r.role::app_role, 'ai.use' from (values ('ADMIN'),('HR_MANAGER'),('OPERATIONS_MANAGER'),('DEPARTMENT_MANAGER'),
      ('TEAM_LEAD'),('SALES_EXECUTIVE'),('PROJECT_MANAGER'),('EMPLOYEE')) r(role) on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists employees_seed_u_ai on employees;
create trigger employees_seed_u_ai after insert on employees for each row execute function seed_ai_on_sa();
