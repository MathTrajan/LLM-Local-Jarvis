/**
 * ============================================================
 * JARVIS CHAT — Camada do Agente (Roteamento e Lógica)
 * ============================================================
 * Esta camada é o "cérebro" do Jarvis.
 * Responsabilidades:
 * - Decidir qual provedor usar para cada requisição
 * - Manter o system prompt consistente
 * - Registrar logs de uso e erros (Groq)
 * ============================================================
 */

const groqProvider = require("./providers/groq");
const { getLogContext } = require("./log-context");
const { getPromptContext: getIngestPromptContext } = require("./log-ingest-store");
const { getEnvString, getEnvBoolean } = require("./config");

// ─────────────────────────────────────────────────────────────
// CONFIGURAÇÃO DE ROTEAMENTO
// ─────────────────────────────────────────────────────────────

/**
 * Estratégias de roteamento disponíveis:
 * - "groq" → Sempre usa o provedor Groq
 * - "auto" → Usa o provedor Groq
 */
const STRATEGIES = {
  GROQ: "groq",
  AUTO: "auto",
};

/**
 * Determina qual provedor deve ser o principal para esta requisição
 */
function resolveRouting(strategy) {
  return {
    primary: groqProvider,
    primaryName: "groq",
  };
}

// ─────────────────────────────────────────────────────────────
// SYSTEM PROMPT DO JARVIS
// ─────────────────────────────────────────────────────────────

function getJarvisSystemPrompt() {
  return {
    role: "system",
    content: `Você é Jarvis, um assistente virtual altamente inteligente, sofisticado e eficiente.
Sempre responda em português brasileiro, de forma objetiva.
Quando o usuário pedir informações sobre automações, execuções, erros ou status do ambiente:
- Use os logs injetados no contexto como fonte primária.
- Cite evidências dos logs (arquivo/evento, horário, erro, runId e errorCode quando existirem).
- Não invente dados. Se não houver evidência, diga claramente que não encontrou nos logs disponíveis.`,
  };
}

// ─────────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL DO AGENTE
// ─────────────────────────────────────────────────────────────

async function processMessage(userMessage, conversationHistory = [], options = {}) {
  const strategy = options.strategy || getEnvString("AGENT_ROUTING_STRATEGY", STRATEGIES.AUTO) || STRATEGIES.AUTO;
  const routing = resolveRouting(strategy);
  let logContext = null;
  const ingestEnabled = getEnvBoolean("LOG_INGEST_ENABLED", true);

  if (ingestEnabled) {
    try {
      const ingestContext = await getIngestPromptContext(userMessage);
      if (ingestContext && ingestContext.files > 0) {
        logContext = ingestContext;
      }
    } catch (error) {
      console.error("[Jarvis] Falha ao montar contexto HTTP ingest:", error.message);
    }
  }

  if (!logContext) {
    logContext = await getLogContext();
  }

  const systemPrompt = getJarvisSystemPrompt();
  const logsPrompt = {
    role: "system",
    content: logContext.context,
  };
  const newUserMessage = { role: "user", content: userMessage };

  const filteredHistory = conversationHistory.filter((m) => m.role !== "system");
  const messages = [systemPrompt, logsPrompt, ...filteredHistory, newUserMessage];

  const startTime = Date.now();

  // ── Tentativa com o provedor PRIMÁRIO ──────────────────────
  try {
    console.log(`[Jarvis] Roteando para provedor primário: ${routing.primaryName} | Estratégia: ${strategy}`);

    const result = await routing.primary.chat(messages, {
      maxTokens: options.maxTokens,
      temperature: options.temperature,
    });

    const latency = Date.now() - startTime;
    console.log(`[Jarvis] ✓ Resposta de ${routing.primaryName} em ${latency}ms`);

    return buildResponse(result, routing.primaryName, false, latency, null, {
      logSource: logContext.source,
      logFiles: logContext.files,
    });

  } catch (primaryError) {
    const primaryLatency = Date.now() - startTime;
    console.error(`[Jarvis] ✗ Falha no provedor primário (${routing.primaryName}) após ${primaryLatency}ms:`, primaryError.message);

    throw new AgentError(
      "O provedor Groq está temporariamente indisponível. Tente novamente em alguns instantes.",
      {
        primaryProvider: routing.primaryName,
        primaryError: primaryError.message,
        totalLatencyMs: primaryLatency,
      }
    );
  }
}


// ─────────────────────────────────────────────────────────────
// HEALTH CHECK DOS PROVEDORES (Interface de Status)
// ─────────────────────────────────────────────────────────────

async function checkProvidersHealth() {
  const groq = await groqProvider.healthCheck();
  return {
    groq: groq === true,
    anyAvailable: groq === true,
  };
}

// ─────────────────────────────────────────────────────────────
// HELPERS E TIPOS
// ─────────────────────────────────────────────────────────────

function buildResponse(providerResult, providerName, usedFallback, latencyMs, fallbackInfo = null, contextInfo = null) {
  return {
    text: providerResult.text,
    provider: providerName,
    model: providerResult.model,
    usedFallback,
    fallbackInfo,
    contextInfo,
    latencyMs,
    usage: providerResult.usage || null,
    timestamp: new Date().toISOString(),
  };
}

class AgentError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AgentError";
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

module.exports = {
  processMessage,
  checkProvidersHealth,
  getJarvisSystemPrompt,
  STRATEGIES,
  AgentError,
};
