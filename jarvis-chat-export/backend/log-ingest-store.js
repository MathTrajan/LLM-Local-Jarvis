const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { getEnvString, getEnvBoolean, getEnvInt } = require("./config");

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = getEnvString("LOG_DB_FILE", path.join(DATA_DIR, "jarvis-logs.db"));
const MAX_QUERY_LIMIT = 200;
const DEFAULT_QUERY_LIMIT = 50;
const POSTGRES_URL = getEnvString("DATABASE_URL") || getEnvString("POSTGRES_URL");

let sqliteDb = null;
let pgPool = null;
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
  if (Array.isArray(payload.events)) return payload.events;
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

function getPool() {
  if (!POSTGRES_URL) return null;
  if (pgPool) return pgPool;

  pgPool = new Pool({
    connectionString: POSTGRES_URL,
    ssl: POSTGRES_URL.includes("localhost") ? false : { rejectUnauthorized: false },
    max: 5,
  });

  return pgPool;
}

async function ensurePostgres() {
  if (!POSTGRES_URL || pgReady) return;

  const pool = getPool();
  await pool.query(`
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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_log_events_timestamp ON log_events(timestamp DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_log_events_level ON log_events(level)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_log_events_automation ON log_events(automation)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_log_events_received_at ON log_events(received_at DESC)`);

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
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const e of normalized) {
        await client.query(
          `
            INSERT INTO log_events (
              event_id, timestamp, level, automation, message,
              tags_json, run_id, status, error_code, meta_json, received_at
            )
            VALUES ($1, $2::timestamptz, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb, $11::timestamptz)
          `,
          [
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
            e.receivedAt,
          ]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
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
    const pool = getPool();
    const { sql, values } = buildPostgresQuery(options);
    const result = await pool.query(sql, values);
    return result.rows.map(rowToEvent);
  }

  const db = ensureSqlite();
  const { sql, values } = buildSqliteQuery(options);
  const rows = db.prepare(sql).all(...values);
  return rows.map(rowToEvent);
}

function buildContextFromEvents(events) {
  const lines = [];
  lines.push(`FONTE PRIMARIA: LOGS EM TEMPO REAL (BANCO ${getStorageMode().toUpperCase()})`);
  lines.push("Use esses eventos como verdade principal para automacoes, erros, execucoes e status.");
  lines.push("Se faltar evidencia nesses eventos, declare claramente.");
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
    lines.push(`[${event.timestamp}] [${event.level}] [${event.automation}] ${event.message}${detailSuffix}`);
  }

  return lines.join("\n");
}

async function getPromptContext(userMessage) {
  const maxEvents = Math.max(1, getEnvInt("LOG_INGEST_MAX_CONTEXT_EVENTS", 60));
  const search = userMessage && userMessage.length > 4 ? userMessage : null;

  const focused = await queryEvents({ search, limit: maxEvents });
  const events = focused.length > 0 ? focused : await queryEvents({ limit: maxEvents });

  return {
    source: POSTGRES_URL ? "postgres-ingest" : "sqlite-ingest",
    files: events.length,
    context: buildContextFromEvents(events),
    events,
  };
}

async function getStats() {
  if (POSTGRES_URL) {
    await ensurePostgres();
    const pool = getPool();
    const recent = await pool.query("SELECT timestamp FROM log_events ORDER BY timestamp DESC LIMIT 1");
    const count = await pool.query("SELECT COUNT(*)::bigint AS total FROM log_events");

    return {
      enabled: getEnvBoolean("LOG_INGEST_ENABLED", true),
      dataFile: "postgres",
      lastEventAt: recent.rows[0]?.timestamp?.toISOString?.() || recent.rows[0]?.timestamp || null,
      totalEvents: Number(count.rows[0]?.total || 0),
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

module.exports = {
  appendEvents,
  queryEvents,
  getPromptContext,
  getStats,
  getStorageMode,
};
