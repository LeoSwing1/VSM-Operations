"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext, requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, optStr, str } from "@/lib/actions";

export async function createTeam(fd: FormData) {
  const ctx = await requirePerm("teams.manage");
  const p = z.object({ name:z.string().trim().min(2).max(100), description:z.string().max(1000), department_id:z.string().uuid().optional(), lead_employee_id:z.string().uuid().optional() })
    .safeParse({name:str(fd,"name"),description:str(fd,"description"),department_id:optStr(fd,"department_id")||undefined,lead_employee_id:optStr(fd,"lead_employee_id")||undefined});
  if(!p.success) flash("/teams","err","Enter a team name and valid team details.");
  const sb=await supabaseServer();
  const {data,error}=await sb.from("org_teams").insert({org_id:ctx.org_id,...p.data,created_by:ctx.employee_id}).select("id").single();
  if(error) flash("/teams","err",dbMessage(error));
  if(p.data.lead_employee_id) await sb.from("org_team_members").upsert({org_id:ctx.org_id,team_id:data.id,employee_id:p.data.lead_employee_id,member_role:"LEAD"});
  await sb.rpc("log_audit",{p_action:"team.created",p_entity:"org_team",p_entity_id:data.id,p_metadata:{name:p.data.name}});
  revalidatePath("/teams"); flash("/teams","ok","Team created.");
}
export async function addTeamMember(fd:FormData){
 const ctx=await requirePerm("teams.manage","teams.manage_team"); const team=str(fd,"team_id"), employee=str(fd,"employee_id"), role=z.enum(["MEMBER","MANAGER","LEAD"]).safeParse(str(fd,"member_role")||"MEMBER");
 if(!role.success) flash("/teams","err","Invalid team role."); const sb=await supabaseServer();
 const {error}=await sb.from("org_team_members").upsert({org_id:ctx.org_id,team_id:team,employee_id:employee,member_role:role.data});
 if(error) flash("/teams","err",dbMessage(error)); revalidatePath("/teams"); flash("/teams","ok","Team membership saved.");
}
export async function createGroup(fd:FormData){
 const ctx=await requirePerm("teams.create_group","teams.manage"); const name=str(fd,"name"); if(name.length<2) flash("/teams","err","Group name is required.");
 const sb=await supabaseServer(); const {data,error}=await sb.from("work_groups").insert({org_id:ctx.org_id,name,description:optStr(fd,"description"),group_type:str(fd,"group_type")||"WORKING",is_private:str(fd,"is_private")==="on",owner_id:ctx.employee_id}).select("id").single();
 if(error) flash("/teams","err",dbMessage(error)); await sb.from("work_group_members").insert({org_id:ctx.org_id,group_id:data.id,employee_id:ctx.employee_id,member_role:"OWNER"});
 revalidatePath("/teams"); flash("/teams","ok","Group created.");
}

export async function addGroupMember(fd:FormData){
 const ctx=await requireContext(); const group=str(fd,"group_id"), employee=str(fd,"employee_id"); const sb=await supabaseServer();
 const {error}=await sb.from("work_group_members").upsert({org_id:ctx.org_id,group_id:group,employee_id:employee,member_role:"MEMBER"});
 if(error) flash("/teams","err",dbMessage(error)); revalidatePath("/teams"); flash("/teams","ok","Group member added.");
}

export async function joinGroup(fd:FormData){const ctx=await requireContext();const sb=await supabaseServer();const {error}=await sb.rpc("join_public_work_group",{p_group:str(fd,"group_id")});if(error)flash("/teams","err",dbMessage(error));revalidatePath("/teams");flash("/teams","ok","You joined the group.");}
export async function leaveGroup(fd:FormData){await requireContext();const sb=await supabaseServer();const {error}=await sb.rpc("leave_work_group",{p_group:str(fd,"group_id")});if(error)flash("/teams","err",dbMessage(error));revalidatePath("/teams");flash("/teams","ok","You left the group.");}
export async function removeTeamMember(fd:FormData){const ctx=await requireContext();const sb=await supabaseServer();const {error}=await sb.from("org_team_members").delete().eq("team_id",str(fd,"team_id")).eq("employee_id",str(fd,"employee_id"));if(error)flash("/teams","err",dbMessage(error));revalidatePath("/teams");flash("/teams","ok","Team member removed.");}
export async function removeGroupMember(fd:FormData){await requireContext();const sb=await supabaseServer();const {error}=await sb.from("work_group_members").delete().eq("group_id",str(fd,"group_id")).eq("employee_id",str(fd,"employee_id"));if(error)flash("/teams","err",dbMessage(error));revalidatePath("/teams");flash("/teams","ok","Group member removed.");}
export async function transferTeamLead(fd:FormData){await requirePerm("teams.manage","teams.manage_team");const sb=await supabaseServer();const {error}=await sb.rpc("transfer_org_team_lead",{p_team:str(fd,"team_id"),p_employee:str(fd,"employee_id")});if(error)flash("/teams","err",dbMessage(error));revalidatePath("/teams");flash("/teams","ok","Team lead transferred.");}
