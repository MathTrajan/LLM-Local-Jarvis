# Jarvis — Agente de Observabilidade para Automações Windows

Agente operacional que recebe logs estruturados de automações PowerShell, armazena em banco Postgres e responde perguntas com base em evidências reais de execução.

**Produção:** [https://jarvis-observability.vercel.app](https://jarvis-observability.vercel.app)

---

## Estrutura do Projeto

```
jarvis-chat-export/
├── backend/
│   ├── server.js              ← Servidor Express (entry point)
│   ├── agent.js               ← Lógica do agente e roteamento
│   ├── config.js              ← Helpers centralizados de variáveis de ambiente
│   ├── log-context.js         ← Leitura de logs (Google Drive + fallback local)
│   ├── log-ingest-store.js    ← HTTP ingest + persistência Postgres/SQLite
│   ├── providers/
│   │   └── groq.js            ← Integração com Groq SDK
│   ├── public/                ← Frontend servido pelo Express (deploy Vercel)
│   │   ├── index.html
│   │   ├── css/style.css
│   │   └── js/app.js
│   ├── .env.example           ← Template de variáveis de ambiente
│   └── package.json
├── frontend/                  ← Fonte de trabalho visual (espelhado em public/)
└── .gitignore
```

---

## Instalação Local

### Pré-requisitos

- Node.js v18+
- Chave de API Groq válida → [console.groq.com](https://console.groq.com)

### Passos

```bash
cd jarvis-chat-export/backend
cp .env.example .env
# preencha ao menos GROQ_API_KEY_1 e LOG_INGEST_API_TOKEN
npm install
npm start
```

Acesse: **http://localhost:3000**

---

## Variáveis de Ambiente

Todas as variáveis são lidas via `config.js`, com trim automático para evitar erros de `\r\n`.

```env
# Servidor
PORT=3000
AGENT_ROUTING_STRATEGY=auto
ALLOWED_ORIGIN=*

# Groq (provedor LLM)
GROQ_API_KEY_1=
GROQ_API_KEY_2=
GROQ_MODEL_1=llama-3.3-70b-versatile
GROQ_MODEL_2=llama-3.1-8b-instant

# HTTP Ingest
LOG_INGEST_ENABLED=true
LOG_INGEST_API_TOKEN=troque-por-um-token-seguro
LOG_INGEST_MAX_CONTEXT_EVENTS=60

# Banco de dados (produção — Neon Postgres)
DATABASE_URL=postgresql://user:password@host/db?sslmode=require

# Banco de dados (local — SQLite, usado quando DATABASE_URL está vazio)
# LOG_DB_FILE=C:\\caminho\\jarvis-logs.db

# Logs via Google Drive (fallback opcional)
GOOGLE_DRIVE_FOLDER_ID=
GOOGLE_SERVICE_ACCOUNT_JSON=

# Logs via pasta local (fallback opcional)
LOG_LOCAL_DIR=G:\\Meu Drive\\Log
```

> **Nunca commite o arquivo `.env`.** Ele está no `.gitignore`.

---

## Deploy em Produção (Vercel + Neon)

1. Crie um banco gratuito em [neon.tech](https://neon.tech) e copie a connection string
2. No painel Vercel do projeto, configure:
   - `DATABASE_URL` = string de conexão Neon
   - `LOG_INGEST_API_TOKEN` = token secreto
   - `GROQ_API_KEY_1` e `GROQ_API_KEY_2`
   - `AGENT_ROUTING_STRATEGY=auto`
3. Faça redeploy
4. Valide os endpoints:

```bash
curl https://jarvis-observability.vercel.app/api/health
curl https://jarvis-observability.vercel.app/api/info
curl https://jarvis-observability.vercel.app/api/logs-debug
```

`/api/info` deve retornar `"logs": { "mode": "postgres" }`.

---

## Integração com Automações Windows

Scripts PowerShell nas automações enviam eventos estruturados ao Jarvis ao final de cada execução.

**Configurar variáveis no servidor Windows (como Administrador):**

```powershell
[Environment]::SetEnvironmentVariable("JARVIS_INGEST_URL", "https://jarvis-observability.vercel.app/api/log-ingest", "Machine")
[Environment]::SetEnvironmentVariable("JARVIS_INGEST_API_TOKEN", "<mesmo token configurado na Vercel>", "Machine")

# Verificar
Get-ChildItem Env:JARVIS*
```

**Formato do payload enviado pelos scripts:**

```json
{
  "events": [
    {
      "timestamp": "2026-05-07T14:00:00.000Z",
      "automation": "Programacao_de_Pedidos",
      "level": "INFO",
      "message": "[STATUS] RefreshAll concluído.",
      "runId": "ProgramacaoPedidos-20260507-140000",
      "status": "running",
      "tags": ["excel", "powerquery"],
      "meta": {
        "host": "SERVIDOR-WIN",
        "user": "automacao"
      }
    }
  ]
}
```

---

## Endpoints da API

| Método | Endpoint | Descrição |
|---|---|---|
| POST | `/api/chat` | Conversa operacional com o Jarvis |
| GET | `/api/health` | Status do provedor LLM |
| POST | `/api/log-ingest` | Ingestão de logs estruturados |
| GET | `/api/logs/query` | Consulta protegida de eventos |
| GET | `/api/logs-debug` | Diagnóstico da fonte de logs e ingestão |
| GET | `/api/info` | Configuração atual do backend |

---

## Segurança

- Chaves de API lidas exclusivamente via variáveis de ambiente
- `LOG_INGEST_API_TOKEN` obrigatório para aceitar eventos no endpoint de ingestão
- `.env` protegido pelo `.gitignore`
- Scripts de automação não são versionados no repositório

---

## Licença

MIT License — Uso livre para fins educacionais e comerciais.
