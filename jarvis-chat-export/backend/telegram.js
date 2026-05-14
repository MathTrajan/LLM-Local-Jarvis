const https = require("https");
const { getEnvString } = require("./config");

function sendTelegramMessage(text) {
  const token  = getEnvString("TELEGRAM_BOT_TOKEN");
  const chatId = getEnvString("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return Promise.resolve(null);

  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" });
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${token}/sendMessage`,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => { res.resume(); resolve(res.statusCode); }
    );
    req.on("error", () => resolve(null));
    req.write(body);
    req.end();
  });
}

module.exports = { sendTelegramMessage };
