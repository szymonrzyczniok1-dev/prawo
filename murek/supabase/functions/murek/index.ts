// MUREK — Śledzenie kosztów budowy
// Edge Function serwująca: panel administratora (/), panel klienta (/klient/<token>)
// oraz API. Autoryzacja własna: klucz administratora + tokeny udostępniania.
// Tabele: ct_sites, ct_expenses, ct_advances, ct_settings (RLS bez polityk —
// dostęp wyłącznie tutaj, przez service role).

import { createClient } from "jsr:@supabase/supabase-js@2";

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
function page(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
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

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // pathname zawiera slug funkcji: /murek/...
  let path = url.pathname.replace(/^\/murek/, "");
  if (path === "" || path === "/") path = "/";
  const method = req.method;

  try {
    // ---------- strony ----------
    if (method === "GET" && path === "/") return page(ADMIN_HTML);
    if (method === "GET" && path.startsWith("/klient/")) return page(CLIENT_HTML);

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

      if (method === "DELETE" && path === "/api/advances") {
        const id = url.searchParams.get("id");
        if (!id) return json({ error: "Brak id" }, 400);
        const { error } = await supa.from("ct_advances").delete().eq("id", id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      return json({ error: "Nie znaleziono" }, 404);
    }

    return page(ADMIN_HTML);
  } catch (e) {
    return json({ error: "Błąd serwera: " + String(e) }, 500);
  }
});

// ============================================================================
// Wspólne elementy wyglądu
// ============================================================================

const LOGO_SVG = `
<svg class="logo" viewBox="0 0 120 104" aria-hidden="true">
  <rect x="24" y="16" width="11" height="20" fill="var(--navy)"/>
  <path d="M60 0 L118 48 L109 56 L60 15 L11 56 L2 48 Z" fill="var(--navy)"/>
  <rect x="49" y="17" width="22" height="22" transform="rotate(45 60 28)" fill="var(--orange)"/>
  <path d="M26 46 H44 L60 62 V86 L44 70 V100 H26 Z" fill="var(--navy)"/>
  <path d="M94 46 H76 L60 62 V86 L76 70 V100 H94 Z" fill="var(--gray)"/>
</svg>`;

const BRAND_HTML = `
<div class="brand">
  ${LOGO_SVG}
  <div class="brand-t">
    <strong>MUREK</strong>
    <span>FUNDAMENTALNA SOLIDNOŚĆ</span>
  </div>
</div>`;

const CSS = `
:root{
  --navy:#25384a; --navy2:#31495f; --orange:#f5821f; --orange-d:#d96d10;
  --gray:#6d6e71; --bg:#eff3f6; --card:#ffffff; --line:#dde5ec;
  --text:#1e2c39; --muted:#64748b; --green:#1d8a56; --red:#c0392b;
}
*{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:'Poppins','Segoe UI',system-ui,-apple-system,sans-serif;
  background:var(--bg); color:var(--text); min-height:100vh;
}
header.top{
  background:var(--navy); color:#fff; padding:14px 20px;
  display:flex; align-items:center; gap:16px; flex-wrap:wrap;
}
.brand{display:flex; align-items:center; gap:12px}
.brand .logo{height:46px; width:auto; --navy:#fff; --gray:#b9c4cd; --orange:#f5821f}
.brand-t{display:flex; flex-direction:column; line-height:1.15}
.brand-t strong{font-size:1.35rem; letter-spacing:.14em}
.brand-t span{font-size:.6rem; letter-spacing:.22em; color:var(--orange); font-weight:600}
.top-actions{margin-left:auto; display:flex; gap:8px; align-items:center; flex-wrap:wrap}
main{max-width:1100px; margin:0 auto; padding:20px 16px 60px}
.cards{display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:14px; margin-bottom:22px}
.card{
  background:var(--card); border:1px solid var(--line); border-radius:14px;
  padding:16px 18px; box-shadow:0 1px 3px rgba(30,44,57,.06);
}
.card h3{font-size:.72rem; text-transform:uppercase; letter-spacing:.1em; color:var(--muted); font-weight:600; margin-bottom:6px}
.card .big{font-size:1.55rem; font-weight:700; color:var(--navy)}
.card .sub{font-size:.78rem; color:var(--muted); margin-top:4px}
.card.accent{border-top:4px solid var(--orange)}
.card.balance-pos .big{color:var(--green)}
.card.balance-neg .big{color:var(--red)}
section.panel{
  background:var(--card); border:1px solid var(--line); border-radius:14px;
  padding:18px; margin-bottom:22px; box-shadow:0 1px 3px rgba(30,44,57,.06);
}
.panel-head{display:flex; align-items:center; gap:10px; margin-bottom:14px; flex-wrap:wrap}
.panel-head h2{font-size:1.05rem; color:var(--navy)}
.panel-head .spacer{flex:1}
form.row{display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; margin-bottom:14px}
.field{display:flex; flex-direction:column; gap:4px}
.field label{font-size:.7rem; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); font-weight:600}
input,select{
  font:inherit; padding:9px 11px; border:1px solid var(--line); border-radius:9px;
  background:#fff; color:var(--text); min-width:0;
}
input:focus,select:focus{outline:2px solid var(--orange); outline-offset:0; border-color:var(--orange)}
button{
  font:inherit; font-weight:600; border:none; border-radius:9px; cursor:pointer;
  padding:10px 16px; background:var(--orange); color:#fff;
}
button:hover{background:var(--orange-d)}
button.ghost{background:transparent; color:#fff; border:1px solid rgba(255,255,255,.35); font-weight:500}
button.ghost:hover{background:rgba(255,255,255,.12)}
button.soft{background:#eef2f6; color:var(--navy)}
button.soft:hover{background:#e2e9ef}
button.danger{background:transparent; color:var(--red); padding:4px 8px; font-size:1rem}
button.danger:hover{background:#fdecea}
button.icon{background:transparent; color:var(--navy2); padding:4px 8px; font-size:1rem}
button.icon:hover{background:#eef2f6}
td.acts{white-space:nowrap; text-align:right}
.table-wrap{overflow-x:auto}
table{width:100%; border-collapse:collapse; font-size:.88rem}
th{
  text-align:left; font-size:.68rem; text-transform:uppercase; letter-spacing:.08em;
  color:var(--muted); padding:8px 10px; border-bottom:2px solid var(--line); white-space:nowrap;
}
td{padding:9px 10px; border-bottom:1px solid var(--line); vertical-align:top}
td.num,th.num{text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums}
tr.sum td{font-weight:700; color:var(--navy); border-top:2px solid var(--navy); border-bottom:none; background:#f6f8fa}
.pill{display:inline-block; font-size:.7rem; font-weight:600; padding:2px 9px; border-radius:99px; background:#eef2f6; color:var(--navy2); white-space:nowrap}
.muted{color:var(--muted)}
.empty{padding:18px; text-align:center; color:var(--muted); font-size:.9rem}
.preview{font-size:.78rem; color:var(--muted); width:100%}
.preview b{color:var(--navy)}
dialog{
  border:none; border-radius:14px; padding:22px; max-width:440px; width:92vw;
  box-shadow:0 10px 40px rgba(0,0,0,.25);
}
dialog::backdrop{background:rgba(30,44,57,.5)}
dialog h3{color:var(--navy); margin-bottom:14px}
dialog .field{margin-bottom:12px}
dialog input{width:100%}
dialog .actions{display:flex; gap:8px; justify-content:flex-end; margin-top:16px}
.linkbox{
  background:#f6f8fa; border:1px dashed var(--line); border-radius:9px;
  padding:10px; font-size:.78rem; word-break:break-all; margin-bottom:10px;
}
.login-wrap{min-height:100vh; display:flex; align-items:center; justify-content:center; background:var(--navy); padding:16px}
.login-card{background:#fff; border-radius:18px; padding:36px 32px; max-width:400px; width:100%; text-align:center}
.login-card .logo{height:74px; margin-bottom:10px}
.login-card h1{color:var(--navy); letter-spacing:.14em; font-size:1.6rem}
.login-card .tag{color:var(--orange); font-size:.66rem; letter-spacing:.22em; font-weight:600; margin-bottom:24px}
.login-card input{width:100%; margin-bottom:12px; text-align:center}
.login-card button{width:100%}
.err{color:var(--red); font-size:.82rem; margin-top:10px; min-height:1.2em}
.progress{height:10px; background:#e2e9ef; border-radius:99px; overflow:hidden; margin-top:10px}
.progress>div{height:100%; background:var(--orange); border-radius:99px}
footer.foot{
  text-align:center; color:var(--muted); font-size:.75rem; padding:24px 16px;
}
footer.foot b{color:var(--navy); letter-spacing:.1em}
.sitebar{display:flex; align-items:center; gap:12px; margin-bottom:16px; flex-wrap:wrap}
.sitebar h2{font-size:1.15rem; color:var(--navy)}
.sitebar .muted{font-size:.85rem}
.status-pill{font-size:.72rem; font-weight:600; padding:3px 12px; border-radius:99px; white-space:nowrap}
.st-active{background:#fdeedd; color:#b35c0a}
.st-done{background:#e2f4ea; color:#1d8a56}
.st-archived{background:#e8ecf0; color:#64748b}
@media print{
  header.top{background:#fff; color:var(--navy)}
  .brand .logo{--navy:#25384a; --gray:#6d6e71}
  .brand-t strong{color:var(--navy)}
  button,.top-actions select{display:none !important}
  body{background:#fff}
  .card,section.panel{box-shadow:none}
}
@media (max-width:640px){
  form.row .field{flex:1 1 45%}
  form.row button{flex:1 1 100%}
  .brand-t strong{font-size:1.1rem}
}
`;

const FONT_LINKS = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">`;

// ============================================================================
// PANEL ADMINISTRATORA
// ============================================================================

const ADMIN_HTML = `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>MUREK — koszty budowy</title>
${FONT_LINKS}
<style>${CSS}</style>
</head>
<body>

<div id="loginView" class="login-wrap">
  <div class="login-card">
    ${LOGO_SVG.replace('class="logo"', 'class="logo" style="--navy:#25384a;--gray:#6d6e71;--orange:#f5821f"')}
    <h1>MUREK</h1>
    <div class="tag">FUNDAMENTALNA SOLIDNOŚĆ</div>
    <input id="keyInput" type="password" placeholder="Klucz dostępu" autocomplete="current-password">
    <button id="loginBtn">Wejdź do panelu</button>
    <div id="loginErr" class="err"></div>
  </div>
</div>

<div id="appView" style="display:none">
  <header class="top">
    ${BRAND_HTML}
    <div class="top-actions">
      <select id="siteSelect" title="Wybierz budowę"></select>
      <button class="ghost" id="newSiteBtn">+ Nowa budowa</button>
      <button class="ghost" id="shareBtn">Link dla klienta</button>
      <button class="ghost" id="pdfBtn">Eksport PDF</button>
      <button class="ghost" id="siteCfgBtn">Ustawienia</button>
      <button class="ghost" id="logoutBtn">Wyloguj</button>
    </div>
  </header>

  <main>
    <div class="sitebar">
      <h2 id="siteNameLbl"></h2>
      <span id="statusPill" class="status-pill"></span>
      <span id="siteClientLbl" class="muted"></span>
    </div>
    <div class="cards">
      <div class="card accent">
        <h3>Suma zaliczek</h3>
        <div class="big" id="cAdv">—</div>
        <div class="sub" id="cAdvSub"></div>
      </div>
      <div class="card">
        <h3>Wydatki brutto</h3>
        <div class="big" id="cGross">—</div>
        <div class="sub" id="cGrossSub"></div>
      </div>
      <div class="card" id="cBalCard">
        <h3>Saldo (zaliczki − wydatki)</h3>
        <div class="big" id="cBal">—</div>
        <div class="sub" id="cBalSub"></div>
      </div>
    </div>

    <section class="panel">
      <div class="panel-head">
        <h2>Zaliczki od klienta</h2>
        <div class="spacer"></div>
        <button class="soft" id="csvAdvBtn">Eksport CSV</button>
      </div>
      <form class="row" id="advForm">
        <div class="field"><label>Data</label><input type="date" id="advDate"></div>
        <div class="field" style="flex:1;min-width:170px"><label>Od kogo / notatka</label><input type="text" id="advNote" placeholder="np. zaliczka gotówką"></div>
        <div class="field"><label>Kwota (zł)</label><input type="text" id="advAmount" inputmode="decimal" placeholder="0,00" required></div>
        <button type="submit">+ Dodaj zaliczkę</button>
      </form>
      <div class="table-wrap"><table id="advTable"></table></div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>Wydatki</h2>
        <div class="spacer"></div>
        <button class="soft" id="csvExpBtn">Eksport CSV</button>
      </div>
      <form class="row" id="expForm">
        <div class="field"><label>Data</label><input type="date" id="expDate"></div>
        <div class="field" style="flex:2;min-width:190px"><label>Opis (na co)</label><input type="text" id="expDesc" placeholder="np. cement 25 worków" required></div>
        <div class="field"><label>Kategoria</label>
          <select id="expCat">
            <option>Materiały</option><option>Robocizna</option><option>Sprzęt</option>
            <option>Transport</option><option>Opłaty</option><option>Inne</option>
          </select>
        </div>
        <div class="field"><label>VAT</label>
          <select id="expVat"><option value="23">23%</option><option value="8">8%</option><option value="0">0%</option></select>
        </div>
        <div class="field"><label>Kwota brutto (zł)</label><input type="text" id="expGross" inputmode="decimal" placeholder="0,00" required></div>
        <button type="submit">+ Dodaj wydatek</button>
        <div class="preview" id="expPreview"></div>
      </form>
      <div class="table-wrap"><table id="expTable"></table></div>
    </section>
  </main>

  <footer class="foot"><b>MUREK</b> — Fundamentalna solidność</footer>
</div>

<dialog id="siteDialog">
  <h3>Nowa budowa</h3>
  <div class="field"><label>Nazwa budowy</label><input type="text" id="siteName" placeholder="np. Dom — ul. Polna 5"></div>
  <div class="field"><label>Klient (opcjonalnie)</label><input type="text" id="siteClient" placeholder="np. Jan Kowalski"></div>
  <div class="actions">
    <button class="soft" id="siteCancel">Anuluj</button>
    <button id="siteSave">Zapisz</button>
  </div>
</dialog>

<dialog id="cfgDialog">
  <h3>Ustawienia budowy</h3>
  <div class="field"><label>Nazwa budowy</label><input type="text" id="cfgName"></div>
  <div class="field"><label>Klient</label><input type="text" id="cfgClient"></div>
  <div class="field"><label>Status</label>
    <select id="cfgStatus" style="width:100%">
      <option value="active">W trakcie</option>
      <option value="done">Zakończona</option>
      <option value="archived">Archiwum</option>
    </select>
  </div>
  <div class="actions" style="justify-content:space-between">
    <button class="soft" style="color:var(--red)" id="cfgDelete">Usuń budowę</button>
    <span>
      <button class="soft" id="cfgCancel">Anuluj</button>
      <button id="cfgSave">Zapisz</button>
    </span>
  </div>
</dialog>

<dialog id="expEditDialog">
  <h3>Edytuj wydatek</h3>
  <div class="field"><label>Data</label><input type="date" id="expEditDate"></div>
  <div class="field"><label>Opis (na co)</label><input type="text" id="expEditDesc"></div>
  <div class="field"><label>Kategoria</label>
    <select id="expEditCat" style="width:100%">
      <option>Materiały</option><option>Robocizna</option><option>Sprzęt</option>
      <option>Transport</option><option>Opłaty</option><option>Inne</option>
    </select>
  </div>
  <div class="field"><label>VAT</label>
    <select id="expEditVat" style="width:100%"><option value="23">23%</option><option value="8">8%</option><option value="0">0%</option></select>
  </div>
  <div class="field"><label>Kwota brutto (zł)</label><input type="text" id="expEditGross" inputmode="decimal"></div>
  <div class="preview" id="expEditPreview"></div>
  <div class="actions">
    <button class="soft" id="expEditCancel">Anuluj</button>
    <button id="expEditSave">Zapisz zmiany</button>
  </div>
</dialog>

<dialog id="advEditDialog">
  <h3>Edytuj zaliczkę</h3>
  <div class="field"><label>Data</label><input type="date" id="advEditDate"></div>
  <div class="field"><label>Od kogo / notatka</label><input type="text" id="advEditNote"></div>
  <div class="field"><label>Kwota (zł)</label><input type="text" id="advEditAmount" inputmode="decimal"></div>
  <div class="actions">
    <button class="soft" id="advEditCancel">Anuluj</button>
    <button id="advEditSave">Zapisz zmiany</button>
  </div>
</dialog>

<dialog id="shareDialog">
  <h3>Panel klienta</h3>
  <p class="muted" style="font-size:.85rem;margin-bottom:10px">
    Wyślij ten link klientowi. Zobaczy tylko: sumę wpłaconych zaliczek,
    ile środków wykorzystano i na co. Bez możliwości edycji.
  </p>
  <div class="linkbox" id="shareLink"></div>
  <div class="actions">
    <button class="soft" id="shareClose">Zamknij</button>
    <button id="shareCopy">Kopiuj link</button>
  </div>
</dialog>

<script>
(function(){
  "use strict";
  window.addEventListener("error", function(ev){
    var el = document.getElementById("loginErr");
    if (el && !el.textContent) el.textContent = "Błąd aplikacji: " + (ev.message || "nieznany");
  });
  var BASE = location.pathname.replace(/\\/+$/, "");
  var KEYSTORE = "murekAdminKey";
  var state = { key: null, sites: [], site: null, expenses: [], advances: [] };
  var STATUS_LABELS = { active: "W trakcie", done: "Zakończona", archived: "Archiwum" };

  // localStorage potrafi rzucać wyjątkiem (tryb prywatny, blokada ciasteczek) —
  // wtedy klucz trzeba wpisywać przy każdej wizycie, ale strona ma działać.
  function storeGet(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
  function storeSet(k, v){ try { localStorage.setItem(k, v); } catch(e){} }
  function storeDel(k){ try { localStorage.removeItem(k); } catch(e){} }

  function $(id){ return document.getElementById(id); }
  function esc(s){
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function pln(n){
    return Number(n || 0).toLocaleString("pl-PL",
      { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " zł";
  }
  function r2(n){ return Math.round(n * 100) / 100; }
  function split(gross, rate){
    var netto = r2(gross / (1 + rate / 100));
    return { netto: netto, vat: r2(gross - netto) };
  }
  function plDate(iso){
    if (!iso) return "";
    var p = iso.split("-");
    return p[2] + "." + p[1] + "." + p[0];
  }
  function todayIso(){
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  }
  function parseAmount(s){
    var n = Number(String(s).replace(/\\s/g, "").replace(",", "."));
    return isFinite(n) && n > 0 ? r2(n) : null;
  }

  function api(path, opts){
    opts = opts || {};
    opts.headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
    if (state.key) opts.headers["x-admin-key"] = state.key;
    return fetch(BASE + path, opts).then(function(res){
      if (res.status === 401) { logout(); throw new Error("Brak autoryzacji"); }
      return res.json().then(function(data){
        if (!res.ok) throw new Error(data.error || "Błąd");
        return data;
      });
    });
  }

  // ---------- logowanie ----------
  function showLogin(){
    $("loginView").style.display = "flex";
    $("appView").style.display = "none";
  }
  function showApp(){
    $("loginView").style.display = "none";
    $("appView").style.display = "block";
  }
  function logout(){
    state.key = null;
    storeDel(KEYSTORE);
    showLogin();
  }
  $("logoutBtn").onclick = logout;

  function tryLogin(key){
    return fetch(BASE + "/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: key })
    }).then(function(res){ return res.ok; });
  }

  $("loginBtn").onclick = function(){
    var key = $("keyInput").value.trim();
    if (!key) return;
    $("loginErr").textContent = "";
    tryLogin(key).then(function(ok){
      if (!ok) { $("loginErr").textContent = "Nieprawidłowy klucz dostępu."; return; }
      state.key = key;
      storeSet(KEYSTORE, key);
      showApp();
      load();
    }).catch(function(){ $("loginErr").textContent = "Błąd połączenia."; });
  };
  $("keyInput").addEventListener("keydown", function(e){
    if (e.key === "Enter") $("loginBtn").click();
  });

  // ---------- ładowanie danych ----------
  function load(siteId){
    var q = siteId ? "?site_id=" + encodeURIComponent(siteId) : "";
    return api("/api/state" + q).then(function(data){
      state.sites = data.sites; state.site = data.site;
      state.expenses = data.expenses; state.advances = data.advances;
      render();
    }).catch(function(e){ console.error(e); });
  }

  // ---------- renderowanie ----------
  function totals(){
    var adv = 0, gross = 0, netto = 0, vat = 0;
    state.advances.forEach(function(a){ adv = r2(adv + Number(a.amount)); });
    state.expenses.forEach(function(x){
      var g = Number(x.gross), s = split(g, Number(x.vat_rate));
      gross = r2(gross + g); netto = r2(netto + s.netto); vat = r2(vat + s.vat);
    });
    return { adv: adv, gross: gross, netto: netto, vat: vat, bal: r2(adv - gross) };
  }

  function siteOption(s){
    var label = esc(s.name) + (s.status === "done" ? " ✓" : "");
    return '<option value="' + s.id + '"' + (state.site && s.id === state.site.id ? " selected" : "") + ">"
      + label + "</option>";
  }

  function render(){
    var sel = $("siteSelect");
    var act = state.sites.filter(function(s){ return s.status !== "archived"; });
    var arch = state.sites.filter(function(s){ return s.status === "archived"; });
    var opts = act.map(siteOption).join("");
    if (arch.length) {
      opts += '<optgroup label="Archiwum">' + arch.map(siteOption).join("") + "</optgroup>";
    }
    sel.innerHTML = opts;

    if (state.site) {
      $("siteNameLbl").textContent = state.site.name;
      var st = state.site.status || "active";
      var pill = $("statusPill");
      pill.textContent = STATUS_LABELS[st] || st;
      pill.className = "status-pill st-" + st;
      $("siteClientLbl").textContent = state.site.client_name
        ? "Klient: " + state.site.client_name : "";
    }

    var t = totals();
    $("cAdv").textContent = pln(t.adv);
    $("cAdvSub").textContent = state.advances.length
      ? "wpłat: " + state.advances.length : "brak wpłat";
    $("cGross").textContent = pln(t.gross);
    $("cGrossSub").textContent = "netto: " + pln(t.netto) + "  •  VAT: " + pln(t.vat);
    $("cBal").textContent = pln(t.bal);
    var balCard = $("cBalCard");
    balCard.className = "card " + (t.bal >= 0 ? "balance-pos" : "balance-neg");
    $("cBalSub").textContent = t.bal >= 0
      ? "zostało z zaliczek" : "wydatki przekraczają zaliczki";

    renderAdvTable();
    renderExpTable();
    updatePreview();
  }

  function renderAdvTable(){
    var tbl = $("advTable");
    if (!state.advances.length) {
      tbl.innerHTML = '<tr><td class="empty">Brak zaliczek — dodaj pierwszą powyżej.</td></tr>';
      return;
    }
    var sum = 0;
    var rows = state.advances.map(function(a){
      sum = r2(sum + Number(a.amount));
      return "<tr>"
        + "<td>" + plDate(a.received_on) + "</td>"
        + "<td>" + (a.note ? esc(a.note) : '<span class="muted">—</span>') + "</td>"
        + '<td class="num">' + pln(a.amount) + "</td>"
        + '<td class="num">' + pln(sum) + "</td>"
        + '<td class="acts"><button class="icon" data-edit-adv="' + a.id + '" title="Edytuj">✎</button>'
        + '<button class="danger" data-del-adv="' + a.id + '" title="Usuń">✕</button></td>'
        + "</tr>";
    }).join("");
    tbl.innerHTML =
      "<thead><tr><th>Data</th><th>Notatka</th>"
      + '<th class="num">Kwota</th><th class="num">Narastająco</th><th></th></tr></thead>'
      + "<tbody>" + rows
      + '<tr class="sum"><td colspan="2">SUMA ZALICZEK</td>'
      + '<td class="num">' + pln(sum) + "</td><td></td><td></td></tr>"
      + "</tbody>";
  }

  function renderExpTable(){
    var tbl = $("expTable");
    if (!state.expenses.length) {
      tbl.innerHTML = '<tr><td class="empty">Brak wydatków — dodaj pierwszy powyżej.</td></tr>';
      return;
    }
    var sg = 0, sn = 0, sv = 0, run = 0;
    var rows = state.expenses.map(function(x){
      var g = Number(x.gross), s = split(g, Number(x.vat_rate));
      sg = r2(sg + g); sn = r2(sn + s.netto); sv = r2(sv + s.vat); run = sg;
      return "<tr>"
        + "<td>" + plDate(x.spent_on) + "</td>"
        + "<td>" + esc(x.description) + "</td>"
        + '<td><span class="pill">' + esc(x.category) + "</span></td>"
        + '<td class="num">' + pln(s.netto) + "</td>"
        + '<td class="num">' + pln(s.vat) + ' <span class="muted">(' + Number(x.vat_rate) + '%)</span></td>'
        + '<td class="num"><b>' + pln(g) + "</b></td>"
        + '<td class="num muted">' + pln(run) + "</td>"
        + '<td class="acts"><button class="icon" data-edit-exp="' + x.id + '" title="Edytuj">✎</button>'
        + '<button class="danger" data-del-exp="' + x.id + '" title="Usuń">✕</button></td>'
        + "</tr>";
    }).join("");
    tbl.innerHTML =
      "<thead><tr><th>Data</th><th>Opis</th><th>Kategoria</th>"
      + '<th class="num">Netto</th><th class="num">VAT</th><th class="num">Brutto</th>'
      + '<th class="num">Narastająco</th><th></th></tr></thead>'
      + "<tbody>" + rows
      + '<tr class="sum"><td colspan="3">RAZEM</td>'
      + '<td class="num">' + pln(sn) + "</td>"
      + '<td class="num">' + pln(sv) + "</td>"
      + '<td class="num">' + pln(sg) + "</td>"
      + "<td></td><td></td></tr>"
      + "</tbody>";
  }

  document.addEventListener("click", function(e){
    var b = e.target.closest ? e.target.closest("button") : null;
    if (!b) return;
    var edExp = b.getAttribute("data-edit-exp");
    var edAdv = b.getAttribute("data-edit-adv");
    if (edExp) openExpEdit(edExp);
    if (edAdv) openAdvEdit(edAdv);
    var idExp = b.getAttribute("data-del-exp");
    var idAdv = b.getAttribute("data-del-adv");
    if (idExp && confirm("Usunąć ten wydatek?")) {
      api("/api/expenses?id=" + idExp, { method: "DELETE" })
        .then(function(){ load(state.site.id); });
    }
    if (idAdv && confirm("Usunąć tę zaliczkę?")) {
      api("/api/advances?id=" + idAdv, { method: "DELETE" })
        .then(function(){ load(state.site.id); });
    }
  });

  // ---------- formularze ----------
  function updatePreview(){
    var g = parseAmount($("expGross").value);
    var rate = Number($("expVat").value);
    var el = $("expPreview");
    if (!g) { el.innerHTML = ""; return; }
    var s = split(g, rate);
    el.innerHTML = "Rozbicie: netto <b>" + pln(s.netto) + "</b> + VAT " + rate + "% <b>"
      + pln(s.vat) + "</b> = brutto <b>" + pln(g) + "</b>";
  }
  $("expGross").addEventListener("input", updatePreview);
  $("expVat").addEventListener("change", updatePreview);

  $("expForm").addEventListener("submit", function(e){
    e.preventDefault();
    var g = parseAmount($("expGross").value);
    var desc = $("expDesc").value.trim();
    if (!g || !desc || !state.site) return;
    api("/api/expenses", { method: "POST", body: JSON.stringify({
      site_id: state.site.id,
      spent_on: $("expDate").value || todayIso(),
      description: desc,
      category: $("expCat").value,
      gross: g,
      vat_rate: Number($("expVat").value)
    })}).then(function(){
      $("expDesc").value = ""; $("expGross").value = "";
      load(state.site.id);
    }).catch(function(err){ alert(err.message); });
  });

  $("advForm").addEventListener("submit", function(e){
    e.preventDefault();
    var a = parseAmount($("advAmount").value);
    if (!a || !state.site) return;
    api("/api/advances", { method: "POST", body: JSON.stringify({
      site_id: state.site.id,
      received_on: $("advDate").value || todayIso(),
      note: $("advNote").value.trim(),
      amount: a
    })}).then(function(){
      $("advNote").value = ""; $("advAmount").value = "";
      load(state.site.id);
    }).catch(function(err){ alert(err.message); });
  });

  // ---------- edycja wpisów ----------
  function updateEditPreview(){
    var g = parseAmount($("expEditGross").value);
    var rate = Number($("expEditVat").value);
    var el = $("expEditPreview");
    if (!g) { el.innerHTML = ""; return; }
    var s = split(g, rate);
    el.innerHTML = "Rozbicie: netto <b>" + pln(s.netto) + "</b> + VAT " + rate + "% <b>"
      + pln(s.vat) + "</b> = brutto <b>" + pln(g) + "</b>";
  }
  $("expEditGross").addEventListener("input", updateEditPreview);
  $("expEditVat").addEventListener("change", updateEditPreview);

  function openExpEdit(id){
    var x = state.expenses.filter(function(e){ return e.id === id; })[0];
    if (!x) return;
    $("expEditDialog").setAttribute("data-id", id);
    $("expEditDate").value = x.spent_on;
    $("expEditDesc").value = x.description;
    $("expEditCat").value = x.category;
    $("expEditVat").value = String(Number(x.vat_rate));
    $("expEditGross").value = String(Number(x.gross)).replace(".", ",");
    updateEditPreview();
    $("expEditDialog").showModal();
  }
  $("expEditCancel").onclick = function(){ $("expEditDialog").close(); };
  $("expEditSave").onclick = function(){
    var g = parseAmount($("expEditGross").value);
    var desc = $("expEditDesc").value.trim();
    if (!g) { alert("Podaj prawidłową kwotę."); return; }
    if (!desc) { alert("Podaj opis wydatku."); return; }
    api("/api/expenses", { method: "PATCH", body: JSON.stringify({
      id: $("expEditDialog").getAttribute("data-id"),
      spent_on: $("expEditDate").value || todayIso(),
      description: desc,
      category: $("expEditCat").value,
      gross: g,
      vat_rate: Number($("expEditVat").value)
    })}).then(function(){
      $("expEditDialog").close();
      load(state.site.id);
    }).catch(function(err){ alert(err.message); });
  };

  function openAdvEdit(id){
    var a = state.advances.filter(function(e){ return e.id === id; })[0];
    if (!a) return;
    $("advEditDialog").setAttribute("data-id", id);
    $("advEditDate").value = a.received_on;
    $("advEditNote").value = a.note || "";
    $("advEditAmount").value = String(Number(a.amount)).replace(".", ",");
    $("advEditDialog").showModal();
  }
  $("advEditCancel").onclick = function(){ $("advEditDialog").close(); };
  $("advEditSave").onclick = function(){
    var a = parseAmount($("advEditAmount").value);
    if (!a) { alert("Podaj prawidłową kwotę."); return; }
    api("/api/advances", { method: "PATCH", body: JSON.stringify({
      id: $("advEditDialog").getAttribute("data-id"),
      received_on: $("advEditDate").value || todayIso(),
      note: $("advEditNote").value.trim(),
      amount: a
    })}).then(function(){
      $("advEditDialog").close();
      load(state.site.id);
    }).catch(function(err){ alert(err.message); });
  };

  // ---------- budowy ----------
  $("siteSelect").addEventListener("change", function(){ load(this.value); });

  $("newSiteBtn").onclick = function(){
    $("siteName").value = ""; $("siteClient").value = "";
    $("siteDialog").showModal();
  };
  $("siteCancel").onclick = function(){ $("siteDialog").close(); };
  $("siteSave").onclick = function(){
    var name = $("siteName").value.trim();
    if (!name) return;
    api("/api/sites", { method: "POST", body: JSON.stringify({
      name: name, client_name: $("siteClient").value.trim()
    })}).then(function(data){
      $("siteDialog").close();
      load(data.site.id);
    }).catch(function(err){ alert(err.message); });
  };

  $("siteCfgBtn").onclick = function(){
    if (!state.site) return;
    $("cfgName").value = state.site.name;
    $("cfgClient").value = state.site.client_name || "";
    $("cfgStatus").value = state.site.status || "active";
    $("cfgDialog").showModal();
  };
  $("cfgCancel").onclick = function(){ $("cfgDialog").close(); };
  $("cfgSave").onclick = function(){
    api("/api/sites", { method: "PATCH", body: JSON.stringify({
      id: state.site.id,
      name: $("cfgName").value.trim(),
      client_name: $("cfgClient").value.trim(),
      status: $("cfgStatus").value
    })}).then(function(){
      $("cfgDialog").close();
      load(state.site.id);
    }).catch(function(err){ alert(err.message); });
  };
  $("cfgDelete").onclick = function(){
    if (!confirm("Usunąć budowę „" + state.site.name + "” wraz ze wszystkimi wydatkami i zaliczkami? Tej operacji nie można cofnąć.")) return;
    api("/api/sites?id=" + state.site.id, { method: "DELETE" }).then(function(){
      $("cfgDialog").close();
      load();
    }).catch(function(err){ alert(err.message); });
  };

  // ---------- udostępnianie ----------
  function clientUrl(){
    return location.origin + BASE + "/klient/" + state.site.share_token;
  }
  $("shareBtn").onclick = function(){
    if (!state.site) return;
    $("shareLink").textContent = clientUrl();
    $("shareDialog").showModal();
  };
  $("shareClose").onclick = function(){ $("shareDialog").close(); };
  $("shareCopy").onclick = function(){
    navigator.clipboard.writeText(clientUrl()).then(function(){
      $("shareCopy").textContent = "Skopiowano ✓";
      setTimeout(function(){ $("shareCopy").textContent = "Kopiuj link"; }, 1600);
    });
  };

  // ---------- raport PDF ----------
  function printReport(){
    if (!state.site) return;
    var t = totals();
    var st = state.site.status || "active";

    var advRows = state.advances.length ? state.advances.map(function(a){
      return "<tr><td>" + plDate(a.received_on) + "</td><td>" + (a.note ? esc(a.note) : "—") + "</td>"
        + '<td class="num">' + pln(a.amount) + "</td></tr>";
    }).join("") + '<tr class="sum"><td colspan="2">SUMA ZALICZEK</td><td class="num">' + pln(t.adv) + "</td></tr>"
      : '<tr><td colspan="3">Brak wpisów.</td></tr>';

    var expRows = state.expenses.length ? state.expenses.map(function(x){
      var g = Number(x.gross), s = split(g, Number(x.vat_rate));
      return "<tr><td>" + plDate(x.spent_on) + "</td><td>" + esc(x.description) + "</td><td>" + esc(x.category) + "</td>"
        + '<td class="num">' + pln(s.netto) + "</td>"
        + '<td class="num">' + Number(x.vat_rate) + "%</td>"
        + '<td class="num">' + pln(s.vat) + "</td>"
        + '<td class="num"><b>' + pln(g) + "</b></td></tr>";
    }).join("") + '<tr class="sum"><td colspan="3">RAZEM</td>'
      + '<td class="num">' + pln(t.netto) + "</td><td></td>"
      + '<td class="num">' + pln(t.vat) + "</td>"
      + '<td class="num">' + pln(t.gross) + "</td></tr>"
      : '<tr><td colspan="7">Brak wpisów.</td></tr>';

    var css = "body{font-family:Arial,Helvetica,sans-serif;color:#1e2c39;margin:28px;font-size:13px}"
      + ".h{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #25384a;padding-bottom:14px;margin-bottom:16px}"
      + ".brand{display:flex;align-items:center;gap:12px}"
      + ".brand .logo{height:52px;width:auto;--navy:#25384a;--gray:#6d6e71;--orange:#f5821f}"
      + ".brand-t{display:flex;flex-direction:column;line-height:1.15}"
      + ".brand-t strong{font-size:1.3rem;letter-spacing:.14em;color:#25384a}"
      + ".brand-t span{font-size:.6rem;letter-spacing:.22em;color:#f5821f;font-weight:600}"
      + ".hr{text-align:right}"
      + ".hr h1{font-size:1.05rem;color:#25384a;margin:0 0 4px}"
      + ".hr div{font-size:.8rem;color:#41505e}"
      + ".boxes{display:flex;gap:10px;margin:0 0 18px}"
      + ".box{flex:1;border:1px solid #cfd8e0;border-radius:8px;padding:10px 12px;font-size:.72rem;color:#64748b}"
      + ".box b{display:block;font-size:1.05rem;color:#25384a;margin-top:2px}"
      + ".box span{display:block;font-size:.68rem;margin-top:2px}"
      + "h2{font-size:.9rem;color:#25384a;margin:16px 0 8px}"
      + "table{width:100%;border-collapse:collapse;font-size:.78rem}"
      + "th{background:#25384a;color:#fff;text-align:left;padding:6px 8px;font-size:.68rem;letter-spacing:.05em}"
      + "th.num,td.num{text-align:right;white-space:nowrap}"
      + "td{padding:6px 8px;border-bottom:1px solid #dde5ec;vertical-align:top}"
      + "tr.sum td{font-weight:700;border-top:2px solid #25384a;border-bottom:none}"
      + ".ft{margin-top:26px;text-align:center;font-size:.68rem;color:#64748b;letter-spacing:.08em}"
      + "@page{margin:12mm}";

    var html = '<!doctype html><html lang="pl"><head><meta charset="utf-8">'
      + "<title>Rozliczenie — " + esc(state.site.name) + "</title>"
      + "<style>" + css + "</style></head><body>"
      + '<div class="h">' + document.querySelector(".brand").outerHTML
      + '<div class="hr"><h1>Rozliczenie budowy</h1>'
      + "<div><b>" + esc(state.site.name) + "</b></div>"
      + (state.site.client_name ? "<div>Klient: " + esc(state.site.client_name) + "</div>" : "")
      + "<div>Status: " + (STATUS_LABELS[st] || st) + "</div>"
      + "<div>Wygenerowano: " + plDate(todayIso()) + "</div></div></div>"
      + '<div class="boxes">'
      + '<div class="box">SUMA ZALICZEK<b>' + pln(t.adv) + "</b></div>"
      + '<div class="box">WYDATKI BRUTTO<b>' + pln(t.gross) + "</b><span>netto " + pln(t.netto) + " • VAT " + pln(t.vat) + "</span></div>"
      + '<div class="box">SALDO<b>' + pln(t.bal) + "</b><span>" + (t.bal >= 0 ? "pozostało z zaliczek" : "do dopłaty") + "</span></div>"
      + "</div>"
      + "<h2>Zaliczki od klienta</h2>"
      + '<table><thead><tr><th>Data</th><th>Notatka</th><th class="num">Kwota</th></tr></thead><tbody>' + advRows + "</tbody></table>"
      + "<h2>Wydatki</h2>"
      + '<table><thead><tr><th>Data</th><th>Opis</th><th>Kategoria</th><th class="num">Netto</th><th class="num">VAT %</th><th class="num">Kwota VAT</th><th class="num">Brutto</th></tr></thead><tbody>' + expRows + "</tbody></table>"
      + '<div class="ft">MUREK — FUNDAMENTALNA SOLIDNOŚĆ</div>'
      + "<scr" + "ipt>window.onload=function(){setTimeout(function(){window.print();},300);};</scr" + "ipt>"
      + "</body></html>";

    var w = window.open("", "_blank");
    if (!w) { alert("Przeglądarka zablokowała okno raportu — zezwól na wyskakujące okna."); return; }
    w.document.write(html);
    w.document.close();
  }
  $("pdfBtn").onclick = printReport;

  // ---------- CSV ----------
  function downloadCsv(name, rows){
    var csv = "\\uFEFF" + rows.map(function(r){
      return r.map(function(c){
        c = String(c == null ? "" : c);
        return /[;"\\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
      }).join(";");
    }).join("\\r\\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function csvNum(n){ return String(n).replace(".", ","); }

  $("csvExpBtn").onclick = function(){
    var rows = [["Data","Opis","Kategoria","Netto","VAT %","Kwota VAT","Brutto"]];
    var sg = 0, sn = 0, sv = 0;
    state.expenses.forEach(function(x){
      var g = Number(x.gross), s = split(g, Number(x.vat_rate));
      sg = r2(sg + g); sn = r2(sn + s.netto); sv = r2(sv + s.vat);
      rows.push([plDate(x.spent_on), x.description, x.category,
        csvNum(s.netto), csvNum(Number(x.vat_rate)), csvNum(s.vat), csvNum(g)]);
    });
    rows.push(["","RAZEM","", csvNum(sn), "", csvNum(sv), csvNum(sg)]);
    downloadCsv("wydatki-" + (state.site ? state.site.name : "budowa") + ".csv", rows);
  };
  $("csvAdvBtn").onclick = function(){
    var rows = [["Data","Notatka","Kwota"]];
    var sum = 0;
    state.advances.forEach(function(a){
      sum = r2(sum + Number(a.amount));
      rows.push([plDate(a.received_on), a.note || "", csvNum(Number(a.amount))]);
    });
    rows.push(["","SUMA", csvNum(sum)]);
    downloadCsv("zaliczki-" + (state.site ? state.site.name : "budowa") + ".csv", rows);
  };

  // ---------- start ----------
  $("advDate").value = todayIso();
  $("expDate").value = todayIso();
  var saved = storeGet(KEYSTORE);
  if (saved) {
    state.key = saved;
    showApp();
    load();
  } else {
    showLogin();
  }
})();
</script>
</body>
</html>`;

// ============================================================================
// PANEL KLIENTA (tylko odczyt)
// ============================================================================

const CLIENT_HTML = `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>MUREK — rozliczenie budowy</title>
${FONT_LINKS}
<style>${CSS}</style>
</head>
<body>
<header class="top">
  ${BRAND_HTML}
  <div class="top-actions">
    <span id="siteTitle" style="font-weight:600"></span>
    <span id="statusBadge"></span>
    <button class="ghost" id="printBtn">Zapisz PDF</button>
  </div>
</header>

<main id="content">
  <div class="empty" id="loading">Wczytywanie rozliczenia…</div>
</main>

<footer class="foot"><b>MUREK</b> — Fundamentalna solidność</footer>

<script>
(function(){
  "use strict";
  var m = location.pathname.match(/^(.*)\\/klient\\/([^\\/]+)\\/?$/);
  var BASE = m ? m[1] : "";
  var TOKEN = m ? m[2] : "";

  function esc(s){
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function pln(n){
    return Number(n || 0).toLocaleString("pl-PL",
      { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " zł";
  }
  function r2(n){ return Math.round(n * 100) / 100; }
  function plDate(iso){
    if (!iso) return "";
    var p = iso.split("-");
    return p[2] + "." + p[1] + "." + p[0];
  }

  document.getElementById("printBtn").onclick = function(){ window.print(); };

  fetch(BASE + "/api/client/" + TOKEN).then(function(res){
    return res.json().then(function(data){
      if (!res.ok) throw new Error(data.error || "Błąd");
      return data;
    });
  }).then(function(data){
    var adv = 0, gross = 0;
    data.advances.forEach(function(a){ adv = r2(adv + Number(a.amount)); });
    data.expenses.forEach(function(x){ gross = r2(gross + Number(x.gross)); });
    var bal = r2(adv - gross);
    var pct = adv > 0 ? Math.min(100, Math.round(gross / adv * 100)) : 0;

    document.getElementById("siteTitle").textContent = data.site.name;
    if (data.site.status === "done" || data.site.status === "archived") {
      document.getElementById("statusBadge").innerHTML =
        '<span class="status-pill st-done">Budowa zakończona</span>';
    }

    var advRows = data.advances.length ? data.advances.map(function(a){
      return "<tr><td>" + plDate(a.received_on) + "</td>"
        + "<td>" + (a.note ? esc(a.note) : '<span class="muted">—</span>') + "</td>"
        + '<td class="num">' + pln(a.amount) + "</td></tr>";
    }).join("") + '<tr class="sum"><td colspan="2">SUMA WPŁAT</td><td class="num">' + pln(adv) + "</td></tr>"
      : '<tr><td class="empty">Brak zarejestrowanych wpłat.</td></tr>';

    var expRows = data.expenses.length ? data.expenses.map(function(x){
      return "<tr><td>" + plDate(x.spent_on) + "</td>"
        + "<td>" + esc(x.description) + "</td>"
        + '<td><span class="pill">' + esc(x.category) + "</span></td>"
        + '<td class="num"><b>' + pln(x.gross) + "</b></td></tr>";
    }).join("") + '<tr class="sum"><td colspan="3">RAZEM WYKORZYSTANO</td><td class="num">' + pln(gross) + "</td></tr>"
      : '<tr><td class="empty">Brak zarejestrowanych wydatków.</td></tr>';

    var hello = data.site.client_name
      ? '<p class="muted" style="margin-bottom:16px">Rozliczenie dla: <b>' + esc(data.site.client_name) + "</b></p>"
      : "";

    document.getElementById("content").innerHTML =
      hello
      + '<div class="cards">'
      +   '<div class="card accent"><h3>Wpłacone zaliczki</h3><div class="big">' + pln(adv) + "</div></div>"
      +   '<div class="card"><h3>Wykorzystane środki</h3><div class="big">' + pln(gross) + "</div>"
      +     '<div class="progress"><div style="width:' + pct + '%"></div></div>'
      +     '<div class="sub">' + pct + "% zaliczek</div></div>"
      +   '<div class="card ' + (bal >= 0 ? "balance-pos" : "balance-neg") + '"><h3>Pozostało środków</h3><div class="big">' + pln(bal) + "</div>"
      +     '<div class="sub">' + (bal >= 0 ? "do wykorzystania" : "do dopłaty") + "</div></div>"
      + "</div>"
      + '<section class="panel"><div class="panel-head"><h2>Na co wykorzystano środki</h2></div>'
      +   '<div class="table-wrap"><table><thead><tr><th>Data</th><th>Opis</th><th>Kategoria</th><th class="num">Kwota</th></tr></thead>'
      +   "<tbody>" + expRows + "</tbody></table></div></section>"
      + '<section class="panel"><div class="panel-head"><h2>Wpłacone zaliczki</h2></div>'
      +   '<div class="table-wrap"><table><thead><tr><th>Data</th><th>Notatka</th><th class="num">Kwota</th></tr></thead>'
      +   "<tbody>" + advRows + "</tbody></table></div></section>";
  }).catch(function(e){
    document.getElementById("content").innerHTML =
      '<div class="empty">Nie udało się wczytać rozliczenia.<br>' + esc(e.message) + "</div>";
  });
})();
</script>
</body>
</html>`;
