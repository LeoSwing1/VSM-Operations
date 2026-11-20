import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/supabase@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface SyncPayload {
  action: "sync" | "status" | "configure";
  start_date?: string;
  end_date?: string;
  integration_id?: string;
}

serve(async (req) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing or invalid authorization header" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verify the access token and get user
  const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Invalid access token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Get employee
  const { data: employee, error: empError } = await supabase
    .from("employees")
    .select("id, org_id")
    .eq("auth_user_id", user.id)
    .single();

  if (empError || !employee) {
    return new Response(JSON.stringify({ error: "Employee not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload: SyncPayload = await req.json();
  const { action } = payload;

  try {
    switch (action) {
      case "sync": {
        // Get or create calendar_sync record
        const { data: sync, error: syncError } = await supabase.from("calendar_sync").upsert(
          [{ employee_id: employee.id, org_id: employee.org_id, provider: "GOOGLE" }],
          { onConflict: "org_id,employee_id,provider" }
        ).select().single();

        if (syncError) throw syncError;

        // Get meetings for this employee
        const { data: meetings, error: meetingsError } = await supabase.from("meetings")
          .select("id, title, description, starts_at, ends_at, timezone, provider, provider_event_id, organizer_id")
          .eq("organizer_id", employee.id)
          .gte("starts_at", payload.start_date || new Date().toISOString())
          .lte("starts_at", payload.end_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString());

        if (meetingsError) throw meetingsError;

        // Get Google Calendar integration config
        const { data: integration, error: intError } = await supabase.from("integrations")
          .select("config")
          .eq("org_id", employee.org_id)
          .eq("kind", "GOOGLE_CALENDAR")
          .single();

        if (intError && intError.code !== "PGRST116") throw intError;

        return new Response(JSON.stringify({
          sync,
          meetings: meetings || [],
          integration: integration || null,
          message: integration ? "Calendar sync configured" : "No Google Calendar integration configured",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      case "status": {
        const { data, error } = await supabase.from("calendar_sync")
          .select("*")
          .eq("employee_id", employee.id)
          .eq("provider", "GOOGLE");

        if (error) throw error;

        return new Response(JSON.stringify({ sync: data?.[0] || null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      case "configure": {
        // This would be called after OAuth flow to set up integration
        if (!payload.integration_id) {
          return new Response(JSON.stringify({ error: "integration_id is required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Mark integration as connected
        const { error } = await supabase.from("integrations")
          .update({ status: "CONNECTED" })
          .eq("id", payload.integration_id)
          .eq("org_id", employee.org_id);

        if (error) throw error;

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      default:
        return new Response(JSON.stringify({ error: "Invalid action" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});