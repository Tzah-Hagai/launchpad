/**
 * Post a Block Kit message with 3 link buttons to a Slack channel.
 *
 * Prereqs (do these before running):
 * 1. Slack app at https://api.slack.com/apps (e.g. "Launchpad")
 * 2. OAuth Scopes → Bot Token Scopes: chat:write, chat:write.public
 * 3. Install app to workspace → copy Bot User OAuth Token (starts with xoxb-)
 * 4. Invite the app to the channel: /invite @Launchpad (or your app name)
 *
 * Usage (channel is required — pick one):
 *   SLACK_BOT_TOKEN=xoxb-your-token SLACK_CHANNEL=#your-channel node post-message.mjs
 *   node post-message.mjs "#your-channel"
 *
 * SLACK_CHANNEL can be a public channel name with # (e.g. #project-alpha) or a channel ID.
 * You can also pass the channel as the first CLI argument instead of env.
 */

import fs from "node:fs";
import path from "node:path";

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

const token = process.env.SLACK_BOT_TOKEN;
const channelFromArg = process.argv[2]?.trim();
const channel = channelFromArg || process.env.SLACK_CHANNEL?.trim();

const URLS = {
  monday: process.env.LINK_MONDAY ?? "https://monday.com",
  designSpec: process.env.LINK_DESIGN ?? "https://example.com/design-spec",
  jira: process.env.LINK_JIRA ?? "https://example.com/jira",
};

if (!token || !channel) {
  console.error(
    "Missing SLACK_BOT_TOKEN or channel. Set SLACK_CHANNEL (e.g. #my-channel) or run: node post-message.mjs \"#my-channel\"",
  );
  process.exit(1);
}

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
        url: URLS.monday,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Design spec", emoji: true },
        action_id: "link_design",
        url: URLS.designSpec,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "JIRA board", emoji: true },
        action_id: "link_jira",
        style: "danger",
        url: URLS.jira,
      },
    ],
  },
];

const res = await fetch("https://slack.com/api/chat.postMessage", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json; charset=utf-8",
  },
  body: JSON.stringify({
    channel,
    text: "Launchpad: Monday, Design spec, JIRA", // fallback for notifications
    blocks,
  }),
});

const data = await res.json();

if (!data.ok) {
  console.error("Slack API error:", data.error, data);
  process.exit(1);
}

const pinRes = await fetch("https://slack.com/api/pins.add", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json; charset=utf-8",
  },
  body: JSON.stringify({
    channel,
    timestamp: data.ts,
  }),
});
const pinData = await pinRes.json();

if (!pinData.ok) {
  console.log("Posted:", data.ts, "in", channel);
  console.log(
    "Pinning failed:",
    pinData.error,
    "(add `pins:write` scope and reinstall app, or pin manually)",
  );
  process.exit(0);
}

console.log("Posted and pinned:", data.ts, "in", channel);
