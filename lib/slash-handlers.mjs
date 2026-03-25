import crypto from "node:crypto";
import { URLSearchParams } from "node:url";

const BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

function isValidUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function verifySlackSignature(headers, rawBody) {
  const timestamp = headers["x-slack-request-timestamp"];
  const signature = headers["x-slack-signature"];
  if (!timestamp || !signature) return false;

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

/**
 * @param {string} rawBody
 * @param {import("node:http").IncomingHttpHeaders} headers
 * @returns {Promise<{ statusCode: number; contentType: string; body: string }>}
 */
export async function handleSlashCommand(rawBody, headers) {
  if (!BOT_TOKEN || !SIGNING_SECRET) {
    return {
      statusCode: 500,
      contentType: "text/plain; charset=utf-8",
      body: "Server misconfigured: missing SLACK_BOT_TOKEN or SLACK_SIGNING_SECRET",
    };
  }

  if (!verifySlackSignature(headers, rawBody)) {
    return {
      statusCode: 401,
      contentType: "text/plain; charset=utf-8",
      body: "Invalid signature",
    };
  }

  const params = new URLSearchParams(rawBody);
  const text = (params.get("text") ?? "").trim();
  const channelId = params.get("channel_id");

  const urls = text.split(/\s+/).filter(Boolean);
  if (!channelId || urls.length !== 3 || !urls.every(isValidUrl)) {
    return {
      statusCode: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        response_type: "ephemeral",
        text:
          "Usage: `/launchpad <monday_url> <design_spec_url> <jira_board_url>`\n" +
          "Example: `/launchpad https://monday.com/... https://figma.com/... https://yourcompany.atlassian.net/...`",
      }),
    };
  }

  const [mondayUrl, designUrl, jiraUrl] = urls;
  try {
    await postLaunchpad(channelId, mondayUrl, designUrl, jiraUrl);
    return {
      statusCode: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        response_type: "ephemeral",
        text: "Launchpad buttons posted to this channel.",
      }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        response_type: "ephemeral",
        text: `Could not post message: ${err.message}`,
      }),
    };
  }
}
