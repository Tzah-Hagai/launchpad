import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { URLSearchParams } from "node:url";

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

const BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const PORT = Number(process.env.PORT ?? 3000);

if (!BOT_TOKEN || !SIGNING_SECRET) {
  console.error("Missing SLACK_BOT_TOKEN or SLACK_SIGNING_SECRET in environment/.env");
  process.exit(1);
}

function isValidUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function verifySlackSignature(req, rawBody) {
  const timestamp = req.headers["x-slack-request-timestamp"];
  const signature = req.headers["x-slack-signature"];
  if (!timestamp || !signature) return false;

  // Protect against replay attacks
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 60 * 5) return false;

  const basestring = `v0:${timestamp}:${rawBody}`;
  const hash =
    "v0=" +
    crypto
      .createHmac("sha256", SIGNING_SECRET)
      .update(basestring)
      .digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(String(signature)));
  } catch {
    return false;
  }
}

async function postLaunchpad(channelId, mondayUrl, designUrl, jiraUrl) {
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Launchpad* — quick links for this channel:",
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Monday item", emoji: true },
          action_id: "link_monday",
          style: "primary",
          url: mondayUrl,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Design spec", emoji: true },
          action_id: "link_design",
          url: designUrl,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "JIRA board", emoji: true },
          action_id: "link_jira",
          style: "danger",
          url: jiraUrl,
        },
      ],
    },
  ];

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: channelId,
      text: "Launchpad: Monday, Design spec, JIRA",
      blocks,
    }),
  });

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }
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
    if (!verifySlackSignature(req, rawBody)) {
      res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Invalid signature");
      return;
    }

    const params = new URLSearchParams(rawBody);
    const text = (params.get("text") ?? "").trim();
    const channelId = params.get("channel_id");

    const urls = text.split(/\s+/).filter(Boolean);
    if (!channelId || urls.length !== 3 || !urls.every(isValidUrl)) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          response_type: "ephemeral",
          text:
            "Usage: `/launchpad <monday_url> <design_spec_url> <jira_board_url>`\n" +
            "Example: `/launchpad https://monday.com/... https://figma.com/... https://yourcompany.atlassian.net/...`",
        })
      );
      return;
    }

    const [mondayUrl, designUrl, jiraUrl] = urls;
    try {
      await postLaunchpad(channelId, mondayUrl, designUrl, jiraUrl);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          response_type: "ephemeral",
          text: "Launchpad buttons posted to this channel.",
        })
      );
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          response_type: "ephemeral",
          text: `Could not post message: ${err.message}`,
        })
      );
    }
  });
});

server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}/slack/commands`);
});

