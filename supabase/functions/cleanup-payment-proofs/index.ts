import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return Response.json({ error: "Server configuration is incomplete" }, { status: 500 });

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from("payment_submissions")
    .select("id,screenshot_path")
    .in("status", ["approved", "rejected"])
    .lt("reviewed_at", cutoff)
    .not("screenshot_path", "like", "[DIHAPUS OTOMATIS 24 JAM]%")
    .limit(500);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let deleted = 0;
  const failures: string[] = [];
  for (const row of rows ?? []) {
    const { error: removeError } = await supabase.storage.from("payment-proofs").remove([row.screenshot_path]);
    if (removeError) { failures.push(row.id); continue; }
    const { error: updateError } = await supabase.from("payment_submissions")
      .update({ screenshot_path: "[DIHAPUS OTOMATIS 24 JAM]" })
      .eq("id", row.id)
      .eq("screenshot_path", row.screenshot_path);
    if (updateError) failures.push(row.id);
    else deleted++;
  }
  return Response.json({ success: failures.length === 0, deleted, failed_count: failures.length, timestamp: new Date().toISOString() });
});
