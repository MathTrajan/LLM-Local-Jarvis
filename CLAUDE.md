# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Contexto do Projeto

> Gerado por /mapa em 2026-05-14. Grafo: `G:\Meu Drive\Obsidian Vault\Graphify\Jarvis\graphify-out\Jarvis - Grafo.md` · 34 arquivos · 231 nós · 365 arestas · 51 comunidades

### Núcleo do sistema (god nodes)
- `getEnvString()` — 12 conexões — ponto único de acesso a env vars em todos os módulos Node.js
- `loadLogsFromSource()` — 11 conexões — hub de carregamento de logs (Google Drive + local)
- `init()` — 10 conexões — inicialização do banco de dados (SQLite/Postgres)
- `refreshSystemStatus()` — 9 conexões — frontend polling que atualiza monitor + status
- `sendMessage()` — 9 conexões — ponto de entrada do chat no frontend

### Comunidades principais
| ID | Nome | Tamanho |
|---|---|---|
| C0 | Frontend UI + Chat App | 37 nós |
| C1 | Log Ingest Store + DB Query | 23 nós |
| C2 | Config + Env Management | 22 nós |
| C3 | Monitor + Server Core | 10 nós |
| C4 | Agent LLM + Response | 9 nós |
| C5 | Agent Error Handling | 8 nós |
| C6 | Legacy Acompanhamento Meta | 7 nós |
| C7 | Legacy Prog Pedidos | 7 nós |
| C8 | Legacy Saldo Cotia | 7 nós |
| C9 | Groq LLM Provider | 6 nós |
| C10-C18 | Automações PS1 individuais (Curva A, Estoque, Matriz, Orçam, Pedidos, Prog, Reposição) | 6 nós cada |

### Conexões não óbvias
- `processMessage()` chama `getEnvString()` e `getEnvBoolean()` via `config.js` — acoplamento indireto ao config em todo fluxo LLM
- `runLogCleanup()` também acessa `getEnvString()` — limpeza de logs depende de config centralizado
- `getEnvString()` é ponto de falha único: qualquer env var ausente quebra agent, server e log-ingest simultaneamente

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

### Groq com duas chaves

`providers/groq.js` tenta `GROQ_API_KEY_1` + `GROQ_MODEL_1` primeiro, depois `GROQ_API_KEY_2` + `GROQ_MODEL_2` como fallback automático.

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
