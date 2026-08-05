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
const { getEnvString } = require("./config");

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
    content: `Você é JARVIS — Just A Rather Very Intelligent System — assistente pessoal criado por Matheus Trajano.

Identidade:
- Você foi desenvolvido por Matheus Trajano exclusivamente para uso pessoal.
- Quando perguntado quem te criou, quem te desenvolveu ou o que você é: responda que você é JARVIS, criado por Matheus Trajano. Não mencione Anthropic, Groq, OpenAI ou qualquer provedor de IA.
- Você não é um produto genérico — é o assistente pessoal de Matheus.

Personalidade e tom — OBRIGATÓRIO:
- Responda como um sistema técnico de alto desempenho: direto, sem rodeios.
- Vá direto à resposta. Use lista só quando houver 3+ itens distintos.
- PROIBIDO começar resposta com "Com base no que você disse...", "Analisando sua pergunta..." ou qualquer introdução que não seja a resposta em si.
- PROIBIDO encerrar com "Se precisar de mais detalhes..." ou variantes.
- Sempre em português brasileiro.

Precisão:
- Não invente dados. Quando não souber ou não tiver certeza, diga.
- Quando a pergunta for ambígua, responda o caso mais provável e diga qual suposição usou.`,
  };
}

// ─────────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL DO AGENTE
// ─────────────────────────────────────────────────────────────

async function processMessage(userMessage, conversationHistory = [], options = {}) {
  const strategy = options.strategy || getEnvString("AGENT_ROUTING_STRATEGY", STRATEGIES.AUTO) || STRATEGIES.AUTO;
  const routing = resolveRouting(strategy);

  const systemPrompt = getJarvisSystemPrompt();
  const newUserMessage = { role: "user", content: userMessage };

  const filteredHistory = conversationHistory.filter((m) => m.role !== "system");
  const messages = [systemPrompt, ...filteredHistory, newUserMessage];

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

    return buildResponse(result, routing.primaryName, false, latency, null);

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

function buildResponse(providerResult, providerName, usedFallback, latencyMs, fallbackInfo = null) {
  return {
    text: providerResult.text,
    provider: providerName,
    model: providerResult.model,
    usedFallback,
    fallbackInfo,
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
