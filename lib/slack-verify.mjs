import crypto from "node:crypto";

/**
 * Verify Slack request signature (slash commands, interactivity, events).
 * @param {import("node:http").IncomingHttpHeaders} headers
 * @param {string} rawBody
 */
export function verifySlackSignature(headers, rawBody) {
  const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
  if (!SIGNING_SECRET) return false;

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
