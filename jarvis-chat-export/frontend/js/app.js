/* ════════════════════════════════════════════════
   J.A.R.V.I.S — Neural Core v5.0 · app.js
   ════════════════════════════════════════════════ */

const API_BASE    = window.location.origin;
const MAX_HISTORY = 20;
const CONVS_KEY   = "jarvis_convs_v1";
const LEGADO_KEY  = "jarvis_chat_v1";   // formato de conversa unica, migrado na 1a carga
const MEMORIA_KEY = "jarvis_memoria_v1";
const MAX_FATOS   = 60;                 // mesmo teto que o backend aceita

const state = {
  isLoading: false,
  sessionStart: Date.now(),
  conversas: [],           // [{ id, titulo, mensagens, history, criadaEm, atualizadaEm }]
  idAtual: null,           // null = tela inicial do Jarvis, fora de qualquer conversa
  fatos: [],               // memoria persistente: [{ id, texto, origem, criadoEm }]
  modoDocs: false,         // responder com base nas notas indexadas (RAG local)
  contextoMax: null,       // n_ctx real do llama-server, vindo do /api/health
  tokensSessao: 0,         // soma dos tokens gastos desde que a aba abriu
};

const DOM = {
  messagesArea:      () => document.getElementById("messages-area"),
  welcomeScreen:     () => document.getElementById("welcome-screen"),
  messageInput:      () => document.getElementById("message-input"),
  sendButton:        () => document.getElementById("send-button"),
  sendIcon:          () => document.querySelector(".send-icon"),
  loadingIcon:       () => document.querySelector(".loading-icon"),
  typingIndicator:   () => document.getElementById("typing-indicator"),
  charCounter:       () => document.getElementById("char-counter"),
  btnClearChat:      () => document.getElementById("btn-clear-chat"),
  btnMenuToggle:     () => document.getElementById("btn-menu-toggle"),
  leftSidebar:       () => document.getElementById("left-sidebar"),
  toastContainer:    () => document.getElementById("toast-container"),
  liveTime:          () => document.getElementById("live-time"),
  liveDate:          () => document.getElementById("live-date"),
  rsStatusDot:       () => document.getElementById("rs-status-dot"),
  rsStatusText:      () => document.getElementById("rs-status-text"),
  rsLatency:         () => document.getElementById("rs-latency"),
  rsUptime:          () => document.getElementById("rs-uptime"),
  rsModel:           () => document.getElementById("rs-model"),
  rsPrecisao:        () => document.getElementById("rs-precisao"),
  rsPeso:            () => document.getElementById("rs-peso"),
  rsMotor:           () => document.getElementById("rs-motor"),
  rsVelocidade:      () => document.getElementById("rs-velocidade"),
  rsCache:           () => document.getElementById("rs-cache"),
  rsCtxValor:        () => document.getElementById("rs-ctx-valor"),
  rsCtxPct:          () => document.getElementById("rs-ctx-pct"),
  rsCtxFill:         () => document.getElementById("rs-ctx-fill"),
  rsTokens:          () => document.getElementById("rs-tokens"),
  rsTokensSessao:    () => document.getElementById("rs-tokens-sessao"),
  navModo:           () => document.getElementById("nav-modo"),
  navDocs:           () => document.getElementById("nav-docs"),
  navJarvis:         () => document.getElementById("nav-jarvis"),
  navNova:           () => document.getElementById("nav-nova-conversa"),
  convList:          () => document.getElementById("conv-list"),
  convEmpty:         () => document.getElementById("conv-empty"),
  convCount:         () => document.getElementById("conv-count"),
  memoriaList:       () => document.getElementById("memoria-list"),
  memoriaCount:      () => document.getElementById("memoria-count"),
  memoriaInput:      () => document.getElementById("memoria-input"),
  memoriaAddBtn:     () => document.getElementById("memoria-add-btn"),
  btnDocs:           () => document.getElementById("btn-docs"),
  btnVoz:            () => document.getElementById("btn-voz"),
  btnMic:            () => document.getElementById("btn-mic"),
};

function setText(el, value) { if (el) el.textContent = value; }

/* ─── Formatadores ───────────────────────────── */

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

/* ═══════════════════════════════════════════════
   CONVERSAS — persistencia e navegacao
   ═══════════════════════════════════════════════
   Tudo mora no localStorage do navegador. O servidor nao guarda conversa
   nenhuma: cada requisicao leva o historico que o front mandar.
   Nao ha expiracao — conversa salva fica ate ser apagada a mao. */

function salvarConversas() {
  try {
    localStorage.setItem(CONVS_KEY, JSON.stringify({ versao: 1, conversas: state.conversas }));
  } catch (_) {
    showToast("Não foi possível salvar a conversa (armazenamento cheio?).", "error");
  }
}

function carregarConversas() {
  try {
    const raw = localStorage.getItem(CONVS_KEY);
    if (raw) {
      const dados = JSON.parse(raw);
      state.conversas = Array.isArray(dados?.conversas) ? dados.conversas : [];
      return;
    }
  } catch (_) { state.conversas = []; }

  // Migra a conversa unica do formato antigo, para nao perder o que ja existia.
  try {
    const antigo = localStorage.getItem(LEGADO_KEY);
    if (!antigo) return;
    const dados = JSON.parse(antigo);
    if (dados?.messages?.length) {
      const quando = dados.savedAt || Date.now();
      state.conversas = [{
        id: gerarId(),
        titulo: tituloDe(dados.messages.find(m => m.role === "user")?.text),
        mensagens: dados.messages,
        history: dados.history || [],
        criadaEm: quando,
        atualizadaEm: quando,
      }];
      salvarConversas();
    }
    localStorage.removeItem(LEGADO_KEY);
  } catch (_) {}
}

function gerarId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function tituloDe(texto) {
  const limpo = (texto || "").replace(/\s+/g, " ").trim();
  if (!limpo) return "Conversa sem título";
  return limpo.length > 42 ? limpo.slice(0, 42).trimEnd() + "…" : limpo;
}

function conversaAtual() {
  return state.conversas.find(c => c.id === state.idAtual) || null;
}

function formatarQuando(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const agora = new Date();
  const mesmoDia = d.toDateString() === agora.toDateString();
  if (mesmoDia) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const ontem = new Date(agora); ontem.setDate(agora.getDate() - 1);
  if (d.toDateString() === ontem.toDateString()) return "ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/* ─── Lista na sidebar ───────────────────────── */
function renderListaConversas() {
  const lista = DOM.convList();
  if (!lista) return;

  setText(DOM.convCount(), String(state.conversas.length));

  const ordenadas = [...state.conversas].sort((a, b) => (b.atualizadaEm || 0) - (a.atualizadaEm || 0));
  lista.innerHTML = "";

  if (!ordenadas.length) {
    const vazio = document.createElement("p");
    vazio.className = "conv-empty";
    vazio.id = "conv-empty";
    vazio.textContent = "Nenhuma conversa ainda.";
    lista.appendChild(vazio);
    return;
  }

  for (const conv of ordenadas) {
    const item = document.createElement("div");
    item.className = `conv-item${conv.id === state.idAtual ? " active" : ""}`;
    item.dataset.id = conv.id;
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.title = conv.titulo;

    const corpo = document.createElement("div");
    corpo.className = "conv-item-body";

    const titulo = document.createElement("span");
    titulo.className = "conv-item-title";
    titulo.textContent = conv.titulo;

    const meta = document.createElement("span");
    meta.className = "conv-item-meta";
    const trocas = conv.mensagens.filter(m => m.role === "user").length;
    meta.textContent = `${formatarQuando(conv.atualizadaEm)} · ${trocas} ${trocas === 1 ? "pergunta" : "perguntas"}`;

    corpo.appendChild(titulo);
    corpo.appendChild(meta);

    const excluir = document.createElement("button");
    excluir.className = "conv-del";
    excluir.title = "Excluir conversa";
    excluir.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`;

    item.appendChild(corpo);
    item.appendChild(excluir);
    lista.appendChild(item);
  }
}

/* ─── Navegação ──────────────────────────────── */

/** Limpa as bolhas do DOM sem tocar na tela de boas-vindas. */
function limparMensagensDaTela() {
  DOM.messagesArea()?.querySelectorAll(".message-wrapper").forEach(el => el.remove());
}

/** Tela inicial: esfera e sugestões, fora de qualquer conversa. */
function mostrarTelaInicial() {
  state.idAtual = null;
  limparMensagensDaTela();

  const ws = DOM.welcomeScreen();
  if (ws) ws.hidden = false;
  DOM.messagesArea()?.classList.add("welcome-mode");

  DOM.navJarvis()?.classList.add("active");
  renderListaConversas();
  DOM.messageInput()?.focus();
}

function abrirConversa(id) {
  const conv = state.conversas.find(c => c.id === id);
  if (!conv) return;

  state.idAtual = id;
  limparMensagensDaTela();

  const ws = DOM.welcomeScreen();
  if (ws) ws.hidden = true;
  DOM.messagesArea()?.classList.remove("welcome-mode");
  DOM.navJarvis()?.classList.remove("active");

  for (const m of conv.mensagens) renderMessage(m.role, m.text, m.time, m.fontes);
  renderListaConversas();

  const area = DOM.messagesArea();
  if (area) area.scrollTop = area.scrollHeight;
  DOM.messageInput()?.focus();
}

function excluirConversa(id) {
  const era = state.idAtual === id;
  state.conversas = state.conversas.filter(c => c.id !== id);
  salvarConversas();
  if (era) mostrarTelaInicial();
  else renderListaConversas();
  showToast("Conversa excluída.", "info");
}

/* ═══════════════════════════════════════════════
   MEMÓRIA — fatos que valem em qualquer conversa
   ═══════════════════════════════════════════════
   Mesmo desenho das conversas: tudo no localStorage, o servidor nao guarda
   nada. Os fatos vao em cada requisicao e entram no system prompt. Depois de
   cada resposta, o back extrai fatos novos da mensagem em segundo plano. */

function carregarMemoria() {
  try {
    const raw = localStorage.getItem(MEMORIA_KEY);
    if (!raw) return;
    const dados = JSON.parse(raw);
    state.fatos = Array.isArray(dados?.fatos)
      ? dados.fatos.filter(f => f && typeof f.texto === "string" && f.texto.trim())
      : [];
  } catch (_) { state.fatos = []; }
}

function salvarMemoria() {
  try {
    localStorage.setItem(MEMORIA_KEY, JSON.stringify({ versao: 1, fatos: state.fatos }));
  } catch (_) {
    showToast("Não foi possível salvar a memória (armazenamento cheio?).", "error");
  }
}

/** Normaliza para comparar: sem acento, sem caixa, sem pontuacao final. */
function normalizarFato(texto) {
  return texto.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ").trim()
    .replace(/[.!]+$/, "");
}

/** Adiciona um fato se ainda nao existir. Devolve true se entrou. */
function adicionarFato(texto, origem) {
  const limpo = (texto || "").replace(/\s+/g, " ").trim().slice(0, 240);
  if (!limpo) return false;

  const chave = normalizarFato(limpo);
  if (state.fatos.some(f => normalizarFato(f.texto) === chave)) return false;

  state.fatos.unshift({ id: gerarId(), texto: limpo, origem: origem || "manual", criadoEm: Date.now() });
  if (state.fatos.length > MAX_FATOS) state.fatos = state.fatos.slice(0, MAX_FATOS);

  salvarMemoria();
  renderMemoria();
  return true;
}

function excluirFato(id) {
  state.fatos = state.fatos.filter(f => f.id !== id);
  salvarMemoria();
  renderMemoria();
  showToast("Fato removido da memória.", "info");
}

function renderMemoria() {
  const lista = DOM.memoriaList();
  if (!lista) return;

  setText(DOM.memoriaCount(), String(state.fatos.length));
  lista.innerHTML = "";

  if (!state.fatos.length) {
    const vazio = document.createElement("p");
    vazio.className = "memoria-empty";
    vazio.textContent = "Nada aprendido ainda.";
    lista.appendChild(vazio);
    return;
  }

  for (const fato of state.fatos) {
    const item = document.createElement("div");
    item.className = "memoria-item";
    item.dataset.id = fato.id;

    const texto = document.createElement("span");
    texto.className = "memoria-texto";
    texto.textContent = fato.texto;
    texto.title = fato.texto;

    const excluir = document.createElement("button");
    excluir.className = "memoria-del";
    excluir.title = "Esquecer este fato";
    excluir.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

    item.appendChild(texto);
    item.appendChild(excluir);
    lista.appendChild(item);
  }
}

/**
 * Extracao em segundo plano, DEPOIS da resposta terminar: o llama-server
 * processa uma requisicao por vez, e extrair em paralelo atrasaria o chat.
 * Falha aqui e silenciosa de proposito: memoria e um extra.
 */
function extrairMemoriaEmSegundoPlano(mensagem) {
  fetch(`${API_BASE}/api/memoria/extrair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: mensagem }),
  })
    .then(r => (r.ok ? r.json() : null))
    .then(dados => {
      const novos = (dados?.fatos || []).filter(f => adicionarFato(f, "auto"));
      if (novos.length) {
        const extra = novos.length > 1 ? ` (e mais ${novos.length - 1})` : "";
        showToast(`Memória atualizada: ${novos[0]}${extra}`, "success");
      }
    })
    .catch(() => {});
}

/* ─── System status ───────────────────────────── */

async function refreshSystemStatus() {
  const res = await fetch(`${API_BASE}/api/health`);
  const health = res.ok ? await res.json() : null;
  const healthy = health?.status === "healthy";

  const dot = DOM.rsStatusDot();
  if (dot) {
    dot.style.background = healthy ? "var(--success)" : "var(--danger)";
    dot.style.boxShadow  = healthy ? "0 0 8px var(--success)" : "0 0 8px var(--danger)";
  }
  const coreText = DOM.rsStatusText();
  if (coreText) {
    // Antes dizia "OPERACIONAL · OFFLINE": tecnicamente certo (o modelo e o da
    // maquina), mas "OFFLINE" ao lado de "OPERACIONAL" se le como falha.
    // "100% LOCAL" diz a mesma coisa sem a leitura de erro.
    coreText.textContent = healthy ? "OPERACIONAL · 100% LOCAL" : "MODELO DESLIGADO";
    coreText.style.color = healthy ? "var(--success)" : "var(--danger)";
    coreText.title = healthy
      ? "Modelo rodando nesta maquina. Nenhum dado sai daqui."
      : "Suba o llama-server com: npm run modelo";
  }

  state.contextoMax = health?.contextoMax || state.contextoMax;

  const info = health?.modelo || {};
  const bruto = healthy ? (health?.localModel || "") : "";
  const { nome, precisao } = formatarModelo(bruto);

  const elModelo = DOM.rsModel();
  if (elModelo) {
    elModelo.textContent = nome;
    // O id completo continua acessivel, so nao ocupa a linha inteira do painel.
    elModelo.title = bruto || "Modelo local";
  }

  // O /props descreve a quantizacao melhor que o nome do arquivo ("Q4_K - Medium"
  // contra "q4_k_m"), entao ele tem prioridade quando existe.
  const elPrec = DOM.rsPrecisao();
  if (elPrec) {
    elPrec.textContent = info.quantizacao ? info.quantizacao.replace(/\s*-\s*/, " ") : precisao;
    elPrec.title = info.quantizacao ? `Quantizacao ${info.quantizacao}` : "Quantizacao do modelo";
  }

  setText(DOM.rsPeso(), info.bytes ? formatarBytes(info.bytes) : "—");

  const elMotor = DOM.rsMotor();
  if (elMotor) {
    // "b10240-0b14b87d7" -> "llama.cpp b10240": o hash do commit nao cabe e nao
    // diz nada de util aqui; fica no title.
    const build = info.motor ? String(info.motor).split("-")[0] : null;
    elMotor.textContent = build ? `llama.cpp ${build}` : "—";
    elMotor.title = info.motor
      ? `llama.cpp build ${info.motor}${info.slots ? ` · ${info.slots} slots` : ""}`
      : "Motor de inferencia";
  }

  // Sem resposta ainda nao ha o que medir, mas o teto do contexto ja e conhecido.
  if (state.contextoMax && DOM.rsCtxValor()?.textContent === "—") {
    setText(DOM.rsCtxValor(), `0 / ${state.contextoMax}`);
  }

  atualizarRodapeNav(health, healthy);
}

/* Quebra o id do gguf em nome e precisao: "qwen2.5-3b-instruct-q4_k_m" vira
   "Qwen2.5 3B" + "Q4_K_M". O id inteiro estourava a coluna do painel, e o sufixo
   de quantizacao e informacao real demais para virar reticencias. */
const RE_QUANT = /[-_](iq\d[a-z0-9_]*|q\d+[a-z0-9_]*|bf16|f16|f32)$/i;

function formatarModelo(id) {
  if (!id) return { nome: "—", precisao: "—" };

  let base = String(id);
  let precisao = "—";
  const m = base.match(RE_QUANT);
  if (m) { precisao = m[1].toUpperCase(); base = base.slice(0, m.index); }

  // "instruct"/"chat" nao distinguem nada aqui: todo modelo do Jarvis e de chat.
  const partes = base.split(/[-_]/)
    .filter(p => p && !/^(instruct|chat|it|gguf)$/i.test(p))
    // "3b" e "7b" sao tamanho de parametros e se escrevem com B maiusculo.
    // Capitalizar so a primeira letra deixava "3b", porque a primeira e o digito.
    .map(p => /^\d+(\.\d+)?b$/i.test(p) ? p.toUpperCase()
                                        : p.charAt(0).toUpperCase() + p.slice(1));

  return { nome: partes.join(" ") || base, precisao };
}

/* Bytes em GB/MB. O .gguf do 3B tem ~2 GB, entao uma casa decimal basta. */
function formatarBytes(bytes) {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1).replace(".", ",")} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/* Painel de metricas depois de cada resposta. Tudo aqui e medido, nao estimado:
   os tokens vem do bloco `usage` do llama-server (que so chega porque o provider
   pede stream_options.include_usage) e a latencia, do proprio agent. */
function atualizarMetricas(meta, latMs) {
  const u = meta?.usage || null;

  setText(DOM.rsLatency(), latMs >= 1000 ? `${(latMs / 1000).toFixed(1).replace(".", ",")}s` : `${latMs}ms`);

  // Tokens por segundo conta so a GERACAO: incluir o prompt inflaria o numero,
  // porque ler o prompt e muito mais rapido que gerar token.
  const saida = u?.completionTokens;
  if (saida && latMs > 0) {
    setText(DOM.rsVelocidade(), (saida / (latMs / 1000)).toFixed(1).replace(".", ","));
  }

  if (u?.promptTokens != null && saida != null) {
    const el = DOM.rsTokens();
    if (el) {
      el.textContent = `${u.promptTokens} + ${saida}`;
      el.title = `${u.promptTokens} tokens de entrada, ${saida} gerados`
        + (u.cachedTokens ? ` · ${u.cachedTokens} reaproveitados do cache` : "");
    }

    // Fatia do prompt que o llama-server nao precisou reprocessar. E o que explica
    // a 2a mensagem responder muito mais rapido que a 1a.
    const elCache = DOM.rsCache();
    if (elCache && u.cachedTokens != null && u.promptTokens > 0) {
      const pct = Math.round((u.cachedTokens / u.promptTokens) * 100);
      elCache.textContent = `${pct}%`;
      elCache.title = `${u.cachedTokens} de ${u.promptTokens} tokens do prompt vieram do cache`;
    }
  }

  if (u?.totalTokens != null) {
    state.tokensSessao += u.totalTokens;
    setText(DOM.rsTokensSessao(), state.tokensSessao.toLocaleString("pt-BR"));
  }

  atualizarContexto(u?.totalTokens);
}

/* Barra de contexto: o quanto da janela do modelo a ultima troca ocupou. E o
   numero que mais importa neste projeto — o 3B tem 4096 tokens, e o modo
   documentos sozinho ja come uns 3600 chars de trechos. */
function atualizarContexto(usados) {
  const max = state.contextoMax;
  if (!max || usados == null) return;

  const pct = Math.min(100, (usados / max) * 100);
  // Sem separador de milhar: "4.096" ao lado de "0" se le como numero decimal.
  setText(DOM.rsCtxValor(), `${usados} / ${max} tokens`);
  setText(DOM.rsCtxPct(), `${pct.toFixed(0)}%`);

  const elPct = DOM.rsCtxPct();
  if (elPct) elPct.style.color = pct >= 90 ? "var(--danger)" : pct >= 70 ? "#ffd000" : "var(--p)";

  const fill = DOM.rsCtxFill();
  if (!fill) return;
  fill.style.width = `${pct}%`;
  // Perto do teto o modelo comeca a perder o inicio da conversa: avisa pela cor.
  fill.style.background = pct >= 90 ? "var(--danger)"
    : pct >= 70 ? "#ffd000"
    : "linear-gradient(to right, var(--blue), var(--p))";

  const el = DOM.rsCtxValor();
  if (el) el.title = pct >= 90
    ? "Contexto quase cheio: o modelo comeca a esquecer o inicio da conversa."
    : `${pct.toFixed(0)}% da janela de contexto do modelo`;
}

/* Rodape da sidebar esquerda. Antes era decoracao fixa ("JARVIS SYSTEM /
   ADMIN ACCESS" com barra de progresso em 62% cravada no HTML): o Jarvis nao tem
   login nem nivel de acesso, e a barra nunca mediu nada. Agora mostra o unico
   dado real que o painel da direita nao repete: o indice do modo documentos. */
function atualizarRodapeNav(health, healthy) {
  const elModo = DOM.navModo();
  if (elModo) {
    elModo.textContent = healthy ? "100% LOCAL" : "MODELO DESLIGADO";
    elModo.style.color = healthy ? "var(--success)" : "var(--danger)";
  }

  const elDocs = DOM.navDocs();
  if (!elDocs) return;

  const docs = health?.docs;
  if (docs?.disponivel) {
    // "trechos indexados" nao cabe nos ~128px que sobram ao lado do avatar e virava
    // reticencias. O detalhe fica no title.
    const n = docs.trechos || 0;
    elDocs.textContent = `${n.toLocaleString("pt-BR")} trechos`;
    const data = docs.geradoEm ? new Date(docs.geradoEm) : null;
    elDocs.title = data && !isNaN(data)
      ? `Indice gerado em ${data.toLocaleDateString("pt-BR")}. Reindexar: npm run indexar`
      : "Indice do modo documentos";
  } else {
    elDocs.textContent = "Documentos sem indice";
    elDocs.title = "Gere o indice com: npm run indexar";
  }
}

/* ─── Clock + Uptime ─────────────────────────── */
function updateClock() {
  const now = new Date();
  setText(DOM.liveTime(), now.toLocaleTimeString("pt-BR", { hour12: false }));
  setText(DOM.liveDate(), now.toLocaleDateString("pt-BR", { day:"2-digit", month:"short", year:"numeric" }).toUpperCase());
  setText(DOM.rsUptime(), formatUptime(Date.now() - state.sessionStart));
}

/* ─── Loading ────────────────────────────────── */

/* Ponto unico que liga e desliga o indicador de digitacao. Existe para o mini
   globo nunca ficar animando por tras de um indicador escondido: o `hidden` era
   mexido em tres lugares diferentes e um deles esqueceria de parar o rAF. */
function mostrarDigitando(on) {
  const el = DOM.typingIndicator();
  if (!el) return;
  if (on) { el.removeAttribute("hidden"); miniGlobo?.iniciar(); }
  else    { el.setAttribute("hidden", ""); miniGlobo?.parar(); }
}

function setLoading(on) {
  state.isLoading = on;
  const input = DOM.messageInput(), btn = DOM.sendButton();
  if (!input || !btn) return;
  input.disabled = on;
  if (on) {
    btn.disabled = true;
    DOM.sendIcon()?.setAttribute("hidden", "");
    DOM.loadingIcon()?.removeAttribute("hidden");
    mostrarDigitando(true);
  } else {
    btn.disabled = input.value.trim().length === 0;
    DOM.sendIcon()?.removeAttribute("hidden");
    DOM.loadingIcon()?.setAttribute("hidden", "");
    mostrarDigitando(false);
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

  text = text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  // Protege blocos de código
  const codeBlocks = [];
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_,_l,code) => {
    codeBlocks.push(`<pre><code>${code.trimEnd()}</code></pre>`);
    return `\x00BLK${codeBlocks.length-1}\x00`;
  });

  // Processa linha a linha
  const lines = text.split("\n");
  const out = [];
  let inUl = false, inOl = false;

  for (const line of lines) {
    const ulm = line.match(/^[-*] (.+)/);
    const olm = line.match(/^\d+\. (.+)/);
    if (!ulm && inUl) { out.push("</ul>"); inUl = false; }
    if (!olm && inOl) { out.push("</ol>"); inOl = false; }

    let m;
    if      ((m = line.match(/^### (.+)/))) out.push(`<h3>${m[1]}</h3>`);
    else if ((m = line.match(/^## (.+)/)))  out.push(`<h2>${m[1]}</h2>`);
    else if ((m = line.match(/^# (.+)/)))   out.push(`<h1>${m[1]}</h1>`);
    else if (ulm) { if (!inUl) { out.push("<ul>"); inUl = true; } out.push(`<li>${ulm[1]}</li>`); }
    else if (olm) { if (!inOl) { out.push("<ol>"); inOl = true; } out.push(`<li>${olm[1]}</li>`); }
    else if (/^---+\s*$/.test(line)) out.push("<hr>");
    else out.push(line);
  }
  if (inUl) out.push("</ul>");
  if (inOl) out.push("</ol>");

  const BLOCK = /^<(h[1-6]|ul|ol|li|hr|pre|\/ul|\/ol)[\s>]/;
  const html = out.map((line, i, arr) => {
    if (BLOCK.test(line) || (i > 0 && BLOCK.test(arr[i-1]))) return line;
    return line === "" ? "<br>" : line + "<br>";
  }).join("");

  const result = html
    .replace(/`([^`\n]+)`/g,"<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g,"<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g,"<em>$1</em>");

  return codeBlocks.reduce((t,b,i) => t.replace(`\x00BLK${i}\x00`, b), result);
}

/* ─── Copy text util ─────────────────────────── */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      // fallback para HTTP localhost
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    showToast("Copiado!", "success");
  } catch (_) {
    showToast("Falha ao copiar.", "error");
  }
}

/* ─── Render message ─────────────────────────── */

/**
 * Cria a bolha no DOM e devolve um handle com atualizar/finalizar/remover.
 * E a base tanto da mensagem pronta (renderMessage) quanto do streaming, em
 * que a bolha nasce vazia e cresce a cada token.
 */
function criarBolha(role, time) {
  const area = DOM.messagesArea();
  // Esconde, nao remove: a tela inicial precisa voltar sem reinicializar a esfera 3D.
  const ws   = DOM.welcomeScreen();
  if (ws) ws.hidden = true;
  if (area) area.classList.remove("welcome-mode");

  const t = time || new Date().toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit" });
  const wrap = document.createElement("div");
  wrap.className = `message-wrapper ${role}`;

  const contentDiv = document.createElement("div");
  contentDiv.className = "message-content";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = t;

  contentDiv.appendChild(bubble);
  contentDiv.appendChild(meta);

  const refs = { time: t, wrap, bubble, textoBruto: "" };

  if (role === "assistant") {
    const copyBtn = document.createElement("button");
    copyBtn.className = "msg-copy-btn";
    copyBtn.title = "Copiar resposta";
    copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    // Le refs.textoBruto na hora do clique: durante o streaming o texto ainda esta crescendo.
    copyBtn.addEventListener("click", () => copyText(refs.textoBruto));
    contentDiv.appendChild(copyBtn);
  }

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = role === "user" ? "EU" : "J";

  if (role === "user") {
    wrap.appendChild(contentDiv);
    wrap.appendChild(avatar);
  } else {
    wrap.appendChild(avatar);
    wrap.appendChild(contentDiv);
  }

  area.appendChild(wrap);
  area.scrollTo({ top: area.scrollHeight, behavior: "smooth" });

  refs.atualizar = (texto) => {
    refs.textoBruto = texto;
    bubble.innerHTML = parseMarkdown(texto);
    // So acompanha o texto se o usuario ja esta no fim: rolar a forca enquanto
    // ele le o comeco da resposta e pior que nao rolar.
    if (area.scrollHeight - area.scrollTop - area.clientHeight < 140) {
      area.scrollTop = area.scrollHeight;
    }
  };
  refs.marcarStreaming = (ligado) => bubble.classList.toggle("streaming", !!ligado);
  refs.remover = () => wrap.remove();

  // Modo documentos: lista as notas que embasaram a resposta, abaixo da bolha.
  refs.mostrarFontes = (fontes) => {
    if (!Array.isArray(fontes) || !fontes.length) return;
    const div = document.createElement("div");
    div.className = "message-fontes";
    div.textContent = `FONTES: ${fontes.join(" · ")}`;
    contentDiv.insertBefore(div, meta);
  };

  // Acoes de arquivo propostas pelo modelo. Nada foi executado ainda: cada card
  // espera um clique. Tudo que vem do modelo entra por textContent, nunca por
  // innerHTML, porque caminho e conteudo sao texto gerado.
  refs.mostrarAcoes = (acoes) => {
    if (!Array.isArray(acoes) || !acoes.length) return;
    for (const acao of acoes) {
      contentDiv.insertBefore(criarCardDeAcao(acao), meta);
    }
  };

  return refs;
}

/** Card de confirmacao de uma acao de arquivo. */
function criarCardDeAcao(acao) {
  const card = document.createElement("div");
  card.className = "acao-card" + (acao.destrutiva ? " destrutiva" : "");

  const titulo = document.createElement("div");
  titulo.className = "acao-titulo";
  titulo.textContent = acao.invalida ? "Pedido invalido" : acao.resumo;
  card.appendChild(titulo);

  if (acao.invalida || !acao.id) {
    const aviso = document.createElement("div");
    aviso.className = "acao-erro";
    aviso.textContent = "O modelo montou um pedido que não deu para interpretar. Peça de novo, com o nome do arquivo.";
    card.appendChild(aviso);
    return card;
  }

  if (acao.previa) {
    const previa = document.createElement("pre");
    previa.className = "acao-previa";
    previa.textContent = acao.previa;
    card.appendChild(previa);
  }

  // A regeneracao do JARVIS.md e uma segunda escrita, derivada desta. Avisar
  // aqui mantem honesta a regra de que nada e gravado sem confirmacao.
  if (acao.geraIndice) {
    const nota = document.createElement("div");
    nota.className = "acao-nota";
    nota.textContent = "O índice JARVIS.md da pasta é atualizado junto.";
    card.appendChild(nota);
  }

  const botoes = document.createElement("div");
  botoes.className = "acao-botoes";

  const confirmar = document.createElement("button");
  confirmar.className = "acao-btn confirmar";
  confirmar.textContent = acao.destrutiva ? "Confirmar" : "Executar";

  const cancelar = document.createElement("button");
  cancelar.className = "acao-btn cancelar";
  cancelar.textContent = "Cancelar";

  const encerrar = (texto, classe) => {
    botoes.remove();
    const estado = document.createElement("div");
    estado.className = `acao-estado ${classe}`;
    estado.textContent = texto;
    card.appendChild(estado);
  };

  confirmar.addEventListener("click", async () => {
    confirmar.disabled = true;
    cancelar.disabled = true;
    confirmar.textContent = "Executando...";
    try {
      const res = await fetch(`${API_BASE}/api/arquivos/executar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: acao.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Falhou (${res.status})`);
      encerrar(descreverResultado(data), "ok");
      mostrarSaidaDaAcao(card, data);
    } catch (err) {
      encerrar(err.message, "erro");
      showToast(err.message, "error");
    }
  });

  cancelar.addEventListener("click", () => {
    fetch(`${API_BASE}/api/arquivos/cancelar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: acao.id }),
    }).catch(() => {});
    encerrar("Cancelado.", "cancelado");
  });

  botoes.appendChild(confirmar);
  botoes.appendChild(cancelar);
  card.appendChild(botoes);
  return card;
}

/** Quantos JARVIS.md foram regerados junto com a acao. */
function sufixoIndice(r) {
  const n = Array.isArray(r.indices) ? r.indices.length : 0;
  if (!n) return "";
  return n === 1 ? " · índice atualizado" : ` · ${n} índices atualizados`;
}

function descreverResultado(data) {
  const r = data.resultado || {};
  switch (data.ferramenta) {
    case "criar_arquivo":  return `Criado: ${r.caminho}${sufixoIndice(r)}`;
    case "editar_arquivo": return `Salvo: ${r.caminho} (a versão anterior ficou em ${r.backup})${sufixoIndice(r)}`;
    case "apagar_arquivo": return `${r.caminho} foi para a Lixeira${sufixoIndice(r)}`;
    case "ler_arquivo":    return `Lido: ${r.caminho}`;
    case "listar_pasta":   return `${r.total} item(ns) em ${r.caminho}`;
    default:               return "Feito.";
  }
}

/** Leitura e listagem devolvem conteudo, que vale a pena mostrar na hora. */
function mostrarSaidaDaAcao(card, data) {
  const r = data.resultado || {};
  let texto = null;

  if (data.ferramenta === "ler_arquivo") {
    texto = r.conteudo + (r.truncado ? "\n\n[...] arquivo cortado na exibição." : "");
  } else if (data.ferramenta === "listar_pasta") {
    texto = r.itens.length
      ? r.itens.map((i) => (i.tipo === "pasta" ? `${i.nome}/` : i.nome)).join("\n")
      : "Pasta vazia.";
  }
  if (texto === null) return;

  const pre = document.createElement("pre");
  pre.className = "acao-saida";
  pre.textContent = texto;
  card.appendChild(pre);
}

function renderMessage(role, text, time, fontes) {
  const bolha = criarBolha(role, time);
  bolha.atualizar(text);
  bolha.mostrarFontes(fontes);
  return bolha.time;
}

/* ─── SSE ────────────────────────────────────── */

/**
 * Le um body de fetch como fluxo SSE e chama onEvento(nome, dados) para cada
 * evento completo. Nome null = evento sem "event:" (os deltas de texto).
 */
async function lerSse(body, onEvento) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let corte;
    while ((corte = buffer.indexOf("\n\n")) !== -1) {
      const bloco = buffer.slice(0, corte);
      buffer = buffer.slice(corte + 2);

      let evento = null;
      const datas = [];
      for (const linha of bloco.split("\n")) {
        if (linha.startsWith("event:")) evento = linha.slice(6).trim();
        else if (linha.startsWith("data:")) datas.push(linha.slice(5).trimStart());
      }
      if (!datas.length) continue;

      let dados;
      try { dados = JSON.parse(datas.join("\n")); } catch (_) { continue; }
      onEvento(evento, dados);
    }
  }
}

/* ─── Send ───────────────────────────────────── */
async function sendMessage() {
  const input = DOM.messageInput();
  const msg   = input?.value.trim();
  if (!msg || state.isLoading) return;

  // Corta a leitura da resposta anterior: pergunta nova cala a voz da antiga.
  voz.parar();

  // Sem conversa aberta (tela inicial), a primeira mensagem cria uma. Conversa
  // vazia nunca aparece na lista: ela nasce com conteudo.
  let conv = conversaAtual();
  if (!conv) {
    conv = {
      id: gerarId(),
      titulo: tituloDe(msg),
      mensagens: [],
      history: [],
      criadaEm: Date.now(),
      atualizadaEm: Date.now(),
    };
    state.conversas.push(conv);
    state.idAtual = conv.id;
    DOM.navJarvis()?.classList.remove("active");
  }

  const time = renderMessage("user", msg);
  conv.mensagens.push({ role: "user", text: msg, time });
  conv.atualizadaEm = Date.now();
  salvarConversas();
  renderListaConversas();

  input.value = ""; input.style.height = "auto";
  updateCharCounter(0); setLoading(true);

  // Streaming: a bolha do assistente nasce vazia no primeiro token e cresce a
  // cada delta. Com o modelo local (1 a 6 s por resposta) e a diferenca entre
  // "esta respondendo" e "parece travado".
  let bolha = null;
  let textoResposta = "";

  try {
    const t0  = performance.now();
    const options = { temperature: 0.7, docs: state.modoDocs };
    const res = await fetch(`${API_BASE}/api/chat/stream`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: msg,
        history: conv.history.slice(-MAX_HISTORY),
        options,
        memory: state.fatos.map(f => f.texto),
      }),
    });

    const tipo = res.headers.get("content-type") || "";
    if (!res.ok || !res.body || !tipo.includes("text/event-stream")) {
      // Validacao e rate limit respondem JSON normal antes de virar SSE.
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || `Erro na API (${res.status})`);
    }

    let meta = null;
    let erroSse = null;

    await lerSse(res.body, (evento, dados) => {
      if (evento === "fim") {
        meta = dados;
      } else if (evento === "erro") {
        erroSse = dados;
      } else if (dados.delta) {
        if (!bolha) {
          mostrarDigitando(false);
          bolha = criarBolha("assistant");
          bolha.marcarStreaming(true);
        }
        textoResposta += dados.delta;
        bolha.atualizar(textoResposta);
        voz.alimentar(dados.delta);
      }
    });

    // Quando o modelo decide usar uma ferramenta, a resposta vem SEM texto: o
    // conteudo dela e a proposta de acao. Nesse caso "vazio" nao e falha.
    const acoes = Array.isArray(meta?.acoes) ? meta.acoes : [];

    if (erroSse && !textoResposta) throw new Error(erroSse.error || "Falha no provedor.");
    if (!textoResposta && !acoes.length) throw new Error("Resposta vazia do provedor.");
    if (erroSse) showToast("A resposta foi interrompida no meio. O texto acima está incompleto.", "error");

    if (!bolha) {
      mostrarDigitando(false);
      bolha = criarBolha("assistant");
    }
    if (!textoResposta) {
      textoResposta = acoes.length > 1
        ? "Preparei estas ações. Confira e confirme."
        : "Preparei esta ação. Confira e confirme.";
      bolha.atualizar(textoResposta);
    }

    bolha.marcarStreaming(false);
    voz.finalizar();
    const fontes = meta?.fontes?.length ? meta.fontes : undefined;
    bolha.mostrarFontes(fontes);
    // As acoes NAO sao persistidas: o id vive 10 minutos no servidor, e botao
    // que reaparece depois de recarregar so daria erro de acao expirada.
    bolha.mostrarAcoes(acoes);
    conv.mensagens.push({ role: "assistant", text: textoResposta, time: bolha.time, fontes });
    conv.history.push({ role: "user", content: msg }, { role: "assistant", content: textoResposta });
    conv.atualizadaEm = Date.now();

    // Mantém só as últimas MAX_HISTORY * 2 mensagens salvas
    if (conv.mensagens.length > MAX_HISTORY * 2) {
      conv.mensagens = conv.mensagens.slice(-MAX_HISTORY * 2);
    }
    salvarConversas();
    renderListaConversas();

    const latMs = meta?.latencyMs || Math.round(performance.now() - t0);
    atualizarMetricas(meta, latMs);

    // So depois da resposta: o llama-server atende uma requisicao por vez.
    // No modo documentos nao extrai: a pergunta costuma citar conteudo das
    // notas, e virar "fato" solto na memoria seria ruido.
    if (!state.modoDocs) extrairMemoriaEmSegundoPlano(msg);
  } catch (err) {
    // Bolha vazia orfa (erro antes do primeiro token) sai da tela.
    if (bolha && !textoResposta) bolha.remover();
    if (bolha && textoResposta) bolha.marcarStreaming(false);
    showToast(`FALHA: ${err.message}`, "error");
  } finally {
    setLoading(false);
  }
}

/* ═══════════════════════════════════════════════
   VOZ — leitura das respostas em voz alta
   ═══════════════════════════════════════════════
   Web Speech API (speechSynthesis): usa as vozes ja instaladas no macOS, entao
   continua 100% offline. Nenhum texto sai da maquina, igual ao resto do Jarvis.

   Fala por FRASE, nao pela resposta inteira: (1) comeca a falar enquanto o
   modelo ainda gera, em vez de esperar o ultimo token; (2) o Chrome corta
   locucoes longas depois de ~15s, e frases curtas nao esbarram nisso. */
const VOZ_CHAVE = "jarvis_voz_v1";

/* Duas personas. A API nao informa genero, entao a escolha e por nome.
   ⚠️ Esta maquina so tem UMA voz pt-BR de qualidade: Luciana. Reed, Rocko, Eddy
   e Grandpa sao "novelty voices" da Apple — servem, mas soam travadas. Por isso
   VERONICA (Luciana) e a persona fluente e JARVIS e a grave.
   Daniel (en-GB) e a voz britanica classica, mas leria portugues com fonemas
   ingleses; fica fora de proposito. */
const PERSONAS = {
  jarvis: {
    rotulo: "JARVIS",
    nomes: ["Felipe", "Reed", "Rocko", "Eddy", "Grandpa"],
    pitch: 0.75, rate: 1.03,
  },
  veronica: {
    rotulo: "VERONICA",
    nomes: ["Luciana", "Flo", "Sandy", "Shelley"],
    pitch: 0.92, rate: 1.06,
  },
};

const CICLO_VOZ = [null, "veronica", "jarvis"];   // null = mudo

const voz = {
  persona: null,          // null | "jarvis" | "veronica"
  escolhida: null,
  buffer: "",
  falando: false,         // a esfera le isto para ondular no ritmo da fala
  pulso: 0,               // sobe a cada palavra dita e decai sozinho

  get ligada() { return this.persona !== null; },

  suportada() {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  },

  iniciar() {
    if (!this.suportada()) return;
    const salvo = localStorage.getItem(VOZ_CHAVE);
    this.persona = PERSONAS[salvo] ? salvo : null;
    this.selecionarVoz();
    // getVoices() costuma vir vazio na primeira chamada: a lista carrega async.
    window.speechSynthesis.addEventListener?.("voiceschanged", () => this.selecionarVoz());
    this.refletirBotao();
  },

  selecionarVoz() {
    if (!this.persona) { this.escolhida = null; return; }
    const vozes = window.speechSynthesis.getVoices() || [];
    if (!vozes.length) return;
    const ptBr = vozes.filter(v => /^pt[-_]BR/i.test(v.lang));
    const cfg = PERSONAS[this.persona];
    this.escolhida =
      cfg.nomes.map(nome => ptBr.find(v => v.name.startsWith(nome))).find(Boolean)
      || ptBr[0]
      || null;
  },

  /* Um clique so: mudo -> VERONICA -> JARVIS -> mudo. Menu suspenso para duas
     opcoes seria mais peca de interface do que escolha. */
  alternar() {
    if (!this.suportada()) {
      showToast("Este navegador não tem síntese de voz.", "error");
      return;
    }
    const i = CICLO_VOZ.indexOf(this.persona);
    this.persona = CICLO_VOZ[(i + 1) % CICLO_VOZ.length];

    localStorage.setItem(VOZ_CHAVE, this.persona || "");
    this.parar();
    this.selecionarVoz();
    this.refletirBotao();

    if (!this.persona) { showToast("Voz desligada.", "success"); return; }
    const nome = this.escolhida?.name?.replace(/\s*\(.*\)$/, "") || "voz do sistema";
    showToast(`Voz ${PERSONAS[this.persona].rotulo} (${nome}).`, "success");
  },

  refletirBotao() {
    const btn = DOM.btnVoz();
    if (!btn) return;
    btn.classList.toggle("ativo", this.ligada);
    btn.dataset.persona = this.persona || "";
    btn.title = this.ligada
      ? `Voz ${PERSONAS[this.persona].rotulo}: clique para trocar ou silenciar`
      : "Ler as respostas em voz alta";
    btn.querySelector(".voz-on")?.toggleAttribute("hidden", !this.ligada);
    btn.querySelector(".voz-off")?.toggleAttribute("hidden", this.ligada);
  },

  /* Markdown falado em voz alta vira ruido: "asterisco asterisco titulo". Tira a
     marcacao e o bloco de codigo, que ninguem quer ouvir caractere a caractere. */
  limpar(texto) {
    return texto
      .replace(/```[\s\S]*?```/g, " (bloco de código) ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, " link ")
      .replace(/\s+/g, " ")
      .trim();
  },

  dizer(frase) {
    const texto = this.limpar(frase);
    if (!texto) return;

    const cfg = PERSONAS[this.persona] || PERSONAS.veronica;
    const fala = new SpeechSynthesisUtterance(texto);
    if (this.escolhida) fala.voice = this.escolhida;
    fala.lang  = this.escolhida?.lang || "pt-BR";
    fala.pitch = cfg.pitch;
    fala.rate  = cfg.rate;

    // A Web Speech API nao da acesso ao audio, entao nao ha amplitude real para
    // ler. O `onboundary` dispara a cada palavra: serve de batida para a esfera
    // pulsar no ritmo de quem fala, que e o efeito que interessa.
    fala.onstart    = () => { this.falando = true; };
    fala.onboundary = () => { this.pulso = 1; };
    fala.onend      = () => { this.falando = window.speechSynthesis.pending || window.speechSynthesis.speaking; };
    fala.onerror    = () => { this.falando = false; };

    window.speechSynthesis.speak(fala);
  },

  /* Decaimento do pulso, chamado pelo laco de animacao da esfera. Fica aqui e
     nao la para o ritmo nao depender da taxa de quadros de um canvas so. */
  consumirPulso(dt) {
    this.pulso = Math.max(0, this.pulso - dt * 3.2);
    return this.pulso;
  },

  /* Recebe os deltas do streaming e solta cada frase fechada. O resto fica no
     buffer ate a proxima pontuacao. */
  alimentar(delta) {
    if (!this.ligada || !this.suportada()) return;
    this.buffer += delta;
    const partes = this.buffer.split(/(?<=[.!?:\n])\s+/);
    this.buffer = partes.pop() || "";
    for (const frase of partes) this.dizer(frase);
  },

  finalizar() {
    if (!this.ligada || !this.suportada()) return;
    if (this.buffer.trim()) this.dizer(this.buffer);
    this.buffer = "";
  },

  parar() {
    if (!this.suportada()) return;
    this.buffer = "";
    this.falando = false;
    this.pulso = 0;
    window.speechSynthesis.cancel();
  },
};

/* ═══════════════════════════════════════════════
   ESCUTA — falar com o Jarvis
   ═══════════════════════════════════════════════
   ⚠️ LEIA ANTES DE MEXER: ao contrario do resto do Jarvis, isto NAO e offline.
   O SpeechRecognition do Chrome manda o audio do microfone para servidores do
   Google; o Safari usa o servico da Apple. Nao existe reconhecimento local nesta
   API. Isso contraria a decisao de privacidade de 2026-08-18 do projeto, e por
   isso o recurso:
     - nasce DESLIGADO;
     - exige um "sim" explicito, uma vez, com o aviso na tela;
     - grava a escolha em jarvis_escuta_v1 e nunca liga sozinho.
   Nao remover a confirmacao "para facilitar": ela e o recurso, nao um enfeite. */
const ESCUTA_CHAVE = "jarvis_escuta_v1";

const AVISO_ESCUTA =
  "Atenção: o reconhecimento de fala do navegador NÃO é offline.\n\n" +
  "Ao contrário do chat (que roda 100% na sua máquina), o áudio do seu microfone " +
  "é enviado para servidores do Google para ser transcrito.\n\n" +
  "Deseja habilitar mesmo assim?";

const escuta = {
  rec: null,
  ativa: false,
  autorizada: false,

  suportada() {
    return typeof window !== "undefined" &&
      ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
  },

  iniciar() {
    this.autorizada = localStorage.getItem(ESCUTA_CHAVE) === "1";
    this.refletirBotao();
  },

  alternar() {
    if (!this.suportada()) {
      showToast("Este navegador não reconhece fala. Use o Chrome ou o Safari.", "error");
      return;
    }
    if (this.ativa) { this.parar(); return; }

    if (!this.autorizada) {
      if (!window.confirm(AVISO_ESCUTA)) {
        showToast("Escuta continua desligada.", "success");
        return;
      }
      this.autorizada = true;
      localStorage.setItem(ESCUTA_CHAVE, "1");
    }
    this.comecar();
  },

  comecar() {
    // Enquanto o Jarvis fala, o microfone ouviria a propria resposta e o ciclo
    // se realimentaria. Cala a voz antes de abrir o microfone.
    voz.parar();

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.interimResults = true;
    // Uma fala por clique. Modo continuo deixaria o microfone aberto indefinidamente,
    // o que e demais para um recurso que manda audio para fora.
    rec.continuous = false;

    const input = DOM.messageInput();

    rec.onresult = (e) => {
      let texto = "";
      for (let i = e.resultIndex; i < e.results.length; i++) texto += e.results[i][0].transcript;
      if (!input) return;
      input.value = texto;
      input.dispatchEvent(new Event("input"));

      // Resultado final: envia sozinho, senao o ganho de falar se perde no clique.
      if (e.results[e.results.length - 1].isFinal && texto.trim()) {
        this.parar();
        sendMessage();
      }
    };

    rec.onerror = (e) => {
      const msg = e.error === "not-allowed"
        ? "Permissão de microfone negada pelo navegador."
        : e.error === "no-speech" ? "Não ouvi nada."
        : `Falha ao ouvir: ${e.error}`;
      showToast(msg, "error");
    };

    rec.onend = () => { this.ativa = false; this.rec = null; this.refletirBotao(); };

    this.rec = rec;
    this.ativa = true;
    this.refletirBotao();
    try { rec.start(); }
    catch (_) { this.ativa = false; this.refletirBotao(); }
  },

  parar() {
    if (this.rec) { try { this.rec.stop(); } catch (_) {} }
    this.ativa = false;
    this.refletirBotao();
  },

  refletirBotao() {
    const btn = DOM.btnMic();
    if (!btn) return;
    btn.classList.toggle("ouvindo", this.ativa);
    btn.title = this.ativa
      ? "Ouvindo... clique para parar"
      : this.autorizada ? "Falar com o Jarvis" : "Falar com o Jarvis (precisa ser habilitado)";
  },
};

/* ═══════════════════════════════════════════════
   MINI GLOBO DO INDICADOR "PROCESSANDO"
   ═══════════════════════════════════════════════
   Versao reduzida da esfera: contorno, paralelos, meridianos girando e as mesmas
   ondulacoes neon. Existe porque a tela inicial (onde mora o globo grande) fica
   escondida durante a conversa, entao o efeito de "gerando resposta" nao teria
   onde aparecer. Anima so enquanto o indicador esta visivel: parado, nao consome
   um frame sequer. */
let miniGlobo = null;

function criarMiniGlobo() {
  const canvas = document.getElementById("typing-globe");
  if (!canvas) return null;

  const ctx = canvas.getContext("2d");
  // Mesmo truque da esfera grande: coordenadas logicas fixas, escala no transform.
  const SIZE = 100;
  const CX = SIZE / 2, CY = SIZE / 2, R = SIZE * 0.26;

  let rafId = null, T0 = 0, proxima = 0;
  const ondas = [];

  function escala() {
    const css = canvas.offsetWidth || 36;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px  = Math.round(css * dpr);
    if (canvas.width === px) return;
    canvas.width = canvas.height = px;
    ctx.setTransform(px / SIZE, 0, 0, px / SIZE, 0, 0);
  }

  function frame(now) {
    const t = (now - T0) * 0.001;
    ctx.clearRect(0, 0, SIZE, SIZE);

    if (t >= proxima) {
      ondas.push({ born: t, lobos: 5 + Math.floor(Math.random() * 3), fase: Math.random() * Math.PI * 2 });
      proxima = t + 0.5;
    }

    ctx.save();
    ctx.shadowColor = "rgba(0,255,157,0.7)";
    ctx.shadowBlur = 6;
    ctx.lineWidth = 1;
    for (let i = ondas.length - 1; i >= 0; i--) {
      const o = ondas[i];
      const p = (t - o.born) / 1.3;
      if (p >= 1) { ondas.splice(i, 1); continue; }

      // Alcance ate R*1.62: passar disso encostaria na borda dos 36px do canvas.
      const rr = R * (1 + p * 0.62);
      ctx.strokeStyle = `rgba(0,255,157,${(1 - p) * (1 - p) * 0.85})`;
      ctx.beginPath();
      for (let s = 0; s <= 48; s++) {
        const a = (s / 48) * Math.PI * 2;
        const mod = 1 + 0.06 * Math.sin(o.lobos * a + o.fase + t * 1.6);
        const x = CX + Math.cos(a) * rr * mod;
        const y = CY + Math.sin(a) * rr * mod;
        if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();

    const rotY = t * 0.9;
    ctx.strokeStyle = "rgba(0,217,255,0.85)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2); ctx.stroke();

    ctx.strokeStyle = "rgba(0,217,255,0.38)";
    ctx.lineWidth = 0.7;
    for (let l = 1; l <= 2; l++) {
      const pl = (l / 3) * Math.PI;
      ctx.beginPath();
      ctx.ellipse(CX, CY - R * Math.cos(pl), R * Math.sin(pl), R * Math.sin(pl) * 0.3, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Meridiano visto de lado vira uma elipse que estreita e alarga: e o que da
    // a sensacao de rotacao sem projetar ponto a ponto.
    for (let m = 0; m < 3; m++) {
      ctx.beginPath();
      ctx.ellipse(CX, CY, R * Math.abs(Math.cos(rotY + m * Math.PI / 3)), R, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(0,255,157,0.9)";
    ctx.beginPath(); ctx.arc(CX, CY, 1.6 + Math.sin(t * 4) * 0.5, 0, Math.PI * 2); ctx.fill();

    rafId = requestAnimationFrame(frame);
  }

  return {
    iniciar() {
      if (rafId !== null) return;      // ja rodando: nao empilhar um segundo rAF
      escala();
      T0 = performance.now();
      proxima = 0;
      ondas.length = 0;
      rafId = requestAnimationFrame(frame);
    },
    parar() {
      if (rafId === null) return;
      cancelAnimationFrame(rafId);
      rafId = null;
    },
  };
}

/* ─── Background particles ───────────────────── */
function initParticles() {
  const canvas = document.getElementById("bg-particles"); if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H, pts;
  const resize = () => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; };
  const mkPt   = () => ({ x:Math.random()*W, y:Math.random()*H, vx:(Math.random()-.5)*.22, vy:(Math.random()-.5)*.22, a:Math.random()*.35+.08 });
  resize(); pts = Array.from({ length: 65 }, mkPt);
  window.addEventListener("resize", resize);
  (function draw() {
    ctx.clearRect(0, 0, W, H);
    for (const p of pts) {
      ctx.beginPath(); ctx.arc(p.x, p.y, .75, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,217,255,${p.a})`; ctx.fill();
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > W) p.vx *= -1;
      if (p.y < 0 || p.y > H) p.vy *= -1;
    }
    requestAnimationFrame(draw);
  })();
}

/* ═══════════════════════════════════════════════
   ADVANCED 3D HOLOGRAPHIC SPHERE
   ═══════════════════════════════════════════════ */
function initAdvancedSphere() {
  const canvas = document.getElementById("neural-sphere");
  if (!canvas) return;

  if (!canvas.offsetWidth) { requestAnimationFrame(initAdvancedSphere); return; }

  const ctx = canvas.getContext("2d");

  // Sistema de coordenadas LOGICO e fixo: toda a matematica daqui para baixo
  // desenha num quadrado SIZE x SIZE, e a escala real mora so no setTransform de
  // ajustarEscala(). Antes o SIZE vinha do offsetWidth uma unica vez, entao
  // redimensionar a janela esticava um buffer velho (imagem borrada). Recalcular
  // R/CX/CY/orbitas/celulas a cada resize exigiria reinicializar a esfera, e isso
  // empilharia os timers e o rAF desta funcao.
  const SIZE = 600;
  const CX = SIZE / 2, CY = SIZE / 2;
  const R  = SIZE * 0.365;
  const CONN = SIZE * 0.075;

  // Atribuir canvas.width reseta o contexto inteiro, por isso o setTransform vem
  // logo depois. Desenho vetorial: escala sem perda de nitidez.
  function ajustarEscala() {
    const css = canvas.offsetWidth;
    if (!css) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px  = Math.round(css * dpr);
    if (canvas.width === px) return;
    canvas.width = canvas.height = px;
    const k = px / SIZE;
    ctx.setTransform(k, 0, 0, k, 0, 0);
  }
  ajustarEscala();

  // ResizeObserver pega tambem o que nao dispara resize de janela (sidebar
  // abrindo, teclado do mobile). O rAF da animacao continua o mesmo.
  const obs = new ResizeObserver(ajustarEscala);
  obs.observe(canvas);
  // Trocar de monitor muda o devicePixelRatio sem mudar o tamanho em CSS.
  window.addEventListener("resize", ajustarEscala);

  function proj3(phi, theta, rotY, rotZ) {
    const x0 = R * Math.sin(phi) * Math.cos(theta);
    const y0 = R * Math.cos(phi);
    const z0 = R * Math.sin(phi) * Math.sin(theta);
    const x1 = x0 * Math.cos(rotY) + z0 * Math.sin(rotY);
    const z1 = -x0 * Math.sin(rotY) + z0 * Math.cos(rotY);
    const x2 = x1 * Math.cos(rotZ) - y0 * Math.sin(rotZ);
    const y2 = x1 * Math.sin(rotZ) + y0 * Math.cos(rotZ);
    return { px: CX + x2, py: CY + y2, z: z1 };
  }

  const N = 280;
  const dots = Array.from({ length: N }, (_, i) => ({
    phi:   Math.acos(1 - 2 * (i + 0.5) / N),
    theta: Math.PI * (1 + Math.sqrt(5)) * i,
    sz:    0.35 + Math.random() * 0.9,
  }));

  const CELLS = Array.from({ length: 9 }, () => ({
    phi:   Math.random() * Math.PI,
    theta: Math.random() * Math.PI * 2,
    dPhi:  (Math.random() - 0.5) * 0.009,
    dTh:   (Math.random() - 0.5) * 0.013,
    baseR: R * (0.05 + Math.random() * 0.045),
    phase: Math.random() * Math.PI * 2,
    spd:   0.6 + Math.random() * 0.8,
    sides: 5 + Math.floor(Math.random() * 3),
  }));

  const ORBITS = [
    { n: 10, r: R * 0.93, spd:  0.50, tilt:  0.62, off: 0,               col: [0, 217, 255] },
    { n: 7,  r: R * 1.06, spd: -0.32, tilt: -0.80, off: Math.PI / 3,     col: [0, 110, 255] },
    { n: 12, r: R * 0.80, spd:  0.22, tilt:  1.05, off: Math.PI,          col: [0, 255, 157] },
    { n: 5,  r: R * 1.12, spd: -0.14, tilt:  0.38, off: Math.PI * 0.75,  col: [100, 200, 255] },
  ];

  const WAVES = [0, 0.5, 1.0, 1.5].map((o, i) => ({ phase: o * Math.PI * 2, spd: 0.7 + i * 0.18 }));
  const pbuf = new Array(N);

  const HOT = new Set();
  const hotTimer = setInterval(() => {
    if (HOT.size < 7) HOT.add(Math.floor(Math.random() * N));
    if (HOT.size > 3 && Math.random() > 0.55) {
      const arr = [...HOT]; HOT.delete(arr[Math.floor(Math.random() * arr.length)]);
    }
  }, 700);

  const STRM = [];
  const strmTimer = setInterval(() => {
    if (STRM.length < 8) STRM.push({
      src: Math.floor(Math.random() * N),
      dst: Math.floor(Math.random() * N),
      born: null,
      dur: 0.8 + Math.random() * 1.1,
    });
  }, 280);

  /* ── Ondulacoes neon ao redor do globo ──
     Cada onda nasce colada na esfera e expande para fora perdendo opacidade. O
     raio e modulado por um seno do angulo, entao ela ondula em vez de ser um
     circulo liso. Enquanto o modelo gera resposta (state.isLoading) as ondas
     nascem mais rapido, mais brilhantes e com amplitude maior.
     O alcance para em R*1.26: o canvas so tem SIZE/2 do centro ate a borda, e
     passar disso corta a onda no meio. */
  const ONDAS = [];
  const MAX_ONDAS = 12;
  let proximaOnda = 0;
  let ultimoT = 0;

  function pulsarOndas(t, ativo, falando, pulso) {
    // Falando manda no ritmo: cada palavra dita joga o pulso em 1 e ele decai.
    // O intervalo curto faz as ondas sairem em rajada, como voz saindo da esfera.
    const intervalo = falando ? 0.16 : ativo ? 0.42 : 1.5;
    if (t >= proximaOnda) {
      ONDAS.push({
        born:  t,
        dur:   falando ? 1.1 : ativo ? 1.5 : 2.6,
        // A amplitude acompanha o pulso: silabas fortes deformam mais o anel.
        amp:   falando ? 0.05 + pulso * 0.09 : ativo ? 0.055 : 0.028,
        lobos: 5 + Math.floor(Math.random() * 4),
        fase:  Math.random() * Math.PI * 2,
      });
      proximaOnda = t + intervalo;
    }
    // Teto de seguranca: aba em segundo plano congela o rAF e o relogio segue,
    // entao na volta nasceriam varias ondas de uma vez.
    if (ONDAS.length > MAX_ONDAS) ONDAS.splice(0, ONDAS.length - MAX_ONDAS);
  }

  function desenharOndas(t, ativo, falando, pulso) {
    ctx.save();
    ctx.shadowColor = falando ? "rgba(0,255,157,0.8)" : "rgba(0,217,255,0.75)";
    for (let i = ONDAS.length - 1; i >= 0; i--) {
      const o = ONDAS[i];
      const p = (t - o.born) / o.dur;
      if (p >= 1) { ONDAS.splice(i, 1); continue; }
      if (p < 0) continue;

      const rr   = R * (1 + p * 0.26);
      const fade = (1 - p) * (1 - p) * (ativo ? 0.9 : 0.42);
      // Verde do --success enquanto responde: mesma paleta do estado OPERACIONAL.
      ctx.strokeStyle = ativo ? `rgba(0,255,157,${fade})` : `rgba(0,217,255,${fade})`;
      ctx.lineWidth   = falando ? 1.6 + pulso * 1.4 : ativo ? 1.8 : 1.1;
      ctx.shadowBlur  = falando ? 14 + pulso * 12 : ativo ? 16 : 8;

      ctx.beginPath();
      const PASSOS = 96;
      for (let s = 0; s <= PASSOS; s++) {
        const ang = (s / PASSOS) * Math.PI * 2;
        // O `t` no argumento faz a ondulacao viajar ao longo do anel. Sem ele a
        // deformacao ficaria congelada e pareceria um circulo torto, nao uma onda.
        const mod = 1 + o.amp * Math.sin(o.lobos * ang + o.fase + t * 1.6);
        const x = CX + Math.cos(ang) * rr * mod;
        const y = CY + Math.sin(ang) * rr * mod;
        if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  const T0 = performance.now();
  let rafId;

  function draw(now) {
    try {
      const t   = (now - T0) * 0.001;
      const rotY = t * 0.17;
      const rotZ = Math.sin(t * 0.09) * 0.12;

      ctx.clearRect(0, 0, SIZE, SIZE);

      const atm = ctx.createRadialGradient(CX, CY, R * 0.6, CX, CY, R * 1.2);
      atm.addColorStop(0, "rgba(0,80,200,0.00)");
      atm.addColorStop(0.5, "rgba(0,80,200,0.05)");
      atm.addColorStop(1, "rgba(0,217,255,0.00)");
      ctx.fillStyle = atm;
      ctx.beginPath(); ctx.arc(CX, CY, R * 1.2, 0, Math.PI * 2); ctx.fill();

      // Ondas primeiro: ficam atras da malha do globo, mas como o raio delas
      // comeca em R elas aparecem inteiras ao redor dele.
      const gerando = state.isLoading === true;
      const falando = voz.falando === true;
      // dt real entre quadros: o decaimento do pulso nao pode depender do fps.
      const pulso = voz.consumirPulso(Math.min(0.05, t - ultimoT));
      ultimoT = t;
      pulsarOndas(t, gerando, falando, pulso);
      desenharOndas(t, gerando || falando, falando, pulso);

      ctx.save();
      ctx.globalAlpha = 0.16 + 0.05 * Math.sin(t * 0.8);
      ctx.strokeStyle = "rgba(0,217,255,0.9)";
      ctx.lineWidth = 0.5;
      for (let lat = 1; lat <= 7; lat++) {
        const pLat = (lat / 8) * Math.PI;
        const rr  = R * Math.sin(pLat);
        const yy  = CY - R * Math.cos(pLat) * Math.cos(rotZ * 0.5);
        ctx.globalAlpha = lat === 4 ? 0.32 + 0.10 * Math.sin(t * 0.8) : 0.14 + 0.05 * Math.sin(t * 0.8);
        ctx.lineWidth = lat === 4 ? 0.8 : 0.45;
        ctx.beginPath();
        ctx.ellipse(CX, yy, rr * (0.88 + 0.12 * Math.abs(Math.cos(rotY))), rr * 0.27, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.13 + 0.04 * Math.sin(t * 0.8);
      ctx.lineWidth = 0.4;
      for (let m = 0; m < 12; m++) {
        const mTh = (m / 12) * Math.PI * 2;
        const seg = [];
        for (let s = 0; s <= 24; s++) {
          const p = proj3((s / 24) * Math.PI, mTh, rotY, rotZ);
          if (p.z > 0) seg.push(p);
        }
        if (seg.length > 1) {
          ctx.beginPath(); ctx.moveTo(seg[0].px, seg[0].py);
          for (let k = 1; k < seg.length; k++) ctx.lineTo(seg[k].px, seg[k].py);
          ctx.stroke();
        }
      }
      ctx.restore();

      ctx.save();
      const eqA = 0.42 + 0.14 * Math.sin(t * 0.55);
      ctx.strokeStyle = `rgba(0,217,255,${eqA})`;
      ctx.lineWidth = 2;
      ctx.shadowColor = "rgba(0,217,255,0.7)";
      ctx.shadowBlur  = 10;
      ctx.beginPath();
      ctx.ellipse(CX, CY - R * 0.02 * Math.sin(rotZ), R, R * 0.20 + R * 0.04 * Math.abs(Math.cos(rotY)), rotZ * 0.35, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2); ctx.clip();
      const sa = (t * 0.38) % (Math.PI * 2);
      const sweepSpan = 1.1;
      const sweepSlices = 14;
      for (let k = 0; k < sweepSlices; k++) {
        const frac = k / sweepSlices;
        const sliceStart = sa - sweepSpan + frac * sweepSpan;
        const sliceEnd   = sliceStart + sweepSpan / sweepSlices;
        ctx.beginPath(); ctx.moveTo(CX, CY);
        ctx.arc(CX, CY, R * 0.97, sliceStart, sliceEnd);
        ctx.closePath();
        ctx.fillStyle = `rgba(0,255,160,${frac * frac * 0.065})`; ctx.fill();
      }
      const radarPulse = 0.28 + 0.12 * Math.sin(t * 2.2);
      ctx.beginPath(); ctx.moveTo(CX, CY);
      ctx.lineTo(CX + R * 0.97 * Math.cos(sa), CY + R * 0.97 * Math.sin(sa));
      ctx.strokeStyle = `rgba(0,255,190,${radarPulse})`;
      ctx.lineWidth = 0.9; ctx.stroke();
      ctx.restore();

      for (let i = 0; i < N; i++) {
        const d = dots[i];
        pbuf[i] = proj3(d.phi, d.theta + rotY * 0.42, rotY * 0.42, rotZ);
        pbuf[i].sz = d.sz;
        pbuf[i].idx = i;
      }
      pbuf.sort((a, b) => a.z - b.z);
      const pmap = new Map();
      for (const p of pbuf) pmap.set(p.idx, p);

      ctx.lineWidth = 0.5;
      const CONN2 = CONN * CONN;
      for (let i = 0; i < N; i++) {
        const a = pbuf[i];
        if (a.z < -R * 0.2) continue;
        for (let j = i + 1; j < Math.min(i + 36, N); j++) {
          const b = pbuf[j];
          if (b.z < -R * 0.2) continue;
          const dx = a.px - b.px, dy = a.py - b.py;
          const dd = dx * dx + dy * dy;
          if (dd > CONN2) continue;
          const d2    = Math.sqrt(dd);
          const depth = ((a.z + b.z) / 2 + R) / (2 * R);
          const alpha = (1 - d2 / CONN) * depth * 0.22;
          ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py);
          ctx.strokeStyle = `rgba(0,${Math.round(138 + depth * 79)},255,${alpha})`;
          ctx.stroke();
        }
      }

      for (let i = 0; i < N; i++) {
        const p = pbuf[i];
        const depth = (p.z + R) / (2 * R);
        if (depth < 0.04) continue;
        const pulse = 0.88 + 0.12 * Math.sin(t * 1.6 + p.sz * 7);
        const r = depth * 1.7 * p.sz * pulse + 0.2;
        ctx.beginPath(); ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,${Math.round(148 + depth * 69)},255,${0.12 + depth * 0.88})`;
        ctx.fill();
      }

      for (const polePhi of [0.06, Math.PI - 0.06]) {
        const pp = proj3(polePhi, 0, rotY, rotZ);
        if (pp.z < 0) continue;
        const depth = (pp.z + R) / (2 * R);
        const pg = ctx.createRadialGradient(pp.px, pp.py, 0, pp.px, pp.py, R * 0.14 * depth);
        pg.addColorStop(0,   `rgba(200,255,255,${0.70 * depth})`);
        pg.addColorStop(0.4, `rgba(0,217,255,${0.25 * depth})`);
        pg.addColorStop(1,   "rgba(0,100,255,0)");
        ctx.beginPath(); ctx.arc(pp.px, pp.py, R * 0.14 * depth, 0, Math.PI * 2);
        ctx.fillStyle = pg; ctx.fill();
      }

      for (const p of pbuf) {
        if (!HOT.has(p.idx)) continue;
        const depth = (p.z + R) / (2 * R);
        if (depth < 0.12) continue;
        const pulse = 0.5 + 0.5 * Math.sin(t * 3.8 + p.idx * 0.73);
        const nr = (2.2 + pulse * 2.4) * depth;
        const hg = ctx.createRadialGradient(p.px, p.py, 0, p.px, p.py, nr * 3.5);
        hg.addColorStop(0,   `rgba(0,255,180,${0.95 * depth})`);
        hg.addColorStop(0.4, `rgba(0,210,255,${0.5 * depth})`);
        hg.addColorStop(1,   "rgba(0,100,255,0)");
        ctx.beginPath(); ctx.arc(p.px, p.py, nr, 0, Math.PI * 2);
        ctx.fillStyle = hg; ctx.fill();
        ctx.beginPath(); ctx.arc(p.px, p.py, nr * 2.8, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0,255,180,${0.18 * depth * pulse})`;
        ctx.lineWidth = 0.6; ctx.stroke();
      }

      for (const cell of CELLS) {
        cell.phi   += cell.dPhi;
        cell.theta += cell.dTh;
        if (cell.phi > Math.PI || cell.phi < 0) cell.dPhi *= -1;
        const p = proj3(cell.phi, cell.theta, rotY * 0.28, rotZ);
        if (p.z < -R * 0.15) continue;
        const depth = (p.z + R) / (2 * R);
        const pulse = 1 + 0.22 * Math.sin(t * cell.spd + cell.phase);
        const cr    = cell.baseR * depth * pulse;
        if (cr < 1) continue;
        ctx.save();
        const cg = ctx.createRadialGradient(p.px, p.py, 0, p.px, p.py, cr);
        cg.addColorStop(0,    `rgba(0,217,255,${0.13 * depth})`);
        cg.addColorStop(0.45, `rgba(0,100,255,${0.06 * depth})`);
        cg.addColorStop(1,    "rgba(0,0,0,0)");
        ctx.beginPath();
        for (let s = 0; s <= cell.sides; s++) {
          const ang = (s / cell.sides) * Math.PI * 2;
          const w   = 1 + 0.28 * Math.sin(ang * 3 + t * cell.spd + cell.phase);
          const bx  = p.px + cr * w * Math.cos(ang);
          const by  = p.py + cr * w * Math.sin(ang) * 0.65;
          s === 0 ? ctx.moveTo(bx, by) : ctx.lineTo(bx, by);
        }
        ctx.closePath();
        ctx.fillStyle = cg; ctx.fill();
        ctx.strokeStyle = `rgba(0,217,255,${0.13 * depth})`;
        ctx.lineWidth = 0.5; ctx.stroke();
        ctx.restore();
      }

      for (const orb of ORBITS) {
        const base = t * orb.spd + orb.off;
        for (let i = 0; i < orb.n; i++) {
          const ang = base + (i / orb.n) * Math.PI * 2;
          const ox = orb.r * Math.cos(ang);
          const oy = orb.r * Math.sin(orb.tilt) * Math.sin(ang);
          const oz = orb.r * Math.cos(orb.tilt) * Math.sin(ang);
          const prx = ox * Math.cos(rotY) + oz * Math.sin(rotY);
          const prz = -ox * Math.sin(rotY) + oz * Math.cos(rotY);
          const depth = (prz + R) / (2 * R);
          if (depth < 0.02) continue;
          const px = CX + prx, py = CY + oy;
          const [cr, cg, cb] = orb.col;
          const alpha = 0.28 + depth * 0.72;
          ctx.beginPath(); ctx.arc(px, py, 1.6 * depth + 0.4, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`; ctx.fill();
          if (depth > 0.45) {
            const tang = ang - 0.9 / orb.n * Math.PI * 2;
            const tx = orb.r * Math.cos(tang);
            const ty = orb.r * Math.sin(orb.tilt) * Math.sin(tang);
            const tz = orb.r * Math.cos(orb.tilt) * Math.sin(tang);
            const trx = tx * Math.cos(rotY) + tz * Math.sin(rotY);
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(CX + trx, CY + ty);
            ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha * 0.25})`;
            ctx.lineWidth = 0.8; ctx.stroke();
          }
        }
      }

      for (const w of WAVES) {
        const progress = ((t * w.spd + w.phase) % (Math.PI * 2)) / (Math.PI * 2);
        const wAlpha   = (1 - progress) * 0.15;
        if (wAlpha < 0.005) continue;
        ctx.beginPath(); ctx.arc(CX, CY, progress * R, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0,217,255,${wAlpha})`;
        ctx.lineWidth = 1.6 * (1 - progress); ctx.stroke();
      }

      for (let i = STRM.length - 1; i >= 0; i--) {
        const s = STRM[i];
        if (s.born === null) s.born = t;
        const prog = Math.min((t - s.born) / s.dur, 1);
        if (prog >= 1) { STRM.splice(i, 1); continue; }
        const ps = pmap.get(s.src), pd = pmap.get(s.dst);
        if (!ps || !pd || ps.z < -R * 0.15 || pd.z < -R * 0.15) continue;
        const x = ps.px + (pd.px - ps.px) * prog;
        const y = ps.py + (pd.py - ps.py) * prog;
        const depth = ((ps.z + pd.z) / 2 + R) / (2 * R);
        const sg = ctx.createRadialGradient(x, y, 0, x, y, 5 * depth);
        sg.addColorStop(0,   `rgba(120,255,220,${0.92 * depth})`);
        sg.addColorStop(0.5, `rgba(0,217,255,${0.45 * depth})`);
        sg.addColorStop(1,   "rgba(0,100,255,0)");
        ctx.beginPath(); ctx.arc(x, y, 3.5 * depth, 0, Math.PI * 2);
        ctx.fillStyle = sg; ctx.fill();
        const trailProg = Math.max(0, prog - 0.18);
        const tx2 = ps.px + (pd.px - ps.px) * trailProg;
        const ty2 = ps.py + (pd.py - ps.py) * trailProg;
        ctx.beginPath(); ctx.moveTo(tx2, ty2); ctx.lineTo(x, y);
        ctx.strokeStyle = `rgba(0,255,200,${0.38 * depth * (1 - prog)})`;
        ctx.lineWidth = 1.4; ctx.stroke();
      }

      ctx.save();
      const limbG = ctx.createRadialGradient(CX, CY, R * 0.78, CX, CY, R * 1.04);
      limbG.addColorStop(0,    "rgba(0,217,255,0)");
      limbG.addColorStop(0.70, `rgba(0,180,255,${0.04 + 0.03 * Math.sin(t * 0.7)})`);
      limbG.addColorStop(0.87, `rgba(0,217,255,${0.22 + 0.08 * Math.sin(t * 0.7)})`);
      limbG.addColorStop(0.95, `rgba(80,235,255,${0.12 + 0.06 * Math.sin(t * 0.7)})`);
      limbG.addColorStop(1,    "rgba(0,217,255,0)");
      ctx.beginPath(); ctx.arc(CX, CY, R * 1.04, 0, Math.PI * 2);
      ctx.fillStyle = limbG; ctx.fill();
      ctx.restore();

      const coreP = 0.5 + 0.5 * Math.sin(t * 1.15);
      const cg2 = ctx.createRadialGradient(CX, CY, 0, CX, CY, R * 0.5);
      cg2.addColorStop(0,    `rgba(0,180,255,${0.25 + 0.11 * coreP})`);
      cg2.addColorStop(0.35, `rgba(0,100,255,${0.11 + 0.05 * coreP})`);
      cg2.addColorStop(1,    "rgba(0,0,0,0)");
      ctx.fillStyle = cg2; ctx.fillRect(0, 0, SIZE, SIZE);

      for (const [phase, bright] of [[0, 1], [Math.PI, 0.55]]) {
        const scanY = CY + R * 0.72 * Math.sin(t * 0.28 + phase);
        const sg = ctx.createLinearGradient(CX - R, scanY, CX + R, scanY);
        sg.addColorStop(0,   "rgba(0,217,255,0)");
        sg.addColorStop(0.3, `rgba(0,217,255,${0.10 * coreP * bright})`);
        sg.addColorStop(0.5, `rgba(0,217,255,${0.18 * coreP * bright})`);
        sg.addColorStop(0.7, `rgba(0,217,255,${0.10 * coreP * bright})`);
        sg.addColorStop(1,   "rgba(0,217,255,0)");
        ctx.fillStyle = sg;
        ctx.fillRect(CX - R, scanY - 2, R * 2, 4);
      }
    } catch (_) {}
    rafId = requestAnimationFrame(draw);
  }

  rafId = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(rafId);
    clearInterval(hotTimer); clearInterval(strmTimer);
    obs.disconnect(); window.removeEventListener("resize", ajustarEscala);
  };
}

/* ─── Init ───────────────────────────────────── */
function init() {
  const input = DOM.messageInput(), btn = DOM.sendButton();
  if (!input || !btn) return;

  // Desativa scroll enquanto só o globo está visível
  if (DOM.welcomeScreen()) DOM.messagesArea()?.classList.add("welcome-mode");

  updateClock();
  setInterval(updateClock, 1000);

  // Abre sempre na tela inicial; as conversas ficam na sidebar, a um clique.
  carregarConversas();
  renderListaConversas();

  carregarMemoria();
  renderMemoria();

  refreshSystemStatus().catch(() => showToast("Não foi possível carregar o status operacional.", "error"));

  // Revalida o status do provedor a cada 2min. Pausa com a aba oculta.
  setInterval(() => {
    if (document.visibilityState === "hidden") return;
    refreshSystemStatus().catch(() => {});
  }, 120_000);

  // Quando a aba volta a ficar visivel, refresca imediatamente.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshSystemStatus().catch(() => {});
    }
  });

  initParticles();
  initAdvancedSphere();
  miniGlobo = criarMiniGlobo();
  voz.iniciar();
  escuta.iniciar();

  DOM.btnVoz()?.addEventListener("click", () => voz.alternar());
  DOM.btnMic()?.addEventListener("click", () => escuta.alternar());

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

  // Botão do header: sai da conversa e volta à tela inicial. Não apaga nada —
  // antes ele limpava o histórico e recarregava a página.
  DOM.btnClearChat()?.addEventListener("click", () => {
    mostrarTelaInicial();
    fecharSidebarNoMobile();
  });

  // Nav: JARVIS e NOVA levam à tela inicial. A conversa só nasce ao enviar a
  // primeira mensagem, então as duas fazem a mesma coisa por design.
  DOM.navJarvis()?.addEventListener("click", () => { mostrarTelaInicial(); fecharSidebarNoMobile(); });
  DOM.navNova()?.addEventListener("click", () => { mostrarTelaInicial(); fecharSidebarNoMobile(); });

  // Lista de conversas: um listener no container aguenta a lista sendo redesenhada.
  DOM.convList()?.addEventListener("click", e => {
    const item = e.target.closest(".conv-item");
    if (!item) return;
    const id = item.dataset.id;

    const btnDel = e.target.closest(".conv-del");
    if (btnDel) {
      e.stopPropagation();
      // Dois cliques para excluir: o primeiro arma, o segundo confirma. Evita
      // perder conversa por clique errado sem recorrer a um modal.
      if (btnDel.classList.contains("confirmando")) {
        excluirConversa(id);
      } else {
        DOM.convList()?.querySelectorAll(".conv-del.confirmando").forEach(b => {
          b.classList.remove("confirmando");
          b.title = "Excluir conversa";
        });
        btnDel.classList.add("confirmando");
        btnDel.title = "Clique de novo para excluir";
        setTimeout(() => {
          btnDel.classList.remove("confirmando");
          btnDel.title = "Excluir conversa";
        }, 3000);
      }
      return;
    }

    abrirConversa(id);
    fecharSidebarNoMobile();
  });

  DOM.convList()?.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const item = e.target.closest(".conv-item");
    if (!item) return;
    e.preventDefault();
    abrirConversa(item.dataset.id);
    fecharSidebarNoMobile();
  });

  // Modo documentos: responde com base nas notas indexadas (npm run indexar).
  DOM.btnDocs()?.addEventListener("click", () => {
    state.modoDocs = !state.modoDocs;
    DOM.btnDocs()?.classList.toggle("ativo", state.modoDocs);
    showToast(
      state.modoDocs
        ? "Modo documentos ligado: respostas com base nas suas notas."
        : "Modo documentos desligado.",
      "info"
    );
  });

  // Memoria: adicionar a mao e excluir com dois cliques (mesmo padrao das conversas).
  const memoriaInput = DOM.memoriaInput();
  const adicionarFatoManual = () => {
    const texto = memoriaInput?.value.trim();
    if (!texto) return;
    if (adicionarFato(texto, "manual")) {
      memoriaInput.value = "";
      showToast("Fato guardado na memória.", "success");
    } else {
      showToast("Esse fato já está na memória.", "info");
    }
  };
  DOM.memoriaAddBtn()?.addEventListener("click", adicionarFatoManual);
  memoriaInput?.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); adicionarFatoManual(); }
  });

  DOM.memoriaList()?.addEventListener("click", e => {
    const btnDel = e.target.closest(".memoria-del");
    if (!btnDel) return;
    const item = e.target.closest(".memoria-item");
    if (!item) return;

    if (btnDel.classList.contains("confirmando")) {
      excluirFato(item.dataset.id);
    } else {
      DOM.memoriaList()?.querySelectorAll(".memoria-del.confirmando").forEach(b => {
        b.classList.remove("confirmando");
        b.title = "Esquecer este fato";
      });
      btnDel.classList.add("confirmando");
      btnDel.title = "Clique de novo para esquecer";
      setTimeout(() => {
        btnDel.classList.remove("confirmando");
        btnDel.title = "Esquecer este fato";
      }, 3000);
    }
  });

  // Sidebar drawer (mobile)
  DOM.btnMenuToggle()?.addEventListener("click", () => DOM.leftSidebar()?.classList.toggle("open"));
  document.addEventListener("click", e => {
    const sb = DOM.leftSidebar(), tb = DOM.btnMenuToggle();
    if (sb?.classList.contains("open") && !sb.contains(e.target) && !tb?.contains(e.target))
      sb.classList.remove("open");
  });

  input.focus();
}

function fecharSidebarNoMobile() {
  DOM.leftSidebar()?.classList.remove("open");
}

document.addEventListener("DOMContentLoaded", init);
