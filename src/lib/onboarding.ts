import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getProvider } from "@/lib/email/providers";
import { render } from "@/lib/email/templates";
import { temporaryPassword } from "@/lib/passwords";

export type WelcomeMode = "link" | "password";

type ExistingLogin = { user_id: string; employee_id: string | null; employee_name: string | null; is_super_admin: boolean };

/**
 * Find a Supabase login by email. Uses the database helper from migration 0038 when it exists; otherwise
 * (SQL not run yet) falls back to paging through the Auth admin API. Server-only (service role).
 */
async function findLoginByEmail(email: string): Promise<ExistingLogin | null> {
  const admin = supabaseAdmin();
  const want = email.trim().toLowerCase();
  const { data, error } = await admin.rpc("auth_login_for_email", { p_email: want });
  if (!error) return (data as ExistingLogin | null) ?? null;
  let found: string | null = null;
  for (let page = 1; page <= 50 && !found; page++) {
    const { data: list, error: lErr } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (lErr || !list?.users?.length) break;
    found = list.users.find((u) => (u.email ?? "").toLowerCase() === want)?.id ?? null;
    if (list.users.length < 200) break;
  }
  if (!found) return null;
  const { data: emp } = await admin.from("employees").select("id, full_name, role").eq("user_id", found).maybeSingle();
  return {
    user_id: found,
    employee_id: emp?.id ?? null,
    employee_name: emp?.full_name ?? null,
    is_super_admin: emp?.role === "SUPER_ADMIN",
  };
}

/**
 * Creates (if needed) the employee's login and emails a welcome with their details.
 *  - "link": a one-time "set my password" link (recommended)
 *  - "password": a temporary password that must be changed at first sign-in
 * Only call AFTER the caller's permission was checked against the database.
 * Never for the Super Admin (the DB also blocks relinking their login).
 */
export async function sendWelcome(employeeId: string, mode: WelcomeMode): Promise<string> {
  const admin = supabaseAdmin();
  const { data: e, error } = await admin
    .from("employees")
    .select(
      "id, org_id, full_name, official_email, employee_code, designation, joining_date, role, user_id, department:departments!department_id(name), manager:employees!manager_id(full_name)",
    )
    .eq("id", employeeId)
    .single();
  if (error || !e) throw new Error("Employee not found.");
  if (e.role === "SUPER_ADMIN") throw new Error("The Super Admin manages their own login.");
  const { data: team } = await admin.from("org_team_members").select("team:org_teams(name)").eq("employee_id", e.id).limit(1).maybeSingle();
  const redirectTo = `${process.env.APP_URL ?? ""}/auth/callback?next=/login/reset`;
  let link = "",
    password = "";
  let userId = e.user_id as string | null;

  // A login with this email may already exist (an earlier attempt, or a removed employee). Re-use it when it isn't
  // anyone else's; refuse clearly when it belongs to another person.
  if (!userId) {
    const existing = await findLoginByEmail(e.official_email);
    if (existing?.user_id) {
      if (existing.employee_id && existing.employee_id !== e.id) {
        throw new Error(
          existing.is_super_admin
            ? "That email is the Super Admin's login. Use a different email for this employee."
            : `That email is already the login of ${existing.employee_name}. Use a different email, or change theirs first.`,
        );
      }
      const { error: linkErr } = await admin.from("employees").update({ user_id: existing.user_id }).eq("id", e.id);
      if (linkErr) throw new Error("Could not attach the existing login: " + linkErr.message);
      userId = existing.user_id as string;
    }
  }

  if (mode === "password") {
    password = temporaryPassword();
    if (userId) {
      const { error: uErr } = await admin.auth.admin.updateUserById(userId, {
        password,
        user_metadata: { must_change_password: true },
        email_confirm: true,
      });
      if (uErr) throw uErr;
    } else {
      const { data, error: cErr } = await admin.auth.admin.createUser({
        email: e.official_email,
        password,
        email_confirm: true,
        user_metadata: { full_name: e.full_name, must_change_password: true },
      });
      if (cErr || !data.user) throw cErr ?? new Error("Could not create the login.");
      userId = data.user.id;
    }
  } else if (!(await getProvider()) || !process.env.EMAIL_FROM) {
    // No Brevo/Resend configured: let Supabase's own mailer send the invite / reset email.
    if (userId) {
      const { error: rErr } = await admin.auth.resetPasswordForEmail(e.official_email, { redirectTo });
      if (rErr) throw rErr;
    } else {
      const { data, error: iErr } = await admin.auth.admin.inviteUserByEmail(e.official_email, {
        redirectTo,
        data: { full_name: e.full_name },
      });
      if (iErr || !data.user) throw iErr ?? new Error("Could not send the invitation.");
      await admin.from("employees").update({ user_id: data.user.id }).eq("id", e.id);
    }
    return "";
  } else {
    const { data, error: lErr } = userId
      ? await admin.auth.admin.generateLink({ type: "recovery", email: e.official_email, options: { redirectTo } })
      : await admin.auth.admin.generateLink({
          type: "invite",
          email: e.official_email,
          options: { redirectTo, data: { full_name: e.full_name } },
        });
    if (lErr || !data.properties?.action_link) throw lErr ?? new Error("Could not create the sign-in link.");
    link = data.properties.action_link;
    userId = data.user?.id ?? userId;
  }
  if (userId && !e.user_id) await admin.from("employees").update({ user_id: userId }).eq("id", e.id);

  const provider = await getProvider();
  const from = process.env.EMAIL_FROM;
  const msg = render("employee.welcome", {
    name: e.full_name,
    first_name: e.full_name.split(" ")[0],
    code: e.employee_code,
    post: e.designation,
    department: (e.department as unknown as { name: string } | null)?.name,
    team: (team?.team as unknown as { name: string } | null)?.name,
    manager: (e.manager as unknown as { full_name: string } | null)?.full_name,
    joining: e.joining_date,
    email: e.official_email,
    link,
    password,
  })!;
  if (provider && from) {
    await provider.send({
      from,
      to: e.official_email,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      refId: `welcome-${e.id}-${Date.now()}`,
      tags: ["welcome"],
    });
  }
  return password; // shown once to the admin (empty for link mode); without a provider the admin shares it privately
}
