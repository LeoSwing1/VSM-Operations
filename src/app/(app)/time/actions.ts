"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext, requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, optStr, str } from "@/lib/actions";
import { localDate } from "@/lib/engines/time";
export async function submitTime(fd:FormData){
 const ctx=await requireContext(); const p=z.object({work_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),minutes:z.coerce.number().int().min(1).max(1440),description:z.string().trim().min(3).max(1000),task_id:z.string().uuid().optional(),project_id:z.string().uuid().optional(),billable:z.boolean()}).refine(v=>!!v.task_id).safeParse({work_date:str(fd,"work_date"),minutes:str(fd,"minutes"),description:str(fd,"description"),task_id:optStr(fd,"task_id")||undefined,project_id:optStr(fd,"project_id")||undefined,billable:str(fd,"billable")==="on"});
 if(!p.success) flash("/time","err","Add a date, duration, description and an assigned task."); if(p.data.work_date>localDate(new Date(),ctx.timezone)) flash("/time","err","You cannot submit time for a future date."); const sb=await supabaseServer(); const {data:task}=await sb.from("tasks").select("id,project_id").eq("id",p.data.task_id!).eq("assignee_id",ctx.employee_id).maybeSingle(); if(!task) flash("/time","err","Choose a task assigned to you."); const {error}=await sb.from("task_time_entries").insert({org_id:ctx.org_id,employee_id:ctx.employee_id,...p.data,project_id:task.project_id,status:"PENDING"});
 if(error) flash("/time","err",dbMessage(error)); revalidatePath("/time"); flash("/time","ok","Time submitted for approval.");
}
export async function decideTime(fd:FormData){ await requirePerm("time.approve_all","time.approve_team"); const sb=await supabaseServer(); const {error}=await sb.rpc("decide_task_time_entry",{p_id:str(fd,"id"),p_approve:str(fd,"decision")==="approve"}); if(error) flash("/time","err",dbMessage(error)); revalidatePath("/time"); flash("/time","ok","Time entry decision saved."); }
