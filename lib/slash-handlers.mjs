import { URLSearchParams } from "node:url";

import { verifySlackSignature } from "./slack-verify.mjs";

const BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

export const LAUNCHPAD_MODAL_CALLBACK_ID = "launchpad_modal";

function isValidUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function escapeSlackMrkdwn(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getInputValue(state, blockId, actionId) {
  const v = state[blockId]?.[actionId]?.value;
  return typeof v === "string" ? v.trim() : "";
}

function buildLaunchpadModalView(channelId) {
  return {
    type: "modal",
    callback_id: LAUNCHPAD_MODAL_CALLBACK_ID,
    private_metadata: JSON.stringify({ channel_id: channelId }),
    title: { type: "plain_text", text: "Launchpad", emoji: true },
    submit: { type: "plain_text", text: "Post to channel" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "title_block",
        optional: true,
        label: { type: "plain_text", text: "Title (optional)" },
        element: {
          type: "plain_text_input",
          action_id: "title_input",
          placeholder: { type: "plain_text", text: "e.g. Sprint 12 — Player HUD" },
        },
      },
      {
        type: "input",
        block_id: "monday_block",
        label: { type: "plain_text", text: "Monday item URL" },
        element: {
          type: "plain_text_input",
          action_id: "monday_url",
          placeholder: { type: "plain_text", text: "https://monday.com/..." },
        },
      },
      {
        type: "input",
        block_id: "design_block",
        label: { type: "plain_text", text: "Design spec URL" },
        element: {
          type: "plain_text_input",
          action_id: "design_url",
          placeholder: { type: "plain_text", text: "https://figma.com/..." },
        },
      },
      {
        type: "input",
        block_id: "jira_block",
        label: { type: "plain_text", text: "JIRA board URL" },
        element: {
          type: "plain_text_input",
          action_id: "jira_url",
          placeholder: { type: "plain_text", text: "https://your-domain.atlassian.net/..." },
        },
      },
    ],
  };
}

async function openLaunchpadModal(triggerId, channelId) {
  const view = buildLaunchpadModalView(channelId);
  const response = await fetch("https://slack.com/api/views.open", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ trigger_id: triggerId, view }),
  });

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error ?? "views_open_failed");
  }
}

async function postLaunchpad(channelId, mondayUrl, designUrl, jiraUrl, title) {
  const headerText = title
    ? `*Launchpad* — ${escapeSlackMrkdwn(title)}`
    : "*Launchpad* — quick links for this channel:";

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: headerText,
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
 * @param {import("node:http").IncomingHttpHeaders} headers
 * @param {string} rawBody
 */
function verifyOrThrow(headers, rawBody) {
  if (!BOT_TOKEN || !SIGNING_SECRET) {
    return { ok: false, statusCode: 500, body: "Server misconfigured" };
  }
  if (!verifySlackSignature(headers, rawBody)) {
    return { ok: false, statusCode: 401, body: "Invalid signature" };
  }
  return { ok: true };
}

/**
 * @param {string} rawBody
 * @param {import("node:http").IncomingHttpHeaders} headers
 * @returns {Promise<{ statusCode: number; contentType: string; body: string }>}
 */
export async function handleSlashCommand(rawBody, headers) {
  const gate = verifyOrThrow(headers, rawBody);
  if (!gate.ok) {
    return {
      statusCode: gate.statusCode,
      contentType: "text/plain; charset=utf-8",
      body: gate.body,
    };
  }

  const params = new URLSearchParams(rawBody);
  const text = (params.get("text") ?? "").trim();
  const channelId = params.get("channel_id");
  const triggerId = params.get("trigger_id");

  const tokens = text.split(/\s+/).filter(Boolean);

  if (tokens.length === 3 && tokens.every(isValidUrl) && channelId) {
    const [mondayUrl, designUrl, jiraUrl] = tokens;
    try {
      await postLaunchpad(channelId, mondayUrl, designUrl, jiraUrl, "");
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

  if (tokens.length === 0 && channelId && triggerId) {
    try {
      await openLaunchpadModal(triggerId, channelId);
      return {
        statusCode: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          response_type: "ephemeral",
          text: "Fill in the form to post the three link buttons.",
        }),
      };
    } catch (err) {
      return {
        statusCode: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          response_type: "ephemeral",
          text: `Could not open form: ${err.message}. Try again or use three URLs in one command.`,
        }),
      };
    }
  }

  return {
    statusCode: 200,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify({
      response_type: "ephemeral",
      text:
        "*Launchpad*\n\n" +
        "• Run `/launchpad` with **no text** to open a form (Monday, Design, JIRA URLs + optional title).\n" +
        "• Or paste **three URLs** in one line:\n" +
        "`/launchpad https://monday.com/... https://figma.com/... https://yourcompany.atlassian.net/...`",
    }),
  };
}

/**
 * Handle modal submit from Interactivity (payload already parsed).
 * @param {object} payload
 * @returns {Promise<object>} JSON body for Slack (response_action, errors, etc.)
 */
export async function handleViewSubmission(payload) {
  if (!BOT_TOKEN) {
    return { response_action: "errors", errors: { monday_block: "Server misconfigured." } };
  }

  const view = payload.view;
  if (!view || view.callback_id !== LAUNCHPAD_MODAL_CALLBACK_ID) {
    return { response_action: "clear" };
  }

  let meta = { channel_id: "" };
  try {
    meta = JSON.parse(view.private_metadata || "{}");
  } catch {
    /* ignore */
  }
  const channelId = meta.channel_id;
  if (!channelId) {
    return {
      response_action: "errors",
      errors: { monday_block: "Missing channel. Try the slash command again from a channel." },
    };
  }

  const state = view.state?.values ?? {};
  const title = getInputValue(state, "title_block", "title_input");
  const mondayUrl = getInputValue(state, "monday_block", "monday_url");
  const designUrl = getInputValue(state, "design_block", "design_url");
  const jiraUrl = getInputValue(state, "jira_block", "jira_url");

  const errors = {};
  if (!isValidUrl(mondayUrl)) errors.monday_block = "Enter a valid http(s) URL.";
  if (!isValidUrl(designUrl)) errors.design_block = "Enter a valid http(s) URL.";
  if (!isValidUrl(jiraUrl)) errors.jira_block = "Enter a valid http(s) URL.";

  if (Object.keys(errors).length > 0) {
    return { response_action: "errors", errors };
  }

  try {
    await postLaunchpad(channelId, mondayUrl, designUrl, jiraUrl, title);
    return { response_action: "clear" };
  } catch (err) {
    return {
      response_action: "errors",
      errors: { monday_block: err.message || "Could not post to channel." },
    };
  }
}
