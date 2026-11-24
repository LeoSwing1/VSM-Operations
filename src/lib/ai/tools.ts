import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/lib/auth";
import { localDate } from "@/lib/engines/time";
import { fyQuarter, krProgress } from "@/lib/engines/growth";
import { clip } from "./spec";

/**
 * Executes assistant tools with the SIGNED-IN USER's Supabase client (never the service role),
 * so the database's row-level security limits the model to what this person can already see.
 */
export function makeToolRunner(sb: SupabaseClient, ctx: Ctx) {
  const today = localDate(new Date(), ctx.timezone);
  const people = async () => {
    const { data } = await sb.from("employees").select("id,full_name,designation").neq("status", "EXITED");
    return new Map((data ?? []).map((p) => [p.id as string, p as { id: string; full_name: string; designation: string | null }]));
  };
  const findPerson = async (q: unknown) => {
    if (typeof q !== "string" || !q.trim()) return null;
    const all = await people();
    const needle = q.trim().toLowerCase();
    return [...all.values()].find((p) => p.full_name.toLowerCase().includes(needle)) ?? null;
  };
  const dateArg = (v: unknown, fallback: string) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback);
  const str = (v: unknown, max = 60) =>
    typeof v === "string"
      ? v
          .replace(/[%,()]/g, " ")
          .trim()
          .slice(0, max)
      : "";

  return async function run(name: string, input: Record<string, unknown>): Promise<string> {
    switch (name) {
      case "my_tasks": {
        const { data, error } = await sb
          .from("tasks")
          .select("title,status,priority,deadline,project:projects(name)")
          .eq("assignee_id", ctx.employee_id)
          .not("status", "in", "(COMPLETED,CANCELLED)")
          .order("deadline", { ascending: true, nullsFirst: false })
          .limit(40);
        return clip(error ? { error: "Can't read tasks." } : data);
      }
      case "team_tasks": {
        let q = sb
          .from("tasks")
          .select("title,status,priority,deadline,assignee_id,project:projects(name)")
          .not("status", "in", "(COMPLETED,CANCELLED)")
          .order("deadline", { ascending: true, nullsFirst: false })
          .limit(60);
        if (input.overdue_only) q = q.lt("deadline", new Date().toISOString());
        const who = await findPerson(input.assignee_name);
        if (who) q = q.eq("assignee_id", who.id);
        const [{ data, error }, map] = await Promise.all([q, people()]);
        if (error) return clip({ error: "Can't read tasks." });
        return clip(
          (data ?? []).map((t) => ({ ...t, assignee: map.get(t.assignee_id as string)?.full_name ?? null, assignee_id: undefined })),
        );
      }
      case "attendance_today": {
        const start = new Date(`${today}T00:00:00+05:30`).toISOString();
        const [{ data, error }, map] = await Promise.all([
          sb.from("attendance_events").select("employee_id,event_type,occurred_at,flag").gte("occurred_at", start).order("occurred_at"),
          people(),
        ]);
        if (error) return clip({ error: "Can't read attendance." });
        const last = new Map<string, { event: string; at: string; first_in?: string }>();
        for (const e of data ?? []) {
          const prev = last.get(e.employee_id);
          last.set(e.employee_id, {
            event: e.event_type,
            at: e.occurred_at,
            first_in: prev?.first_in ?? (e.event_type === "CLOCK_IN" ? e.occurred_at : undefined),
          });
        }
        const rows = [...map.values()].map((p) => {
          const l = last.get(p.id);
          const state = !l
            ? "Not clocked in"
            : l.event === "CLOCK_OUT"
              ? "Clocked out"
              : l.event === "BREAK_START"
                ? "On break"
                : "Working";
          return { name: p.full_name, state, first_in: l?.first_in ?? null, last_event_at: l?.at ?? null };
        });
        return clip(rows);
      }
      case "daily_updates": {
        const from = dateArg(input.from, today);
        const to = dateArg(input.to, from);
        let q = sb
          .from("daily_updates")
          .select("employee_id,work_date,completed,in_progress,blockers,tomorrow,minutes_spent")
          .gte("work_date", from)
          .lte("work_date", to)
          .order("work_date")
          .limit(120);
        const who = await findPerson(input.employee_name);
        if (who) q = q.eq("employee_id", who.id);
        const [{ data, error }, map] = await Promise.all([q, people()]);
        if (error) return clip({ error: "Can't read daily updates." });
        return clip(
          (data ?? []).map((u) => ({ ...u, employee: map.get(u.employee_id)?.full_name ?? null, employee_id: undefined })),
          20000,
        );
      }
      case "leads": {
        let q = sb
          .from("leads")
          .select("name,company,service_interest,status,source,priority,next_follow_up_at,assigned_to,created_at")
          .is("duplicate_of", null)
          .order("updated_at", { ascending: false })
          .limit(50);
        if (typeof input.status === "string" && /^[A-Z_]{3,20}$/.test(input.status)) q = q.eq("status", input.status);
        const s = str(input.search);
        if (s) q = q.or(`name.ilike.%${s}%,company.ilike.%${s}%,service_interest.ilike.%${s}%`);
        if (input.follow_up_due) q = q.lte("next_follow_up_at", new Date().toISOString()).not("status", "in", "(WON,LOST)");
        const [{ data, error }, map] = await Promise.all([q, people()]);
        if (error) return clip({ error: "No CRM access." });
        return clip(
          (data ?? []).map((l) => ({ ...l, owner: map.get(l.assigned_to as string)?.full_name ?? null, assigned_to: undefined })),
        );
      }
      case "project_status": {
        const n = str(input.name);
        let q = sb
          .from("projects")
          .select("id,name,status,priority,start_date,deadline,client:clients(name)")
          .limit(n ? 3 : 30);
        q = n ? q.ilike("name", `%${n}%`) : q.in("status", ["PLANNING", "ACTIVE", "ON_HOLD"]);
        const { data: projects, error } = await q;
        if (error) return clip({ error: "Can't read projects." });
        if (!n) return clip(projects);
        const out = [];
        for (const p of projects ?? []) {
          const [{ data: ms }, { data: ups }] = await Promise.all([
            sb.from("project_milestones").select("title,due_date,status,completed_at").eq("project_id", p.id).order("due_date"),
            sb
              .from("project_updates")
              .select("update_type,body,created_at")
              .eq("project_id", p.id)
              .order("created_at", { ascending: false })
              .limit(8),
          ]);
          out.push({ ...p, id: undefined, milestones: ms ?? [], recent_updates: ups ?? [] });
        }
        return clip(out);
      }
      case "leave_calendar": {
        const from = dateArg(input.from, today);
        const to = dateArg(input.to, from);
        const [{ data, error }, map] = await Promise.all([
          sb
            .from("leave_requests")
            .select("employee_id,start_date,end_date,half_day,status,leave_type:leave_types(name)")
            .lte("start_date", to)
            .gte("end_date", from)
            .in("status", ["APPROVED", "PENDING"])
            .order("start_date"),
          people(),
        ]);
        if (error) return clip({ error: "Can't read leave." });
        return clip((data ?? []).map((l) => ({ ...l, employee: map.get(l.employee_id)?.full_name ?? null, employee_id: undefined })));
      }
      case "okrs": {
        const q = fyQuarter(today);
        const { data: objs, error } = await sb
          .from("okr_objectives")
          .select("id,title,level,status,owner_id")
          .lte("period_start", q.end)
          .gte("period_end", q.start);
        if (error) return clip({ error: "Can't read OKRs." });
        const ids = (objs ?? []).map((o) => o.id);
        const [{ data: krs }, map] = await Promise.all([
          ids.length
            ? sb
                .from("okr_key_results")
                .select("objective_id,title,start_value,target_value,current_value,unit,confidence")
                .in("objective_id", ids)
            : Promise.resolve({ data: [] as never[] }),
          people(),
        ]);
        return clip({
          quarter: q.label,
          objectives: (objs ?? []).map((o) => ({
            title: o.title,
            level: o.level,
            status: o.status,
            owner: map.get(o.owner_id)?.full_name ?? null,
            key_results: (krs ?? [])
              .filter((k) => k.objective_id === o.id)
              .map((k) => ({
                title: k.title,
                current: k.current_value,
                target: k.target_value,
                unit: k.unit,
                confidence: k.confidence,
                progress_pct: krProgress(Number(k.start_value), Number(k.target_value), Number(k.current_value)),
              })),
          })),
        });
      }
      case "kpis": {
        const month = typeof input.month === "string" && /^\d{4}-\d{2}-01$/.test(input.month) ? input.month : today.slice(0, 8) + "01";
        let q = sb
          .from("kpi_values")
          .select("employee_id,value,source,verified_at,kpi:kpi_definitions(name,unit,target,direction)")
          .eq("period_month", month)
          .limit(300);
        const who = await findPerson(input.employee_name);
        if (who) q = q.eq("employee_id", who.id);
        const [{ data, error }, map] = await Promise.all([q, people()]);
        if (error) return clip({ error: "Can't read KPIs." });
        return clip({
          month,
          values: (data ?? []).map((v) => ({ ...v, employee: map.get(v.employee_id)?.full_name ?? null, employee_id: undefined })),
        });
      }
      case "scholars_pipeline": {
        const { data, error } = await sb.from("scholar_students").select("stage,next_follow_up_at,full_name").limit(1000);
        if (error || !data) return clip({ error: "No VSM Scholars access." });
        const byStage: Record<string, number> = {};
        for (const s of data) byStage[s.stage] = (byStage[s.stage] ?? 0) + 1;
        const due = data
          .filter(
            (s) =>
              s.next_follow_up_at &&
              s.next_follow_up_at <= new Date(Date.now() + 2 * 864e5).toISOString() &&
              !["ENROLLED", "ALUMNI", "LOST", "DROPPED"].includes(s.stage),
          )
          .slice(0, 25)
          .map((s) => ({ name: s.full_name, stage: s.stage, follow_up: s.next_follow_up_at }));
        return clip({ by_stage: byStage, follow_ups_next_2_days: due });
      }
      case "invoices_outstanding": {
        const { data, error } = await sb
          .from("client_invoices")
          .select("invoice_number,issue_date,due_date,total_amount,status,client:clients(name)")
          .in("status", ["ISSUED", "PARTIALLY_PAID", "OVERDUE"])
          .order("due_date")
          .limit(60);
        if (error) return clip({ error: "No finance access." });
        return clip(data);
      }
      default:
        return clip({ error: `Unknown tool ${name}` });
    }
  };
}
