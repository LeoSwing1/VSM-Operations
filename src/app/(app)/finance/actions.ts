"use server";
import { z } from "zod";
import { requireContext, requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { dbMessage, flash, num, optStr, str } from "@/lib/actions";

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const method = z.enum(["BANK_TRANSFER","UPI","CASH","CARD","CHEQUE","OTHER"]);
const receiptTypes = ["application/pdf","image/jpeg","image/png","image/webp"];

export async function submitExpense(fd: FormData) {
  const ctx = await requireContext();
  const parsed = z.object({ type:z.enum(["COMPANY_EXPENSE","REIMBURSEMENT"]), category:z.string().trim().min(2).max(80), description:z.string().trim().min(3).max(1000), amount:z.coerce.number().positive().max(100000000), expense_date:date, project_id:uuid.nullable(), department_id:uuid.nullable(), vendor_id:uuid.nullable() }).safeParse({
    type:str(fd,"expense_type") || "REIMBURSEMENT", category:str(fd,"category"), description:str(fd,"description"), amount:str(fd,"amount"), expense_date:str(fd,"expense_date"), project_id:optStr(fd,"project_id"), department_id:optStr(fd,"department_id"), vendor_id:optStr(fd,"vendor_id")
  });
  if (!parsed.success) flash("/finance/expenses","err",parsed.error.issues[0]?.message ?? "Check expense details.");
  const file = fd.get("receipt");
  if (file instanceof File && file.size && (file.size > 10*1024*1024 || !receiptTypes.includes(file.type))) flash("/finance/expenses","err","Receipt must be a PDF, JPG, PNG or WEBP up to 10 MB.");
  const sb = await supabaseServer();
  const id = crypto.randomUUID();
  let receipt: Record<string,unknown> = {};
  if (file instanceof File && file.size) {
    const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g,"") || "file";
    const path = `${ctx.org_id}/${ctx.employee_id}/${id}.${ext}`;
    const {error} = await sb.storage.from("finance-receipts").upload(path,file,{contentType:file.type,upsert:false});
    if(error) flash("/finance/expenses","err","Receipt upload failed. Please retry.");
    receipt = {receipt_path:path,receipt_name:file.name.slice(0,255),receipt_mime:file.type,receipt_size:file.size};
  }
  const code = `EXP-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${id.slice(0,6).toUpperCase()}`;
  const {type,...claim}=parsed.data;
  const {error} = await sb.from("finance_expenses").insert({id,org_id:ctx.org_id,expense_code:code,expense_type:type,employee_id:ctx.employee_id,
    ...claim, status:"SUBMITTED",...receipt});
  if(error) { if(receipt.receipt_path) await sb.storage.from("finance-receipts").remove([String(receipt.receipt_path)]); flash("/finance/expenses","err",dbMessage(error)); }
  await sb.rpc("log_audit",{p_action:"finance.expense_submitted",p_entity:"finance_expense",p_entity_id:id,p_metadata:{amount:parsed.data.amount,type:parsed.data.type}});
  flash("/finance/expenses","ok","Expense submitted for manager review.");
}

export async function decideExpense(fd: FormData) {
  await requirePerm("finance.approve_manager","finance.approve_all","finance.approve");
  const id = uuid.parse(str(fd,"id"));
  const decision = z.enum(["APPROVE","REJECT"]).parse(str(fd,"decision"));
  const sb = await supabaseServer();
  const {error} = await sb.rpc("finance_expense_decide",{p_expense:id,p_decision:decision,p_note:optStr(fd,"note")});
  if(error) flash("/finance/expenses","err",dbMessage(error));
  flash("/finance/expenses","ok",decision === "APPROVE" ? "Approval step recorded." : "Expense rejected.");
}

export async function payExpense(fd: FormData) {
  await requirePerm("finance.pay");
  const id = uuid.parse(str(fd,"id")), paidOn = date.parse(str(fd,"paid_on")), payMethod = method.parse(str(fd,"method"));
  const reference = z.string().trim().min(3).max(120).parse(str(fd,"reference"));
  const sb = await supabaseServer();
  const {error} = await sb.rpc("finance_mark_expense_paid",{p_expense:id,p_reference:reference,p_method:payMethod,p_paid_on:paidOn});
  if(error) flash("/finance/expenses","err",dbMessage(error));
  flash("/finance/expenses","ok","Expense payment recorded.");
}

export async function saveVendor(fd: FormData) {
  const ctx = await requirePerm("finance.manage");
  const p = z.object({id:uuid.nullable(),name:z.string().trim().min(2).max(160),contact_name:z.string().max(160).nullable(),email:z.string().email().nullable().or(z.literal("")).transform(v=>v||null),phone:z.string().max(40).nullable(),tax_id:z.string().max(40).nullable(),address:z.string().max(1000).nullable(),payment_terms:z.string().max(120).nullable()}).safeParse({
    id:optStr(fd,"id"),name:str(fd,"name"),contact_name:optStr(fd,"contact_name"),email:optStr(fd,"email") ?? "",phone:optStr(fd,"phone"),tax_id:optStr(fd,"tax_id"),address:optStr(fd,"address"),payment_terms:optStr(fd,"payment_terms")});
  if(!p.success) flash("/finance/vendors","err",p.error.issues[0]?.message ?? "Check vendor details.");
  const sb=await supabaseServer(); const {id,...values}=p.data; const {error}=id
    ? await sb.from("vendors").update({...values,updated_at:new Date().toISOString()}).eq("id",id).eq("org_id",ctx.org_id)
    : await sb.from("vendors").insert({...values,org_id:ctx.org_id,created_by:ctx.employee_id});
  if(error) flash("/finance/vendors","err",dbMessage(error));
  flash("/finance/vendors","ok","Vendor saved.");
}

export async function recordVendorPayment(fd: FormData) {
  const ctx=await requirePerm("finance.pay");
  const p=z.object({vendor_id:uuid,expense_id:uuid.nullable(),amount:z.coerce.number().positive(),paid_on:date,method,reference:z.string().trim().min(3).max(120),notes:z.string().max(1000).nullable()}).safeParse({vendor_id:str(fd,"vendor_id"),expense_id:optStr(fd,"expense_id"),amount:str(fd,"amount"),paid_on:str(fd,"paid_on"),method:str(fd,"method"),reference:str(fd,"reference"),notes:optStr(fd,"notes")});
  if(!p.success) flash("/finance/vendors","err",p.error.issues[0]?.message ?? "Check payment details.");
  const sb=await supabaseServer(); const {error}=await sb.from("vendor_payments").insert({...p.data,org_id:ctx.org_id,recorded_by:ctx.employee_id});
  if(error) flash("/finance/vendors","err",dbMessage(error));
  flash("/finance/vendors","ok","Vendor payment recorded.");
}

export async function createInvoice(fd: FormData) {
  await requirePerm("finance.manage");
  const p=z.object({client_id:uuid,project_id:uuid.nullable(),invoice_number:z.string().trim().min(2).max(60),issue_date:date,due_date:date,description:z.string().trim().min(2).max(300),quantity:z.coerce.number().positive(),unit_price:z.coerce.number().nonnegative(),tax_amount:z.coerce.number().nonnegative(),notes:z.string().max(2000).nullable()}).safeParse({
    client_id:str(fd,"client_id"),project_id:optStr(fd,"project_id"),invoice_number:str(fd,"invoice_number"),issue_date:str(fd,"issue_date"),due_date:str(fd,"due_date"),description:str(fd,"description"),quantity:str(fd,"quantity"),unit_price:str(fd,"unit_price"),tax_amount:str(fd,"tax_amount") || "0",notes:optStr(fd,"notes")});
  if(!p.success) flash("/finance/invoices","err",p.error.issues[0]?.message ?? "Check invoice details.");
  if(p.data.due_date<p.data.issue_date) flash("/finance/invoices","err","Due date cannot precede issue date.");
  const sb=await supabaseServer();
  const {data,error}=await sb.rpc("finance_create_invoice",{p_client_id:p.data.client_id,p_project_id:p.data.project_id,p_invoice_number:p.data.invoice_number,p_issue_date:p.data.issue_date,p_due_date:p.data.due_date,p_description:p.data.description,p_quantity:p.data.quantity,p_unit_price:p.data.unit_price,p_tax_amount:p.data.tax_amount,p_notes:p.data.notes});
  if(error||!data) flash("/finance/invoices","err",dbMessage(error));
  flash("/finance/invoices","ok","Draft invoice created. Issue it when reviewed.");
}

export async function issueInvoice(fd: FormData) {
  const ctx=await requirePerm("finance.manage"); const id=uuid.parse(str(fd,"id")); const sb=await supabaseServer();
  const {error}=await sb.rpc("finance_issue_invoice",{p_invoice:id});
  if(error) flash("/finance/invoices","err",dbMessage(error));
  flash("/finance/invoices","ok","Invoice issued.");
}

export async function recordInvoicePayment(fd: FormData) {
  await requirePerm("finance.pay","finance.manage");
  const p=z.object({invoice_id:uuid,amount:z.coerce.number().positive(),paid_on:date,method,reference:z.string().trim().min(3).max(120),notes:z.string().max(1000).nullable()}).safeParse({invoice_id:str(fd,"invoice_id"),amount:str(fd,"amount"),paid_on:str(fd,"paid_on"),method:str(fd,"method"),reference:str(fd,"reference"),notes:optStr(fd,"notes")});
  if(!p.success) flash("/finance/invoices","err",p.error.issues[0]?.message ?? "Check payment details.");
  const sb=await supabaseServer(); const {error}=await sb.rpc("finance_record_invoice_payment",{p_invoice:p.data.invoice_id,p_amount:p.data.amount,p_paid_on:p.data.paid_on,p_method:p.data.method,p_reference:p.data.reference,p_notes:p.data.notes});
  if(error) flash("/finance/invoices","err",dbMessage(error));
  flash("/finance/invoices","ok","Client payment recorded and balance recalculated.");
}

export async function createBudget(fd: FormData) {
  const ctx=await requirePerm("finance.manage");
  const p=z.object({department_id:uuid.nullable(),project_id:uuid.nullable(),period_start:date,period_end:date,category:z.string().trim().min(2).max(80),amount:z.coerce.number().nonnegative()}).safeParse({department_id:optStr(fd,"department_id"),project_id:optStr(fd,"project_id"),period_start:str(fd,"period_start"),period_end:str(fd,"period_end"),category:str(fd,"category")||"GENERAL",amount:str(fd,"amount")});
  if(!p.success) flash("/finance/budgets","err",p.error.issues[0]?.message ?? "Check budget details.");
  if(!p.data.department_id&&!p.data.project_id) flash("/finance/budgets","err","Select a department or project.");
  if(p.data.period_end<p.data.period_start) flash("/finance/budgets","err","Period end must be on or after start.");
  const sb=await supabaseServer(); const {error}=await sb.from("department_budgets").insert({...p.data,org_id:ctx.org_id,created_by:ctx.employee_id});
  if(error) flash("/finance/budgets","err",dbMessage(error));
  flash("/finance/budgets","ok","Budget saved.");
}

export async function createReconciliation(fd: FormData) {
  const ctx=await requirePerm("finance.manage");
  const p=z.object({statement_date:date,bank_account_label:z.string().trim().min(2).max(120),opening_balance:z.coerce.number(),closing_balance:z.coerce.number(),notes:z.string().max(1000).nullable()}).safeParse({statement_date:str(fd,"statement_date"),bank_account_label:str(fd,"bank_account_label"),opening_balance:str(fd,"opening_balance"),closing_balance:str(fd,"closing_balance"),notes:optStr(fd,"notes")});
  if(!p.success) flash("/finance/reconciliation","err",p.error.issues[0]?.message ?? "Check statement details.");
  const sb=await supabaseServer(); const {data,error}=await sb.from("bank_reconciliations").insert({...p.data,org_id:ctx.org_id,created_by:ctx.employee_id}).select("id").single();
  if(error||!data) flash("/finance/reconciliation","err",dbMessage(error));
  flash("/finance/reconciliation","ok",`Reconciliation opened (${data.id.slice(0,8)}). Add statement lines next.`);
}

export async function addStatementLine(fd: FormData) {
  const ctx=await requirePerm("finance.manage");
  const p=z.object({reconciliation_id:uuid,transaction_date:date,description:z.string().trim().min(2).max(500),reference:z.string().max(120).nullable(),debit:z.coerce.number().nonnegative(),credit:z.coerce.number().nonnegative()}).safeParse({reconciliation_id:str(fd,"reconciliation_id"),transaction_date:str(fd,"transaction_date"),description:str(fd,"description"),reference:optStr(fd,"reference"),debit:str(fd,"debit")||"0",credit:str(fd,"credit")||"0"});
  if(!p.success) flash("/finance/reconciliation","err",p.error.issues[0]?.message ?? "Check transaction line.");
  if((p.data.debit>0)===(p.data.credit>0)) flash("/finance/reconciliation","err","Enter either a debit or a credit amount, not both.");
  const sb=await supabaseServer(); const {error}=await sb.from("bank_statement_lines").insert({...p.data,org_id:ctx.org_id});
  if(error) flash("/finance/reconciliation","err",dbMessage(error));
  flash("/finance/reconciliation","ok","Statement line added.");
}

export async function matchStatementLine(fd: FormData) {
  const ctx=await requirePerm("finance.manage");
  const id=uuid.parse(str(fd,"id")); const type=z.enum(["EXPENSE","VENDOR_PAYMENT","INVOICE_PAYMENT"]).parse(str(fd,"matched_type")); const target=uuid.parse(str(fd,"matched_id"));
  const sb=await supabaseServer(); const {error}=await sb.rpc("finance_match_statement_line",{p_line:id,p_type:type,p_id:target});
  if(error) flash("/finance/reconciliation","err",dbMessage(error));
  flash("/finance/reconciliation","ok","Statement line matched. Verify amount and reference before closing reconciliation.");
}

export async function closeReconciliation(fd: FormData) {
 await requirePerm("finance.manage"); const id=uuid.parse(str(fd,"id")); const sb=await supabaseServer();
 const {error}=await sb.rpc("finance_close_reconciliation",{p_reconciliation:id});
 if(error) flash("/finance/reconciliation","err",dbMessage(error));
 flash("/finance/reconciliation","ok","Statement reconciled and closed.");
}
