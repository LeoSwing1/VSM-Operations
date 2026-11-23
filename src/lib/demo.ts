import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { temporaryPassword } from "@/lib/passwords";

/**
 * Demo workspace: 5 clearly-flagged demo employees with real logins (random passwords, shown once),
 * placed into the company posts → teams → chat groups, plus a little live activity so every screen has data.
 * Never touches real employees. Removable in one click.
 */
export const DEMO_PEOPLE = [
  { key: "hr", full_name: "Riya Kapoor", designation: "HR Manager", role: "HR_MANAGER" },
  { key: "seo1", full_name: "Arjun Mehta", designation: "SEO Executive", role: "EMPLOYEE" },
  { key: "seo2", full_name: "Neha Verma", designation: "SEO Executive", role: "EMPLOYEE" },
  { key: "edit", full_name: "Kabir Singh", designation: "Video Editor", role: "EMPLOYEE" },
  { key: "dev", full_name: "Ishaan Gupta", designation: "Web Developer", role: "EMPLOYEE" },
] as const;

const TASKS: Record<string, [string, "LOW" | "MEDIUM" | "HIGH" | "URGENT", number][]> = {
  seo1: [
    ["On-page SEO for Khanna Opticians — 5 product pages", "HIGH", 1],
    ["Weekly ranking report — ASR Fixit", "MEDIUM", -1],
  ],
  seo2: [
    ["Google Business Profile posts — Dough & Pan", "MEDIUM", 2],
    ["Technical audit — Taruvan.in", "HIGH", 3],
  ],
  edit: [
    ["Edit 3 reels — Pushpdeep Collection", "HIGH", 1],
    ["Thumbnail set — Millennium Kids vlog", "LOW", 4],
  ],
  dev: [
    ["Fix mobile header — Sight Care Centre", "URGENT", 0],
    ["Speed optimisation — Vertex Polymers", "MEDIUM", 5],
  ],
  hr: [["Onboarding checklist for new SEO intern", "MEDIUM", 2]],
};

export type DemoCredential = { name: string; post: string; email: string; password: string; code: string };

export function demoDomain(env: Record<string, string | undefined> = process.env) {
  const d = (env.DEMO_EMAIL_DOMAIN ?? "demo.vsmgrowth.com").toLowerCase().trim();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : "demo.vsmgrowth.com";
}

export async function createDemoWorkspace(orgId: string, superAdminId: string): Promise<DemoCredential[]> {
  const sb = supabaseAdmin();
  await sb.rpc("seed_vsm_structure", { p_org: orgId });
  const { data: shift } = await sb.from("shifts").select("id").eq("org_id", orgId).order("created_at").limit(1).maybeSingle();
  const domain = demoDomain();
  const creds: DemoCredential[] = [];
  const ids: Record<string, string> = {};

  for (const p of DEMO_PEOPLE) {
    const email = `${p.full_name.toLowerCase().replace(/[^a-z]+/g, ".")}@${domain}`;
    const password = temporaryPassword();
    const { data: existing } = await sb
      .from("employees")
      .select("id, user_id, employee_code")
      .eq("org_id", orgId)
      .eq("official_email", email)
      .maybeSingle();
    let userId = existing?.user_id ?? null;
    if (userId) {
      const { error } = await sb.auth.admin.updateUserById(userId, { password });
      if (error) throw new Error(`${p.full_name}: ${error.message}`);
    } else {
      const { data, error } = await sb.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: p.full_name, demo: true },
      });
      if (error || !data.user) throw new Error(`${p.full_name}: ${error?.message ?? "could not create login"}`);
      userId = data.user.id;
    }
    let empId = existing?.id,
      code = existing?.employee_code ?? "";
    if (!empId) {
      const { data, error } = await sb
        .from("employees")
        .insert({
          org_id: orgId,
          user_id: userId,
          full_name: p.full_name,
          official_email: email,
          role: p.role,
          designation: p.designation,
          manager_id: superAdminId,
          shift_id: shift?.id ?? null,
          is_demo: true,
          work_location: "Meerut",
          status: "ACTIVE",
        })
        .select("id, employee_code")
        .single();
      if (error) throw new Error(`${p.full_name}: ${error.message}`);
      empId = data.id;
      code = data.employee_code;
    } else {
      await sb.from("employees").update({ user_id: userId, status: "ACTIVE" }).eq("id", empId);
    }
    ids[p.key] = empId!;
    creds.push({ name: p.full_name, post: p.designation, email, password, code });
  }

  // Demo activity (only for demo people): tasks with deadlines, and three of them clocked in today.
  const day = 86400_000;
  const tasks = Object.entries(TASKS).flatMap(([k, list]) =>
    list.map(([title, priority, d]) => ({
      org_id: orgId,
      title,
      priority,
      assignee_id: ids[k],
      assigned_by: superAdminId,
      deadline: new Date(Date.now() + d * day + 6 * 3600_000).toISOString(),
      status: d < 0 ? "IN_PROGRESS" : "TODO",
    })),
  );
  const { data: old } = await sb.from("tasks").select("id").in("assignee_id", Object.values(ids));
  if (!old?.length) await sb.from("tasks").insert(tasks);
  const now = Date.now();
  const punches = [
    { employee_id: ids.seo1, event_type: "CLOCK_IN", occurred_at: new Date(now - 3.2 * 3600_000).toISOString() },
    { employee_id: ids.edit, event_type: "CLOCK_IN", occurred_at: new Date(now - 2.5 * 3600_000).toISOString() },
    { employee_id: ids.edit, event_type: "BREAK_START", occurred_at: new Date(now - 0.3 * 3600_000).toISOString() },
    { employee_id: ids.dev, event_type: "CLOCK_IN", occurred_at: new Date(now - 1.1 * 3600_000).toISOString() },
  ].map((x) => ({ ...x, org_id: orgId, source: "ADMIN", created_by: superAdminId }));
  const { count } = await sb
    .from("attendance_events")
    .select("id", { count: "exact", head: true })
    .in("employee_id", Object.values(ids))
    .gte("occurred_at", new Date(now - 12 * 3600_000).toISOString());
  if (!count) await sb.from("attendance_events").insert(punches);
  return creds;
}

export async function removeDemoWorkspace(orgId: string): Promise<{ removed: number; archived: number }> {
  const sb = supabaseAdmin();
  const { data: demo } = await sb.from("employees").select("id, user_id").eq("org_id", orgId).eq("is_demo", true);
  let removed = 0,
    archived = 0;
  for (const d of demo ?? []) {
    await sb.from("tasks").delete().eq("assignee_id", d.id);
    const { error } = await sb.from("employees").delete().eq("id", d.id);
    if (error) {
      // Referenced elsewhere (e.g. chat history): keep the record but switch it off.
      await sb
        .from("employees")
        .update({ status: "EXITED", exit_date: new Date().toISOString().slice(0, 10), user_id: null })
        .eq("id", d.id);
      archived++;
    } else removed++;
    if (d.user_id) await sb.auth.admin.deleteUser(d.user_id);
  }
  return { removed, archived };
}
