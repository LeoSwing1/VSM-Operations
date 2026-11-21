import { NextResponse } from "next/server";
import { requireContext, can } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{channelId:string}>}){
 try{
  const ctx=await requireContext(); if(!can(ctx,"communication.view")&&!can(ctx,"communication.moderate"))return NextResponse.json({error:"Forbidden"},{status:403}); const {channelId}=await params; const sb=await supabaseServer();
  const {data:messages,error}=await sb.from("chat_messages").select("id,body,author_id,parent_message_id,created_at,edited_at,deleted_at").eq("channel_id",channelId).order("created_at",{ascending:false}).limit(150);
  if(error)return NextResponse.json({error:"Unable to load messages."},{status:403});
  const messageRows=((messages??[]) as {id:string;author_id:string;body:string;parent_message_id:string|null;created_at:string;edited_at:string|null;deleted_at:string|null}[]).reverse();
  const ids=messageRows.map((m)=>m.id);
  const [{data:attachments},{data:reactions},{data:members}]=await Promise.all([
   ids.length?sb.from("chat_attachments").select("id,message_id,storage_path,file_name,mime_type,file_size").in("message_id",ids):Promise.resolve({data:[]}),
   ids.length?sb.from("chat_reactions").select("message_id,reaction,employee_id").in("message_id",ids):Promise.resolve({data:[]}),
   sb.from("employee_directory").select("id,full_name,photo_url")
  ]);
  const attachmentRows=(attachments??[]) as {id:string;message_id:string;storage_path:string;file_name:string;mime_type:string;file_size:number}[];
  const reactionRows=(reactions??[]) as {message_id:string;reaction:string;employee_id:string}[];
  const memberRows=(members??[]) as {id:string;full_name:string}[];
  const enriched=await Promise.all(attachmentRows.map(async (a)=>{const {data}=await sb.storage.from("chat-files").createSignedUrl(a.storage_path,300);return {...a,url:data?.signedUrl??null};}));
  const response=messageRows.map((m)=>({...m,attachments:enriched.filter((a)=>a.message_id===m.id),reactions:reactionRows.filter((r)=>r.message_id===m.id),author_name:memberRows.find((e)=>e.id===m.author_id)?.full_name??"Team member"}));
  return NextResponse.json({messages:response},{headers:{"Cache-Control":"no-store, max-age=0"}});
 }catch{return NextResponse.json({error:"Authentication required."},{status:401});}
}
