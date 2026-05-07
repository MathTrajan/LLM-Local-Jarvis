/**
 * ============================================================
 * JARVIS CHAT - Provedor Groq (duas chaves + dois modelos)
 * ============================================================
 */

const Groq = require("groq-sdk");
const { getEnvString } = require("../config");

const KEY_1 = getEnvString("GROQ_API_KEY_1") || getEnvString("GROQ_API_KEY") || "";
const MODEL_1 = getEnvString("GROQ_MODEL_1") || getEnvString("GROQ_MODEL") || "llama-3.3-70b-versatile";

const KEY_2 = getEnvString("GROQ_API_KEY_2") || "";
const MODEL_2 = getEnvString("GROQ_MODEL_2") || "llama-3.1-8b-instant";

const clients = new Map();

function getClient(apiKey) {
  if (!apiKey) return null;
  if (!clients.has(apiKey)) {
    clients.set(apiKey, new Groq({ apiKey }));
  }
  return clients.get(apiKey);
}

function getCandidates(modelOverride) {
  const candidates = [{ apiKey: KEY_1, model: modelOverride || MODEL_1, slot: "primary" }];
  if (KEY_2) {
    candidates.push({ apiKey: KEY_2, model: modelOverride || MODEL_2, slot: "secondary" });
  }
  return candidates;
}

async function chat(messages, options = {}) {
  const modelOverride = options.model || null;
  const maxTokens = options.maxTokens || 1024;
  const temperature = options.temperature ?? 0.7;

  const hasSystemMessage = messages.some((m) => m.role === "system");
  const fullMessages = hasSystemMessage ? messages : [getSystemPrompt(), ...messages];

  let lastError = null;
  for (const candidate of getCandidates(modelOverride)) {
    const client = getClient(candidate.apiKey);
    if (!client) continue;

    try {
      const response = await client.chat.completions.create({
        model: candidate.model,
        messages: fullMessages,
        max_tokens: maxTokens,
        temperature,
      });

      const choice = response.choices[0];
      const text = choice.message.content?.trim() || "";

      return {
        text,
        model: response.model,
        provider: "groq",
        usage: {
          promptTokens: response.usage?.prompt_tokens,
          completionTokens: response.usage?.completion_tokens,
          totalTokens: response.usage?.total_tokens,
        },
        finishReason: choice.finish_reason,
      };
    } catch (error) {
      lastError = error;
      console.error(`Erro na chamada Chat (Groq ${candidate.slot}):`, error.message);
    }
  }

  throw lastError || new Error("Nenhuma chave Groq configurada.");
}

async function healthCheck() {
  try {
    for (const candidate of getCandidates(null)) {
      const client = getClient(candidate.apiKey);
      if (!client) continue;

      const response = await client.chat.completions
        .create({
          model: candidate.model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 5,
        })
        .catch(() => null);

      if (response && response.choices) return true;
    }
    return false;
  } catch (error) {
    console.error("Erro no HealthCheck (Groq):", error.message);
    return false;
  }
}

function getSystemPrompt() {
  return {
    role: "system",
    content:
      "Voce e Jarvis, um assistente virtual altamente inteligente, sofisticado e eficiente. Responda em portugues brasileiro de forma clara e direta.",
  };
}

module.exports = { chat, healthCheck, getSystemPrompt };
