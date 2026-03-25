import { verifySlackSignature } from "../../lib/slack-verify.mjs";

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Slack Interactivity Request URL — required so Block Kit action rows are accepted.
 * Link buttons open URLs in the browser and do not POST here; this endpoint
 * acknowledges URL verification and any future interactive payloads.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Method not allowed");
    return;
  }

  const rawBody = await readRawBody(req);
  const contentType = String(req.headers["content-type"] ?? "");

  // URL verification when saving Interactivity (JSON body, same pattern as Events API)
  if (contentType.includes("application/json")) {
    if (!verifySlackSignature(req.headers, rawBody)) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Invalid signature");
      return;
    }
    try {
      const json = JSON.parse(rawBody);
      if (json.type === "url_verification" && json.challenge) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ challenge: json.challenge }));
        return;
      }
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Bad request");
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Interactive payloads (form-urlencoded), e.g. block_actions — ack quickly
  if (!verifySlackSignature(req.headers, rawBody)) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Invalid signature");
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: true }));
}
