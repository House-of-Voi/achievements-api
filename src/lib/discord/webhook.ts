// Rate-limit aware webhook utilities with optional batching, no `any`.

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

type DiscordRateLimit = {
  message?: string;
  retry_after?: number; // seconds
  global?: boolean;
};

async function sendOnce(webhookUrl: string, content: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (res.status === 429) {
    const text = await res.text();
    let retryAfterMs = 1100; // conservative default
    try {
      const body = JSON.parse(text) as Partial<DiscordRateLimit>;
      const retrySec = typeof body.retry_after === "number" ? body.retry_after : 1;
      retryAfterMs = Math.ceil((retrySec + 0.05) * 1000);
    } catch {
      // ignore parse errors, keep default
    }
    await sleep(retryAfterMs);
    // single retry; if you want multiple retries, loop with a counter
    const retryRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!retryRes.ok) {
      const bodyText = await retryRes.text();
      throw new Error(`Discord webhook failed after retry: ${retryRes.status} ${bodyText}`);
    }
    return;
  }

  if (!res.ok) {
    const bodyText = await res.text();
    throw new Error(`Discord webhook failed: ${res.status} ${bodyText}`);
  }
}

export async function postDiscordMessage(webhookUrl: string, content: string): Promise<void> {
  let safe = content;
  if (safe.length > 1900) safe = `${safe.slice(0, 1900)} …`;
  await sendOnce(webhookUrl, safe);
}

/**
 * Batch multiple lines into fewer webhook calls.
 * Default 5 lines per message; configurable via env BATCH_LINES_PER_MESSAGE.
 */
export async function postDiscordLines(
  webhookUrl: string,
  lines: string[],
  perMessage = Number(process.env.BATCH_LINES_PER_MESSAGE ?? "5")
): Promise<void> {
  if (lines.length === 0) return;
  const chunkSize = Math.max(1, perMessage);

  for (let i = 0; i < lines.length; i += chunkSize) {
    const chunk = lines.slice(i, i + chunkSize);
    await postDiscordMessage(webhookUrl, chunk.join("\n"));
    // Gentle pacing even when not rate-limited
    await sleep(250);
  }
}
