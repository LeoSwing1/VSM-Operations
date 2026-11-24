-- =============================================================================
-- 0037 · Make sure the employee → manager / department / shift links exist on every database, then ask the
-- Supabase API (PostgREST) to reload its schema cache so the app can use them straight away.
-- Safe to run any number of times.
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
                 where c.conrelid = 'public.employees'::regclass and c.contype = 'f' and a.attname = 'manager_id') then
    update employees e set manager_id = null where manager_id is not null and not exists (select 1 from employees m where m.id = e.manager_id);
    alter table employees add constraint employees_manager_id_fkey foreign key (manager_id) references employees(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
                 where c.conrelid = 'public.employees'::regclass and c.contype = 'f' and a.attname = 'department_id') then
    update employees e set department_id = null where department_id is not null and not exists (select 1 from departments d where d.id = e.department_id);
    alter table employees add constraint employees_department_id_fkey foreign key (department_id) references departments(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
                 where c.conrelid = 'public.employees'::regclass and c.contype = 'f' and a.attname = 'shift_id') then
    update employees e set shift_id = null where shift_id is not null and not exists (select 1 from shifts s where s.id = e.shift_id);
    alter table employees add constraint employees_shift_id_fkey foreign key (shift_id) references shifts(id) on delete set null;
  end if;
end $$;

notify pgrst, 'reload schema';
