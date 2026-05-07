/* ════════════════════════════════════════════════
   J.A.R.V.I.S — Neural Core v3.0 · app.js
   ════════════════════════════════════════════════ */

const API_BASE    = window.location.origin;
const MAX_HISTORY = 20;
const state       = { history: [], isLoading: false, messageCount: 0 };

const DOM = {
  messagesArea:      () => document.getElementById("messages-area"),
  overdueBanner:     () => document.getElementById("overdue-banner"),
  overdueBannerText: () => document.getElementById("overdue-banner-text"),
  monitorList:       () => document.getElementById("monitor-list"),
  monitorBadge:      () => document.getElementById("monitor-overdue-badge"),
  welcomeScreen:     () => document.getElementById("welcome-screen"),
  messageInput:      () => document.getElementById("message-input"),
  sendButton:        () => document.getElementById("send-button"),
  sendIcon:          () => document.querySelector(".send-icon"),
  loadingIcon:       () => document.querySelector(".loading-icon"),
  typingIndicator:   () => document.getElementById("typing-indicator"),
  charCounter:       () => document.getElementById("char-counter"),
  msgCounter:        () => document.getElementById("msg-counter"),
  btnClearChat:      () => document.getElementById("btn-clear-chat"),
  btnMenuToggle:     () => document.getElementById("btn-menu-toggle"),
  leftSidebar:       () => document.getElementById("left-sidebar"),
  toastContainer:    () => document.getElementById("toast-container"),
  liveTime:          () => document.getElementById("live-time"),
  liveDate:          () => document.getElementById("live-date"),
  temperatureSlider: () => document.getElementById("temperature-slider"),
  temperatureValue:  () => document.getElementById("temperature-value"),
  hdrLatency:        () => document.getElementById("hdr-latency"),
  rsLatency:         () => document.getElementById("rs-latency"),
  hdrSystemStatus:   () => document.getElementById("hdr-system-status"),
  hdrLogSource:      () => document.getElementById("hdr-log-source"),
  hdrLogMode:        () => document.getElementById("hdr-log-mode"),
  rsStatusDot:       () => document.getElementById("rs-status-dot"),
  rsStatusText:      () => document.getElementById("rs-status-text"),
  rsSource:          () => document.getElementById("rs-source"),
  rsMode:            () => document.getElementById("rs-mode"),
  rsEvents:          () => document.getElementById("rs-events"),
  rsLastEvent:       () => document.getElementById("rs-last-event"),
};

function setText(el, value) {
  if (el) el.textContent = value;
}

function formatSourceName(source) {
  switch (source) {
    case "sqlite-ingest": return "SQLITE";
    case "google-drive": return "GOOGLE DRIVE";
    case "local": return "PASTA LOCAL";
    case "none": return "NAO CONFIG.";
    case "error": return "ERRO";
    default: return String(source || "DESCONHECIDO").toUpperCase();
  }
}

function formatLogMode(info = {}) {
  if (info.ingestEnabled) return "INGEST + FALLBACK";
  if (info.mode === "google-drive") return "GOOGLE DRIVE";
  if (info.mode === "local") return "LOCAL";
  return "SEM LOGS";
}

function formatDateTime(value) {
  if (!value) return "SEM DADOS";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "SEM DADOS";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function refreshSystemStatus() {
  const [healthResult, infoResult, debugResult] = await Promise.allSettled([
    fetch(`${API_BASE}/api/health`),
    fetch(`${API_BASE}/api/info`),
    fetch(`${API_BASE}/api/logs-debug`),
  ]);

  let health = null;
  let info = null;
  let debug = null;

  if (healthResult.status === "fulfilled" && healthResult.value.ok) {
    health = await healthResult.value.json();
  }
  if (infoResult.status === "fulfilled" && infoResult.value.ok) {
    info = await infoResult.value.json();
  }
  if (debugResult.status === "fulfilled" && debugResult.value.ok) {
    debug = await debugResult.value.json();
  }

  const healthy = health?.status === "healthy";
  const sourceLabel = formatSourceName(debug?.source || info?.logs?.mode);
  const modeLabel = formatLogMode(info?.logs || {});
  const totalEvents = debug?.ingest?.totalEvents ?? state.messageCount;
  const lastEvent = formatDateTime(debug?.ingest?.lastEventAt);

  setText(DOM.hdrSystemStatus(), healthy ? "OPERACIONAL" : "DEGRADADO");
  setText(DOM.hdrLogSource(), sourceLabel);
  setText(DOM.hdrLogMode(), modeLabel);
  setText(DOM.msgCounter(), String(totalEvents));

  setText(DOM.rsStatusText(), healthy ? "OPERACIONAL" : "DEGRADADO");
  setText(DOM.rsSource(), sourceLabel);
  setText(DOM.rsMode(), modeLabel);
  setText(DOM.rsEvents(), String(totalEvents));
  setText(DOM.rsLastEvent(), lastEvent);

  const dot = DOM.rsStatusDot();
  if (dot) {
    dot.style.background = healthy ? "var(--success)" : "var(--danger)";
    dot.style.boxShadow = healthy ? "0 0 8px var(--success)" : "0 0 8px var(--danger)";
  }
}

/* ─── Monitor ────────────────────────────────── */
const STATUS_LABEL = { ok: "OK", overdue: "ATRASADA", pending: "AGUARDANDO", not_connected: "S/ CONEXÃO", not_scheduled: "NÃO AGENDADA" };

function formatMonitorTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

async function refreshMonitor() {
  try {
    const res = await fetch(`${API_BASE}/api/monitor`);
    if (!res.ok) return;
    const data = await res.json();

    const list = DOM.monitorList();
    const badge = DOM.monitorBadge();
    const banner = DOM.overdueBanner();
    const bannerText = DOM.overdueBannerText();

    if (list) {
      list.innerHTML = data.automations.map((a) => {
        const meta = a.status === "ok"
          ? formatMonitorTime(a.lastEventAt)
          : a.status === "overdue"
          ? `${a.hoursElapsed}h atraso`
          : a.status === "pending"
          ? `${a.hoursElapsed}h atrás`
          : "";
        return `<div class="monitor-item ${a.status}">
          <span class="monitor-dot ${a.status}"></span>
          <span class="monitor-name" title="${a.displayName}">${a.displayName}</span>
          <span class="monitor-meta">${meta}</span>
        </div>`;
      }).join("");
    }

    const overdueCount = data.overdueCount || 0;
    if (badge) { badge.textContent = overdueCount; badge.hidden = overdueCount === 0; }
    if (banner && bannerText) {
      banner.hidden = overdueCount === 0;
      bannerText.textContent = `${overdueCount} AUTOMAÇÃO${overdueCount > 1 ? "ÕES" : ""} ATRASADA${overdueCount > 1 ? "S" : ""}`;
    }
  } catch (_) {}
}

/* ─── Clock ──────────────────────────────────── */
function updateClock() {
  const now = new Date();
  const t = now.toLocaleTimeString("pt-BR", { hour12: false });
  const d = now.toLocaleDateString("pt-BR", { day:"2-digit", month:"short", year:"numeric" }).toUpperCase();
  if (DOM.liveTime()) DOM.liveTime().textContent = t;
  if (DOM.liveDate()) DOM.liveDate().textContent = d;
}

/* ─── Loading ────────────────────────────────── */
function setLoading(on) {
  state.isLoading = on;
  const input = DOM.messageInput(), btn = DOM.sendButton();
  if (!input || !btn) return;
  input.disabled = on;
  if (on) {
    btn.disabled = true;
    if (DOM.sendIcon())        DOM.sendIcon().hidden        = true;
    if (DOM.loadingIcon())     DOM.loadingIcon().hidden     = false;
    if (DOM.typingIndicator()) DOM.typingIndicator().hidden = false;
  } else {
    btn.disabled = input.value.trim().length === 0;
    if (DOM.sendIcon())        DOM.sendIcon().hidden        = false;
    if (DOM.loadingIcon())     DOM.loadingIcon().hidden     = true;
    if (DOM.typingIndicator()) DOM.typingIndicator().hidden = true;
    input.focus();
  }
}

/* ─── Toast ──────────────────────────────────── */
function showToast(msg, type = "info") {
  const c = DOM.toastContainer(); if (!c) return;
  const t = document.createElement("div");
  t.className = `toast toast-${type}`; t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.classList.add("toast-out"); setTimeout(() => t.remove(), 280); }, 3500);
}

/* ─── Char counter ───────────────────────────── */
function updateCharCounter(len) {
  const el = DOM.charCounter(); if (!el) return;
  el.textContent = `${len}/8000`;
  el.className = len > 7500 ? "char-counter danger" : len > 6000 ? "char-counter warning" : "char-counter";
}

/* ─── Markdown ───────────────────────────────── */
function parseMarkdown(text) {
  if (!text) return "";
  return text
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/```(\w*)\n?([\s\S]*?)```/g,'<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/\n/g,'<br>');
}

/* ─── Render message ─────────────────────────── */
function renderMessage(role, text) {
  const area = DOM.messagesArea();
  const ws   = DOM.welcomeScreen();
  if (ws) ws.remove();
  const time = new Date().toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit" });
  const wrap = document.createElement("div");
  wrap.className = `message-wrapper ${role}`;
  wrap.innerHTML = `
    <div class="message-avatar">${role === "user" ? "EU" : "J"}</div>
    <div class="message-content">
      <div class="message-bubble">${parseMarkdown(text)}</div>
      <div class="message-meta">${time}</div>
    </div>`;
  area.appendChild(wrap);
  area.scrollTo({ top: area.scrollHeight, behavior: "smooth" });
}

/* ─── Send ───────────────────────────────────── */
async function sendMessage() {
  const input = DOM.messageInput();
  const msg   = input?.value.trim();
  if (!msg || state.isLoading) return;

  state.messageCount++;
  renderMessage("user", msg);
  input.value = ""; input.style.height = "auto";
  updateCharCounter(0); setLoading(true);

  if (DOM.msgCounter()) DOM.msgCounter().textContent = state.messageCount;

  try {
    const temp = parseFloat(DOM.temperatureSlider()?.value ?? "0.7");
    const res  = await fetch(`${API_BASE}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, history: state.history.slice(-MAX_HISTORY), options: { temperature: temp } }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro na API");

    renderMessage("assistant", data.text);
    state.history.push({ role:"user", content:msg }, { role:"assistant", content:data.text });

    if (data.latencyMs) {
      const lat = `${data.latencyMs}ms`;
      if (DOM.hdrLatency()) DOM.hdrLatency().textContent = lat;
      if (DOM.rsLatency())  DOM.rsLatency().textContent  = lat;
    }
    await refreshSystemStatus();
  } catch (err) {
    showToast(`FALHA: ${err.message}`, "error");
  } finally {
    setLoading(false);
  }
}

/* ─── Background particles ───────────────────── */
function initParticles() {
  const canvas = document.getElementById("bg-particles"); if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H, pts;
  const resize = () => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; };
  const mkPt   = () => ({ x:Math.random()*W, y:Math.random()*H, vx:(Math.random()-.5)*.25, vy:(Math.random()-.5)*.25, a:Math.random()*.4+.1 });
  resize(); pts = Array.from({length:70}, mkPt);
  window.addEventListener("resize", resize);
  (function draw() {
    ctx.clearRect(0,0,W,H);
    for (const p of pts) {
      ctx.beginPath(); ctx.arc(p.x, p.y, .8, 0, Math.PI*2);
      ctx.fillStyle = `rgba(0,217,255,${p.a})`; ctx.fill();
      p.x += p.vx; p.y += p.vy;
      if (p.x<0||p.x>W) p.vx*=-1;
      if (p.y<0||p.y>H) p.vy*=-1;
    }
    requestAnimationFrame(draw);
  })();
}

/* ─── 3D Holographic Sphere ──────────────────── */
function initSphere() {
  const canvas = document.getElementById("neural-sphere"); if (!canvas) return;
  const SIZE = canvas.offsetWidth || 340;
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  const cx = SIZE / 2, cy = SIZE / 2;
  const R = SIZE * 0.34;

  /* gera pontos uniformes na superfície da esfera */
  const pts = [];
  const N = 280;
  for (let i = 0; i < N; i++) {
    const phi   = Math.acos(1 - 2 * (i + 0.5) / N);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    pts.push({ phi, theta });
  }

  let angle = 0;

  function project(phi, theta) {
    const t = theta + angle;
    const x = R * Math.sin(phi) * Math.cos(t);
    const y = R * Math.cos(phi);
    const z = R * Math.sin(phi) * Math.sin(t);
    return { px: cx + x, py: cy + y, z };
  }

  (function draw() {
    ctx.clearRect(0, 0, SIZE, SIZE);
    angle += 0.006;

    /* projeta todos os pontos */
    const projected = pts.map(p => ({ ...project(p.phi, p.theta) }));

    /* ordena por z (back-to-front) */
    projected.sort((a, b) => a.z - b.z);

    /* linhas entre pontos próximos */
    for (let i = 0; i < projected.length; i++) {
      const a = projected[i];
      for (let j = i + 1; j < projected.length; j++) {
        const b = projected[j];
        const dx = a.px - b.px, dy = a.py - b.py;
        const d  = Math.sqrt(dx*dx + dy*dy);
        if (d < SIZE * 0.09) {
          const depth  = ((a.z + b.z) / 2 + R) / (2 * R);
          const alpha  = (1 - d / (SIZE * 0.09)) * depth * 0.18;
          ctx.beginPath();
          ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py);
          ctx.strokeStyle = `rgba(0,160,255,${alpha})`;
          ctx.lineWidth = 0.6; ctx.stroke();
        }
      }
    }

    /* pontos */
    for (const p of projected) {
      const depth = (p.z + R) / (2 * R);
      const r     = depth * 1.8 + 0.4;
      const alpha = 0.15 + depth * 0.85;
      ctx.beginPath(); ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
      /* cor: pontos na frente mais brilhantes/azul-ciano */
      const g = Math.round(160 + depth * 57);
      ctx.fillStyle = `rgba(0,${g},255,${alpha * 0.85})`;
      ctx.fill();
    }

    /* brilho central */
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.55);
    grd.addColorStop(0, "rgba(0,150,255,0.18)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grd; ctx.fillRect(0, 0, SIZE, SIZE);

    requestAnimationFrame(draw);
  })();
}

/* ─── World map (canvas simples) ─────────────── */
function initWorldMap() {
  const canvas = document.getElementById("world-map-canvas"); if (!canvas) return;
  const W = canvas.offsetWidth || 216, H = canvas.offsetHeight || 90;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  /* grade */
  ctx.strokeStyle = "rgba(0,217,255,0.06)"; ctx.lineWidth = 0.5;
  for (let x = 0; x <= W; x += 18) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 18) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

  /* continentes simplificados como polígonos */
  const continents = [
    [[0.05,0.25],[0.18,0.18],[0.28,0.20],[0.30,0.40],[0.22,0.55],[0.10,0.50]],
    [[0.32,0.15],[0.48,0.12],[0.52,0.35],[0.46,0.55],[0.34,0.52],[0.30,0.35]],
    [[0.52,0.15],[0.70,0.12],[0.74,0.30],[0.68,0.45],[0.55,0.48],[0.50,0.30]],
    [[0.72,0.20],[0.84,0.18],[0.88,0.38],[0.80,0.55],[0.72,0.45]],
    [[0.35,0.58],[0.48,0.55],[0.52,0.85],[0.38,0.88]],
    [[0.75,0.60],[0.85,0.58],[0.88,0.80],[0.76,0.82]],
  ];

  ctx.fillStyle = "rgba(0,130,255,0.14)";
  ctx.strokeStyle = "rgba(0,217,255,0.22)"; ctx.lineWidth = 0.8;
  for (const shape of continents) {
    ctx.beginPath();
    ctx.moveTo(shape[0][0]*W, shape[0][1]*H);
    for (let i=1;i<shape.length;i++) ctx.lineTo(shape[i][0]*W, shape[i][1]*H);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
}

/* ─── Slider ─────────────────────────────────── */
function updateSlider(slider) {
  const pct = (parseFloat(slider.value) / parseFloat(slider.max)) * 100;
  slider.style.background = `linear-gradient(to right,#00D9FF ${pct}%,rgba(0,217,255,0.1) ${pct}%)`;
}

/* ─── Init ───────────────────────────────────── */
function init() {
  const input = DOM.messageInput(), btn = DOM.sendButton();
  if (!input || !btn) return;

  updateClock(); setInterval(updateClock, 1000);
  refreshSystemStatus().catch(() => {
    showToast("Nao foi possivel carregar o status operacional.", "error");
  });
  refreshMonitor().catch(() => {});
  setInterval(() => {
    refreshSystemStatus().catch(() => {});
    refreshMonitor().catch(() => {});
  }, 60000);

  initParticles();
  initSphere();
  initWorldMap();

  input.addEventListener("input", () => {
    const len = input.value.length;
    btn.disabled = state.isLoading || input.value.trim().length === 0;
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 100) + "px";
    updateCharCounter(len);
  });

  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!btn.disabled) sendMessage(); }
  });

  btn.addEventListener("click", sendMessage);

  /* Quick cards */
  const area = DOM.messagesArea();
  if (area) {
    area.addEventListener("click", e => {
      const card = e.target.closest(".qcard");
      if (card) {
        const msg = card.getAttribute("data-msg");
        if (msg) { input.value = msg; input.dispatchEvent(new Event("input")); sendMessage(); }
      }
    });
  }

  /* Clear = reload */
  DOM.btnClearChat()?.addEventListener("click", () => location.reload());

  /* Mobile sidebar */
  DOM.btnMenuToggle()?.addEventListener("click", () => DOM.leftSidebar()?.classList.toggle("open"));
  document.addEventListener("click", e => {
    const sb = DOM.leftSidebar(), tb = DOM.btnMenuToggle();
    if (sb?.classList.contains("open") && !sb.contains(e.target) && !tb?.contains(e.target))
      sb.classList.remove("open");
  });

  /* Nav active */
  document.querySelectorAll(".nav-item").forEach(el =>
    el.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach(x => x.classList.remove("active"));
      el.classList.add("active");
    })
  );

  /* Slider */
  const slider = DOM.temperatureSlider();
  if (slider) {
    updateSlider(slider);
    slider.addEventListener("input", e => {
      if (DOM.temperatureValue()) DOM.temperatureValue().textContent = parseFloat(e.target.value).toFixed(1);
      updateSlider(e.target);
    });
  }

  input.focus();
}

document.addEventListener("DOMContentLoaded", init);
