// MUREK — Śledzenie kosztów budowy — API
// Panele (HTML) są hostowane statycznie na Cloudflare Pages (folder murek/ w repo),
// bo domena *.supabase.co wymusza content-type text/plain dla HTML (antyphishing).
// Ta funkcja obsługuje wyłącznie JSON API + CORS.
// Autoryzacja własna: klucz administratora (x-admin-key) + tokeny udostępniania.
// Tabele: ct_sites, ct_expenses, ct_advances, ct_settings (RLS bez polityk —
// dostęp wyłącznie tutaj, przez service role).

import { createClient } from "jsr:@supabase/supabase-js@2";

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-admin-key",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-max-age": "86400",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}
function textPage(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", ...CORS },
  });
}

async function getAdminKey(): Promise<string | null> {
  const { data } = await supa.from("ct_settings").select("value")
    .eq("key", "admin_key").maybeSingle();
  return data?.value ?? null;
}

function money(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(/\s/g, "").replace(",", ".")) : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 999_999_999) return null;
  return Math.round(n * 100) / 100;
}
function dateOr(v: unknown, fallback: string): string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const NOTICE = `MUREK — API śledzenia kosztów budowy.
To jest adres API, nie strona. Panel otwiera się pod adresem Twojej strony
(Cloudflare Pages) w katalogu /murek/ — szczegóły w murek/README.md w repozytorium.`;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // pathname zawiera slug funkcji: /murek/...
  let path = url.pathname.replace(/^\/murek/, "");
  if (path === "" || path === "/") path = "/";
  const method = req.method;

  try {
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ---------- API klienta (token w adresie) ----------
    if (method === "GET" && path.startsWith("/api/client/")) {
      const token = path.slice("/api/client/".length);
      if (!token) return json({ error: "Brak tokenu" }, 400);
      const { data: site } = await supa.from("ct_sites")
        .select("id,name,client_name,status").eq("share_token", token).maybeSingle();
      if (!site) return json({ error: "Nie znaleziono rozliczenia" }, 404);
      const [{ data: expenses }, { data: advances }] = await Promise.all([
        supa.from("ct_expenses")
          .select("spent_on,description,category,gross,vat_rate")
          .eq("site_id", site.id)
          .order("spent_on", { ascending: true })
          .order("created_at", { ascending: true }),
        supa.from("ct_advances")
          .select("received_on,note,amount")
          .eq("site_id", site.id)
          .order("received_on", { ascending: true })
          .order("created_at", { ascending: true }),
      ]);
      return json({
        site: { name: site.name, client_name: site.client_name, status: site.status },
        expenses: expenses ?? [],
        advances: advances ?? [],
      });
    }

    // ---------- logowanie ----------
    if (method === "POST" && path === "/api/login") {
      const body = await req.json().catch(() => ({}));
      const stored = await getAdminKey();
      if (stored && typeof body.key === "string" && body.key === stored) {
        return json({ ok: true });
      }
      return json({ error: "Nieprawidłowy klucz" }, 401);
    }

    // ---------- API administratora ----------
    if (path.startsWith("/api/")) {
      const stored = await getAdminKey();
      const given = req.headers.get("x-admin-key");
      if (!stored || !given || given !== stored) {
        return json({ error: "Brak autoryzacji" }, 401);
      }

      if (method === "GET" && path === "/api/state") {
        const { data: sites } = await supa.from("ct_sites")
          .select("id,name,client_name,share_token,status,created_at")
          .order("created_at", { ascending: true });
        const list = sites ?? [];
        const wanted = url.searchParams.get("site_id");
        const site = list.find((s) => s.id === wanted) ?? list[0] ?? null;
        if (!site) return json({ sites: [], site: null, expenses: [], advances: [] });
        const [{ data: expenses }, { data: advances }] = await Promise.all([
          supa.from("ct_expenses")
            .select("id,spent_on,description,category,gross,vat_rate")
            .eq("site_id", site.id)
            .order("spent_on", { ascending: true })
            .order("created_at", { ascending: true }),
          supa.from("ct_advances")
            .select("id,received_on,note,amount")
            .eq("site_id", site.id)
            .order("received_on", { ascending: true })
            .order("created_at", { ascending: true }),
        ]);
        return json({ sites: list, site, expenses: expenses ?? [], advances: advances ?? [] });
      }

      if (method === "POST" && path === "/api/sites") {
        const b = await req.json().catch(() => ({}));
        const name = typeof b.name === "string" ? b.name.trim().slice(0, 200) : "";
        if (!name) return json({ error: "Podaj nazwę budowy" }, 400);
        const client_name = typeof b.client_name === "string"
          ? b.client_name.trim().slice(0, 200) || null : null;
        const { data, error } = await supa.from("ct_sites")
          .insert({ name, client_name }).select().single();
        if (error) return json({ error: error.message }, 500);
        return json({ site: data });
      }

      if (method === "PATCH" && path === "/api/sites") {
        const b = await req.json().catch(() => ({}));
        if (typeof b.id !== "string") return json({ error: "Brak id" }, 400);
        const patch: Record<string, unknown> = {};
        if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim().slice(0, 200);
        if ("client_name" in b) {
          patch.client_name = typeof b.client_name === "string"
            ? b.client_name.trim().slice(0, 200) || null : null;
        }
        if (typeof b.status === "string") {
          if (!["active", "done", "archived"].includes(b.status)) {
            return json({ error: "Nieprawidłowy status" }, 400);
          }
          patch.status = b.status;
        }
        const { error } = await supa.from("ct_sites").update(patch).eq("id", b.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      if (method === "DELETE" && path === "/api/sites") {
        const id = url.searchParams.get("id");
        if (!id) return json({ error: "Brak id" }, 400);
        const { error } = await supa.from("ct_sites").delete().eq("id", id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      if (method === "POST" && path === "/api/expenses") {
        const b = await req.json().catch(() => ({}));
        const gross = money(b.gross);
        const description = typeof b.description === "string"
          ? b.description.trim().slice(0, 300) : "";
        const vat = money(b.vat_rate);
        if (typeof b.site_id !== "string") return json({ error: "Brak budowy" }, 400);
        if (!description) return json({ error: "Podaj opis wydatku" }, 400);
        if (gross === null || gross <= 0) return json({ error: "Nieprawidłowa kwota" }, 400);
        if (vat === null || vat > 100) return json({ error: "Nieprawidłowa stawka VAT" }, 400);
        const category = typeof b.category === "string"
          ? b.category.trim().slice(0, 60) || "Inne" : "Inne";
        const { data, error } = await supa.from("ct_expenses").insert({
          site_id: b.site_id,
          spent_on: dateOr(b.spent_on, today()),
          description,
          category,
          gross,
          vat_rate: vat,
        }).select().single();
        if (error) return json({ error: error.message }, 500);
        return json({ expense: data });
      }

      if (method === "PATCH" && path === "/api/expenses") {
        const b = await req.json().catch(() => ({}));
        if (typeof b.id !== "string") return json({ error: "Brak id" }, 400);
        const patch: Record<string, unknown> = {};
        if ("spent_on" in b) patch.spent_on = dateOr(b.spent_on, today());
        if (typeof b.description === "string" && b.description.trim()) {
          patch.description = b.description.trim().slice(0, 300);
        }
        if (typeof b.category === "string" && b.category.trim()) {
          patch.category = b.category.trim().slice(0, 60);
        }
        if ("gross" in b) {
          const g = money(b.gross);
          if (g === null || g <= 0) return json({ error: "Nieprawidłowa kwota" }, 400);
          patch.gross = g;
        }
        if ("vat_rate" in b) {
          const v = money(b.vat_rate);
          if (v === null || v > 100) return json({ error: "Nieprawidłowa stawka VAT" }, 400);
          patch.vat_rate = v;
        }
        const { error } = await supa.from("ct_expenses").update(patch).eq("id", b.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      if (method === "DELETE" && path === "/api/expenses") {
        const id = url.searchParams.get("id");
        if (!id) return json({ error: "Brak id" }, 400);
        const { error } = await supa.from("ct_expenses").delete().eq("id", id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      if (method === "POST" && path === "/api/advances") {
        const b = await req.json().catch(() => ({}));
        const amount = money(b.amount);
        if (typeof b.site_id !== "string") return json({ error: "Brak budowy" }, 400);
        if (amount === null || amount <= 0) return json({ error: "Nieprawidłowa kwota" }, 400);
        const note = typeof b.note === "string" ? b.note.trim().slice(0, 300) || null : null;
        const { data, error } = await supa.from("ct_advances").insert({
          site_id: b.site_id,
          received_on: dateOr(b.received_on, today()),
          note,
          amount,
        }).select().single();
        if (error) return json({ error: error.message }, 500);
        return json({ advance: data });
      }

      if (method === "PATCH" && path === "/api/advances") {
        const b = await req.json().catch(() => ({}));
        if (typeof b.id !== "string") return json({ error: "Brak id" }, 400);
        const patch: Record<string, unknown> = {};
        if ("received_on" in b) patch.received_on = dateOr(b.received_on, today());
        if ("note" in b) {
          patch.note = typeof b.note === "string" ? b.note.trim().slice(0, 300) || null : null;
        }
        if ("amount" in b) {
          const a = money(b.amount);
          if (a === null || a <= 0) return json({ error: "Nieprawidłowa kwota" }, 400);
          patch.amount = a;
        }
        const { error } = await supa.from("ct_advances").update(patch).eq("id", b.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      return json({ error: "Nie znaleziono" }, 404);
    }

    return textPage(NOTICE);
  } catch (e) {
    return json({ error: "Błąd serwera: " + String(e) }, 500);
  }
});
