"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext, requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, optStr, str } from "@/lib/actions";

export async function createChatChannel(fd:FormData){
 const ctx=await requirePerm("communication.send"); const name=str(fd,"name"); const description=optStr(fd,"description");
 if(name.trim().length<2||name.length>100) flash("/chat","err","Channel name must be 2–100 characters.");
 const sb=await supabaseServer(); const {data,error}=await sb.from("chat_channels").insert({org_id:ctx.org_id,name:name.trim(),description,channel_type:"GROUP",created_by:ctx.employee_id}).select("id").single();
 if(error) flash("/chat","err",dbMessage(error));
 await sb.rpc("manage_chat_member",{p_channel:data.id,p_employee:ctx.employee_id,p_action:"ADD",p_role:"OWNER"});
 const selected=[...new Set(fd.getAll("members").map(String).filter((v)=>v!==ctx.employee_id&&z.string().uuid().safeParse(v).success))];
 for(const employee_id of selected){const {error:memberError}=await sb.rpc("manage_chat_member",{p_channel:data.id,p_employee:employee_id,p_action:"ADD",p_role:"MEMBER"});if(memberError)flash("/chat","err",dbMessage(memberError));}
 redirect(`/chat/${data.id}`);
}
export async function openDirectChat(fd:FormData){
 await requirePerm("communication.send"); const target=str(fd,"employee_id"); const parsed=z.string().uuid().safeParse(target); if(!parsed.success) flash("/chat","err","Choose a valid employee.");
 const sb=await supabaseServer(); const {data,error}=await sb.rpc("open_direct_conversation",{p_employee:target}); if(error||!data) flash("/chat","err",dbMessage(error)); redirect(`/chat/${data}`);
}
export async function joinChatChannel(fd:FormData){
 const ctx=await requirePerm("communication.view"); const id=str(fd,"channel_id"); const sb=await supabaseServer(); const {error}=await sb.from("chat_channel_members").insert({channel_id:id,employee_id:ctx.employee_id});
 if(error&&error.code!=="23505") flash("/chat","err",dbMessage(error)); redirect(`/chat/${id}`);
}
export async function sendChatMessage(fd:FormData){
 const ctx=await requirePerm("communication.send"); const channel=str(fd,"channel_id"), body=str(fd,"body").trim(), parent=optStr(fd,"parent_message_id");
 const file=fd.get("file"); const upload=file instanceof File&&file.size>0?file:null;
 if(!body&&!upload) flash(`/chat/${channel}`,"err","Write a message or attach a file.");
 if(body.length>10000) flash(`/chat/${channel}`,"err","Message is too long.");
 const allowed=["application/pdf","image/jpeg","image/png","image/webp","text/plain","application/zip"];
 if(upload&&(upload.size>15728640||!allowed.includes(upload.type))) flash(`/chat/${channel}`,"err","Attachment must be a supported file under 15 MB.");
 const sb=await supabaseServer(); let path:string|null=null;
 if(upload){path=`${ctx.org_id}/${channel}/${ctx.employee_id}/${crypto.randomUUID()}-${upload.name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(-100)}`;const {error}=await sb.storage.from("chat-files").upload(path,upload,{contentType:upload.type,upsert:false});if(error)flash(`/chat/${channel}`,"err",dbMessage(error));}
 const {data:message,error}=await sb.from("chat_messages").insert({org_id:ctx.org_id,channel_id:channel,author_id:ctx.employee_id,body:body||`Shared ${upload?.name??"a file"}`,parent_message_id:parent}).select("id").single();
 if(error){if(path)await sb.storage.from("chat-files").remove([path]);flash(`/chat/${channel}`,"err",dbMessage(error));}
 if(upload&&path){const {error:attachError}=await sb.from("chat_attachments").insert({org_id:ctx.org_id,channel_id:channel,message_id:message.id,uploaded_by:ctx.employee_id,storage_path:path,file_name:upload.name,mime_type:upload.type,file_size:upload.size});if(attachError){await sb.storage.from("chat-files").remove([path]);flash(`/chat/${channel}`,"err",dbMessage(attachError));}}
 revalidatePath(`/chat/${channel}`); redirect(`/chat/${channel}`);
}
export async function addChatReaction(fd:FormData){
 const ctx=await requirePerm("communication.send"); const channel=str(fd,"channel_id"),message=str(fd,"message_id"),reaction=str(fd,"reaction");
 if(!["👍","❤️","😂","🎉","👀","🙏"].includes(reaction)) flash(`/chat/${channel}`,"err","Invalid reaction.");
 const sb=await supabaseServer(); const {error}=await sb.from("chat_reactions").upsert({org_id:ctx.org_id,message_id:message,employee_id:ctx.employee_id,reaction},{onConflict:"message_id,employee_id,reaction"});
 if(error) flash(`/chat/${channel}`,"err",dbMessage(error)); revalidatePath(`/chat/${channel}`); redirect(`/chat/${channel}`);
}

export async function createPublicChannel(fd:FormData){
 const ctx=await requirePerm("communication.manage"); const name=str(fd,"name"),description=optStr(fd,"description");
 if(name.length<2||name.length>100)flash("/chat","err","Channel name must be 2–100 characters.");
 const sb=await supabaseServer();const {data,error}=await sb.from("chat_channels").insert({org_id:ctx.org_id,name,description,channel_type:"PUBLIC",created_by:ctx.employee_id}).select("id").single();
 if(error)flash("/chat","err",dbMessage(error));await sb.rpc("manage_chat_member",{p_channel:data.id,p_employee:ctx.employee_id,p_action:"ADD",p_role:"OWNER"});redirect(`/chat/${data.id}`);
}

export async function createDepartmentChannel(fd:FormData){
 const ctx=await requirePerm("communication.manage"); const department=str(fd,"department_id"),name=str(fd,"name");
 if(!z.string().uuid().safeParse(department).success||name.length<2||name.length>100)flash("/chat","err","Choose a department and a valid channel name.");
 const sb=await supabaseServer();const {data,error}=await sb.from("chat_channels").insert({org_id:ctx.org_id,name,description:optStr(fd,"description"),channel_type:"DEPARTMENT",department_id:department,created_by:ctx.employee_id}).select("id").single();
 if(error)flash("/chat","err",dbMessage(error));
 const {data:employees}=await sb.from("employee_directory").select("id").eq("department_id",department);
 const memberIds=[...new Set([ctx.employee_id,...(employees??[]).map((e:any)=>e.id)])];for(const employee_id of memberIds){const {error:memberError}=await sb.rpc("manage_chat_member",{p_channel:data.id,p_employee:employee_id,p_action:"ADD",p_role:employee_id===ctx.employee_id?"OWNER":"MEMBER"});if(memberError)flash("/chat","err",dbMessage(memberError));}redirect(`/chat/${data.id}`);
}

export async function reportChatMessage(fd:FormData){
 const ctx=await requirePerm("communication.view");const channel=str(fd,"channel_id"),message=str(fd,"message_id"),reason=str(fd,"reason"),details=optStr(fd,"details");
 if(!["HARASSMENT","SPAM","CONFIDENTIAL_DATA","INAPPROPRIATE","OTHER"].includes(reason))flash(`/chat/${channel}`,"err","Choose a valid report reason.");
 const sb=await supabaseServer();const {error}=await sb.from("chat_message_reports").insert({org_id:ctx.org_id,channel_id:channel,message_id:message,reporter_id:ctx.employee_id,reason,details});
 if(error)flash(`/chat/${channel}`,"err",dbMessage(error,"You may already have reported this message."));flash(`/chat/${channel}`,"ok","Message reported to the moderation team.");
}

export async function moderateMessage(fd:FormData){
 await requirePerm("communication.moderate");const message=str(fd,"message_id"),action=str(fd,"action"),reason=optStr(fd,"reason"),channel=str(fd,"channel_id");
 if(!["HIDE","RESTORE"].includes(action))flash("/settings/chat-moderation","err","Invalid moderation action.");
 const sb=await supabaseServer();const {error}=await sb.rpc("moderate_chat_message",{p_message:message,p_action:action,p_reason:reason});
 if(error)flash("/settings/chat-moderation","err",dbMessage(error));flash("/settings/chat-moderation","ok",action==="HIDE"?"Message hidden.":"Message restored.");
}

export async function reviewChatReportAction(fd:FormData){
 await requirePerm("communication.moderate");const id=str(fd,"report_id"),status=str(fd,"status"),resolution=optStr(fd,"resolution");
 if(!["REVIEWING","DISMISSED"].includes(status))flash("/settings/chat-moderation","err","Invalid report status.");
 const sb=await supabaseServer();const {error}=await sb.rpc("review_chat_report",{p_report:id,p_status:status,p_resolution:resolution});
 if(error)flash("/settings/chat-moderation","err",dbMessage(error));flash("/settings/chat-moderation","ok","Report updated.");
}

export async function manageChatMember(fd:FormData){
 const ctx=await requirePerm("communication.view");const channel=str(fd,"channel_id"),employee=str(fd,"employee_id"),action=str(fd,"action"),role=str(fd,"member_role")||"MEMBER";const sb=await supabaseServer();
 if(!["ADD","REMOVE","ROLE"].includes(action)||!z.string().uuid().safeParse(employee).success)flash(`/chat/${channel}`,"err","Invalid membership request.");
 const {error}=await sb.rpc("manage_chat_member",{p_channel:channel,p_employee:employee,p_action:action,p_role:role});if(error)flash(`/chat/${channel}`,"err",dbMessage(error));flash(`/chat/${channel}`,"ok","Channel membership updated.");
}
export async function leaveChatChannel(fd:FormData){
 const ctx=await requirePerm("communication.view");const channel=str(fd,"channel_id"),sb=await supabaseServer();const {error}=await sb.rpc("manage_chat_member",{p_channel:channel,p_employee:ctx.employee_id,p_action:"LEAVE",p_role:"MEMBER"});if(error)flash(`/chat/${channel}`,"err",dbMessage(error));redirect("/chat");
}
export async function archiveChat(fd:FormData){
 await requirePerm("communication.view");const channel=str(fd,"channel_id"),sb=await supabaseServer();const {error}=await sb.rpc("archive_chat_channel",{p_channel:channel});if(error)flash(`/chat/${channel}`,"err",dbMessage(error));redirect("/chat");
}
