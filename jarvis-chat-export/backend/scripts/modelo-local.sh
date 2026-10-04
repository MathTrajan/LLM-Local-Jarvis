#!/usr/bin/env bash
#
# Sobe o llama-server com o modelo local do Jarvis.
#
# Este processo e SEPARADO do servidor Node e morre quando o shell fecha —
# mesma armadilha do odysseus-dev. Sem ele de pe, a estrategia "auto" cai para o
# Groq (precisa de internet) e a estrategia "local" devolve 503.
#
set -euo pipefail

cd "$(dirname "$0")/.."

# Le o .env sem executa-lo (evita surpresa com valores contendo espaco/aspas).
if [ -f .env ]; then
  GGUF=$(grep -E '^LOCAL_LLM_GGUF=' .env | head -1 | cut -d= -f2-)
  BASE=$(grep -E '^LOCAL_LLM_BASE_URL=' .env | head -1 | cut -d= -f2-)
fi

GGUF="${GGUF:-}"
BASE="${BASE:-http://127.0.0.1:8080/v1}"
# Extrai a porta da base URL; cai para 8080 se nao der.
PORTA=$(printf '%s' "$BASE" | sed -nE 's#.*://[^:]+:([0-9]+).*#\1#p')
PORTA="${PORTA:-8080}"
CONTEXTO="${LOCAL_LLM_CTX:-4096}"

BIN="${LLAMA_SERVER_BIN:-/opt/homebrew/bin/llama-server}"

if [ ! -x "$BIN" ]; then
  echo "erro: llama-server nao encontrado em $BIN" >&2
  echo "instale com: brew install llama.cpp" >&2
  exit 1
fi

if [ -z "$GGUF" ] || [ ! -f "$GGUF" ]; then
  echo "erro: modelo GGUF nao encontrado." >&2
  echo "defina LOCAL_LLM_GGUF no .env apontando para o arquivo .gguf" >&2
  [ -n "$GGUF" ] && echo "valor atual: $GGUF" >&2
  exit 1
fi

if lsof -ti:"$PORTA" >/dev/null 2>&1; then
  echo "ja existe algo escutando na porta $PORTA — nada a fazer."
  exit 0
fi

echo "modelo:   $(basename "$GGUF")"
echo "porta:    $PORTA"
echo "contexto: $CONTEXTO tokens"
echo

exec "$BIN" \
  -m "$GGUF" \
  --host 127.0.0.1 \
  --port "$PORTA" \
  -c "$CONTEXTO" \
  -ngl 99
