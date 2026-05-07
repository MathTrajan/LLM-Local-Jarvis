function getEnvString(name, fallback = "") {
  const value = process.env[name];
  if (typeof value !== "string") return fallback;
  return value.trim();
}

function getEnvBoolean(name, fallback = true) {
  const raw = getEnvString(name);
  if (raw === "") return fallback;
  return raw.toLowerCase() !== "false";
}

function getEnvInt(name, fallback = 0) {
  const raw = getEnvString(name);
  if (raw === "") return fallback;
  const value = Number(raw);
  return Number.isNaN(value) ? fallback : value;
}

function parseJsonEnv(name) {
  const raw = getEnvString(name);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeLocalDirPath(localDir) {
  if (!localDir) return "";
  const trimmed = String(localDir).trim().replace(/^"(.*)"$/, "$1");
  return trimmed.replace(/\\\\/g, "\\");
}

module.exports = {
  getEnvString,
  getEnvBoolean,
  getEnvInt,
  parseJsonEnv,
  normalizeLocalDirPath,
};
