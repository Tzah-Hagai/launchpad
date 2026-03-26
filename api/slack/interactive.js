import { verifySlackSignature } from "../../lib/slack-verify.mjs";
import { handleViewSubmission } from "../../lib/slash-handlers.mjs";

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
    res.statusCode = 405;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Method not allowed");
    return;
  }

  const rawBody = await readRawBody(req);
  const contentType = String(req.headers["content-type"] ?? "");

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

  if (!verifySlackSignature(req.headers, rawBody)) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Invalid signature");
    return;
  }

  const formParams = new URLSearchParams(rawBody);
  const payloadStr = formParams.get("payload");
  if (payloadStr) {
    try {
      const payload = JSON.parse(payloadStr);
      if (payload.type === "view_submission") {
        const body = await handleViewSubmission(payload);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(body));
        return;
      }
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Bad request");
      return;
    }
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: true }));
}
