import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const loginEmailForIC = (icName: string) =>
  `${icName.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-")}@login.webkas-fam-sos.invalid`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return respond({ error: "Server configuration is incomplete" }, 500);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return respond({ error: "Unauthorized" }, 401);
  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerData.user) return respond({ error: "Unauthorized" }, 401);
  if (callerData.user.app_metadata?.role !== "admin") return respond({ error: "Admin access required" }, 403);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return respond({ error: "Invalid JSON body" }, 400); }
  const ic_name = typeof body.ic_name === "string" ? body.ic_name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const display_name = typeof body.display_name === "string" ? body.display_name.trim() : "";
  if (!ic_name || !/^[a-zA-Z0-9._ -]{2,40}$/.test(ic_name))
    return respond({ error: "Nama IC wajib diisi (2-40 karakter; huruf, angka, titik, garis bawah, atau spasi)." }, 400);
  if (password.length < 8) return respond({ error: "Nomor HP/password minimal 8 karakter." }, 400);
  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: existing, error: lookupError } = await adminClient.from("member_profiles")
    .select("user_id").ilike("ic_name", ic_name).limit(1);
  if (lookupError) return respond({ error: "Gagal memeriksa nama IC: " + lookupError.message }, 500);
  if (existing?.length) return respond({ error: "Nama IC tersebut sudah terdaftar." }, 409);
  const { data, error } = await adminClient.auth.admin.createUser({
    email: loginEmailForIC(ic_name), password, email_confirm: true,
    user_metadata: { ic_name, display_name: display_name || ic_name },
  });
  if (error) return respond({ error: error.message }, 400);
  const { error: profileError } = await adminClient.from("member_profiles").upsert({
    user_id: data.user.id, ic_name, display_name: display_name || ic_name,
    member_status: "active", created_by: callerData.user.id,
  }, { onConflict: "user_id" });
  if (profileError) {
    await adminClient.auth.admin.deleteUser(data.user.id);
    return respond({ error: "Akun gagal disiapkan: " + profileError.message }, 500);
  }
  return respond({ id: data.user.id, ic_name }, 201);
});