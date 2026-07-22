<div align="center">

# 🤖 Jarvis — Agente de Observabilidade para Automações Windows

Monitoramento em tempo real de automações PowerShell, com ingestão de logs, persistência em Postgres e respostas operacionais via LLM.

![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white)
![Groq](https://img.shields.io/badge/Groq_LLM-F55036?style=flat-square)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL_(Neon)-316192?style=flat-square&logo=postgresql&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white)
![Vercel](https://img.shields.io/badge/Deploy-Vercel-000000?style=flat-square&logo=vercel&logoColor=white)

[**🌐 Demonstração online**](https://jarvis-observability.vercel.app)

</div>

---

## Visão geral

O **Jarvis** é um agente de observabilidade que dá visibilidade sobre um parque de automações rodando em servidores Windows. Cada rotina PowerShell envia, ao final da execução, um evento estruturado para o Jarvis via HTTP. Esses eventos são persistidos e ficam disponíveis para consulta em linguagem natural — o operador pergunta *"o que aconteceu com a automação X hoje?"* e o agente responde com base em evidências reais de execução, não em suposições.

## Funcionalidades

- **Ingestão de logs** de automações PowerShell via `POST /api/log-ingest`
- **Persistência dual**: Postgres (Neon) em produção, SQLite localmente — sem alteração de código
- **Chat operacional** com LLM (Groq) fundamentado nos eventos reais dos últimos dias
- **Monitor de automações** com detecção de atraso ("overdue") pelo tempo desde o último evento real
- **Painel** com fonte ativa de logs, status operacional e último evento conhecido
- **Alertas via Telegram** e gráfico diário de execuções
- Fuso horário correto (BRT) no monitor e no contexto enviado ao LLM

## Arquitetura

```
┌────────────────────────┐      POST /api/log-ingest       ┌───────────────────────────┐
│  Automações PowerShell │ ──────────────────────────────▶ │  Backend Node.js/Express   │
│  (servidor Windows)    │      eventos estruturados        │                            │
└────────────────────────┘                                  │  ┌──────────────────────┐  │
                                                             │  │ log-ingest-store     │  │
┌────────────────────────┐      GET /api/chat               │  │ Postgres | SQLite    │  │
│  Painel Web (frontend) │ ◀──────────────────────────────▶ │  └──────────────────────┘  │
│  polling ~30s          │      respostas fundamentadas      │  ┌──────────────────────┐  │
└────────────────────────┘                                  │  │ agent + monitor      │  │
                                                             │  │ contexto → Groq LLM  │  │
                                                             │  └──────────────────────┘  │
                                                             └───────────────────────────┘
```

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + Express |
| LLM | Groq API |
| Banco (produção) | PostgreSQL via Neon |
| Banco (local) | SQLite |
| Frontend | HTML/CSS/JS puro (polling) |
| Alertas | Telegram Bot API |
| Deploy | Vercel |

## Como rodar localmente

```bash
git clone https://github.com/MathTrajan/Jarvis-Chat-Assistente-Virtual-Inteligente.git
cd Jarvis-Chat-Assistente-Virtual-Inteligente/jarvis-chat-export/backend

cp .env.example .env
# preencha GROQ_API_KEY_1 e LOG_INGEST_API_TOKEN no .env

npm install
npm start
```

Acesse: **http://localhost:3000**

## Variáveis de ambiente principais

| Variável | Descrição |
|---|---|
| `GROQ_API_KEY_1` | Chave da API Groq (obrigatória para o chat) |
| `LOG_INGEST_API_TOKEN` | Token que protege o endpoint de ingestão de logs |
| `DATABASE_URL` | String Postgres/Neon (produção); se ausente, usa SQLite local |
| `LOG_INGEST_ENABLED` | Habilita a persistência de logs via HTTP |

> Lista completa em `jarvis-chat-export/backend/.env.example`.

## Endpoints principais

| Método | Endpoint | Descrição |
|---|---|---|
| `POST` | `/api/chat` | Conversa operacional com o Jarvis |
| `GET`  | `/api/health` | Status do provedor LLM |
| `POST` | `/api/log-ingest` | Ingestão de logs estruturados |
| `GET`  | `/api/logs/query` | Consulta protegida de eventos |
| `GET`  | `/api/logs-debug` | Diagnóstico da fonte de logs |
| `GET`  | `/api/info` | Configuração atual do backend |

## Integração com automações Windows

As automações enviam um evento ao final de cada execução. No servidor Windows, configure (como Administrador):

```powershell
[Environment]::SetEnvironmentVariable("JARVIS_INGEST_URL", "https://jarvis-observability.vercel.app/api/log-ingest", "Machine")
[Environment]::SetEnvironmentVariable("JARVIS_INGEST_API_TOKEN", "<token>", "Machine")
```

---

<div align="center">

Desenvolvido por **Matheus Trajano** · [LinkedIn](https://www.linkedin.com/in/matheus-trajano-5179a7378/)

</div>
