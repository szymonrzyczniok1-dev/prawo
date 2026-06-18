/* =========================================================================
   Powtórki — warstwa kont i synchronizacji postępów.
   - Tryb CHMURA  : gdy w config.js ustawiono Supabase (konta + sync między urządzeniami).
   - Tryb LOKALNY : gdy config pusty / brak internetu (logowanie imieniem, zapis w przeglądarce).
   Zawsze działa „offline-first”: najpierw zapis lokalny, potem (jeśli można) wysyłka do chmury.
   API: window.Powtorka
   ========================================================================= */
(function () {
  const CFG = window.POWTORKA_CONFIG || {};
  const HAS_CLOUD_CFG = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);

  let sb = null;            // klient supabase
  let isCloud = false;      // czy chmura faktycznie działa
  let user = null;          // {id, name, email?}
  let ready = false;
  const listeners = [];
  const pushTimers = {};

  /* ---------------- pomoc localStorage ---------------- */
  const LS = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function userKey() { return user ? user.id : "gosc"; }
  function progKey(uk, sub) { return "powtorka.prog." + uk + "." + sub; }
  function readLocal(uk, sub) { return LS.get(progKey(uk, sub), null); }
  function writeLocal(uk, sub, data) { LS.set(progKey(uk, sub), data); }

  /* ---------------- motyw (light/dark) ---------------- */
  function applyTheme(t) { document.documentElement.setAttribute("data-theme", t); }
  function getTheme() { return LS.get("powtorka.theme", null) || "light"; }
  function setTheme(t) { LS.set("powtorka.theme", t); applyTheme(t); }
  function toggleTheme() { const t = getTheme() === "dark" ? "light" : "dark"; setTheme(t); emit(); return t; }
  applyTheme(getTheme()); // od razu, by uniknąć mignięcia

  /* ---------------- scalanie postępów ---------------- */
  function mergeProgress(a, b) {
    if (!a || !Object.keys(a).length) return b ? Object.assign({}, b) : {};
    if (!b || !Object.keys(b).length) return Object.assign({}, a);
    const aN = a._ts || 0, bN = b._ts || 0;
    const newer = aN >= bN ? a : b, older = aN >= bN ? b : a;
    const out = Object.assign({}, older, newer);
    if (a.mastered || b.mastered) {
      out.mastered = Object.assign({}, a.mastered || {}, b.mastered || {});
      const fill = (m) => { if (m) for (const k in m) if (m[k]) out.mastered[k] = true; };
      fill(a.mastered); fill(b.mastered);
    }
    out._ts = Math.max(aN, bN);
    return out;
  }

  /* ---------------- chmura: ładowanie SDK ---------------- */
  function loadSupabase() {
    return new Promise((resolve, reject) => {
      if (window.supabase) return resolve();
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Nie udało się wczytać Supabase SDK"));
      document.head.appendChild(s);
    });
  }

  async function fetchRemote(sub) {
    try {
      const { data, error } = await sb.from("progress").select("data")
        .eq("user_id", user.id).eq("subject", sub).maybeSingle();
      if (error) return null;
      return data ? data.data : null;
    } catch (e) { return null; }
  }
  async function pushNow(sub) {
    if (!isCloud || !user) return;
    const data = readLocal(userKey(), sub) || {};
    try {
      await sb.from("progress").upsert({
        user_id: user.id, subject: sub, data,
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id,subject" });
    } catch (e) { /* offline — zostanie wysłane przy następnym zapisie */ }
  }
  function schedulePush(sub) {
    if (!isCloud || !user) return;
    clearTimeout(pushTimers[sub]);
    pushTimers[sub] = setTimeout(() => pushNow(sub), 900);
  }

  /* ---------------- użytkownik ---------------- */
  function setUserFromSession(session) {
    if (session && session.user) {
      const u = session.user;
      const m = u.user_metadata || {};
      const full = m.name || [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || u.email;
      const prevRole = user && user.role, prevApproved = user && user.approved;
      user = {
        id: u.id, email: u.email, name: full,
        first_name: m.first_name || "", last_name: m.last_name || "",
        role: prevRole || "user", approved: prevApproved || false
      };
    } else {
      user = null;
    }
  }
  function emit() { listeners.forEach(fn => { try { fn(user); } catch (e) {} }); }

  /* ---------------- init ---------------- */
  async function init() {
    if (HAS_CLOUD_CFG) {
      try {
        await loadSupabase();
        sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
        isCloud = true;
        const { data } = await sb.auth.getSession();
        setUserFromSession(data ? data.session : null);
        if (user) { await getProfile(); }
        sb.auth.onAuthStateChange((_e, session) => { setUserFromSession(session); emit(); if (user) getProfile(); });
      } catch (e) {
        isCloud = false; // graceful fallback do trybu lokalnego
      }
    }
    if (!isCloud) {
      user = LS.get("powtorka.localUser", null);
    }
    ready = true;
    emit();
    return user;
  }

  /* ---------------- API auth ---------------- */
  async function signUp(email, password, firstName, lastName) {
    if (!isCloud) throw new Error("Tryb lokalny — rejestracja niedostępna.");
    const full = [firstName, lastName].filter(Boolean).join(" ").trim();
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { first_name: firstName || "", last_name: lastName || "", name: full || email } }
    });
    if (error) throw error;
    // gdy potwierdzanie e-mail wyłączone → od razu jest sesja
    if (data.session) { setUserFromSession(data.session); emit(); return { signedIn: true }; }
    return { signedIn: false, needsConfirm: true };
  }
  // realizacja kodu dostępu → zatwierdza konto
  async function redeemCode(code) {
    if (!isCloud || !sb || !code) return false;
    try {
      const { data, error } = await sb.rpc("redeem_access_code", { p_code: code });
      if (error) return false;
      if (data && user) user.approved = true;
      return !!data;
    } catch (e) { return false; }
  }
  // dociągnięcie profilu (rola, status zatwierdzenia, imię/nazwisko)
  async function getProfile() {
    if (!isCloud || !sb || !user) return null;
    try {
      const { data, error } = await sb.from("profiles")
        .select("role,approved,first_name,last_name,streak_count,streak_last").eq("id", user.id).maybeSingle();
      if (error || !data) return null;
      user.role = data.role || "user";
      user.approved = !!data.approved;
      if (data.streak_count != null) user.streak_count = data.streak_count;
      if (data.streak_last) user.streak_last = data.streak_last;
      if (data.first_name) user.first_name = data.first_name;
      if (data.last_name) user.last_name = data.last_name;
      const full = [data.first_name, data.last_name].filter(Boolean).join(" ").trim();
      if (full && (!user.name || user.name === user.email)) user.name = full;
      emit();
      return data;
    } catch (e) { return null; }
  }
  async function signIn(email, password) {
    if (!isCloud) throw new Error("Tryb lokalny.");
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    setUserFromSession(data.session); emit();
    return { signedIn: true };
  }
  function setLocalProfile(name) {
    const clean = (name || "").trim() || "Gość";
    user = { id: "local:" + clean.toLowerCase().replace(/\s+/g, "-"), name: clean };
    LS.set("powtorka.localUser", user);
    emit();
    return user;
  }
  async function signOut() {
    if (isCloud && sb) { try { await sb.auth.signOut(); } catch (e) {} }
    else { LS.del("powtorka.localUser"); }
    user = null; emit();
  }
  // reset hasła — wysyła link na e-mail (wymaga skonfigurowanego SMTP w Supabase)
  async function resetPassword(email) {
    if (!isCloud || !sb) throw new Error("Tryb lokalny.");
    const redirectTo = new URL("reset-haslo.html", location.href).href;
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
    return true;
  }
  // ustawienie nowego hasła (po wejściu z linku resetującego)
  async function updatePassword(newPassword) {
    if (!isCloud || !sb) throw new Error("Tryb lokalny.");
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) throw error;
    return true;
  }
  // prośba o dostęp (gdy ktoś nie ma kodu) — trafia do panelu admina
  async function requestAccess(opts) {
    opts = opts || {};
    if (!isCloud || !sb) throw new Error("Tryb lokalny.");
    const { error } = await sb.from("access_requests").insert({
      email: (opts.email || "").trim(), name: opts.name || null, message: opts.message || null
    });
    if (error) throw error;
    return true;
  }
  // admin zatwierdza prośbę → funkcja brzegowa wysyła maila przez Supabase
  async function approveRequest(requestId) {
    if (!isCloud || !sb) throw new Error("Tryb lokalny.");
    const { data, error } = await sb.functions.invoke("approve-access", {
      body: { request_id: requestId, site_url: location.origin + "/" }
    });
    if (error) throw error;
    if (data && data.error) throw new Error(data.error);
    return true;
  }
  // usunięcie własnego konta i danych
  async function deleteAccount() {
    if (!isCloud || !sb || !user) throw new Error("Tryb lokalny.");
    // najpierw pliki notatek (Storage API — SQL nie może ich ruszać)
    try {
      const { data: files } = await sb.storage.from("notatki").list(user.id);
      if (files && files.length) {
        await sb.storage.from("notatki").remove(files.map(f => user.id + "/" + f.name));
      }
    } catch (e) { /* brak plików / brak dostępu — pomijamy */ }
    const { error } = await sb.rpc("delete_my_account");
    if (error) throw error;
    await signOut();
    return true;
  }

  /* ---------------- API postępów ---------------- */
  async function load(sub) {
    const uk = userKey();
    let base = readLocal(uk, sub);
    // przenieś postępy „gościa” do zalogowanego konta
    if (uk !== "gosc") {
      const guest = readLocal("gosc", sub);
      if (guest) base = mergeProgress(base, guest);
    }
    if (isCloud && user) {
      const remote = await fetchRemote(sub);
      if (remote) base = mergeProgress(base, remote);
    }
    base = base || {};
    writeLocal(uk, sub, base);
    if (isCloud && user) schedulePush(sub);
    return base;
  }
  function save(sub, data) {
    data = data || {};
    data._ts = Date.now();
    writeLocal(userKey(), sub, data);
    schedulePush(sub);
  }
  async function resetSubject(sub) {
    writeLocal(userKey(), sub, { _ts: Date.now() });
    if (isCloud && user) await pushNow(sub);
  }

  /* ---------------- pytania z bazy (z fallbackiem do plików) ---------------- */
  async function loadQuestions(subject) {
    if (!isCloud || !sb) return null;
    try {
      const { data, error } = await sb.from("questions")
        .select("payload,kind,position").eq("subject", subject)
        .order("position", { ascending: true });
      if (error || !data || !data.length) return null;
      return data; // [{payload, kind, position}]
    } catch (e) { return null; }
  }

  /* ---------------- passa dni nauki (streak) ---------------- */
  function dayStr(offset) {
    const d = new Date(); if (offset) d.setDate(d.getDate() + offset);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function getStreak() {
    if (user && user.streak_count != null) return user.streak_count;
    const s = LS.get("powtorka.streak." + userKey(), null);
    return s ? s.count : 0;
  }
  async function touchStreak() {
    let count = 0, last = null;
    const local = LS.get("powtorka.streak." + userKey(), null);
    if (local) { count = local.count; last = local.last; }
    if (user && user.streak_count != null) { count = user.streak_count; last = user.streak_last; }
    const today = dayStr(0);
    if (last === today) return count;                 // już dziś policzone
    count = (last === dayStr(-1)) ? count + 1 : 1;     // wczoraj → +1, inaczej → reset
    last = today;
    LS.set("powtorka.streak." + userKey(), { count, last });
    if (user) { user.streak_count = count; user.streak_last = last; }
    if (isCloud && user && sb) {
      try { await sb.from("profiles").update({ streak_count: count, streak_last: last }).eq("id", user.id); } catch (e) {}
    }
    emit();
    return count;
  }

  /* ---------------- wysyłka notatki (tekst + plik) ---------------- */
  async function submitNote(opts) {
    opts = opts || {};
    if (!isCloud || !sb || !user) throw new Error("Zaloguj się, aby wysłać notatkę.");
    let file_path = null;
    if (opts.file) {
      const safe = (opts.file.name || "plik").replace(/[^\w.\-]+/g, "_");
      file_path = user.id + "/" + Date.now() + "_" + safe;
      const up = await sb.storage.from("notatki").upload(file_path, opts.file, { upsert: false });
      if (up.error) throw up.error;
    }
    const { error } = await sb.from("submissions").insert({
      user_id: user.id, subject: opts.subject || null,
      title: opts.title || null, content: opts.content || null, file_path
    });
    if (error) throw error;
    return true;
  }

  /* ---------------- globalne edycje treści (admin) ---------------- */
  async function loadOverrides(subject) {
    if (!isCloud || !sb) return {};
    try {
      const { data, error } = await sb.from("question_overrides")
        .select("qid,level,text").eq("subject", subject);
      if (error || !data) return {};
      const map = {};
      data.forEach(r => { (map[r.qid] = map[r.qid] || {})[r.level] = r.text; });
      return map;
    } catch (e) { return {}; }
  }
  async function setGlobalOverride(subject, qid, level, text) {
    if (!isCloud || !sb || !user) throw new Error("Brak uprawnień.");
    const { error } = await sb.from("question_overrides").upsert({
      subject, qid, level, text, updated_by: user.id, updated_at: new Date().toISOString()
    }, { onConflict: "subject,qid,level" });
    if (error) throw error;
    return true;
  }
  async function clearGlobalOverride(subject, qid, level) {
    if (!isCloud || !sb || !user) throw new Error("Brak uprawnień.");
    const { error } = await sb.from("question_overrides")
      .delete().eq("subject", subject).eq("qid", qid).eq("level", level);
    if (error) throw error;
    return true;
  }

  /* ---------------- API procentów (na kafelki) ---------------- */
  // czytamy z lokalnego cache bez sieci — szybki podgląd na stronie głównej
  function masteredCount(sub) {
    const d = readLocal(userKey(), sub);
    if (!d || !d.mastered) return 0;
    return Object.values(d.mastered).filter(Boolean).length;
  }

  window.Powtorka = {
    init, onChange: (fn) => { listeners.push(fn); if (ready) fn(user); },
    isReady: () => ready,
    isCloud: () => isCloud,
    hasCloudConfig: () => HAS_CLOUD_CFG,
    getUser: () => user,
    signUp, signIn, signOut, setLocalProfile, redeemCode, getProfile,
    resetPassword, updatePassword, deleteAccount, requestAccess, approveRequest,
    isAdmin: () => !!(user && user.role === "admin"),
    isApproved: () => !!(user && user.approved),
    getClient: () => sb,
    getStreak, touchStreak, submitNote,
    load, save, resetSubject, masteredCount, loadQuestions,
    loadOverrides, setGlobalOverride, clearGlobalOverride,
    getTheme, setTheme, toggleTheme
  };
})();
