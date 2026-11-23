import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getProvider } from "@/lib/email/providers";
import { render } from "@/lib/email/templates";
import { temporaryPassword } from "@/lib/passwords";

export type WelcomeMode = "link" | "password";

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
      "id, org_id, full_name, official_email, employee_code, designation, joining_date, role, user_id, department:departments(name), manager:employees!employees_manager_id_fkey(full_name)",
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

  if (mode === "password") {
    password = temporaryPassword();
    if (userId) {
      const { error: uErr } = await admin.auth.admin.updateUserById(userId, { password, user_metadata: { must_change_password: true } });
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
