import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { handleSlashCommand } from "./lib/slash-handlers.mjs";

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  }
}

loadLocalEnv();

const PORT = Number(process.env.PORT ?? 3000);

if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_SIGNING_SECRET) {
  console.error("Missing SLACK_BOT_TOKEN or SLACK_SIGNING_SECRET in environment/.env");
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/slack/commands") {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  let rawBody = "";
  req.on("data", (chunk) => {
    rawBody += chunk.toString("utf8");
  });

  req.on("end", async () => {
    const { statusCode, contentType, body } = await handleSlashCommand(rawBody, req.headers);
    res.writeHead(statusCode, { "Content-Type": contentType });
    res.end(body);
  });
});

server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}/slack/commands`);
});
