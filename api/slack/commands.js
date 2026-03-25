import { handleSlashCommand } from "../../lib/slash-handlers.mjs";

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not found");
    return;
  }

  const rawBody = await readRawBody(req);
  const { statusCode, contentType, body } = await handleSlashCommand(rawBody, req.headers);

  res.statusCode = statusCode;
  res.setHeader("Content-Type", contentType);
  res.end(body);
}
