/**
 * Cloudflare Email Routing handler.
 *
 * Receives inbound mail at *@agentslovebitcoin.com, resolves the recipient
 * AIBTC name via GlobalDO, and stores the message in the agent's AgentDO inbox.
 */

import type { Env } from "./lib/types";
import { EMAIL_DOMAIN } from "./lib/constants";

/** Minimal MIME header parser — extracts text/plain and text/html parts. */
function parseEmailBody(raw: string): { text: string | null; html: string | null } {
  // Check for multipart boundary
  const boundaryMatch = raw.match(/Content-Type:\s*multipart\/\w+;\s*boundary="?([^\s"]+)"?/i);

  if (!boundaryMatch) {
    // Single-part message
    const bodyStart = raw.indexOf("\r\n\r\n");
    if (bodyStart === -1) return { text: raw, html: null };
    const body = raw.slice(bodyStart + 4);

    if (/Content-Type:\s*text\/html/i.test(raw)) {
      return { text: null, html: body };
    }
    return { text: body, html: null };
  }

  const boundary = boundaryMatch[1];
  const parts = raw.split(`--${boundary}`);
  let text: string | null = null;
  let html: string | null = null;

  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const headers = part.slice(0, headerEnd);
    const body = part.slice(headerEnd + 4).replace(/--\s*$/, "").trim();

    if (/Content-Type:\s*text\/plain/i.test(headers)) {
      text = body;
    } else if (/Content-Type:\s*text\/html/i.test(headers)) {
      html = body;
    }
  }

  return { text, html };
}

/** Extract a header value from raw email text. */
function getHeader(raw: string, name: string): string | null {
  const regex = new RegExp(`^${name}:\\s*(.+)$`, "im");
  const match = raw.match(regex);
  return match ? match[1].trim() : null;
}

/** Handle inbound email: resolve recipient → store in AgentDO inbox. */
export async function handleEmail(
  message: ForwardableEmailMessage,
  env: Env
): Promise<void> {
  const recipientAddress = message.to;

  // Extract local part (aibtcName) from recipient address
  const atIndex = recipientAddress.indexOf("@");
  if (atIndex === -1) {
    message.setReject("Invalid recipient address");
    return;
  }

  const localPart = recipientAddress.slice(0, atIndex).toLowerCase();
  const domain = recipientAddress.slice(atIndex + 1).toLowerCase();

  // Verify domain
  if (domain !== EMAIL_DOMAIN) {
    message.setReject(`Unknown domain: ${domain}`);
    return;
  }

  // Resolve AIBTC name → BTC address via GlobalDO
  const globalDoId = env.GLOBAL_DO.idFromName("global");
  const globalDo = env.GLOBAL_DO.get(globalDoId);

  const resolveResp = await globalDo.fetch(
    new Request(`http://internal/resolve-name/${encodeURIComponent(localPart)}`)
  );

  if (!resolveResp.ok) {
    message.setReject(`Unknown recipient: ${localPart}@${EMAIL_DOMAIN}`);
    return;
  }

  const { btcAddress } = await resolveResp.json() as { btcAddress: string };

  // Read the raw email to extract subject and body parts
  const rawStream = message.raw;
  const reader = rawStream.getReader();
  const chunks: Uint8Array[] = [];
  let done = false;
  while (!done) {
    const result = await reader.read();
    if (result.done) {
      done = true;
    } else {
      chunks.push(result.value);
    }
  }

  // Combine chunks and decode
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  const rawText = new TextDecoder().decode(combined);

  // Extract subject and body
  const subject = getHeader(rawText, "Subject");
  const { text, html } = parseEmailBody(rawText);

  // Generate message ID
  const messageId = crypto.randomUUID();

  // Store in AgentDO inbox
  const agentDoId = env.AGENT_DO.idFromName(btcAddress);
  const agentDo = env.AGENT_DO.get(agentDoId);

  const storeResp = await agentDo.fetch(
    new Request("http://internal/inbox/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: messageId,
        fromAddress: message.from,
        subject,
        bodyText: text,
        bodyHtml: html,
      }),
    })
  );

  if (!storeResp.ok) {
    message.setReject("Failed to store message");
    return;
  }

  // Check if agent has forwarding configured
  const emailResp = await agentDo.fetch(new Request("http://internal/email"));
  if (!emailResp.ok) return;

  const { email } = await emailResp.json() as {
    email: { forward_to: string | null; active: number } | null;
  };

  if (email?.forward_to && email.active) {
    await message.forward(email.forward_to);
  }
}
