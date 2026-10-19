/* Страны Европы — PWA для заучивания положения стран и столиц. */
"use strict";

(() => {
  const STORE_KEY = "geogame.v1";
  const LENGTHS = [10, 20, 30, "all"]; // «all» — каждая страна выбранного региона ровно один раз
  const MICRO_R = 10;     // радиус видимого маркера микрогосударства, px
  const MICRO_CORE = 11;  // в этом радиусе (видимый маркер) тап всегда уходит микрогосударству
  const MICRO_HIT = 24;   // невидимый круг: срабатывает, если под пальцем море/фон
  const LABEL_OVERRIDES = { NO: [9.5, 61.6], HR: [16.0, 45.6], RU: [40, 56], GR: [22.0, 39.6], DK: [9.2, 56.1], IT: [14.8, 41.2], CH: [7.7, 46.7] };

  let DATA = null;
  const BY = {};
  const REGION = {};

  /* ================= Хранилище ================= */

  const defaults = () => ({
    settings: {
      groups: { russia: false, turkey: false, cyprus: false, caucasus: false },
      vibrate: true,
      sound: false,
      showLearned: true,
      sessionLen: 20,
      examInput: "keyboard", // столица в экзамене: keyboard — вписать, voice — назвать вслух и оценить себя
      region: "all",
    },
    progress: {},
    tick: 0,
    blitzBest: {}, // рекорды блица: ключ «регион:длина»
  });

  function loadStore() {
    const d = defaults();
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && typeof s === "object") {
        return {
          ...d,
          ...s,
          settings: { ...d.settings, ...s.settings, groups: { ...d.settings.groups, ...(s.settings || {}).groups } },
          progress: s.progress || {},
          // Старый формат: один рекорд на 20 стран.
          blitzBest: s.blitzBest && "score" in s.blitzBest ? { "all:20": s.blitzBest } : s.blitzBest || {},
        };
      }
    } catch (e) { /* повреждённые данные — начинаем заново */ }
    return d;
  }
  let store = loadStore();
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* приватный режим */ } };

  const peek = (code) => store.progress[code];
  const prog = (code) => (store.progress[code] ||= {
    box: 1, streak: 0, seen: 0, right: 0, wrong: 0, locWrong: 0, capWrong: 0, learned: false, last: 0,
  });

  const isActive = (c) => !c.group || !!store.settings.groups[c.group];
  const activeCountries = () => DATA.countries.filter(isActive);
  const inRegion = (c, r) => r === "all" || c.region === r;
  const isLearned = (code) => !!(peek(code) && peek(code).learned);

  // Лейтнер: ошибка -> коробка 1, верно -> следующая коробка.
  // «Выучено» = 2 раза подряд верно и положение, и столица (режимы «Тест» и «Блиц», без подсказки).
  function record(code, { ok, loc = null, cap = null, full = false, hinted = false }) {
    const p = prog(code);
    p.seen++;
    p.last = ++store.tick;
    if (loc === false) p.locWrong++;
    if (cap === false) p.capWrong++;
    if (ok) {
      p.right++;
      p.box = Math.min(3, p.box + 1);
      if (full && !hinted) {
        p.streak++;
        if (p.streak >= 2) p.learned = true;
      }
    } else {
      p.wrong++;
      p.box = 1;
      p.streak = 0;
      p.learned = false;
    }
    save();
    updateBadge();
  }

  function weight(code, sess) {
    const p = peek(code);
    let w;
    if (!p || !p.seen) w = 3;           // ещё не встречалась
    else if (p.learned) w = 0.35;        // выучена — изредка
    else w = [0, 5, 2.5, 1.2][p.box];    // коробки 1..3
    if (sess && sess.missed.has(code)) w *= 2;
    return w;
  }

  function pickWeighted(pool, sess) {
    const recentN = Math.min(3, pool.length - 1);
    const recent = recentN > 0 ? sess.history.slice(-recentN) : [];
    const cands = pool.filter((c) => !recent.includes(c));
    let total = 0;
    const acc = cands.map((c) => (total += weight(c, sess)));
    const r = Math.random() * total;
    const i = acc.findIndex((x) => x >= r);
    return cands[i < 0 ? cands.length - 1 : i];
  }

  function weakList() {
    return activeCountries()
      .filter((c) => { const p = peek(c.code); return p && p.wrong > 0 && !p.learned; })
      .sort((a, b) => {
        const pa = peek(a.code), pb = peek(b.code);
        return pa.box - pb.box || pb.wrong / pb.seen - pa.wrong / pa.seen || pb.wrong - pa.wrong;
      });
  }

  /* ================= Утилиты ================= */

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const fmtTime = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

  function buzz(kind) {
    if (kind === "bad" && store.settings.vibrate && navigator.vibrate) {
      try { navigator.vibrate([60, 40, 60]); } catch (e) { /* не поддерживается */ }
    }
    if (store.settings.sound) beep(kind);
  }

  let audioCtx = null;
  function beep(kind) {
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = kind === "ok" ? 880 : 220;
      o.type = kind === "ok" ? "sine" : "triangle";
      g.gain.setValueAtTime(0.12, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
      o.connect(g).connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + 0.26);
    } catch (e) { /* без звука */ }
  }

  let flashTimer = 0;
  function flash(text, kind = "") {
    const el = $("#flash");
    el.textContent = text;
    el.className = "show " + kind;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.className = kind; }, 1400);
  }

  const ICON_GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

  /* ================= Карта ================= */

  const M = {
    t: d3.zoomIdentity,
    w: 0,
    h: 0,
    classFn: () => "",
    fx: [],
    onTap: () => {},

    init(geo) {
      const svg = d3.select("#map");
      this.svg = svg;
      this.gZoom = svg.append("g");
      this.gMarkers = svg.append("g").attr("class", "markers");
      this.gFx = svg.append("g").attr("class", "fx");

      // Фон рисуем первым, чтобы играбельные страны были сверху.
      const feats = geo.features.slice().sort((a, b) => (b.properties.bg || 0) - (a.properties.bg || 0));
      this.byCode = new Map(feats.filter((f) => f.properties.code).map((f) => [f.properties.code, f]));
      this.mainGeom = {};
      for (const [code, f] of this.byCode) this.mainGeom[code] = largestPolygon(f.geometry);

      this.paths = this.gZoom.selectAll("path").data(feats).join("path")
        .attr("data-code", (d) => d.properties.code || null);
      this.pathEl = {};
      this.paths.each(function (d) { if (d.properties.code) M.pathEl[d.properties.code] = this; });

      this.micro = DATA.countries.filter((c) => c.micro);
      this.markers = this.gMarkers.selectAll("g").data(this.micro).join("g")
        .attr("class", "marker").attr("data-code", (c) => c.code);
      this.markers.append("circle").attr("r", MICRO_R);

      this.zoom = d3.zoom()
        .scaleExtent([1, 40])
        .on("zoom", (ev) => {
          this.t = ev.transform;
          this.gZoom.attr("transform", this.t);
          this.updateOverlay();
        });
      svg.call(this.zoom).on("dblclick.zoom", null);
      this.bindTaps(svg.node());

      new ResizeObserver(() => this.layout()).observe(svg.node());
      this.layout(true);
    },

    // Свой детектор тапа: короткое касание одним пальцем без сдвига.
    bindTaps(el) {
      const down = new Map();
      let start = null;
      let multi = false;
      el.addEventListener("pointerdown", (e) => {
        down.set(e.pointerId, true);
        if (down.size === 1) { start = { x: e.clientX, y: e.clientY, t: e.timeStamp }; multi = false; } else multi = true;
      });
      const end = (e, cancelled) => {
        const had = down.delete(e.pointerId);
        if (!had) return;
        if (!cancelled && !multi && start && down.size === 0) {
          const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
          if (moved < 10 && e.timeStamp - start.t < 800) this.tapAt(e.clientX, e.clientY);
        }
        if (down.size === 0) { start = null; multi = false; }
      };
      el.addEventListener("pointerup", (e) => end(e, false));
      el.addEventListener("pointercancel", (e) => end(e, true));
      // Тап по карте открывает поле ввода столицы; не даём следующим за тапом
      // мышиным событиям сразу же снять с него фокус (и закрыть клавиатуру).
      const keepInput = (e) => { if (document.activeElement && document.activeElement.id === "capInput") e.preventDefault(); };
      el.addEventListener("touchend", keepInput, { passive: false });
      el.addEventListener("mousedown", keepInput);
    },

    tapAt(cx, cy) {
      const r = this.svg.node().getBoundingClientRect();
      const x = cx - r.left, y = cy - r.top;
      let best = null, bd = Infinity;
      for (const c of this.micro) {
        if (!isActive(c) || this.markerHidden[c.code]) continue;
        const [mx, my] = this.screenPt(c.code);
        const d = Math.hypot(mx - x, my - y);
        if (d < bd) { bd = d; best = c.code; }
      }
      const hit = document.elementFromPoint(cx, cy);
      const pathEl = hit && hit.closest ? hit.closest("path[data-code]") : null;
      const pathCode = pathEl && !pathEl.classList.contains("off") ? pathEl.dataset.code : null;
      const pathIsBig = pathCode && !BY[pathCode].micro;
      if (best && (bd <= MICRO_CORE || (bd <= MICRO_HIT && !pathIsBig))) return this.onTap(best);
      if (pathCode) this.onTap(pathCode);
    },

    focusShape() {
      const pts = [[-24, 64.5], [-10, 36.5], [-9, 58], [6, 71], [28, 71], [41, 48], [33, 35], [14, 35.5]];
      const g = store.settings.groups;
      if (g.russia) pts.push([46, 58], [44, 66]);
      if (g.turkey) pts.push([44.5, 37.5], [36, 36]);
      if (g.caucasus) pts.push([50.5, 40], [46, 43]);
      return { type: "MultiPoint", coordinates: pts };
    },

    layout(force) {
      const r = this.svg.node().getBoundingClientRect();
      const w = Math.round(r.width), h = Math.round(r.height);
      if (!w || !h || (!force && w === this.w && h === this.h)) return;
      this.w = w;
      this.h = h;
      this.projection = d3.geoConicConformal().parallels([40, 62]).rotate([-14, 0])
        .fitExtent([[8, 8], [w - 8, h - 8]], this.focusShape());
      this.path = d3.geoPath(this.projection);
      this.paths.attr("d", this.path);

      this.label = {};
      this.size = {};
      this.bounds = {};
      for (const [code, f] of this.byCode) {
        const c = BY[code];
        const g = this.mainGeom[code];
        let pt;
        if (c && c.micro) pt = this.projection(c.micro);
        else if (LABEL_OVERRIDES[code]) pt = this.projection(LABEL_OVERRIDES[code]);
        else pt = this.path.centroid(g);
        this.label[code] = pt;
        const b = this.path.bounds(g);
        this.bounds[code] = b;
        this.size[code] = Math.max(b[1][0] - b[0][0], b[1][1] - b[0][1]);
      }
      this.zoom.extent([[0, 0], [w, h]]).translateExtent([[-w * 0.5, -h * 0.5], [w * 1.5, h * 1.5]]);
      this.svg.call(this.zoom.transform, d3.zoomIdentity);
      this.updateOverlay();
      if (this.afterLayout) this.afterLayout();
    },

    screenPt(code) { return this.t.apply(this.label[code]); },

    updateOverlay() {
      if (!this.label) return;
      this.markerHidden = {};
      this.markers
        .attr("transform", (c) => { const [x, y] = this.screenPt(c.code); return `translate(${x},${y})`; })
        .classed("hidden", (c) => {
          // Когда страна сама стала крупной, маркер не нужен.
          const hide = !isActive(c) || this.size[c.code] * this.t.k > 34;
          this.markerHidden[c.code] = hide;
          return hide;
        });
      for (const f of this.fx) {
        const [x, y] = this.screenPt(f.code);
        f.el.attr("transform", `translate(${x},${y})`);
      }
    },

    paint(fn) {
      if (fn) this.classFn = fn;
      const cls = (code) => {
        const c = BY[code];
        if (!isActive(c)) return "off";
        return this.classFn(code) || "";
      };
      this.paths.attr("class", (d) => d.properties.bg ? "country bg" : "country " + cls(d.properties.code));
      this.markers.attr("class", (c) => "marker " + cls(c.code));
      // Выделенные страны поднимаем наверх, чтобы обводка не пряталась под соседями.
      this.paths.filter((d) => d.properties.code && /\b(sel|ok|bad|target)\b/.test(cls(d.properties.code))).raise();
      this.updateOverlay();
    },

    pulse(code, color = "") {
      const el = this.gFx.append("g").attr("class", "pulse " + color);
      el.append("circle").attr("r", 14);
      el.append("circle").attr("r", 14);
      el.append("path").attr("d", "M0,-12 L-9,-28 L-3,-28 L-3,-40 L3,-40 L3,-28 L9,-28 Z");
      this.fx.push({ code, el });
      this.updateOverlay();
    },

    clearFx() {
      for (const f of this.fx) f.el.remove();
      this.fx = [];
    },

    visible(code, pad = 24) {
      const [x, y] = this.screenPt(code);
      return x > pad && x < this.w - pad && y > pad && y < this.h - pad;
    },

    zoomTo(codes, { maxK = 8, minSize = 60, duration = 550 } = {}) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const code of codes) {
        const b = BY[code].micro ? [this.label[code], this.label[code]] : this.bounds[code];
        x0 = Math.min(x0, b[0][0]); y0 = Math.min(y0, b[0][1]);
        x1 = Math.max(x1, b[1][0]); y1 = Math.max(y1, b[1][1]);
      }
      if (!isFinite(x0)) return;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const dx = Math.max(x1 - x0, minSize), dy = Math.max(y1 - y0, minSize);
      const k = Math.max(1, Math.min(maxK, 0.8 / Math.max(dx / this.w, dy / this.h)));
      const t = d3.zoomIdentity.translate(this.w / 2, this.h / 2).scale(k).translate(-cx, -cy);
      this.svg.transition().duration(duration).call(this.zoom.transform, t);
    },

    ensureVisible(codes) {
      if (codes.every((c) => this.visible(c))) return;
      this.zoomTo(codes, { maxK: Math.max(1, Math.min(this.t.k, 6)), minSize: 120 });
    },

    reset(duration = 450) {
      this.svg.transition().duration(duration).call(this.zoom.transform, d3.zoomIdentity);
    },
  };

  function largestPolygon(geom) {
    if (geom.type !== "MultiPolygon") return geom;
    let best = null, ba = -1;
    for (const coords of geom.coordinates) {
      const g = { type: "Polygon", coordinates: coords };
      const a = d3.geoArea(g);
      if (a > ba) { ba = a; best = g; }
    }
    return best;
  }

  /* ================= Интерфейс ================= */

  const ui = { tab: "map", studySel: null, session: null, lastSession: null };
  const showsTarget = (mode) => mode === "reverse" || mode === "capitals" || mode === "typing";
  const MODES = {
    exam: { title: "Тест «как на экзамене»", desc: "Найдите страну на карте, затем столица", ico: "🎯" },
    reverse: { title: "Обратный режим", desc: "Страна подсвечена — вспомните название и столицу", ico: "🔁" },
    capitals: { title: "Только столицы", desc: "Выберите столицу из 4 вариантов", ico: "🏛️" },
    typing: { title: "Столица с клавиатуры", desc: "Впишите столицу сами, мелкие опечатки прощаются", ico: "⌨️" },
    blitz: { title: "Блиц", desc: "На время: место на карте + столица", ico: "⚡" },
  };

  function learnedCount(list = activeCountries()) {
    return list.filter((c) => isLearned(c.code)).length;
  }

  function regionChips(action) {
    const cur = store.settings.region;
    const list = [{ id: "all", name: "Все" }, ...DATA.regions];
    return list.map((r) => {
      const cs = activeCountries().filter((c) => inRegion(c, r.id));
      return `<button type="button" class="chip" data-action="${action}" data-region="${r.id}" aria-pressed="${cur === r.id}">${esc(r.name)}<small>${learnedCount(cs)}/${cs.length}</small></button>`;
    }).join("");
  }

  function boxes(code) {
    const p = peek(code);
    const b = p ? p.box : 0;
    return `<span class="boxes" title="Коробка ${b || 1} из 3">${[1, 2, 3].map((i) => `<i class="${p && p.seen && i <= b ? "on" : ""}"></i>`).join("")}</span>`;
  }

  function setPage(html) {
    const page = $("#page");
    if (html == null) { page.hidden = true; page.innerHTML = ""; return; }
    page.hidden = false;
    page.innerHTML = html;
  }

  function render() {
    document.querySelectorAll("#tabbar button").forEach((b) => {
      if (b.dataset.tab === ui.tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    stopTimer();
    if (ui.tab === "map") renderStudy();
    else if (ui.tab === "test") (ui.session ? (ui.session.done ? renderResult() : renderSession()) : renderTestMenu());
    else if (ui.tab === "errors") renderErrors();
    else renderStats();
  }

  /* ---------- Изучение ---------- */

  function studyPaint() {
    const r = store.settings.region;
    M.paint((code) => {
      const c = BY[code];
      if (code === ui.studySel) return "sel";
      if (!inRegion(c, r)) return "dim";
      if (store.settings.showLearned && isLearned(code)) return "learned";
      return "";
    });
  }

  function renderStudy() {
    const all = activeCountries();
    $("#topbar").innerHTML = `
      <div class="toprow">
        <h1>Карта</h1>
        <span class="sub">Выучено ${learnedCount(all)}/${all.length}</span>
        <button type="button" class="iconbtn" data-action="settings" aria-label="Настройки">${ICON_GEAR}</button>
      </div>
      <div class="chips">
        ${regionChips("studyRegion")}
        <button type="button" class="chip" data-action="toggleShowLearned" aria-pressed="${store.settings.showLearned}">✓ Выученные зелёным</button>
      </div>`;
    setPage(null);
    const c = ui.studySel && BY[ui.studySel];
    if (!c) {
      $("#panel").innerHTML = `<div class="empty-hint">Нажмите на страну — покажу название и столицу.<br>Щипок — масштаб, палец — перетаскивание.</div>`;
    } else {
      const p = peek(c.code);
      const status = isLearned(c.code) ? "✓ выучена" : p && p.seen ? `коробка ${p.box} из 3` : "ещё не тренировали";
      $("#panel").innerHTML = `
        <div class="prompt">${esc(c.name)}</div>
        <div class="capital-big">${esc(c.capital)}</div>
        <div class="meta">${esc(REGION[c.region])} · ${status}</div>
        <div class="spacer"></div>
        <div class="row">
          <button type="button" class="btn" data-action="toggleLearned">${isLearned(c.code) ? "Снять отметку «выучено»" : "Отметить выученной"}</button>
          <button type="button" class="btn small" data-action="studyClose" aria-label="Закрыть">✕</button>
        </div>`;
    }
    studyPaint();
  }

  /* ---------- Меню теста ---------- */

  function renderTestMenu() {
    const all = activeCountries();
    $("#topbar").innerHTML = `
      <div class="toprow">
        <h1>Тест</h1>
        <span class="sub">Выучено ${learnedCount(all)}/${all.length}</span>
        <button type="button" class="iconbtn" data-action="settings" aria-label="Настройки">${ICON_GEAR}</button>
      </div>`;
    const len = store.settings.sessionLen;
    const regionCount = all.filter((c) => inRegion(c, store.settings.region)).length;
    setPage(`
      <div class="card">
        <h3>Регион · ${regionCount} стран</h3>
        <div class="chips">${regionChips("testRegion")}</div>
      </div>
      <div class="card">
        <h3>Вопросов в сессии</h3>
        <div class="seg">${LENGTHS.map((n) => `<button type="button" data-action="sessionLen" data-n="${n}" aria-pressed="${len === n}">${n === "all" ? `Все (${regionCount})` : n}</button>`).join("")}</div>
        <p class="mt">${len === "all"
          ? "Каждая страна региона спрашивается один раз, в случайном порядке."
          : "Чаще спрашиваются новые и ошибочные страны, реже — выученные. В блице страны не повторяются."}</p>
      </div>
      <div class="card">
        <h3>Столица в экзамене</h3>
        <div class="seg">${[["keyboard", "⌨️ Вписать"], ["voice", "🗣️ Вслух"]].map(([v, t]) =>
          `<button type="button" data-action="examInput" data-v="${v}" aria-pressed="${store.settings.examInput === v}">${t}</button>`).join("")}</div>
      </div>
      ${Object.entries(MODES).map(([id, m]) => `
        <button type="button" class="mode ${id === "exam" ? "main" : ""}" data-action="start" data-mode="${id}">
          <span class="ico" aria-hidden="true">${m.ico}</span>
          <span class="grow"><b>${esc(m.title)}</b><span>${esc(m.desc)}</span></span>
        </button>`).join("")}`);
    $("#panel").innerHTML = "";
  }

  /* ---------- Сессия ---------- */

  function startSession(mode, customPool) {
    const region = store.settings.region;
    let pool = customPool || activeCountries().filter((c) => inRegion(c, region)).map((c) => c.code);
    if (!pool.length) { flash("В этом регионе нет стран"); return; }
    const lenSetting = store.settings.sessionLen;
    let len, order = null;
    if (customPool) {
      len = Math.max(4, Math.min(30, pool.length * 2));
    } else if (mode === "blitz" || lenSetting === "all") {
      // Без повторов: блиц и «Все» идут по перемешанному списку.
      order = shuffle(pool).slice(0, lenSetting === "all" ? pool.length : lenSetting);
      len = order.length;
    } else {
      len = lenSetting;
    }
    ui.session = {
      mode, pool, len, order, custom: !!customPool,
      keyboard: mode === "typing" || (mode === "exam" && store.settings.examInput === "keyboard"),
      recordKey: mode === "blitz" && !customPool ? `${region}:${lenSetting}` : null,
      i: 0, okCount: 0, history: [], missed: new Set(), results: [],
      started: Date.now(), locRight: 0, capRight: 0, done: false,
    };
    ui.lastSession = { mode, customPool };
    clearTimeout(flashTimer);
    $("#flash").className = "";
    ui.tab = "test";
    M.reset(0);
    nextQuestion();
  }

  function nextQuestion() {
    const s = ui.session;
    if (!s) return;
    clearTimeout(s.timer);
    if (s.i >= s.len) return finishSession();
    s.cur = s.order ? s.order[s.i] : pickWeighted(s.pool, s);
    s.history.push(s.cur);
    Object.assign(s, { step: "ask", hinted: false, tapped: null, locOk: null, choice: null, options: null, typed: "", verdict: null });
    M.clearFx();
    if (s.mode === "capitals" || s.mode === "blitz") s.options = capitalOptions(s.cur);
    if (showsTarget(s.mode)) {
      focusTarget(s.cur);
      M.pulse(s.cur, "blue");
    }
    render();
  }

  function focusTarget(c, duration = 550) {
    if (BY[c].micro || M.size[c] < 40) M.zoomTo([c], { maxK: 6, minSize: 110, duration });
    else if (!M.visible(c, 40)) M.reset(duration);
  }

  function capitalOptions(code) {
    const c = BY[code];
    const same = shuffle(DATA.countries.filter((x) => x.code !== code && x.region === c.region && x.capital !== c.capital));
    const preferred = same.filter(isActive).concat(same.filter((x) => !isActive(x)));
    const others = shuffle(DATA.countries.filter((x) => x.code !== code && x.region !== c.region && isActive(x)));
    const caps = [];
    for (const x of preferred.concat(others)) {
      if (caps.length >= 3) break;
      if (!caps.includes(x.capital)) caps.push(x.capital);
    }
    return shuffle([c.capital, ...caps]);
  }

  function sessionPaint() {
    const s = ui.session;
    M.paint((code) => {
      if (s.mode === "typing") return code === s.cur ? (s.step === "ask" ? "target" : s.verdict === "wrong" ? "bad" : "ok") : "";
      if (showsTarget(s.mode)) return code === s.cur ? (s.step === "ask" ? "target" : s.locOk === false ? "bad" : "ok") : "";
      if (s.tapped == null) return "";
      if (code === s.cur) return "ok";
      if (code === s.tapped) return "bad";
      return "";
    });
  }

  function sessionTopbar() {
    const s = ui.session;
    const pct = Math.round((s.i / s.len) * 100);
    const wrong = s.i - s.okCount;
    return `
      <div class="toprow">
        <button type="button" class="iconbtn" data-action="quit" aria-label="Завершить">${ICON_CLOSE}</button>
        <div class="progress" role="progressbar" aria-valuenow="${s.i}" aria-valuemax="${s.len}"><i style="width:${pct}%"></i></div>
        <span class="counter">${Math.min(s.i + 1, s.len)}/${s.len} · <span class="okc">✓${s.okCount}</span> <span class="badc">✗${wrong}</span>${s.mode === "blitz" ? ` · ⏱ <span id="timer">${fmtTime(Date.now() - s.started)}</span>` : ""}</span>
      </div>`;
  }

  function renderSession() {
    const s = ui.session;
    const c = BY[s.cur];
    setPage(null);
    $("#topbar").innerHTML = sessionTopbar();
    const hint = s.hinted
      ? `<span class="hint-text">Столица на «${esc(c.capital[0])}»</span>`
      : `<button type="button" class="btn ghost small" data-action="hint">💡 Первая буква</button>`;
    let html = "";

    if ((s.keyboard && s.step !== "ask") || s.mode === "typing") {
      html = capInputPanel(s, c);
    } else if (s.mode === "exam") {
      if (s.step === "ask") {
        html = `<div class="prompt-label">${s.keyboard ? "Покажите на карте, затем впишите столицу" : "Покажите на карте и назовите столицу"}</div>
          <div class="prompt">${esc(c.name)}</div>
          <div class="spacer"></div>
          <div class="row"><span class="meta grow">Нажмите на страну 👆</span>${hint}</div>`;
      } else if (s.step === "located") {
        const t = BY[s.tapped];
        html = `<div class="prompt-label">${s.locOk ? "✅ Верно, это" : `❌ Вы нажали: ${esc(t.name)}. Правильно —`}</div>
          <div class="prompt">${esc(c.name)}</div>
          <div class="spacer"></div>
          <div class="row">${hint}<button type="button" class="btn primary" data-action="reveal">Показать столицу</button></div>`;
      } else {
        html = `<div class="prompt-label">${s.locOk ? "✅ Положение верно" : "❌ Положение — ошибка"} · ${esc(c.name)}</div>
          <div class="prompt capital-big" style="font-size:28px">${esc(c.capital)}</div>
          <div class="meta">Вы назвали столицу правильно?</div>
          <div class="spacer"></div>
          <div class="row">
            <button type="button" class="btn ok" data-action="selfGrade" data-ok="1">Знал(а) ✅</button>
            <button type="button" class="btn bad" data-action="selfGrade" data-ok="0">Не знал(а) ❌</button>
          </div>`;
      }
    } else if (s.mode === "reverse") {
      if (s.step === "ask") {
        html = `<div class="prompt-label">Обратный режим</div>
          <div class="prompt">Что это за страна и её столица?</div>
          <div class="meta">Страна подсвечена на карте</div>
          <div class="spacer"></div>
          <button type="button" class="btn primary" data-action="reveal">Показать ответ</button>`;
      } else {
        html = `<div class="prompt">${esc(c.name)}</div>
          <div class="capital-big">${esc(c.capital)}</div>
          <div class="spacer"></div>
          <div class="row">
            <button type="button" class="btn ok" data-action="selfGrade" data-ok="1">Знал(а) ✅</button>
            <button type="button" class="btn bad" data-action="selfGrade" data-ok="0">Не знал(а) ❌</button>
          </div>`;
      }
    } else if (s.mode === "capitals" || (s.mode === "blitz" && s.step !== "ask")) {
      html = `<div class="prompt-label">${s.mode === "blitz" ? (s.locOk ? "✅ Место верно · столица?" : "❌ Место — ошибка · столица?") : "Столица страны"}</div>
        <div class="prompt">${esc(c.name)}</div>
        <div class="grid2">${s.options.map((o) => {
          let cls = "";
          if (s.choice != null) { if (o === c.capital) cls = "right"; else if (o === s.choice) cls = "wrong"; }
          return `<button type="button" class="btn opt ${cls}" data-action="choose" data-cap="${esc(o)}" ${s.choice != null ? "disabled" : ""}>${esc(o)}</button>`;
        }).join("")}</div>`;
    } else {
      html = `<div class="prompt-label">Блиц · найдите на карте</div>
        <div class="prompt">${esc(c.name)}</div>
        <div class="spacer"></div>
        <div class="meta">Нажмите на страну 👆 Затем выберите столицу.</div>`;
    }
    $("#panel").innerHTML = html;
    // Фокус ставится синхронно в обработчике нажатия, поэтому клавиатура iOS не закрывается между вопросами.
    const input = $("#capInput");
    if (input && document.activeElement !== input) input.focus({ preventScroll: true });
    sessionPaint();
    if (s.mode === "blitz") startTimer();
  }

  function onSessionTap(code) {
    const s = ui.session;
    if (!s || s.done || s.step !== "ask" || !(s.mode === "exam" || s.mode === "blitz")) return;
    s.tapped = code;
    s.locOk = code === s.cur;
    if (s.locOk) {
      flash("Верно!", "ok");
      buzz("ok");
    } else {
      flash(`Это ${BY[code].name}`, "bad");
      buzz("bad");
      M.pulse(s.cur);
      M.ensureVisible([s.cur, code]);
    }
    s.step = s.mode === "blitz" ? "cap" : "located";
    render();
  }

  // Ввод столицы с клавиатуры: режим «Столица с клавиатуры» и экзамен после тапа по карте.
  function capInputPanel(s, c) {
    const done = s.step === "checked";
    let status;
    if (!done) {
      if (s.mode === "typing") status = "Страна подсвечена на карте";
      else status = s.locOk ? `<span class="okc">✅ Место верно</span> · впишите столицу` : `<span class="badc">❌ Вы нажали: ${esc(BY[s.tapped].name)}</span> · впишите столицу`;
    } else {
      const loc = s.mode === "exam" ? (s.locOk ? `<span class="okc">Место ✅</span> · ` : `<span class="badc">Место ❌</span> · `) : "";
      if (s.verdict === "exact") status = loc + `<span class="okc">✅ ${esc(c.capital)}</span>`;
      else if (s.verdict === "close") status = loc + `<span class="okc">✅ Почти, пишется «${esc(c.capital)}»</span>`;
      else status = loc + `<span class="badc">❌ Правильно: ${esc(c.capital)}</span>`;
    }
    const hint = s.hinted
      ? `<span class="hint-text">Столица на «${esc(c.capital[0])}»</span>`
      : `<button type="button" class="btn ghost small" data-action="hint">💡 Первая буква</button>`;
    return `<div class="prompt-label">${status}</div>
      <div class="prompt">${esc(c.name)}</div>
      <form id="capForm" class="row" autocomplete="off">
        <input id="capInput" class="text-input ${done ? (s.verdict === "wrong" ? "wrong" : "right") : ""}" type="text" inputmode="text"
          placeholder="Столица…" autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false"
          enterkeyhint="${done ? "next" : "done"}" value="${esc(s.typed)}" ${done ? "readonly" : ""} aria-label="Столица страны ${esc(c.name)}">
        <button type="submit" class="btn primary small">${done ? "Дальше" : "Проверить"}</button>
      </form>
      <div class="row">${done ? "" : `${hint}<span class="grow"></span><button type="button" class="btn ghost small" data-action="giveUp">Не знаю</button>`}</div>`;
  }

  const inputStep = (s) => (s.mode === "typing" ? "ask" : "located");

  function gradeTyped(ok) {
    const s = ui.session;
    if (s.mode === "exam") finishQuestion(s.locOk && ok, { loc: s.locOk, cap: ok, full: true, hinted: s.hinted });
    else finishQuestion(ok, { cap: ok });
    buzz(ok ? "ok" : "bad");
    s.step = "checked";
    render();
  }

  const normCap = (v) => v.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я]/g, "");

  function levenshtein(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // exact — совпало (без учёта регистра, ё/е, дефисов и пробелов), close — опечатка, wrong — неверно.
  function judgeCapital(typed, capital) {
    const a = normCap(typed), b = normCap(capital);
    if (!a) return "wrong";
    if (a === b) return "exact";
    const allowed = b.length >= 9 ? 2 : b.length >= 5 ? 1 : 0;
    return levenshtein(a, b) <= allowed ? "close" : "wrong";
  }

  function submitTyped(value) {
    const s = ui.session;
    if (!s || !s.keyboard) return;
    if (s.step === "checked") return nextQuestion();
    if (s.step !== inputStep(s)) return;
    s.typed = value.trim();
    if (!s.typed) { flash("Впишите столицу или нажмите «Не знаю»"); return; }
    s.verdict = judgeCapital(s.typed, BY[s.cur].capital);
    gradeTyped(s.verdict !== "wrong");
  }

  function finishQuestion(ok, extra) {
    const s = ui.session;
    record(s.cur, { ok, ...extra });
    s.results.push({ code: s.cur, ok });
    if (ok) { s.okCount++; s.missed.delete(s.cur); } else s.missed.add(s.cur);
    s.i++;
  }

  function finishSession() {
    const s = ui.session;
    s.done = true;
    s.elapsed = Date.now() - s.started;
    if (s.recordKey) {
      const b = store.blitzBest[s.recordKey];
      const better = !b || s.okCount > b.score || (s.okCount === b.score && s.elapsed < b.ms);
      if (better) { store.blitzBest[s.recordKey] = { score: s.okCount, ms: s.elapsed, of: s.len }; s.record = true; save(); }
    }
    M.clearFx();
    render();
  }

  function renderResult() {
    const s = ui.session;
    const pct = Math.round((s.okCount / Math.max(1, s.len)) * 100);
    const mistakes = [...new Set(s.results.filter((r) => !r.ok).map((r) => r.code))];
    $("#topbar").innerHTML = `<div class="toprow"><h1>${esc(MODES[s.mode].title)}</h1></div>`;
    setPage(`
      <div class="card result-hero">
        <div class="big-num">${s.okCount} из ${s.len}</div>
        <p class="mt">${pct >= 90 ? "Отлично! 🎉" : pct >= 60 ? "Хороший результат 👍" : "Есть над чем поработать 💪"} · ${pct}%</p>
        ${s.mode === "blitz" ? `<p class="mt">Время: <b>${fmtTime(s.elapsed)}</b> · место ✓${s.locRight} · столица ✓${s.capRight}${s.record ? " · 🏆 новый рекорд" : ""}</p>` : ""}
      </div>
      ${mistakes.length ? `<div class="card"><h3>Ошибки в этой сессии</h3><ul class="list">${mistakes.map((code) => `
        <li><span class="grow"><div class="name">${esc(BY[code].name)}</div><div class="cap">${esc(BY[code].capital)}</div></span>${boxes(code)}</li>`).join("")}</ul></div>` : ""}
      <div class="row"><button type="button" class="btn primary" data-action="again">Ещё раз</button></div>
      ${mistakes.length ? `<div class="row mt"><button type="button" class="btn" data-action="trainList" data-codes="${mistakes.join(",")}">Тренировать эти ошибки</button></div>` : ""}
      <div class="row mt"><button type="button" class="btn ghost" data-action="quit">В меню</button></div>`);
    $("#panel").innerHTML = "";
  }

  let timerId = 0;
  function startTimer() {
    stopTimer();
    timerId = setInterval(() => {
      const el = $("#timer");
      if (el && ui.session) el.textContent = fmtTime(Date.now() - ui.session.started);
    }, 250);
  }
  function stopTimer() { clearInterval(timerId); }

  /* ---------- Ошибки ---------- */

  function renderErrors() {
    const weak = weakList();
    $("#topbar").innerHTML = `<div class="toprow"><h1>Мои ошибки</h1><span class="sub">${weak.length ? weak.length + " стран" : ""}</span></div>`;
    setPage(weak.length ? `
      <button type="button" class="btn primary" style="width:100%;margin-bottom:12px" data-action="trainWeak">Тренировать только их (${weak.length})</button>
      <div class="card"><ul class="list">${weak.map((c) => {
        const p = peek(c.code);
        return `<li data-action="showOnMap" data-code="${c.code}">
          <span class="grow"><div class="name">${esc(c.name)}</div><div class="cap">${esc(c.capital)} · ${esc(REGION[c.region])}</div></span>
          ${boxes(c.code)}<span class="pill" title="ошибок">✗ ${p.wrong}</span></li>`;
      }).join("")}</ul></div>
      <p class="muted center-text" style="font-size:13px">Страна уходит из списка, когда вы дважды подряд верно назовёте и место, и столицу.</p>`
      : `<div class="card center-text" style="padding:28px 14px"><div style="font-size:44px">🎉</div><h2>Ошибок нет</h2><p>Здесь появятся страны, на которых вы ошибались.</p></div>`);
    $("#panel").innerHTML = "";
  }

  /* ---------- Статистика ---------- */

  function renderStats() {
    const all = activeCountries();
    const learned = learnedCount(all);
    const pct = Math.round((learned / Math.max(1, all.length)) * 100);
    let answers = 0, right = 0;
    for (const c of all) { const p = peek(c.code); if (p) { answers += p.seen; right += p.right; } }
    const acc = answers ? Math.round((right / answers) * 100) + "%" : "—";
    const lenSetting = store.settings.sessionLen;
    const bb = store.blitzBest[`all:${lenSetting}`];
    const best = bb ? `${bb.score}/${bb.of} · ${fmtTime(bb.ms)}` : "—";
    const bestLabel = `рекорд блица, ${lenSetting === "all" ? "все страны" : lenSetting + " стран"}`;
    const hardest = all.filter((c) => peek(c.code) && peek(c.code).wrong > 0)
      .sort((a, b) => { const pa = peek(a.code), pb = peek(b.code); return pb.wrong / pb.seen - pa.wrong / pa.seen || pb.wrong - pa.wrong; })
      .slice(0, 7);

    $("#topbar").innerHTML = `<div class="toprow"><h1>Статистика</h1><button type="button" class="iconbtn" data-action="settings" aria-label="Настройки">${ICON_GEAR}</button></div>`;
    setPage(`
      <div class="card">
        <div class="big-num">${pct}%</div>
        <p class="mt">Выучено ${learned} из ${all.length} стран</p>
        <div class="kpis">
          <div class="kpi"><b>${answers}</b><span>ответов</span></div>
          <div class="kpi"><b>${acc}</b><span>точность</span></div>
          <div class="kpi"><b style="font-size:15px;line-height:24px">${best}</b><span>${bestLabel}</span></div>
        </div>
      </div>
      <div class="card">
        <h3>По регионам</h3>
        ${DATA.regions.map((r) => {
          const cs = all.filter((c) => c.region === r.id);
          if (!cs.length) return "";
          const l = learnedCount(cs);
          const inProg = cs.filter((c) => !isLearned(c.code) && peek(c.code) && peek(c.code).seen).length;
          return `<div class="bar-row"><div class="lbl"><span>${esc(r.name)}</span><span>${l}/${cs.length}</span></div>
            <div class="bar"><i class="l" style="width:${(l / cs.length) * 100}%"></i><i class="p" style="width:${(inProg / cs.length) * 100}%"></i></div></div>`;
        }).join("")}
        <p class="mt" style="font-size:13px"><span style="color:var(--ok)">■</span> выучено &nbsp; <span style="color:var(--accent)">■</span> в процессе</p>
      </div>
      <div class="card">
        <h3>Самые трудные страны</h3>
        ${hardest.length ? `<ul class="list">${hardest.map((c) => {
          const p = peek(c.code);
          const parts = [];
          if (p.locWrong) parts.push(`место ✗${p.locWrong}`);
          if (p.capWrong) parts.push(`столица ✗${p.capWrong}`);
          return `<li data-action="showOnMap" data-code="${c.code}"><span class="grow"><div class="name">${esc(c.name)}</div><div class="cap">${esc(c.capital)}${parts.length ? " · " + parts.join(", ") : ""}</div></span>
            <span class="pill">${Math.round((p.wrong / p.seen) * 100)}% ошибок</span></li>`;
        }).join("")}</ul>` : `<p>Пока нет данных — пройдите тест.</p>`}
      </div>
      <button type="button" class="btn" style="width:100%" data-action="askReset"><span class="danger">Сбросить прогресс</span></button>`);
    $("#panel").innerHTML = "";
  }

  /* ---------- Настройки и подтверждение ---------- */

  function toggleRow(key, title, sub, on) {
    return `<button type="button" class="toggle" role="switch" aria-checked="${on}" data-action="setting" data-key="${key}">
      <span class="grow">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ""}</span><span class="switch" aria-hidden="true"></span></button>`;
  }

  function openSettings() {
    const st = store.settings;
    const sheet = $("#sheet");
    sheet.className = "overlay";
    sheet.innerHTML = `
      <div class="sheet" role="dialog" aria-label="Настройки">
        <div class="toprow"><h2 style="flex:1;margin:0">Настройки</h2><button type="button" class="iconbtn" data-action="closeSheet" aria-label="Закрыть">${ICON_CLOSE}</button></div>
        <div class="card mt">
          <h3>Дополнительные страны</h3>
          ${DATA.groups.map((g) => toggleRow("group:" + g.id, g.name, "", !!st.groups[g.id])).join("")}
        </div>
        <div class="card">
          <h3>Поведение</h3>
          ${toggleRow("vibrate", "Вибрация при ошибке", "Если устройство поддерживает (в iOS Safari недоступна)", st.vibrate)}
          ${toggleRow("sound", "Звук", "Короткий сигнал при ответе", st.sound)}
          ${toggleRow("showLearned", "Красить выученные зелёным", "На вкладке «Карта»", st.showLearned)}
        </div>
        <button type="button" class="btn" style="width:100%" data-action="askReset"><span class="danger">Сбросить прогресс…</span></button>
        <p class="muted center-text mt" style="font-size:12px">Карта: Natural Earth (общественное достояние). Прогресс хранится только на этом устройстве.</p>
      </div>`;
    sheet.hidden = false;
  }

  function closeSheet() {
    const sheet = $("#sheet");
    sheet.hidden = true;
    sheet.innerHTML = "";
  }

  function confirmDialog(text, okLabel, onOk) {
    const sheet = $("#sheet");
    sheet.className = "overlay center";
    sheet.innerHTML = `
      <div class="sheet dialog" role="alertdialog" aria-label="Подтверждение">
        <h2>${esc(text)}</h2>
        <p class="muted">Это действие нельзя отменить.</p>
        <div class="row mt">
          <button type="button" class="btn" data-action="closeSheet">Отмена</button>
          <button type="button" class="btn danger-fill" data-action="confirmOk">${esc(okLabel)}</button>
        </div>
      </div>`;
    sheet.hidden = false;
    confirmDialog.onOk = onOk;
  }

  function updateBadge() {
    const n = DATA ? weakList().length : 0;
    const b = $("#errBadge");
    b.hidden = !n;
    b.textContent = n > 99 ? "99+" : String(n);
  }

  /* ---------- Действия ---------- */

  const actions = {
    tab(el) {
      ui.tab = el.dataset.tab;
      M.clearFx();
      if (ui.tab === "test" && ui.session && !ui.session.done) {
        // Возврат в идущую сессию: восстановить пульс.
        const s = ui.session;
        if (showsTarget(s.mode)) M.pulse(s.cur, "blue");
        else if (s.tapped && !s.locOk) M.pulse(s.cur);
      }
      render();
    },
    settings: openSettings,
    closeSheet,
    confirmOk() { const fn = confirmDialog.onOk; closeSheet(); if (fn) fn(); },
    setting(el) {
      const key = el.dataset.key;
      const st = store.settings;
      if (key.startsWith("group:")) {
        const g = key.slice(6);
        st.groups[g] = !st.groups[g];
        if (ui.studySel && !isActive(BY[ui.studySel])) ui.studySel = null;
        save();
        M.layout(true);
        M.paint();
      } else {
        st[key] = !st[key];
        save();
      }
      el.setAttribute("aria-checked", key.startsWith("group:") ? st.groups[key.slice(6)] : st[key]);
      updateBadge();
      render();
    },
    askReset() {
      confirmDialog("Сбросить весь прогресс?", "Сбросить", () => {
        store.progress = {};
        store.tick = 0;
        store.blitzBest = {};
        save();
        updateBadge();
        flash("Прогресс сброшен");
        render();
      });
    },
    studyRegion(el) {
      store.settings.region = el.dataset.region;
      save();
      ui.studySel = null;
      const r = store.settings.region;
      if (r === "all") M.reset();
      else M.zoomTo(activeCountries().filter((c) => c.region === r).map((c) => c.code), { maxK: 5 });
      render();
    },
    testRegion(el) { store.settings.region = el.dataset.region; save(); render(); },
    toggleShowLearned() { store.settings.showLearned = !store.settings.showLearned; save(); render(); },
    toggleLearned() {
      const code = ui.studySel;
      if (!code) return;
      const p = prog(code);
      if (p.learned) { p.learned = false; p.streak = 0; p.box = Math.min(p.box, 2); }
      else { p.learned = true; p.box = 3; p.streak = Math.max(p.streak, 2); }
      save();
      updateBadge();
      render();
    },
    studyClose() { ui.studySel = null; render(); },
    examInput(el) { store.settings.examInput = el.dataset.v; save(); render(); },
    sessionLen(el) { const n = el.dataset.n; store.settings.sessionLen = n === "all" ? "all" : +n; save(); render(); },
    start(el) { startSession(el.dataset.mode); },
    again() {
      const l = ui.lastSession;
      if (l) startSession(l.mode, l.customPool);
    },
    trainList(el) { startSession("exam", el.dataset.codes.split(",")); },
    trainWeak() {
      const weak = weakList().map((c) => c.code);
      if (weak.length) startSession("exam", weak);
    },
    quit() {
      const s = ui.session;
      if (s) clearTimeout(s.timer);
      ui.session = null;
      M.clearFx();
      M.reset();
      render();
    },
    hint() {
      const s = ui.session;
      if (!s) return;
      s.hinted = true;
      render();
    },
    reveal() {
      const s = ui.session;
      if (!s) return;
      s.step = "revealed";
      render();
    },
    selfGrade(el) {
      const s = ui.session;
      if (!s || s.step !== "revealed") return;
      const knew = el.dataset.ok === "1";
      if (s.mode === "exam") {
        finishQuestion(s.locOk && knew, { loc: s.locOk, cap: knew, full: true, hinted: s.hinted });
      } else {
        finishQuestion(knew, { cap: knew });
      }
      if (!knew) buzz("bad");
      nextQuestion();
    },
    giveUp() {
      const s = ui.session;
      if (!s || !s.keyboard || s.step !== inputStep(s)) return;
      s.typed = "";
      s.verdict = "wrong";
      gradeTyped(false);
    },
    choose(el) {
      const s = ui.session;
      if (!s || s.choice != null) return;
      s.choice = el.dataset.cap;
      const right = s.choice === BY[s.cur].capital;
      if (s.mode === "blitz") {
        if (s.locOk) s.locRight++;
        if (right) s.capRight++;
        finishQuestion(s.locOk && right, { loc: s.locOk, cap: right, full: true });
      } else {
        finishQuestion(right, { cap: right });
      }
      buzz(right ? "ok" : "bad");
      if (!right) flash(`Столица — ${BY[s.cur].capital}`, "bad");
      render();
      s.timer = setTimeout(nextQuestion, s.mode === "blitz" ? (right ? 450 : 1100) : (right ? 700 : 1800));
    },
    showOnMap(el) {
      const code = el.dataset.code;
      ui.tab = "map";
      ui.studySel = code;
      if (!inRegion(BY[code], store.settings.region)) store.settings.region = "all";
      render();
      M.zoomTo([code], { maxK: 6, minSize: 140 });
    },
  };

  // iOS: при открытой клавиатуре подгоняем приложение под видимую область, чтобы поле ввода не пряталось.
  function watchKeyboard() {
    const vv = window.visualViewport;
    if (!vv) return;
    const app = $("#app");
    const update = () => {
      const open = vv.height < window.innerHeight - 120;
      document.documentElement.classList.toggle("kb-open", open);
      app.style.height = open ? vv.height + "px" : "";
      app.style.transform = open && vv.offsetTop ? `translateY(${vv.offsetTop}px)` : "";
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
  }

  /* ================= Запуск ================= */

  async function boot() {
    document.addEventListener("click", (e) => {
      const el = e.target.closest("[data-action],[data-tab]");
      if (!el) {
        if (e.target === $("#sheet")) closeSheet();
        return;
      }
      if (el.dataset.tab) return actions.tab(el);
      const fn = actions[el.dataset.action];
      if (fn) fn(el);
    });
    $("#resetView").addEventListener("click", () => M.reset());
    document.addEventListener("submit", (e) => {
      if (e.target.id !== "capForm") return;
      e.preventDefault();
      submitTyped($("#capInput").value);
    });
    watchKeyboard();
    // iOS: запрещаем масштабирование страницы жестами, кроме самой карты.
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    document.addEventListener("dblclick", (e) => e.preventDefault());

    const [countries, geo] = await Promise.all([
      fetch("data/countries.json").then((r) => r.json()),
      fetch("data/europe.geojson").then((r) => r.json()),
    ]);
    DATA = countries;
    for (const c of DATA.countries) BY[c.code] = c;
    for (const r of DATA.regions) REGION[r.id] = r.name;

    M.onTap = (code) => {
      if (ui.tab === "map") {
        ui.studySel = ui.studySel === code ? null : code;
        render();
      } else if (ui.tab === "test" && ui.session) {
        onSessionTap(code);
      }
    };
    M.init(geo);
    // Карта перестраивается при смене размера (поворот, клавиатура) — снова показываем загаданную страну.
    M.afterLayout = () => {
      const s = ui.session;
      if (ui.tab !== "test" || !s || s.done) return;
      if (showsTarget(s.mode)) focusTarget(s.cur, 0);
      else if (s.tapped) M.ensureVisible([s.cur, s.tapped]);
    };
    updateBadge();
    render();

    // Тестовый крючок для автопроверки.
    window.__geogame = { M, ui, store: () => store, actions, BY };
  }

  boot().catch((err) => {
    console.error(err);
    $("#panel").innerHTML = `<div class="empty-hint">Не удалось загрузить данные: ${esc(err.message)}</div>`;
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW:", e));
    });
  }
})();
