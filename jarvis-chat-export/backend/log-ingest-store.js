const fs = require("fs");
const path = require("path");
const { neon } = require("@neondatabase/serverless");
const { getEnvString, getEnvBoolean, getEnvInt } = require("./config");

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = getEnvString("LOG_DB_FILE", path.join(DATA_DIR, "jarvis-logs.db"));
const MAX_QUERY_LIMIT = 200;
const DEFAULT_QUERY_LIMIT = 50;
const POSTGRES_URL = getEnvString("DATABASE_URL") || getEnvString("POSTGRES_URL");

let sqliteDb = null;
let neonSql = null;
let pgReady = false;
let DatabaseSync = null;

function getStorageMode() {
  return POSTGRES_URL ? "postgres" : "sqlite";
}

function parseDateSafe(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function inferLevelFromText(text) {
  const line = String(text || "").toUpperCase();
  if (line.includes("ERROR") || line.includes("FALHA")) return "ERROR";
  if (line.includes("WARN")) return "WARN";
  return "INFO";
}

function normalizeEvent(raw = {}) {
  const timestamp = parseDateSafe(raw.timestamp) || new Date();
  const message = String(raw.message || "").trim();
  const automation = String(raw.automation || raw.source || "unknown").trim();
  const level = String(raw.level || inferLevelFromText(message)).toUpperCase();
  const tags = Array.isArray(raw.tags) ? raw.tags.map((t) => String(t)) : [];
  const meta = raw.meta && typeof raw.meta === "object" ? raw.meta : {};

  return {
    eventId: String(raw.eventId || `${timestamp.getTime()}-${Math.random().toString(36).slice(2, 8)}`),
    timestamp: timestamp.toISOString(),
    level: ["INFO", "WARN", "ERROR"].includes(level) ? level : "INFO",
    automation,
    message: message.slice(0, 4000),
    tags,
    runId: raw.runId ? String(raw.runId) : null,
    status: raw.status ? String(raw.status) : null,
    errorCode: raw.errorCode ? String(raw.errorCode) : null,
    meta,
    receivedAt: new Date().toISOString(),
  };
}

function expandPayloadToEvents(payload) {
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.events)) {
    // Herda campos do pai nos eventos filhos quando ausentes
    return payload.events.map(ev => ({
      automation: payload.automation || payload.source,
      runId:      payload.runId,
      tags:       payload.tags,
      meta:       payload.meta,
      ...ev,
    }));
  }
  if (typeof payload.text === "string" && payload.text.trim()) {
    const lines = payload.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 2000);

    return lines.map((line) => ({
      timestamp: payload.timestamp || new Date().toISOString(),
      automation: payload.automation || payload.source || "unknown",
      level: inferLevelFromText(line),
      message: line,
      tags: payload.tags || [],
      meta: payload.meta || {},
    }));
  }
  return [payload];
}

function ensureSqlite() {
  if (POSTGRES_URL) return null;
  if (sqliteDb) return sqliteDb;
  if (!DatabaseSync) {
    ({ DatabaseSync } = require("node:sqlite"));
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  sqliteDb = new DatabaseSync(DB_FILE);
  sqliteDb.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS log_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      level TEXT NOT NULL,
      automation TEXT NOT NULL,
      message TEXT NOT NULL,
      tags_json TEXT,
      run_id TEXT,
      status TEXT,
      error_code TEXT,
      meta_json TEXT,
      received_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_log_events_timestamp ON log_events(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_log_events_level ON log_events(level);
    CREATE INDEX IF NOT EXISTS idx_log_events_automation ON log_events(automation);
    CREATE INDEX IF NOT EXISTS idx_log_events_received_at ON log_events(received_at DESC);
  `);

  return sqliteDb;
}

// Driver HTTP do Neon: cada query e uma chamada HTTP isolada, sem conexao TCP persistente.
// Permite a Neon fazer scale-to-zero entre queries, reduzindo CU drasticamente.
function getSql() {
  if (!POSTGRES_URL) return null;
  if (neonSql) return neonSql;
  // fullResults: true devolve { rows, rowCount } como o driver pg classico.
  neonSql = neon(POSTGRES_URL, { fullResults: true });
  return neonSql;
}

async function ensurePostgres() {
  if (!POSTGRES_URL || pgReady) return;

  const sql = getSql();
  await sql.query(`
    CREATE TABLE IF NOT EXISTS log_events (
      id BIGSERIAL PRIMARY KEY,
      event_id TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL,
      level TEXT NOT NULL,
      automation TEXT NOT NULL,
      message TEXT NOT NULL,
      tags_json JSONB,
      run_id TEXT,
      status TEXT,
      error_code TEXT,
      meta_json JSONB,
      received_at TIMESTAMPTZ NOT NULL
    )
  `);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_log_events_timestamp ON log_events(timestamp DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_log_events_level ON log_events(level)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_log_events_automation ON log_events(automation)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_log_events_received_at ON log_events(received_at DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_log_events_automation_ts ON log_events(LOWER(automation), timestamp DESC)`);

  pgReady = true;
}

function rowToEvent(row) {
  const parseMaybeJson = (value, fallback) => {
    if (value == null) return fallback;
    if (typeof value === "object") return value;
    try {
      return JSON.parse(value);
    } catch (_) {
      return fallback;
    }
  };

  return {
    id: row.id,
    eventId: row.event_id,
    timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
    level: row.level,
    automation: row.automation,
    message: row.message,
    tags: parseMaybeJson(row.tags_json, []),
    runId: row.run_id,
    status: row.status,
    errorCode: row.error_code,
    meta: parseMaybeJson(row.meta_json, {}),
    receivedAt: row.received_at instanceof Date ? row.received_at.toISOString() : row.received_at,
  };
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAutomationVariants(event) {
  const variants = new Set();
  if (event.automation) variants.add(event.automation);
  if (event.meta && event.meta.script) variants.add(event.meta.script);
  return Array.from(variants)
    .map(normalizeText)
    .filter(Boolean);
}

function detectAutomationFromEvents(userMessage, events) {
  const normalizedMessage = normalizeText(userMessage);
  if (!normalizedMessage) return null;

  const automations = new Map();
  for (const event of events) {
    if (!event.automation || automations.has(event.automation)) continue;
    automations.set(event.automation, buildAutomationVariants(event));
  }

  let bestMatch = null;
  for (const [automation, variants] of automations.entries()) {
    for (const variant of variants) {
      if (!variant) continue;
      const exactish =
        normalizedMessage.includes(variant) ||
        variant.includes(normalizedMessage);
      if (exactish) {
        const score = variant.length;
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { automation, score, variant };
        }
      }
    }
  }

  return bestMatch ? bestMatch.automation : null;
}

async function appendEvents(payload) {
  const rawEvents = expandPayloadToEvents(payload);
  const normalized = rawEvents
    .map(normalizeEvent)
    .filter((e) => e.message && e.automation)
    .slice(0, 1000);

  if (normalized.length === 0) {
    return { accepted: 0, rejected: rawEvents.length };
  }

  if (POSTGRES_URL) {
    await ensurePostgres();
    const sql = getSql();
    // Multi-row INSERT em UMA chamada HTTP (atomico por ser single statement).
    // Chunks de 200 para nao estourar limite de params do Postgres (65535).
    const CHUNK = 200;
    for (let i = 0; i < normalized.length; i += CHUNK) {
      const chunk = normalized.slice(i, i + CHUNK);
      const params = [];
      const placeholders = chunk.map((e) => {
        const base = params.length;
        params.push(
          e.eventId,
          e.timestamp,
          e.level,
          e.automation,
          e.message,
          JSON.stringify(e.tags || []),
          e.runId,
          e.status,
          e.errorCode,
          JSON.stringify(e.meta || {}),
          e.receivedAt
        );
        return `($${base + 1}, $${base + 2}::timestamptz, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::jsonb, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}::jsonb, $${base + 11}::timestamptz)`;
      }).join(", ");

      await sql.query(
        `INSERT INTO log_events (
          event_id, timestamp, level, automation, message,
          tags_json, run_id, status, error_code, meta_json, received_at
        ) VALUES ${placeholders}`,
        params
      );
    }

    return { accepted: normalized.length, rejected: Math.max(0, rawEvents.length - normalized.length) };
  }

  const db = ensureSqlite();
  const stmt = db.prepare(`
    INSERT INTO log_events (
      event_id, timestamp, level, automation, message,
      tags_json, run_id, status, error_code, meta_json, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec("BEGIN");
  try {
    for (const e of normalized) {
      stmt.run(
        e.eventId,
        e.timestamp,
        e.level,
        e.automation,
        e.message,
        JSON.stringify(e.tags || []),
        e.runId,
        e.status,
        e.errorCode,
        JSON.stringify(e.meta || {}),
        e.receivedAt
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { accepted: normalized.length, rejected: Math.max(0, rawEvents.length - normalized.length) };
}

function buildSqliteQuery(options = {}) {
  const where = [];
  const values = [];

  if (options.level) {
    where.push("level = ?");
    values.push(String(options.level).toUpperCase());
  }

  if (options.automation) {
    where.push("LOWER(automation) LIKE ?");
    values.push(`%${String(options.automation).toLowerCase()}%`);
  }

  if (options.search) {
    const q = `%${String(options.search).toLowerCase()}%`;
    where.push("(LOWER(message) LIKE ? OR LOWER(automation) LIKE ?)");
    values.push(q, q);
  }

  const from = parseDateSafe(options.from);
  if (from) {
    where.push("timestamp >= ?");
    values.push(from.toISOString());
  }

  const to = parseDateSafe(options.to);
  if (to) {
    where.push("timestamp <= ?");
    values.push(to.toISOString());
  }

  const limit = Math.min(Number(options.limit || DEFAULT_QUERY_LIMIT), MAX_QUERY_LIMIT);
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const sql = `
    SELECT *
    FROM log_events
    ${whereSql}
    ORDER BY timestamp DESC
    LIMIT ?
  `;

  values.push(limit);
  return { sql, values };
}

function buildPostgresQuery(options = {}) {
  const where = [];
  const values = [];

  if (options.level) {
    values.push(String(options.level).toUpperCase());
    where.push(`level = $${values.length}`);
  }

  if (options.automation) {
    values.push(`%${String(options.automation).toLowerCase()}%`);
    where.push(`LOWER(automation) LIKE $${values.length}`);
  }

  if (options.search) {
    const q = `%${String(options.search).toLowerCase()}%`;
    values.push(q);
    values.push(q);
    where.push(`(LOWER(message) LIKE $${values.length - 1} OR LOWER(automation) LIKE $${values.length})`);
  }

  const from = parseDateSafe(options.from);
  if (from) {
    values.push(from.toISOString());
    where.push(`timestamp >= $${values.length}::timestamptz`);
  }

  const to = parseDateSafe(options.to);
  if (to) {
    values.push(to.toISOString());
    where.push(`timestamp <= $${values.length}::timestamptz`);
  }

  const limit = Math.min(Number(options.limit || DEFAULT_QUERY_LIMIT), MAX_QUERY_LIMIT);
  values.push(limit);
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  return {
    sql: `
      SELECT *
      FROM log_events
      ${whereSql}
      ORDER BY timestamp DESC
      LIMIT $${values.length}
    `,
    values,
  };
}

async function queryEvents(options = {}) {
  if (POSTGRES_URL) {
    await ensurePostgres();
    const sql = getSql();
    const { sql: text, values } = buildPostgresQuery(options);
    const result = await sql.query(text, values);
    return result.rows.map(rowToEvent);
  }

  const db = ensureSqlite();
  const { sql, values } = buildSqliteQuery(options);
  const rows = db.prepare(sql).all(...values);
  return rows.map(rowToEvent);
}

// Formata ISO timestamp em horario BRT legivel (dd/MM HH:mm:ss). Evita o LLM tentar converter UTC.
function formatBrt(iso) {
  if (!iso) return "?";
  try {
    return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  } catch (_) {
    return String(iso);
  }
}

// Converte minutos decimais (ex: 1.8) em "1min 48s" / "1h 30min" / "45s"
function formatDuration(minutes) {
  if (minutes == null || !isFinite(minutes)) return null;
  const totalSeconds = Math.max(0, Math.round(minutes * 60));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}min`;
  if (m > 0) return s > 0 ? `${m}min ${s}s` : `${m}min`;
  return `${s}s`;
}

function buildContextFromEvents(events, focusAutomation = null) {
  const lines = [];
  lines.push(`FONTE PRIMARIA: LOGS EM TEMPO REAL (BANCO ${getStorageMode().toUpperCase()})`);
  lines.push("Todos os horarios abaixo ja estao em America/Sao_Paulo (BRT, UTC-3). NAO converta.");
  lines.push("Use esses eventos como verdade principal para automacoes, erros, execucoes e status.");
  lines.push("Se faltar evidencia nesses eventos, declare claramente.");
  if (focusAutomation) {
    lines.push(`AUTOMACAO EM FOCO: ${focusAutomation}`);
  }
  lines.push("");

  for (const event of events) {
    const details = [];
    if (event.runId) details.push(`runId=${event.runId}`);
    if (event.errorCode) details.push(`errorCode=${event.errorCode}`);
    if (event.status) details.push(`status=${event.status}`);
    if (Array.isArray(event.tags) && event.tags.length > 0) {
      details.push(`tags=${event.tags.join("|")}`);
    }
    const detailSuffix = details.length > 0 ? ` | ${details.join(" | ")}` : "";
    // Trunca mensagens muito longas (ex: dumps de upload) para nao estourar o TPM do Groq
    const msg = event.message.length > 400 ? event.message.slice(0, 400) + "…" : event.message;
    lines.push(`[${formatBrt(event.timestamp)} BRT] [${event.level}] [${event.automation}] ${msg}${detailSuffix}`);
  }

  return lines.join("\n");
}

function buildHistoryContext(history, stats) {
  if (!history || history.length === 0) return "";
  const lines = [];
  lines.push(`\nHISTÓRICO DE EXECUÇÕES (últimas ${history.length}) — horários em BRT:`);
  for (const run of history) {
    const dt = formatBrt(run.startTs);
    const dur = formatDuration(run.durationMinutes) || "duração indisponível";
    const st = run.hasError ? "FALHA" : run.succeeded ? "sucesso" : "incompleto";
    lines.push(`  ${dt} | duração: ${dur} | ${st} | eventos: ${run.eventCount}`);
  }
  if (stats) {
    const successRate =
      stats.totalRuns > 0
        ? Math.round(((stats.totalRuns - stats.failedRuns) / stats.totalRuns) * 100)
        : null;
    lines.push(
      `\nESTATÍSTICAS (${stats.daysBack} dias): ${stats.totalRuns} execuções | ${stats.failedRuns} falhas | sucesso: ${successRate ?? "?"}%`
    );
    if (stats.avgDurationMinutes != null) {
      const avg = formatDuration(stats.avgDurationMinutes);
      const min = formatDuration(stats.minDurationMinutes);
      const max = formatDuration(stats.maxDurationMinutes);
      lines.push(`  Duração: média ${avg} | mín ${min} | máx ${max}`);
    }
  }
  return lines.join("\n");
}

async function getPromptContext(userMessage, automationHint = null) {
  // Default 25: o tier gratuito do Groq tem TPM 6000. Com 60 eventos o request batia 6300+.
  const maxEvents = Math.max(1, getEnvInt("LOG_INGEST_MAX_CONTEXT_EVENTS", 25));
  const search = userMessage && userMessage.length > 4 ? userMessage : null;
  const recentEvents = await queryEvents({ limit: Math.max(maxEvents * 3, 120) });
  // Quando o front passa a automação explicitamente (botão DIAGNOSTICAR), pula a detecção por texto
  const detectedAutomation = automationHint || detectAutomationFromEvents(userMessage, recentEvents);

  let events = [];
  if (detectedAutomation) {
    events = await queryEvents({ automation: detectedAutomation, limit: maxEvents });
  }

  if (events.length === 0 && search) {
    events = await queryEvents({ search, limit: maxEvents });
  }

  if (events.length === 0) {
    events = recentEvents.slice(0, maxEvents);
  }

  let history = null;
  let stats = null;
  if (detectedAutomation) {
    try {
      [history, stats] = await Promise.all([
        getAutomationHistory(detectedAutomation, 7),
        getRunStats(detectedAutomation, 30),
      ]);
    } catch (_) { /* histórico é não-crítico */ }
  }

  const eventsContext = buildContextFromEvents(events, detectedAutomation);
  const historyBlock = buildHistoryContext(history, stats);
  const context = historyBlock ? `${eventsContext}\n${historyBlock}` : eventsContext;

  return {
    source: POSTGRES_URL ? "postgres-ingest" : "sqlite-ingest",
    files: events.length,
    context,
    events,
    focusAutomation: detectedAutomation,
  };
}

async function getStats() {
  if (POSTGRES_URL) {
    await ensurePostgres();
    const sql = getSql();
    // 1 query so: ultimo evento + estimativa de total via pg_class.reltuples (barato, sem scan).
    const result = await sql.query(`
      SELECT
        (SELECT timestamp FROM log_events ORDER BY timestamp DESC LIMIT 1) AS last_ts,
        (SELECT reltuples::bigint FROM pg_class WHERE relname = 'log_events') AS total
    `);
    const row = result.rows[0] || {};
    return {
      enabled: getEnvBoolean("LOG_INGEST_ENABLED", true),
      dataFile: "postgres",
      lastEventAt: row.last_ts instanceof Date ? row.last_ts.toISOString() : (row.last_ts || null),
      totalEvents: Number(row.total || 0),
    };
  }

  const db = ensureSqlite();
  const recentRows = db.prepare("SELECT timestamp FROM log_events ORDER BY timestamp DESC LIMIT 1").all();
  const countRow = db.prepare("SELECT COUNT(*) as total FROM log_events").get();

  return {
    enabled: getEnvBoolean("LOG_INGEST_ENABLED", true),
    dataFile: DB_FILE,
    lastEventAt: recentRows[0]?.timestamp || null,
    totalEvents: Number(countRow?.total || 0),
  };
}

async function getLastEventForAutomation(automationName, afterTimestamp) {
  const afterIso = afterTimestamp instanceof Date ? afterTimestamp.toISOString() : afterTimestamp;

  if (POSTGRES_URL) {
    await ensurePostgres();
    const sql = getSql();
    const result = await sql.query(
      `SELECT * FROM log_events WHERE LOWER(automation) = LOWER($1) AND timestamp >= $2::timestamptz ORDER BY timestamp DESC LIMIT 1`,
      [automationName, afterIso]
    );
    return result.rows[0] ? rowToEvent(result.rows[0]) : null;
  }

  const db = ensureSqlite();
  const row = db
    .prepare(`SELECT * FROM log_events WHERE LOWER(automation) = LOWER(?) AND timestamp >= ? ORDER BY timestamp DESC LIMIT 1`)
    .get(automationName, afterIso);
  return row ? rowToEvent(row) : null;
}

// Retorna o ultimo evento por automacao, em UMA unica query, restrito a uma lista
// de nomes e a um cutoff global. Substitui N chamadas de getLastEventForAutomation.
async function getLastEventsForAutomations(automationNames, sinceTimestamp) {
  const names = Array.from(new Set((automationNames || []).filter(Boolean)));
  if (names.length === 0) return {};
  const sinceIso = sinceTimestamp instanceof Date ? sinceTimestamp.toISOString() : sinceTimestamp;

  if (POSTGRES_URL) {
    await ensurePostgres();
    const sql = getSql();
    const lowered = names.map((n) => String(n).toLowerCase());
    const result = await sql.query(
      `SELECT DISTINCT ON (LOWER(automation)) *
       FROM log_events
       WHERE LOWER(automation) = ANY($1::text[])
         AND timestamp >= $2::timestamptz
       ORDER BY LOWER(automation), timestamp DESC`,
      [lowered, sinceIso]
    );
    const byName = {};
    for (const row of result.rows) {
      byName[String(row.automation).toLowerCase()] = rowToEvent(row);
    }
    return byName;
  }

  const db = ensureSqlite();
  const placeholders = names.map(() => "LOWER(?)").join(",");
  const rows = db
    .prepare(
      `SELECT * FROM log_events
       WHERE LOWER(automation) IN (${placeholders})
         AND timestamp >= ?
       ORDER BY timestamp DESC`
    )
    .all(...names, sinceIso);
  const byName = {};
  for (const row of rows) {
    const key = String(row.automation).toLowerCase();
    if (!byName[key]) byName[key] = rowToEvent(row);
  }
  return byName;
}

async function deleteOldEvents(daysOld = 30) {
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();

  if (POSTGRES_URL) {
    await ensurePostgres();
    const sql = getSql();
    const result = await sql.query(
      `DELETE FROM log_events WHERE timestamp < $1::timestamptz`,
      [cutoff]
    );
    return result.rowCount;
  }

  const db = ensureSqlite();
  const stmt = db.prepare(`DELETE FROM log_events WHERE timestamp < ?`);
  stmt.run(cutoff);
  return null;
}

async function getAutomationHistory(automationName, limit = 7) {
  const lim = Math.min(Number(limit) || 7, 20);

  if (POSTGRES_URL) {
    await ensurePostgres();
    const sql = getSql();
    const result = await sql.query(
      `SELECT run_id,
              MIN(timestamp) AS start_ts,
              MAX(timestamp) AS end_ts,
              ROUND(EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) / 60, 1) AS duration_minutes,
              MAX(CASE WHEN level = 'ERROR' THEN 1 ELSE 0 END) AS has_error,
              MAX(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS has_success,
              COUNT(*) AS event_count
       FROM log_events
       WHERE LOWER(automation) = LOWER($1) AND run_id IS NOT NULL
       GROUP BY run_id
       ORDER BY MIN(timestamp) DESC
       LIMIT $2`,
      [automationName, lim]
    );
    return result.rows.map((r) => ({
      runId: r.run_id,
      startTs: r.start_ts instanceof Date ? r.start_ts.toISOString() : r.start_ts,
      endTs: r.end_ts instanceof Date ? r.end_ts.toISOString() : r.end_ts,
      durationMinutes: r.duration_minutes != null ? Number(r.duration_minutes) : null,
      hasError: r.has_error === 1 || r.has_error === true,
      succeeded: r.has_success === 1 || r.has_success === true,
      eventCount: Number(r.event_count || 0),
    }));
  }

  const db = ensureSqlite();
  const rows = db
    .prepare(
      `SELECT run_id,
              MIN(timestamp) AS start_ts,
              MAX(timestamp) AS end_ts,
              ROUND((julianday(MAX(timestamp)) - julianday(MIN(timestamp))) * 24 * 60, 1) AS duration_minutes,
              MAX(CASE WHEN level = 'ERROR' THEN 1 ELSE 0 END) AS has_error,
              MAX(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS has_success,
              COUNT(*) AS event_count
       FROM log_events
       WHERE LOWER(automation) = LOWER(?) AND run_id IS NOT NULL
       GROUP BY run_id
       ORDER BY MIN(timestamp) DESC
       LIMIT ?`
    )
    .all(automationName, lim);
  return rows.map((r) => ({
    runId: r.run_id,
    startTs: r.start_ts,
    endTs: r.end_ts,
    durationMinutes: r.duration_minutes != null ? Number(r.duration_minutes) : null,
    hasError: r.has_error === 1,
    succeeded: r.has_success === 1,
    eventCount: Number(r.event_count || 0),
  }));
}

async function getRunStats(automationName, daysBack = 30) {
  const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  if (POSTGRES_URL) {
    await ensurePostgres();
    const sql = getSql();
    const result = await sql.query(
      `SELECT COUNT(DISTINCT run_id) AS total_runs,
              ROUND(AVG(EXTRACT(EPOCH FROM (max_ts - min_ts)) / 60)::numeric, 1) AS avg_dur,
              ROUND(MIN(EXTRACT(EPOCH FROM (max_ts - min_ts)) / 60)::numeric, 1) AS min_dur,
              ROUND(MAX(EXTRACT(EPOCH FROM (max_ts - min_ts)) / 60)::numeric, 1) AS max_dur,
              SUM(has_error) AS failed_runs
       FROM (
         SELECT run_id,
                MIN(timestamp) AS min_ts,
                MAX(timestamp) AS max_ts,
                MAX(CASE WHEN level = 'ERROR' THEN 1 ELSE 0 END) AS has_error
         FROM log_events
         WHERE LOWER(automation) = LOWER($1)
           AND run_id IS NOT NULL
           AND timestamp >= $2::timestamptz
         GROUP BY run_id
       ) sub`,
      [automationName, cutoff]
    );
    const r = result.rows[0];
    if (!r || !r.total_runs) return null;
    return {
      totalRuns: Number(r.total_runs),
      failedRuns: Number(r.failed_runs || 0),
      avgDurationMinutes: r.avg_dur != null ? Number(r.avg_dur) : null,
      minDurationMinutes: r.min_dur != null ? Number(r.min_dur) : null,
      maxDurationMinutes: r.max_dur != null ? Number(r.max_dur) : null,
      daysBack,
    };
  }

  const db = ensureSqlite();
  const row = db.prepare(
    `SELECT COUNT(DISTINCT run_id) AS total_runs,
            ROUND(AVG(dur), 1) AS avg_dur,
            ROUND(MIN(dur), 1) AS min_dur,
            ROUND(MAX(dur), 1) AS max_dur,
            SUM(has_error) AS failed_runs
     FROM (
       SELECT run_id,
              ROUND((julianday(MAX(timestamp)) - julianday(MIN(timestamp))) * 24 * 60, 1) AS dur,
              MAX(CASE WHEN level = 'ERROR' THEN 1 ELSE 0 END) AS has_error
       FROM log_events
       WHERE LOWER(automation) = LOWER(?) AND run_id IS NOT NULL AND timestamp >= ?
       GROUP BY run_id
     )`
  ).get(automationName, cutoff);

  if (!row || !row.total_runs) return null;
  return {
    totalRuns: Number(row.total_runs),
    failedRuns: Number(row.failed_runs || 0),
    avgDurationMinutes: row.avg_dur != null ? Number(row.avg_dur) : null,
    minDurationMinutes: row.min_dur != null ? Number(row.min_dur) : null,
    maxDurationMinutes: row.max_dur != null ? Number(row.max_dur) : null,
    daysBack,
  };
}

async function getDailyStats(automationName, days = 7) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  if (POSTGRES_URL) {
    await ensurePostgres();
    const sql = getSql();
    const result = await sql.query(
      `SELECT DATE(timestamp AT TIME ZONE 'America/Sao_Paulo') AS day,
              COUNT(*) AS total,
              SUM(CASE WHEN level = 'ERROR' THEN 1 ELSE 0 END) AS errors
       FROM log_events
       WHERE LOWER(automation) = LOWER($1) AND timestamp >= $2::timestamptz
       GROUP BY day ORDER BY day ASC`,
      [automationName, cutoff]
    );
    return result.rows.map(r => ({
      date: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
      total: Number(r.total),
      errors: Number(r.errors),
    }));
  }

  const db = ensureSqlite();
  const rows = db.prepare(
    `SELECT DATE(datetime(timestamp, '-3 hours')) AS day,
            COUNT(*) AS total,
            SUM(CASE WHEN level = 'ERROR' THEN 1 ELSE 0 END) AS errors
     FROM log_events
     WHERE LOWER(automation) = LOWER(?) AND timestamp >= ?
     GROUP BY day ORDER BY day ASC`
  ).all(automationName, cutoff);
  return rows.map(r => ({ date: r.day, total: Number(r.total), errors: Number(r.errors) }));
}

module.exports = {
  appendEvents,
  queryEvents,
  getPromptContext,
  getStats,
  getStorageMode,
  getLastEventForAutomation,
  getLastEventsForAutomations,
  deleteOldEvents,
  getAutomationHistory,
  getRunStats,
  getDailyStats,
};
