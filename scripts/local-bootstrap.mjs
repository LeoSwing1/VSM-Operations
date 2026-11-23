#!/usr/bin/env node
// Creates the ONE Super Admin for a fresh local (Docker) database.
// Usage: node scripts/local-bootstrap.mjs --email you@vsmgrowth.com --name "Your Name"
// The password is random, printed once, and must be changed after first sign-in.
import { createClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map((a) => { const [k, ...v] = a.trim().split(" "); return [k, v.join(" ").replace(/^"|"$/g, "")]; }));
const envFile = existsSync(".env.local") ? ".env.local" : ".env.docker.local";
const env = Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url?.includes("127.0.0.1") && !url?.includes("localhost")) { console.error(`Refusing: ${envFile} does not point at a local Supabase (${url}). This script is for Docker only.`); process.exit(1); }
const email = (args.email ?? "").toLowerCase(), name = args.name ?? "Super Admin";
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error("Pass --email you@company.com"); process.exit(1); }

const sb = createClient(url, key, { auth: { persistSession: false } });
const { data: orgs } = await sb.from("organizations").select("id").limit(1);
if (orgs?.length) { console.log("An organisation already exists — nothing to do. Sign in with your Super Admin account."); process.exit(0); }
const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const password = Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => abc[randomInt(abc.length)]).join("")).join("-") + "-" + randomInt(10, 99);
const { data: u, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name, must_change_password: true } });
if (error) { console.error(error.message); process.exit(1); }
const { error: bErr } = await sb.rpc("bootstrap_organization", { p_org_name: "VSM Growth", p_slug: process.env.ORG_SLUG ?? "vsm-growth", p_admin_user: u.user.id, p_admin_name: name, p_admin_email: email });
if (bErr) { console.error("bootstrap failed:", bErr.message); process.exit(1); }
console.log(`\n  ✔ Local organisation created with ONE Super Admin\n\n    Email:    ${email}\n    Password: ${password}   (shown once — you'll set your own at first sign-in)\n\n  Next: npm run dev → http://localhost:3000 → Super Admin console → "Create demo team".\n  Local emails (password reset) arrive at http://localhost:54324\n`);
