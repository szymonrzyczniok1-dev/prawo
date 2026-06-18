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
      user = { id: u.id, email: u.email, name: (u.user_metadata && u.user_metadata.name) || u.email };
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
        sb.auth.onAuthStateChange((_e, session) => { setUserFromSession(session); emit(); });
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
  async function signUp(email, password, name) {
    if (!isCloud) throw new Error("Tryb lokalny — rejestracja niedostępna.");
    const { data, error } = await sb.auth.signUp({
      email, password, options: { data: { name: name || email } }
    });
    if (error) throw error;
    // gdy potwierdzanie e-mail wyłączone → od razu jest sesja
    if (data.session) { setUserFromSession(data.session); emit(); return { signedIn: true }; }
    return { signedIn: false, needsConfirm: true };
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
    signUp, signIn, signOut, setLocalProfile,
    load, save, resetSubject, masteredCount,
    getTheme, setTheme, toggleTheme
  };
})();
