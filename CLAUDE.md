# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Contexto do Projeto

> Gerado por /mapa em 2026-05-25. Vault: `G:\Meu Drive\Obsidian Vault\Graphify\Jarvis\` · 36 arquivos · 37 nós · 49 arestas · 9 comunidades

**Para qualquer dúvida arquitetural, leia primeiro `_index.md` e o hub da comunidade relevante antes de explorar nodes/.**

### Ponto de entrada
`G:\Meu Drive\Obsidian Vault\Graphify\Jarvis\_index.md`

### God nodes (núcleo — ausência quebra o sistema)
- `log-ingest-store` — 10 conexões — persistência dual SQLite/Neon HTTP + contexto LLM primário
- `config` — 9 conexões — acesso a env vars, importado por todos os módulos
- `getEnvString` — 9 conexões — env var ausente sem fallback quebra silenciosamente
- `ensurePostgres` — 8 conexões — lazy init Neon + 5 índices, chamado por toda I/O
- `server` — 8 conexões — entry point Express, orquestra todos os módulos
- `agent` — 7 conexões — hub LLM: contexto + roteamento + resposta
- `monitor` — 7 conexões — avalia 13 automações em 1 query batch
- `getPromptContext` — 6 conexões — monta contexto primário: detecta automação + busca eventos
- `queryEvents` — 6 conexões — consultada 3x em getPromptContext + monitor + API
- `log-context` — 5 conexões — fallback Drive/local quando banco está vazio

### Comunidades
| Hub | Nós | Papel |
|-----|-----|-------|
| C0 Log Ingest Store | 8 | Persistência Neon HTTP + contexto LLM |
| C1 Frontend UI | 2 | SPA chat + monitor (polling 2min, pausa em hidden) |
| C2 Monitor + Server Core | 6 | Express + monitor batch + cache 5min |
| C3 Server Endpoints | 7 | 7 endpoints REST |
| C4 Agent LLM | 2 | Orquestra LLM |
| C5 Groq Provider | 2 | Groq 3-key cascade |
| C6 Config + Env | 4 | Env vars centralizadas |
| C7 Log Context | 2 | Fallback Drive/local |
| C8 Telegram Alertas | 2 | Alertas overdue |

### Mudanças desde último mapeamento (2026-05-15)
- Driver Postgres: `pg.Pool` → `@neondatabase/serverless` (HTTP, scale-to-zero)
- Nova função batch `getLastEventsForAutomations` substitui 13 queries do monitor por 1
- Lógica overdue revista: usa último evento real (anti-deslizamento de horários)
- Cache monitor 30s → 5min; polling front 30s → 2min com pausa em hidden

### Anomalias detectadas
Nenhuma anomalia ativa.

## Comandos

Todos os comandos rodam dentro de `jarvis-chat-export/backend/`:

```bash
npm start        # produção
npm run dev      # desenvolvimento com nodemon (hot reload)
```

Não há testes automatizados nem linter. Para validar endpoints manualmente:

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/info
curl http://localhost:3000/api/logs-debug
```

## Arquitetura

Backend Node.js + Express com uma responsabilidade: receber logs de automações Windows via HTTP e responder perguntas sobre elas com LLM (Groq).

### Fluxo de uma mensagem no chat

```
POST /api/chat
  → agent.processMessage()
      → log-ingest-store.getPromptContext()   ← fonte primária: banco de logs
          detectAutomationFromEvents()         ← detecta automação citada pelo usuário
          queryEvents({ automation })          ← prioriza eventos daquela automação
      → getLogContext()                        ← fallback: Google Drive ou pasta local
      → groq.chat(messages)                   ← envia contexto + pergunta ao LLM
```

### Identidade do Jarvis

`agent.js → getJarvisSystemPrompt()` define a personalidade: JARVIS é apresentado como criado por Matheus Trajano. Quando perguntado sobre sua origem, não menciona Anthropic, Groq ou qualquer provedor de IA.

### Persistência dual (SQLite ↔ Postgres)

`log-ingest-store.js` decide o backend pela presença de `DATABASE_URL` ou `POSTGRES_URL`:
- **Sem essas vars** → SQLite via `node:sqlite` (nativo), arquivo em `backend/data/jarvis-logs.db`
- **Com essas vars** → Postgres via `pg`, schema criado automaticamente

O modo ativo aparece em `/api/info` e `/api/logs-debug`. Em produção (Vercel), usar Postgres (ex: Neon).

### Detecção de automação no contexto

`detectAutomationFromEvents()` normaliza a pergunta do usuário e os nomes de automação (remove acentos, pontuação, converte separadores) e faz correspondência por substring. Também considera `meta.script` além do campo `automation`. Quando há match, o contexto do LLM é filtrado para aquela automação.

### Monitor (`monitor.js`)

Lista estática de automações com schedules. Para cada automação `connected: true`, calcula se houve evento desde o último horário esperado. Status: `ok`, `pending`, `overdue` (>5h sem evento, configurável via `MONITOR_OVERDUE_HOURS`). Cache de 30s em memória via `getCachedMonitorStatus()`.

### Frontend

Servido como static files pelo próprio Express. Resolução:
1. `backend/public/` (deploy Vercel)
2. `frontend/` (fallback legacy)

**`frontend/` é a fonte de trabalho visual.** Após edições, espelhar manualmente para `backend/public/`. O frontend faz polling a cada 30s chamando `refreshSystemStatus()` + `refreshMonitor()`.

### Groq com três chaves

`providers/groq.js` tenta `GROQ_API_KEY_1` + `GROQ_MODEL_1` primeiro, depois `GROQ_API_KEY_2` e `GROQ_API_KEY_3` como fallback automático em cascata.

## Variáveis de ambiente críticas

| Var | Obrigatória | Descrição |
|---|---|---|
| `GROQ_API_KEY_1` | Sim | Chave primária Groq |
| `LOG_INGEST_API_TOKEN` | Sim | Token Bearer para `POST /api/log-ingest` |
| `DATABASE_URL` | Em produção | Postgres (Neon). Sem ela, usa SQLite local |
| `MONITOR_OVERDUE_HOURS` | Não | Horas para marcar automação como overdue (padrão: 5) |

## Adicionando uma nova automação

Quando uma nova automação PowerShell começa a enviar logs:

1. Adicionar entrada no array `AUTOMATIONS` em `monitor.js` com `connected: true` e o `schedule` correto
2. O campo `name` deve coincidir **exatamente** com o campo `automation` enviado no payload do script PS1
3. O `displayName` é o que aparece no painel do frontend

Enquanto `connected: false`, a automação aparece no painel como "não conectada" sem alertas de atraso.

## Padrão dos scripts PS1

Cada script de automação segue este padrão obrigatório:
- `Write-Log` → formata a mensagem e classifica nível/status/errorCode
- `Send-LogsToJarvis` → envia batch de eventos para `POST /api/log-ingest` com Bearer token
- `Invoke-ComWithRetry` → abre Excel via COM com até 10 tentativas
- Cópia limpa: `PasteSpecial` só valores + `TabRatio = 0.8` antes de salvar
- Limpeza de Mashup: `Stop-Process Mashup*` em scripts que usam Power Query com conexões externas

## Fila de execução (PowerShell)

`PowerShell/Gestor_Fila_Automacao.ps1` é o mutex global que evita colisões entre scripts Excel. Usa `Global\ExcelAutomationQueueProbel`, chamado pelas VBS wrappers antes de cada script. Não é invocado diretamente — cada automação aguarda liberação como subprocesso.

## O que não versionar

- `PowerShell/` — scripts operacionais do servidor Windows (já no `.gitignore`)
- `backend/data/jarvis-logs.db` — banco SQLite local
- `backend/ngrok.exe` e `ngrok.yml` — tunelamento local

## Deploy (Vercel)

Entry point: `backend/server.js`. O `backend/.vercelignore` exclui `node_modules`, `data/` e scripts locais. Após deploy, confirmar `/api/info` retornando `"mode": "postgres"`.
