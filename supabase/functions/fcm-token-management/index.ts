import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/supabase@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface TokenPayload {
  action: "register" | "unregister" | "mark_used" | "list";
  token?: string;
  platform?: string;
  device_info?: Record<string, unknown>;
  employee_id?: string;
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

  const payload: TokenPayload = await req.json();
  const { action } = payload;

  try {
    switch (action) {
      case "register": {
        if (!payload.token) {
          return new Response(JSON.stringify({ error: "Token is required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { data, error } = await supabase.from("fcm_tokens").upsert({
          employee_id: employee.id,
          token: payload.token,
          platform: payload.platform || "web",
          device_info: payload.device_info || null,
          active: true,
          last_used_at: new Date().toISOString(),
        }, { onConflict: "employee_id,token" }).select().single();

        if (error) throw error;

        return new Response(JSON.stringify({ token: data }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      case "unregister": {
        if (!payload.token) {
          return new Response(JSON.stringify({ error: "Token is required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { error } = await supabase.from("fcm_tokens").delete().eq("employee_id", employee.id).eq("token", payload.token);
        if (error) throw error;

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      case "mark_used": {
        if (!payload.token) {
          return new Response(JSON.stringify({ error: "Token is required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        await supabase.from("fcm_tokens").update({ last_used_at: new Date().toISOString() }).eq("token", payload.token).eq("employee_id", employee.id);

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      case "list": {
        const { data, error } = await supabase.from("fcm_tokens").select("*").eq("employee_id", employee.id);
        if (error) throw error;

        return new Response(JSON.stringify({ tokens: data }), {
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