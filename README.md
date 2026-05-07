# Jarvis — Agente de Observabilidade para Automações Windows

O **Jarvis** é um agente de observabilidade desenvolvido para monitorar automações Windows em tempo real.

Ele recebe logs estruturados das automações via HTTP, armazena os eventos em banco Postgres e responde perguntas operacionais com base em evidências reais de execução.

## Demonstração Online

[https://jarvis-observability.vercel.app](https://jarvis-observability.vercel.app)

## O que o Jarvis faz

- Recebe logs estruturados de automações PowerShell via `POST /api/log-ingest`
- Armazena eventos em Postgres (Neon) em produção ou SQLite localmente
- Responde perguntas como "o que aconteceu com a automação X?" ou "quais erros ocorreram hoje?"
- Mostra fonte ativa de logs, status operacional e último evento conhecido na interface

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + Express |
| LLM | Groq API |
| Banco local | SQLite |
| Banco produção | Postgres via Neon |
| Frontend | HTML/CSS/JS puro |
| Deploy | Vercel |

## Como rodar localmente

```bash
git clone https://github.com/MathTrajan/Jarvis-Chat-Assistente-Virtual-Inteligente.git
cd jarvis-chat-export/backend
cp .env.example .env
# preencha GROQ_API_KEY_1 e LOG_INGEST_API_TOKEN no .env
npm install
npm start
```

Acesse: **http://localhost:3000**

## Endpoints principais

| Método | Endpoint | Descrição |
|---|---|---|
| POST | `/api/chat` | Conversa operacional com o Jarvis |
| GET | `/api/health` | Status do provedor LLM |
| POST | `/api/log-ingest` | Ingestão de logs estruturados |
| GET | `/api/logs/query` | Consulta protegida de eventos |
| GET | `/api/logs-debug` | Diagnóstico da fonte de logs |
| GET | `/api/info` | Configuração atual do backend |

## Integração com automações Windows

Scripts PowerShell nas automações enviam eventos para o Jarvis ao final de cada execução:

```powershell
# Variáveis de ambiente no servidor Windows (configurar como Administrador)
[Environment]::SetEnvironmentVariable("JARVIS_INGEST_URL", "https://jarvis-observability.vercel.app/api/log-ingest", "Machine")
[Environment]::SetEnvironmentVariable("JARVIS_INGEST_API_TOKEN", "<token>", "Machine")
```

---

*Desenvolvido por **Matheus Trajano** — [LinkedIn](https://www.linkedin.com/in/matheus-trajano-5179a7378/)*
