# AGENTS.md — Instruções para agentes de IA (Codex, Gemini, Cursor, Copilot CLI, Aider)

> Auto-gerado por /mapa em 2026-05-25. Leia este arquivo ANTES de qualquer ação no projeto.
> Seções marcadas `<!-- manual -->` são preservadas em re-runs do /mapa.

## 0. O que é este projeto

**Jarvis** — Node.js · Vercel · Neon Postgres · SQLite (dev). Backend Express que recebe logs de automações PowerShell por HTTP e responde perguntas sobre elas com LLM Groq.

<!-- manual:start:context -->
Sistema operacional rodando em servidor Windows da Colchoes Ind. 13 automações conectadas (PowerShell) enviam logs via POST /api/log-ingest com Bearer token. Frontend SPA polla /api/monitor a cada 2min mostrando status ok/pending/overdue.
<!-- manual:end:context -->

## 1. Ordem de leitura obrigatória

1. **`CLAUDE.md`** (raiz) — convenções, comandos, decisões.
2. **`G:\Meu Drive\Obsidian Vault\Graphify\Jarvis\_index.md`** — mapa do projeto.
3. **`G:\Meu Drive\Obsidian Vault\Graphify\Jarvis\contexts\`** — architecture, domain, stack, conventions.
4. **`nodes\C<N>-<nome>-hub.md`** — hub da comunidade tocada.
5. **`nodes\<id>.md`** — nó específico só se hub não responder.
6. Código-fonte — em último caso.

## 2. Como o Claude Code trabalha aqui (não duplique)

- **`/mapa`** — regera knowledge graph. Última execução: **2026-05-25** (37 nós · 49 arestas · 9 comunidades).
- **`/sync-vault`** — sincroniza aprendizados com Obsidian.
- Memória persistente do Claude em `C:\Users\User\.claude\projects\` — outros agentes não acessam.

## 3. God Nodes (não toque sem motivo forte)

- `jarvis-chat-export/backend/log-ingest-store.js` — persistência dual SQLite/Neon HTTP + contexto LLM (10 conexões)
- `jarvis-chat-export/backend/config.js` — env vars (9 conexões)
- `jarvis-chat-export/backend/server.js` — entry Express + cache + cleanup (8 conexões)
- `jarvis-chat-export/backend/monitor.js` — schedules + status batch (7 conexões)
- `jarvis-chat-export/backend/agent.js` — orquestra LLM (7 conexões)

## 4. Padrões obrigatórios

<!-- manual:start:patterns -->
- Siga `G:\Meu Drive\Obsidian Vault\Graphify\Jarvis\contexts\conventions.md`.
- Em produção use SEMPRE o driver `@neondatabase/serverless` (HTTP). Não reintroduzir `pg.Pool`.
- Schedules em `monitor.js` usam UTC métodos (`getUTC*`) pra não depender do timezone do runtime (Vercel é UTC, Windows é BRT).
- Toda query nova que vai no caminho do monitor passa pelo índice composto `(LOWER(automation), timestamp DESC)`.
- Frontend é editado em `frontend/` e espelhado manualmente para `backend/public/`.
<!-- manual:end:patterns -->

## 5. Comandos canônicos

**Node:**
```bash
cd jarvis-chat-export/backend
npm start          # produção
npm run dev        # nodemon
```

**Vercel:**
```bash
vercel deploy --prod --yes
vercel logs --level error --since 30m
vercel logs --level error --since 10m --expand
```

<!-- manual:start:commands -->
**Health check produção:**
```bash
curl https://jarvis-observability.vercel.app/api/info
curl https://jarvis-observability.vercel.app/api/monitor
```
<!-- manual:end:commands -->

## 6. Variáveis de ambiente

<!-- manual:start:env -->
| Var | Obrigatória | Descrição |
|-----|-------------|-----------|
| `GROQ_API_KEY_1` | Sim | Chave primária Groq |
| `LOG_INGEST_API_TOKEN` | Sim | Bearer pra POST /api/log-ingest |
| `DATABASE_URL` | Em prod | Neon Postgres connection string |
| `MONITOR_OVERDUE_HOURS` | Não | Threshold overdue (padrão: 5) |
| `TELEGRAM_BOT_TOKEN` | Não | Alertas Telegram |
| `TELEGRAM_CHAT_ID` | Não | Chat ID dos alertas |
<!-- manual:end:env -->

## 7. Anomalias conhecidas (não "corrija" achando que é bug)

- `openai ^6.32.0` em `package.json` — dependência sem uso no código. Pode remover.

## 8. Não faça

<!-- manual:start:donts -->
- Não reintroduzir `pg.Pool` — Neon CU consumption explode (conexão TCP impede scale-to-zero).
- Não rodar múltiplos agentes ou ferramentas em paralelo (regra global do usuário).
- Não usar `--no-verify` em commits.
- Não fazer `git push --force` para main.
- Não comitar `.env` nem `backend/data/*.db`.
- Não editar `PowerShell/*.ps1` sem entender o mutex `Global\ExcelAutomationQueueProbel`.
<!-- manual:end:donts -->

## 9. Faça

<!-- manual:start:dos -->
- Antes de mudar lógica de banco, verifique o impacto em CU da Neon (queries por hora, conexões abertas).
- Para automações novas, adicionar entrada em `AUTOMATIONS` no `monitor.js` com `name` idêntico ao campo `automation` enviado pelos scripts PS1.
- Ao adicionar nota nova no vault, siga template em `_meta\conventions.md`.
<!-- manual:end:dos -->

## 10. Em caso de dúvida

1. Releia `CLAUDE.md` + `_index.md`.
2. Cheque o hub da comunidade relevante.
3. **Pergunte ao usuário** antes de agir em deploy, refatoração de god node, ou mudanças que afetem CU/billing.
