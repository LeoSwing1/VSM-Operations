-- =============================================================================
-- 0026 — Employee activity timeline (profile → Activity) and a compact "who am I" for the profile menu.
-- Visible to: the employee themself, their managers (team), HR (people.manage) and auditors (audit.view).
-- Shows WHAT happened and WHEN — never audit metadata (it can hold personal or salary fields).
-- =============================================================================
create or replace function employee_activity(p_emp uuid, p_limit int default 60)
returns table(at timestamptz, kind text, title text, detail text, actor text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from employees where id = p_emp and org_id = current_org_id()) then return; end if;
  if not (p_emp = current_employee_id() or has_perm('audit.view') or has_perm('people.manage') or is_in_my_team(p_emp)) then
    raise exception 'You can''t view this person''s activity.' using errcode = '42501';
  end if;
  return query
  select * from (
    select a.created_at, 'AUDIT'::text, initcap(replace(replace(a.action, '.', ' · '), '_', ' ')),
           a.entity || coalesce(' ' || left(a.entity_id, 8), ''), coalesce(x.full_name, 'System')
      from audit_events a left join employees x on x.id = a.actor_employee_id
     where a.org_id = current_org_id() and (a.actor_employee_id = p_emp or (a.entity = 'employee' and a.entity_id = p_emp::text))
    union all
    select e.occurred_at, 'ATTENDANCE', initcap(replace(e.event_type::text, '_', ' ')), e.source, null
      from attendance_events e where e.employee_id = p_emp and e.occurred_at > now() - interval '45 days'
    union all
    select t.completed_at, 'TASK', 'Completed task', t.title, null
      from tasks t where t.assignee_id = p_emp and t.completed_at is not null
    union all
    select l.created_at, 'LEAVE', 'Leave ' || lower(l.status::text), lt.name || ' · ' || l.start_date || ' → ' || l.end_date, null
      from leave_requests l join leave_types lt on lt.id = l.leave_type_id where l.employee_id = p_emp
  ) feed
  order by 1 desc
  limit least(greatest(p_limit, 1), 200);
end $$;
grant execute on function employee_activity(uuid, int) to authenticated;

-- Live sync for the Operations Center CRM tile.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leads') then
    alter publication supabase_realtime add table public.leads;
  end if;
end $$;
