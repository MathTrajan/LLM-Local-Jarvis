const fs = require("fs/promises");
const path = require("path");
const { google } = require("googleapis");
const { getEnvString, getEnvInt, getEnvBoolean, parseJsonEnv, normalizeLocalDirPath } = require("./config");

const MAX_FILES = getEnvInt("LOG_CONTEXT_MAX_FILES", 12);
const MAX_BYTES_PER_FILE = getEnvInt("LOG_CONTEXT_MAX_BYTES_PER_FILE", 60000);
const MAX_CONTEXT_CHARS = getEnvInt("LOG_CONTEXT_MAX_CHARS", 18000);

function normalizeFileName(name) {
  return (name || "").toLowerCase().endsWith(".txt");
}

function parseServiceAccountFromEnv() {
  return parseJsonEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
}

function hasOAuthUserConfig() {
  return Boolean(
    getEnvString("GOOGLE_DRIVE_FOLDER_ID") &&
      getEnvString("GOOGLE_OAUTH_CLIENT_ID") &&
      getEnvString("GOOGLE_OAUTH_CLIENT_SECRET") &&
      getEnvString("GOOGLE_OAUTH_REFRESH_TOKEN")
  );
}

function hasDriveConfig() {
  const hasFolderTarget = Boolean(
    getEnvString("GOOGLE_DRIVE_FOLDER_ID") || getEnvString("GOOGLE_DRIVE_LOG_FOLDER_NAME")
  );
  return Boolean(hasFolderTarget && (parseServiceAccountFromEnv() || hasOAuthUserConfig()));
}

async function listLocalLogFiles(localDir) {
  const entries = await fs.readdir(localDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !normalizeFileName(entry.name)) continue;
    const fullPath = path.join(localDir, entry.name);
    const stat = await fs.stat(fullPath);
    files.push({
      id: fullPath,
      name: entry.name,
      modifiedTime: stat.mtime.toISOString(),
      source: "local",
    });
  }
  files.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
  return files.slice(0, MAX_FILES);
}

function buildDriveClient() {
  const serviceAccount = parseServiceAccountFromEnv();
  let auth = null;

  if (serviceAccount) {
    auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
  } else if (hasOAuthUserConfig()) {
    const oauth = new google.auth.OAuth2(
      getEnvString("GOOGLE_OAUTH_CLIENT_ID"),
      getEnvString("GOOGLE_OAUTH_CLIENT_SECRET"),
      getEnvString("GOOGLE_OAUTH_REDIRECT_URI", "http://localhost")
    );
    oauth.setCredentials({
      refresh_token: getEnvString("GOOGLE_OAUTH_REFRESH_TOKEN"),
    });
    auth = oauth;
  }

  if (!auth) return null;
  return google.drive({ version: "v3", auth });
}

async function listDriveLogFiles(folderId) {
  const drive = buildDriveClient();
  if (!drive) return [];
  const query = `'${folderId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`;
  const response = await drive.files.list({
    q: query,
    fields: "files(id,name,modifiedTime,parents)",
    orderBy: "modifiedTime desc",
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return (response.data.files || []).filter((f) => normalizeFileName(f.name)).map((f) => ({
    id: f.id,
    name: f.name,
    modifiedTime: f.modifiedTime,
    source: "google-drive",
  }));
}

async function listDriveSubfolders(folderId) {
  const drive = buildDriveClient();
  if (!drive) return [];
  const query = `'${folderId}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder'`;
  const response = await drive.files.list({
    q: query,
    fields: "files(id,name,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return response.data.files || [];
}

async function listDriveLogFilesRecursive(rootFolderId) {
  const queue = [rootFolderId];
  const visited = new Set();
  const allFiles = [];

  while (queue.length > 0) {
    const folderId = queue.shift();
    if (visited.has(folderId)) continue;
    visited.add(folderId);

    const files = await listDriveLogFiles(folderId);
    allFiles.push(...files);

    const subfolders = await listDriveSubfolders(folderId);
    for (const sub of subfolders) {
      if (!visited.has(sub.id)) queue.push(sub.id);
    }
  }

  allFiles.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
  return allFiles.slice(0, MAX_FILES);
}

async function resolveRootLogFolderId() {
  const drive = buildDriveClient();
  if (!drive) return null;
  const folderName = getEnvString("GOOGLE_DRIVE_LOG_FOLDER_NAME", "Log");
  const query = `'root' in parents and trashed=false and mimeType='application/vnd.google-apps.folder' and name='${folderName.replace(/'/g, "\\'")}'`;
  const response = await drive.files.list({
    q: query,
    fields: "files(id,name,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const folder = (response.data.files || [])[0];
  return folder ? folder.id : null;
}

async function readLocalFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return raw.slice(-MAX_BYTES_PER_FILE);
}

async function readDriveFile(fileId) {
  const drive = buildDriveClient();
  if (!drive) return "";
  const response = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "text" }
  );
  const text = typeof response.data === "string" ? response.data : String(response.data || "");
  return text.slice(-MAX_BYTES_PER_FILE);
}

function buildContext(filesWithContent) {
  const lines = [];
  lines.push("FONTE PRIMARIA: LOGS DE AUTOMACAO");
  lines.push("Use primeiro os fatos abaixo para responder status, erros e execucoes.");
  lines.push("Se faltar dado nos logs, diga explicitamente que nao encontrou evidencia.");
  lines.push("");

  for (const file of filesWithContent) {
    lines.push(`[ARQUIVO] ${file.name} | atualizado: ${file.modifiedTime} | origem: ${file.source}`);
    lines.push(file.content || "(arquivo vazio)");
    lines.push("");
  }

  const joined = lines.join("\n");
  return joined.length > MAX_CONTEXT_CHARS ? joined.slice(0, MAX_CONTEXT_CHARS) : joined;
}

async function loadLogsFromSource() {
  let folderId = getEnvString("GOOGLE_DRIVE_FOLDER_ID");
  const localDir = normalizeLocalDirPath(getEnvString("LOG_LOCAL_DIR"));

  if (hasDriveConfig()) {
    if (!folderId) {
      folderId = await resolveRootLogFolderId();
    }
    if (!folderId) {
      return {
        source: "google-drive",
        files: 0,
        context: "A pasta 'Log' na raiz do Google Drive nao foi encontrada.",
      };
    }
    const driveFiles = await listDriveLogFilesRecursive(folderId);
    const filesWithContent = [];
    for (const file of driveFiles) {
      const content = await readDriveFile(file.id);
      filesWithContent.push({ ...file, content });
    }
    return {
      source: "google-drive",
      files: filesWithContent.length,
      fileNames: filesWithContent.map((f) => ({
        name: f.name,
        modifiedTime: f.modifiedTime,
        origin: f.source,
      })),
      context: buildContext(filesWithContent),
    };
  }

  if (localDir) {
    const localFiles = await listLocalLogFiles(localDir);
    const filesWithContent = [];
    for (const file of localFiles) {
      const content = await readLocalFile(file.id);
      filesWithContent.push({ ...file, content });
    }
    return {
      source: "local",
      files: filesWithContent.length,
      fileNames: filesWithContent.map((f) => ({
        name: f.name,
        modifiedTime: f.modifiedTime,
        origin: f.source,
      })),
      context: buildContext(filesWithContent),
    };
  }

  return {
    source: "none",
    files: 0,
    fileNames: [],
    context:
      "FONTE PRIMARIA DE LOGS NAO CONFIGURADA. Configure GOOGLE_DRIVE_FOLDER_ID + GOOGLE_SERVICE_ACCOUNT_JSON ou LOG_LOCAL_DIR.",
  };
}

async function getLogContext() {
  try {
    return await loadLogsFromSource();
  } catch (error) {
    return {
      source: "error",
      files: 0,
      fileNames: [],
      context: `Falha ao carregar logs: ${error.message}`,
    };
  }
}

module.exports = {
  getLogContext,
  hasDriveConfig,
};
