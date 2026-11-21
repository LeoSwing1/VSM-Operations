"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, optStr, str } from "@/lib/actions";
export async function createChecklist(fd:FormData){
 const ctx=await requirePerm("quality.manage"); const name=str(fd,"name"), criteria=str(fd,"criteria").split("\n").map(v=>v.trim().slice(0,200)).filter(Boolean).slice(0,50); if(name.length<2||!criteria.length) flash("/quality","err","Give the checklist a name and at least one criterion."); const sb=await supabaseServer(); const {error}=await sb.from("quality_checklists").insert({org_id:ctx.org_id,name,description:str(fd,"description"),criteria:criteria.map((label,index)=>({id:`c${index+1}`,label})) ,created_by:ctx.employee_id}); if(error) flash("/quality","err",dbMessage(error)); revalidatePath("/quality"); flash("/quality","ok","Quality checklist created.");
}

export async function assessQuality(fd:FormData){
 const ctx=await requirePerm("quality.review","tasks.review"); const score=str(fd,"score")===""?Number.NaN:Number(str(fd,"score")); const p=z.object({employee_id:z.string().uuid(),task_id:z.string().uuid().optional(),project_id:z.string().uuid().optional(),checklist_id:z.string().uuid().optional(),score:z.number().min(0).max(100),outcome:z.enum(["PASS","REWORK","FAIL"]),findings:z.string().max(2000)}).refine(v=>!!v.task_id||!!v.project_id).safeParse({employee_id:str(fd,"employee_id"),task_id:optStr(fd,"task_id")||undefined,project_id:optStr(fd,"project_id")||undefined,checklist_id:optStr(fd,"checklist_id")||undefined,score,outcome:str(fd,"outcome"),findings:str(fd,"findings")});
 if(!p.success) flash("/quality","err","Enter a valid employee, task or project and score from 0–100."); if(p.data.employee_id===ctx.employee_id) flash("/quality","err","You cannot assess your own work."); const sb=await supabaseServer(); const {error}=await sb.from("quality_assessments").insert({org_id:ctx.org_id,...p.data,reviewer_id:ctx.employee_id}); if(error) flash("/quality","err",dbMessage(error)); revalidatePath("/quality"); flash("/quality","ok","Quality assessment recorded.");
}
