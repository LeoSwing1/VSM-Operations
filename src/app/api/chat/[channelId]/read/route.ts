import { NextResponse } from "next/server";
import { requireContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
export async function POST(_request:Request,{params}:{params:Promise<{channelId:string}>}){
 try{const ctx=await requireContext(),{channelId}=await params,sb=await supabaseServer();const {error}=await sb.from("chat_channel_members").update({last_read_at:new Date().toISOString()}).eq("channel_id",channelId).eq("employee_id",ctx.employee_id);if(error)return NextResponse.json({ok:false},{status:403});return NextResponse.json({ok:true});}catch{return NextResponse.json({ok:false},{status:401});}
}
