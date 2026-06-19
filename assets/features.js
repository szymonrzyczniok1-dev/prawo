/* =========================================================================
   features.js — wspólne funkcje paneli:
   modal, silnik egzaminu, wrzucanie notatek, chip passy.
   Wymaga store.js (window.Powtorka). Udostępnia window.PUI.
   ========================================================================= */
(function () {
  /* ---------------- CSS komponentów (wstrzykiwany) ---------------- */
  const css = `
  .pui-overlay{position:fixed;inset:0;z-index:70;display:none;place-items:center;padding:18px;
    background:color-mix(in srgb,var(--ink) 40%,transparent);backdrop-filter:blur(3px)}
  .pui-overlay.show{display:grid;animation:fade .18s ease}
  .pui-modal{width:100%;max-width:460px;max-height:92vh;overflow:auto;background:var(--surface);
    border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow-lg);padding:24px;animation:pop .24s var(--ease)}
  .pui-modal.wide{max-width:680px}
  .pui-modal h3{font-family:"Fraunces",serif;font-weight:560;font-size:1.5rem;margin:0 0 4px;letter-spacing:-.01em}
  .pui-modal .psub{color:var(--ink-soft);font-size:13.5px;margin-bottom:18px}
  .pui-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  .pui-field{margin-bottom:13px}
  .pui-field label{display:block;font-size:12px;font-weight:600;color:var(--ink-soft);margin-bottom:6px}
  .pui-field input,.pui-field textarea,.pui-field select{width:100%;font:inherit;font-size:14.5px;padding:10px 12px;
    border-radius:10px;border:1px solid var(--line-strong);background:var(--paper);color:var(--ink)}
  .pui-field textarea{min-height:120px;resize:vertical;line-height:1.55}
  .pui-field input:focus,.pui-field textarea:focus,.pui-field select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
  .pui-file{font-size:13px;color:var(--ink-soft)}
  .pui-seg{display:inline-flex;gap:4px;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-pill);padding:4px;flex-wrap:wrap}
  .pui-seg button{border:none;background:transparent;color:var(--ink-soft);font:inherit;font-weight:600;font-size:13px;padding:7px 13px;border-radius:var(--r-pill);cursor:pointer;transition:.15s}
  .pui-seg button.on{background:var(--surface);color:var(--accent);box-shadow:var(--shadow-sm)}
  /* egzamin */
  .ex-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;font-size:13px;color:var(--ink-soft)}
  .ex-timer{font-variant-numeric:tabular-nums;font-weight:700;color:var(--ink)}
  .ex-timer.low{color:var(--no)}
  .ex-bar{height:6px;background:var(--surface-2);border:1px solid var(--line);border-radius:999px;overflow:hidden;margin-bottom:18px}
  .ex-bar>i{display:block;height:100%;background:var(--accent);transition:width .3s var(--ease)}
  .ex-q{font-family:"Fraunces",serif;font-size:1.2rem;font-weight:500;line-height:1.35;margin:6px 0 16px}
  .ex-opts{display:flex;flex-direction:column;gap:9px}
  .ex-opt{display:flex;gap:11px;align-items:flex-start;padding:12px 14px;border:1px solid var(--line);background:var(--surface-2);
    border-radius:11px;cursor:pointer;font-size:14.5px;line-height:1.45;transition:.12s var(--ease)}
  .ex-opt:hover{border-color:var(--line-strong)}
  .ex-opt.sel{border-color:var(--accent);background:var(--accent-soft)}
  .ex-opt .l{flex:0 0 25px;height:25px;border:1px solid var(--line-strong);border-radius:50%;display:grid;place-items:center;font-size:12.5px;font-weight:700;color:var(--ink-faint)}
  .ex-opt.sel .l{border-color:var(--accent);color:var(--accent)}
  .ex-opt.correct{border-color:var(--ok-line);background:var(--ok-bg)} .ex-opt.correct .l{background:var(--ok);color:#fff;border-color:var(--ok)}
  .ex-opt.wrong{border-color:var(--no-line);background:var(--no-bg)} .ex-opt.wrong .l{background:var(--no);color:#fff;border-color:var(--no)}
  .ex-nav{display:flex;justify-content:space-between;gap:10px;margin-top:18px}
  .ex-score{font-family:"Fraunces",serif;font-size:2.8rem;text-align:center;color:var(--accent);margin:6px 0}
  .ex-msg{text-align:center;color:var(--ink-soft);margin-bottom:18px}
  .ex-rev{margin-top:18px;display:flex;flex-direction:column;gap:9px}
  .ex-rev .it{border:1px solid var(--line);border-radius:10px;padding:11px 13px;font-size:13px;line-height:1.5}
  .ex-rev .it.no{border-left:3px solid var(--no)} .ex-rev .it.ok{border-left:3px solid var(--ok)}
  .ex-rev .t{font-size:10.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-faint);font-weight:700;margin-bottom:4px}
  /* statystyki */
  .st-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:18px}
  .st-card{background:var(--surface-2);border:1px solid var(--line);border-radius:12px;padding:14px}
  .st-card .v{font-family:"Fraunces",serif;font-size:1.7rem;color:var(--accent);line-height:1}
  .st-card .k{font-size:12px;color:var(--ink-soft);margin-top:4px}
  .st-row{display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:13px}
  .st-row .lab{flex:0 0 42%;color:var(--ink-soft)}
  .st-track{flex:1;height:7px;background:var(--surface-2);border:1px solid var(--line);border-radius:999px;overflow:hidden}
  .st-track>i{display:block;height:100%;background:var(--accent)}
  .st-row .num{flex:0 0 50px;text-align:right;color:var(--ink-faint);font-variant-numeric:tabular-nums}
  .st-h{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--ink-faint);font-weight:700;margin:18px 0 10px}
  /* chip passy */
  .streak-chip{display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:700;color:#c2702a;
    background:#f6ece0;border:1px solid #ecd7bf;border-radius:999px;padding:4px 10px}
  [data-theme="dark"] .streak-chip{color:#e2a35f;background:#2b2014;border-color:#473420}
  /* przyciski flag na kartach */
  .flagbtns{display:inline-flex;gap:6px}
  .flagbtn{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line-strong);background:var(--surface);
    color:var(--ink-faint);font:inherit;font-size:12px;font-weight:600;padding:5px 10px;border-radius:999px;cursor:pointer;transition:.13s}
  .flagbtn:hover{color:var(--ink);border-color:var(--ink-faint)}
  .flagbtn.on.hard{color:var(--no);border-color:var(--no-line);background:var(--no-bg)}
  .flagbtn.on.fav{color:#c2702a;border-color:#ecd7bf;background:#f6ece0}
  [data-theme="dark"] .flagbtn.on.fav{background:#2b2014;border-color:#473420;color:#e2a35f}
  `;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  /* ---------------- pomoc ---------------- */
  function esc(s){ return (s==null?"":String(s)).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function shuffle(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]];} return a; }
  function toast(msg){
    let t=document.getElementById("toast");
    if(!t){ t=document.createElement("div"); t.id="toast"; t.className="toast"; document.body.appendChild(t); }
    t.textContent=msg; t.classList.add("show"); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove("show"),2600);
  }

  /* ---------------- modal ---------------- */
  function modal({ title, sub, html, wide, onMount }) {
    const ov = document.createElement("div"); ov.className = "pui-overlay";
    ov.innerHTML = `<div class="pui-modal${wide?" wide":""}" role="dialog" aria-modal="true">
      <div class="pui-head"><div><h3>${esc(title)}</h3>${sub?`<div class="psub">${esc(sub)}</div>`:""}</div>
        <button class="iconbtn pui-x" aria-label="Zamknij"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <div class="pui-body"></div></div>`;
    document.body.appendChild(ov);
    ov.querySelector(".pui-body").innerHTML = html || "";
    const close = () => { ov.classList.remove("show"); setTimeout(()=>ov.remove(), 180); };
    ov.querySelector(".pui-x").onclick = close;
    ov.addEventListener("click", e => { if (e.target === ov) close(); });
    requestAnimationFrame(()=>ov.classList.add("show"));
    if (onMount) onMount(ov.querySelector(".pui-body"), close);
    return close;
  }

  /* ---------------- chip passy ---------------- */
  function streakChip(n) {
    if (!n || n < 1) return "";
    return `<span class="streak-chip" title="Passa dni nauki">🔥 ${n}</span>`;
  }

  /* ---------------- egzamin ---------------- */
  // items: [{prompt, options:[...], correct:index, topic, explanation}]
  function examOpen({ items, subject, onFinish }) {
    if (!items || !items.length) { toast("Brak pytań do egzaminu."); return; }
    let timerId = null;
    const close = modal({
      title: "Tryb egzaminacyjny", wide: true,
      onMount: (body, closeFn) => {
        const max = items.length;
        const counts = [10, 20, 30].filter(c => c < max).concat([max]);
        renderConfig();
        function renderConfig() {
          body.innerHTML = `
            <div class="pui-field"><label>Liczba pytań</label>
              <div class="pui-seg" id="exCount">${counts.map((c,i)=>`<button data-c="${c}" class="${i===0?"on":""}">${c===max?"Wszystkie ("+max+")":c}</button>`).join("")}</div></div>
            <div class="pui-field"><label>Czas</label>
              <div class="pui-seg" id="exTime">
                <button data-m="0" class="on">Bez limitu</button>
                <button data-m="10">10 min</button>
                <button data-m="20">20 min</button>
                <button data-m="30">30 min</button>
              </div></div>
            <button class="btn btn--primary btn--block" id="exStart" style="margin-top:8px">Rozpocznij egzamin</button>
            <p class="psub" style="margin-top:14px;text-align:center">Pytania losowe, ocena na końcu — jak na prawdziwym egzaminie.</p>`;
          let cnt = counts[0], mins = 0;
          body.querySelectorAll("#exCount button").forEach(b=>b.onclick=()=>{ body.querySelectorAll("#exCount button").forEach(x=>x.classList.remove("on")); b.classList.add("on"); cnt=+b.dataset.c; });
          body.querySelectorAll("#exTime button").forEach(b=>b.onclick=()=>{ body.querySelectorAll("#exTime button").forEach(x=>x.classList.remove("on")); b.classList.add("on"); mins=+b.dataset.m; });
          body.querySelector("#exStart").onclick = () => startExam(cnt, mins);
        }
        function startExam(count, mins) {
          const pick = shuffle(items).slice(0, count);
          const answers = new Array(pick.length).fill(null);
          let idx = 0;
          const startedAt = Date.now();
          const deadline = mins ? startedAt + mins * 60000 : 0;
          const LET = ["A","B","C","D","E","F"];
          renderQ();
          if (deadline) {
            timerId = setInterval(() => {
              const left = deadline - Date.now();
              const el = body.querySelector("#exTimer");
              if (left <= 0) { clearInterval(timerId); finish(); return; }
              if (el) { const s=Math.ceil(left/1000); el.textContent = Math.floor(s/60)+":"+String(s%60).padStart(2,"0"); el.classList.toggle("low", left<60000); }
            }, 500);
          }
          function renderQ() {
            const q = pick[idx];
            body.innerHTML = `
              <div class="ex-top"><span>Pytanie ${idx+1} z ${pick.length}</span>
                ${deadline?`<span class="ex-timer" id="exTimer">${String(mins).padStart(1,"0")}:00</span>`:`<span>${pick.length} pytań</span>`}</div>
              <div class="ex-bar"><i style="width:${(idx)/(pick.length)*100}%"></i></div>
              ${q.topic?`<div class="eyebrow">${esc(q.topic)}</div>`:""}
              <div class="ex-q">${esc(q.prompt)}</div>
              <div class="ex-opts">${q.options.map((o,i)=>`<button class="ex-opt${answers[idx]===i?" sel":""}" data-i="${i}"><span class="l">${LET[i]}</span><span>${esc(o)}</span></button>`).join("")}</div>
              <div class="ex-nav">
                <button class="btn btn--ghost" id="exPrev" ${idx===0?"disabled":""}>← Wstecz</button>
                <button class="btn btn--primary" id="exNext">${idx===pick.length-1?"Zakończ egzamin":"Dalej →"}</button>
              </div>`;
            body.querySelectorAll(".ex-opt").forEach(b=>b.onclick=()=>{ answers[idx]=+b.dataset.i; renderQ(); });
            body.querySelector("#exPrev").onclick=()=>{ if(idx>0){idx--;renderQ();} };
            body.querySelector("#exNext").onclick=()=>{ if(idx<pick.length-1){idx++;renderQ();} else finish(); };
          }
          function finish() {
            if (timerId) { clearInterval(timerId); timerId = null; }
            let score = 0; pick.forEach((q,i)=>{ if(answers[i]===q.correct) score++; });
            const total = pick.length;
            const pct = Math.round(score/total*100);
            const timeSec = Math.round((Date.now()-startedAt)/1000);
            const mm = Math.floor(timeSec/60), ss = timeSec%60;
            let msg = pct>=90?"Znakomicie — materiał opanowany.":pct>=70?"Dobrze, dopracuj słabsze działy.":pct>=50?"Przeciętnie — powtórz materiał.":"Trzeba jeszcze popracować.";
            const wrong = pick.map((q,i)=>({q,a:answers[i],i})).filter(x=>x.a!==x.q.correct);
            body.innerHTML = `
              <div class="ex-score">${score} / ${total}</div>
              <div class="ex-msg">${pct}% poprawnych · czas ${mm}:${String(ss).padStart(2,"0")} · ${msg}</div>
              <div style="display:flex;gap:10px;justify-content:center">
                <button class="btn" id="exAgain">Jeszcze raz</button>
                <button class="btn btn--primary" id="exDone">Zamknij</button>
              </div>
              ${wrong.length?`<div class="st-h">Do powtórki (${wrong.length})</div><div class="ex-rev">${wrong.map(x=>`
                <div class="it no">${x.q.topic?`<div class="t">${esc(x.q.topic)}</div>`:""}<div>${esc(x.q.prompt)}</div>
                  <div style="margin-top:6px;font-size:12.5px"><span style="color:var(--no)">Twoja: ${x.a==null?"brak":esc(x.q.options[x.a])}</span><br><span style="color:var(--ok)">Poprawna: ${esc(x.q.options[x.q.correct])}</span></div>
                  ${x.q.explanation?`<div style="margin-top:6px;color:var(--ink-soft)">${esc(x.q.explanation)}</div>`:""}</div>`).join("")}</div>`:`<div class="ex-msg" style="margin-top:14px;color:var(--ok)">✓ Komplet! Wszystkie odpowiedzi poprawne.</div>`}`;
            body.querySelector("#exAgain").onclick = renderConfig;
            body.querySelector("#exDone").onclick = closeFn;
            if (onFinish) onFinish({ score, total, pct, timeSec, date: Date.now() });
          }
        }
      }
    });
    // sprzątanie timera przy zamknięciu przez tło/X
    return () => { if (timerId) clearInterval(timerId); close(); };
  }

  /* ---------------- wrzucanie notatki ---------------- */
  function notesOpen({ subject, subjectName }) {
    if (!Powtorka.getUser()) {
      modal({ title: "Zaloguj się", sub: "Aby wysłać notatkę do weryfikacji, zaloguj się na konto.",
        html: `<a class="btn btn--primary btn--block" href="${location.pathname.includes("/przedmioty/")?"../../index.html":"index.html"}">Przejdź do logowania</a>` });
      return;
    }
    modal({
      title: "Wrzuć notatkę", sub: subjectName ? "Przedmiot: " + subjectName : "Twoja notatka trafi do weryfikacji.",
      onMount: (body, close) => {
        body.innerHTML = `
          <div class="pui-field"><label>Tytuł</label><input id="nTitle" placeholder="np. Streszczenie wykładu 3"></div>
          <div class="pui-field"><label>Treść (opcjonalnie)</label><textarea id="nContent" placeholder="Wklej notatkę tekstem…"></textarea></div>
          <div class="pui-field"><label>Plik (opcjonalnie — PDF, zdjęcie, dokument)</label><input id="nFile" type="file" class="pui-file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt,.heic"></div>
          <div class="err" id="nErr" style="display:none;color:var(--no);font-size:13px;margin-bottom:10px"></div>
          <button class="btn btn--primary btn--block" id="nSend">Wyślij do weryfikacji</button>
          <p class="psub" style="margin-top:12px;text-align:center">Trafi do panelu organizatora. Dziękujemy za wkład!</p>`;
        const err = body.querySelector("#nErr");
        body.querySelector("#nSend").onclick = async () => {
          const title = body.querySelector("#nTitle").value.trim();
          const content = body.querySelector("#nContent").value.trim();
          const file = body.querySelector("#nFile").files[0] || null;
          err.style.display = "none";
          if (!title) { err.textContent = "Podaj tytuł."; err.style.display = "block"; return; }
          if (!content && !file) { err.textContent = "Dodaj treść lub plik."; err.style.display = "block"; return; }
          if (file && file.size > 25 * 1024 * 1024) { err.textContent = "Plik za duży (max 25 MB)."; err.style.display = "block"; return; }
          const btn = body.querySelector("#nSend"); btn.disabled = true; btn.textContent = "Wysyłanie…";
          try {
            await Powtorka.submitNote({ subject, title, content, file });
            close(); toast("Notatka wysłana — dziękujemy!");
          } catch (e) {
            err.textContent = "Błąd wysyłki: " + (e && e.message || e); err.style.display = "block";
            btn.disabled = false; btn.textContent = "Wyślij do weryfikacji";
          }
        };
      }
    });
  }

  /* ---------------- ekran dostępu (mur) ---------------- */
  function homeHref(){ return location.pathname.includes("/przedmioty/") ? "../../index.html" : "index.html"; }
  function accessGate(target){
    if(!target) return;
    const u = Powtorka.getUser();
    if(!u){
      target.innerHTML = `<div class="gate"><h2>Dostęp dla zalogowanych</h2>
        <p>Ta powtórka jest dostępna po zalogowaniu i wpisaniu kodu dostępu od organizatora roku.</p>
        <a class="btn btn--primary" href="${homeHref()}">Zaloguj się / Zarejestruj</a></div>`;
      return;
    }
    target.innerHTML = `<div class="gate"><h2>Wpisz kod dostępu</h2>
      <p>Konto <b>${esc(u.name)}</b> czeka na odblokowanie. Podaj kod dostępu, aby zacząć naukę.</p>
      <div style="display:flex;gap:8px;justify-content:center;max-width:360px;margin:0 auto">
        <input id="gateCode" placeholder="kod dostępu" autocomplete="off" style="flex:1;font:inherit;font-size:15px;padding:10px 13px;border-radius:10px;border:1px solid var(--line-strong);background:var(--paper);color:var(--ink)">
        <button class="btn btn--primary" id="gateGo">Odblokuj</button>
      </div>
      <div class="err" id="gateErr">Kod nieprawidłowy lub nieaktywny.</div>
      <p style="margin-top:18px"><a href="${homeHref()}" style="color:var(--ink-soft);font-size:13px;text-decoration:none">← Strona główna</a></p></div>`;
    const go=target.querySelector("#gateGo"), err=target.querySelector("#gateErr"), inp=target.querySelector("#gateCode");
    const submit=async()=>{
      const code=inp.value.trim(); if(!code) return;
      go.disabled=true; go.textContent="…"; err.classList.remove("show");
      const ok=await Powtorka.redeemCode(code);
      if(ok){ location.reload(); } else { err.classList.add("show"); go.disabled=false; go.textContent="Odblokuj"; }
    };
    go.onclick=submit; inp.addEventListener("keydown",e=>{ if(e.key==="Enter") submit(); }); inp.focus();
  }

  /* ---------------- bezpieczne formatowanie treści ---------------- */
  // Obsługuje: **pogrubienie**, listy (linie zaczynające się od - * • – —),
  // akapity (pusta linia) i pojedyncze złamania linii. Resztę escapuje (XSS-safe).
  function formatText(raw) {
    raw = raw == null ? "" : String(raw);
    const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    const isBullet = (l) => /^\s*[-*•–—]\s+/.test(l);
    const lines = raw.split(/\r?\n/);
    let html = "", listOpen = false, para = [];
    const flushPara = () => { if (para.length) { html += "<p>" + para.join("<br>") + "</p>"; para = []; } };
    const closeList = () => { if (listOpen) { html += "</ul>"; listOpen = false; } };
    lines.forEach((line) => {
      if (isBullet(line)) {
        flushPara();
        if (!listOpen) { html += "<ul>"; listOpen = true; }
        html += "<li>" + inline(line.replace(/^\s*[-*•–—]\s+/, "")) + "</li>";
      } else if (line.trim() === "") {
        flushPara(); closeList();
      } else {
        closeList(); para.push(inline(line));
      }
    });
    flushPara(); closeList();
    return html || "<p></p>";
  }

  window.PUI = { modal, streakChip, examOpen, notesOpen, accessGate, toast, esc, shuffle, formatText };
})();
