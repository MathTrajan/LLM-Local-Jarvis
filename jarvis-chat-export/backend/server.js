require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const { getEnvString } = require("./config");
const agent = require("./agent");
const localProvider = require("./providers/local");
const rag = require("./rag");
const perfil = require("./perfil");
const arquivos = require("./arquivos");

const app = express();

const PORT = Number(getEnvString("PORT", "3000")) || 3000;
const api = express.Router();

const publicDir = path.join(__dirname, "public");
const legacyFrontendDir = path.join(__dirname, "../frontend");
const frontendDir = fs.existsSync(publicDir) ? publicDir : legacyFrontendDir;

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        // O helmet liga upgrade-insecure-requests por padrao. O Chrome isenta
        // localhost dela; o Safari NAO — ele reescreve css/js para https://localhost:3100,
        // o Express so fala HTTP, e a pagina abre em HTML cru sem estilo nem script.
        // O Jarvis e 100% local e nunca sobe em HTTPS, entao a diretiva so atrapalha.
        upgradeInsecureRequests: null,
      },
    },
    // HSTS em http e ignorado pelo navegador, mas se um dia o Jarvis for aberto por
    // um proxy https ele fixaria localhost em HTTPS no navegador inteiro. Fora.
    strictTransportSecurity: false,
  })
);

app.use(
  cors({
    origin: getEnvString("ALLOWED_ORIGIN", "*"),
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

const chatRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Muitas requisicoes. Aguarde um momento.",
    code: "RATE_LIMIT_EXCEEDED",
  },
});

app.use(express.json({ limit: "2mb" }));

// Sem cache no front: em dev o navegador ja serviu HTML/JS/CSS velhos como se fossem
// os atuais, e o sintoma parece bug de codigo. Tira o cache da equacao.
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  next();
});

// Log de requisicoes: mostra o que o navegador realmente pede. Sem isso, "a tela esta
// branca" nao distingue asset com 404 de pagina que nunca foi buscada no servidor.
app.use((req, res, next) => {
  res.on("finish", () => {
    console.log(`[req] ${req.method} ${req.originalUrl} -> ${res.statusCode}`);
  });
  next();
});

app.use(express.static(frontendDir, { etag: false, lastModified: false }));

/** Valida o corpo do /chat e do /chat/stream. Devolve null se invalido (ja respondeu). */
function validarCorpoDeChat(req, res) {
  const { message, history = [], options = {}, memory = [] } = req.body;

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Mensagem invalida.", code: "INVALID_MESSAGE" });
    return null;
  }

  const trimmedMessage = message.trim();
  if (trimmedMessage.length === 0 || trimmedMessage.length > 8000) {
    res.status(400).json({ error: "Tamanho de mensagem invalido.", code: "BAD_SIZE" });
    return null;
  }

  return {
    trimmedMessage,
    history: Array.isArray(history) ? history : [],
    // A memoria vem do navegador (localStorage) e entra no system prompt.
    // O agent sanitiza tamanho e quantidade.
    options: { ...options, memory: Array.isArray(memory) ? memory : [] },
  };
}

/**
 * Modo documentos: recupera trechos do indice BM25 e anexa ao corpo.
 * Devolve false se ja respondeu erro (indice ausente). Chamar ANTES de
 * virar SSE — o 503 daqui precisa sair como JSON normal.
 */
function prepararModoDocs(corpo, res) {
  if (!corpo.options.docs) return true;

  if (!rag.disponivel()) {
    res.status(503).json({
      error: "Modo documentos sem indice. Rode npm run indexar e tente de novo.",
      code: "RAG_SEM_INDICE",
    });
    return false;
  }

  corpo.trechos = rag.buscar(corpo.trimmedMessage);
  corpo.options.trechos = corpo.trechos;
  return true;
}

/** Nomes unicos das notas usadas, para o front exibir as fontes. */
function fontesDe(trechos) {
  return [...new Set((trechos || []).map((t) => t.arquivo))];
}

// ─────────────────────────────────────────────────────────────
// ACOES DE ARQUIVO: propor no chat, executar so no clique
// ─────────────────────────────────────────────────────────────

/**
 * Propostas pendentes, em memoria. O chat NUNCA executa ferramenta: ele
 * registra a intencao aqui e devolve um id. O /arquivos/executar so aceita id
 * existente.
 *
 * Isso e o que impede a rota de virar uma API de escrita arbitraria aberta na
 * rede local: nao da para pedir "grave neste caminho", so "confirme a proposta
 * X", e o caminho da proposta X foi validado quando ela nasceu.
 */
const propostas = new Map();
const TTL_PROPOSTA_MS = 10 * 60 * 1000;

function limparPropostasVencidas() {
  const agora = Date.now();
  for (const [id, p] of propostas) {
    if (agora - p.criadaEm > TTL_PROPOSTA_MS) propostas.delete(id);
  }
}

/**
 * Converte as tool_calls do modelo em propostas exibiveis. Argumento com JSON
 * quebrado (acontece com modelo pequeno) vira proposta invalida, que o front
 * mostra como erro em vez de sumir sem explicacao.
 */
function registrarPropostas(toolCalls) {
  limparPropostasVencidas();
  const saida = [];

  for (const tc of toolCalls || []) {
    if (!arquivos.existeFerramenta(tc.nome)) continue;

    let args;
    try {
      args = JSON.parse(tc.argumentos || "{}");
    } catch (_) {
      saida.push({ id: null, ferramenta: tc.nome, invalida: true, resumo: `O modelo montou um pedido invalido para ${tc.nome}.` });
      continue;
    }

    const id = crypto.randomUUID();
    propostas.set(id, { ferramenta: tc.nome, args, criadaEm: Date.now() });
    saida.push({
      id,
      ferramenta: tc.nome,
      args,
      destrutiva: arquivos.ehDestrutiva(tc.nome),
      geraIndice: arquivos.escreveNoDisco(tc.nome),
      resumo: arquivos.resumirAcao(tc.nome, args),
      // Pre-visualizacao do conteudo, para conferir antes de gravar.
      previa: typeof args.conteudo === "string" ? args.conteudo.slice(0, 2000) : null,
    });
  }
  return saida;
}

api.post("/chat", chatRateLimiter, async (req, res) => {
  const corpo = validarCorpoDeChat(req, res);
  if (!corpo) return;
  if (!prepararModoDocs(corpo, res)) return;

  try {
    const response = await agent.processMessage(corpo.trimmedMessage, corpo.history, corpo.options);
    return res.json({
      text: response.text,
      provider: response.provider,
      model: response.model,
      latencyMs: response.latencyMs,
      usage: response.usage || null,
      fontes: fontesDe(corpo.trechos),
      acoes: registrarPropostas(response.toolCalls),
      timestamp: response.timestamp,
    });
  } catch (err) {
    console.error("[/api/chat] Erro:", err.message, err.details || "");
    if (err.name === "AgentError") {
      return res.status(503).json({ error: err.message, code: "AGENT_UNAVAILABLE" });
    }
    return res.status(500).json({ error: "Erro interno no Jarvis.", code: "INTERNAL_ERROR" });
  }
});

/**
 * Chat em streaming (SSE). Eventos:
 *   inicio → { provider, usedFallback }        provedor que comecou a responder
 *   (sem nome) → { delta }                     trecho de texto
 *   fim   → { provider, model, latencyMs... }  resposta completa
 *   erro  → { error, code, parcial }           falha (parcial=true se ja havia texto)
 */
api.post("/chat/stream", chatRateLimiter, async (req, res) => {
  const corpo = validarCorpoDeChat(req, res);
  if (!corpo) return;
  if (!prepararModoDocs(corpo, res)) return;

  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  const enviar = (evento, dados) => {
    if (res.writableEnded) return;
    if (evento) res.write(`event: ${evento}\n`);
    res.write(`data: ${JSON.stringify(dados)}\n\n`);
  };

  // Se o navegador fechar a aba no meio, aborta a inferencia: sem isso o
  // llama-server continua gerando tokens para ninguem.
  const aborto = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) aborto.abort();
  });

  try {
    const response = await agent.processMessageStream(
      corpo.trimmedMessage,
      corpo.history,
      { ...corpo.options, signal: aborto.signal },
      {
        onStart: (info) => enviar("inicio", info),
        onDelta: (delta) => enviar(null, { delta }),
      }
    );

    enviar("fim", {
      provider: response.provider,
      model: response.model,
      latencyMs: response.latencyMs,
      usage: response.usage || null,
      fontes: fontesDe(corpo.trechos),
      acoes: registrarPropostas(response.toolCalls),
      timestamp: response.timestamp,
    });
  } catch (err) {
    console.error("[/api/chat/stream] Erro:", err.message, err.details || "");
    enviar("erro", {
      error: err.name === "AgentError" ? err.message : "Erro interno no Jarvis.",
      code: err.name === "AgentError" ? "AGENT_UNAVAILABLE" : "INTERNAL_ERROR",
      parcial: err.details?.parcial === true,
    });
  } finally {
    res.end();
  }
});

// Limiter proprio: cada mensagem enviada dispara tambem uma extracao, e usar o
// mesmo limiter do chat cortaria o teto efetivo de mensagens pela metade.
const memoriaRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas requisicoes.", code: "RATE_LIMIT_EXCEEDED" },
});

/** Extrai fatos duraveis da mensagem. Melhor esforco: falha vira lista vazia. */
api.post("/memoria/extrair", memoriaRateLimiter, async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== "string" || message.trim().length === 0 || message.length > 8000) {
    return res.status(400).json({ error: "Mensagem invalida.", code: "INVALID_MESSAGE", fatos: [] });
  }

  try {
    const fatos = await agent.extrairFatos(message.trim());
    return res.json({ fatos });
  } catch (err) {
    console.error("[/api/memoria/extrair] Erro:", err.message);
    return res.json({ fatos: [] });
  }
});

/**
 * Executa uma proposta ja registrada. E o unico ponto do sistema que escreve
 * em disco a pedido do modelo, e so roda depois do clique do usuario.
 * A proposta e consumida: um clique, uma execucao.
 */
api.post("/arquivos/executar", chatRateLimiter, async (req, res) => {
  const { id } = req.body || {};
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Acao invalida.", code: "ACAO_INVALIDA" });
  }

  limparPropostasVencidas();
  const proposta = propostas.get(id);
  if (!proposta) {
    return res.status(404).json({
      error: "Essa acao expirou ou ja foi executada. Peca de novo ao Jarvis.",
      code: "ACAO_NAO_ENCONTRADA",
    });
  }
  propostas.delete(id);

  try {
    const resultado = await arquivos.executarFerramenta(proposta.ferramenta, proposta.args);
    console.log(`[arquivos] ${proposta.ferramenta} executado:`, resultado.caminho ?? "");
    return res.json({ ok: true, ferramenta: proposta.ferramenta, resultado });
  } catch (err) {
    console.error(`[arquivos] ${proposta.ferramenta} falhou:`, err.message);
    const conhecido = err.name === "ErroArquivo";
    return res.status(conhecido ? 400 : 500).json({
      ok: false,
      error: conhecido ? err.message : "Nao consegui concluir a acao.",
      code: conhecido ? err.codigo : "ERRO_INTERNO",
    });
  }
});

/** Cancela uma proposta sem executar. Libera a memoria na hora do "Cancelar". */
api.post("/arquivos/cancelar", (req, res) => {
  const { id } = req.body || {};
  if (id && typeof id === "string") propostas.delete(id);
  return res.json({ ok: true });
});

api.get("/health", async (req, res) => {
  try {
    const status = await agent.checkProvidersHealth();
    return res.json({
      status: status.anyAvailable ? "healthy" : "degraded",
      local: status.local,
      localModel: status.localModel,
      contextoMax: status.modelo?.contextoMax ?? null,
      modelo: status.modelo || {},
      activeProvider: status.local ? "local" : null,
      docs: rag.info(),
      perfil: perfil.info(),
      arquivos: { raiz: arquivos.RAIZ },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(503).json({ status: "error", local: false });
  }
});

api.get("/info", (req, res) => {
  res.json({
    name: "Jarvis Chat API",
    version: "2.2.0",
    providers: ["local"],
    local: {
      baseUrl: localProvider.BASE_URL,
    },
  });
});

app.use("/api", api);
app.use("/", api);

app.get("*", (req, res) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});

if (require.main === module) {
  arquivos.garantirRaiz();
  app.listen(PORT, () => {
    console.log(`Jarvis iniciado em http://localhost:${PORT}`);
    console.log(`Frontend servido de: ${frontendDir}`);
    console.log(`Arquivos do Jarvis em: ${arquivos.RAIZ}`);
  });
}

module.exports = app;
