import { NextResponse } from "next/server";
import { getCursor, setCursor } from "@/lib/state/cursor";
import { fetchAllEventsSince, type HoVEvent } from "@/lib/hov/fetch-wins";
import { postDiscordLines } from "@/lib/discord/webhook";

export const runtime = "nodejs";

type MetricKey = "net_result" | "payout";

interface Config {
  webhookUrl: string;
  apiUrl: string;
  thresholdRaw: number;
  metricKey: MetricKey;
  displayDivisor: number;
  displayUnit: string;
  maxPostsPerRun: number;
}

interface DebugLog {
  steps: string[];
  config?: { apiUrl: string; thresholdRaw: number; metricKey: MetricKey };
  cursorBefore?: { round: number; intra: number };
  requested?: string[];
  apiResponse?: { count: number; sample: HoVEvent[] };
  newerCount?: number;
  bigCount?: number;
  toPostCount?: number;
  linesPreview?: string[];
  discordPosted?: number;
  cursorAdvancedTo?: { round: number; intra: number } | null;
  note?: string;
  error?: string;
}

function env(): Config {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  const apiUrl = process.env.HOV_EVENTS_URL;
  if (!webhookUrl) throw new Error("Missing DISCORD_WEBHOOK_URL");
  if (!apiUrl) throw new Error("Missing HOV_EVENTS_URL");

  const metricKey = (process.env.BIGWIN_METRIC ?? "net_result") as MetricKey;

  // support either BIGWIN_THRESHOLD_RAW or BIGWIN_THRESHOLD
  const thresholdRaw = Number(
    process.env.BIGWIN_THRESHOLD_RAW ?? process.env.BIGWIN_THRESHOLD ?? "25000000"
  );

  const displayDivisor = Number(process.env.DISPLAY_DIVISOR ?? "1");
  if (!Number.isFinite(displayDivisor) || displayDivisor <= 0) {
    throw new Error("DISPLAY_DIVISOR must be > 0");
  }

  return {
    webhookUrl,
    apiUrl,
    thresholdRaw,
    metricKey,
    displayDivisor,
    displayUnit: process.env.CURRENCY_UNIT ?? "VOI",
    maxPostsPerRun: Number(process.env.MAX_POSTS_PER_RUN ?? "20"),
  };
}

function shorten(addr: string, head = 6, tail = 4): string {
  return addr.length > head + tail ? `${addr.slice(0, head)}…${addr.slice(-tail)}` : addr;
}

export async function GET() {
  const debug: DebugLog = { steps: [] };
  try {
    const {
      webhookUrl,
      apiUrl,
      thresholdRaw,
      metricKey,
      displayDivisor,
      displayUnit,
      maxPostsPerRun,
    } = env();

    debug.config = { apiUrl, thresholdRaw, metricKey };

    // 1) Current cursor
    const { round: lastRound, intra: lastIntra } = await getCursor();
    debug.cursorBefore = { round: lastRound, intra: lastIntra };

    // 2) First requested URL (for visibility)
    const firstUrl = `${apiUrl}?isWin=true&roundGte=${lastRound}&order=asc&limit=100&offset=0&payoutGte=${thresholdRaw}`;
    debug.requested = [firstUrl];

    // 3) Fetch events with server-side payout filter
    const { events, maxRound, maxIntra } = await fetchAllEventsSince(
      apiUrl,
      lastRound,
      2000,
      thresholdRaw // payoutGte
    );
    debug.apiResponse = { count: events.length, sample: events.slice(0, 3) };

    // 4) Only strictly newer than last cursor
    const newer = events.filter(
      (e) => e.round > lastRound || (e.round === lastRound && e.intra > lastIntra)
    );
    debug.newerCount = newer.length;

    // 5) Safety cap per run
    const toPost = newer.slice(0, maxPostsPerRun);
    debug.toPostCount = toPost.length;

    // 6) Build lines
    const lines: string[] = [];
    for (const e of toPost) {
      const raw: number = e[metricKey]; // typed via MetricKey
      const displayAmount = raw / displayDivisor;
      const amountStr = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: displayDivisor === 1 ? 0 : 2,
        maximumFractionDigits: 6,
      }).format(displayAmount);

      const who = e.who ? shorten(e.who) : "A player";
      const link = e.replayUrl ? ` ${e.replayUrl}` : "";
      lines.push(`${who} won ${amountStr} ${displayUnit}. Congrats!!${link}`);
    }
    debug.linesPreview = lines.slice(0, 5);

    // 7) Post to Discord (respect batching + 429 logic inside helper)
    const dryRun = process.env.DRY_RUN === "true";
    if (!dryRun && lines.length > 0) {
      await postDiscordLines(webhookUrl, lines);
      debug.discordPosted = lines.length;
    } else {
      debug.discordPosted = 0;
      if (dryRun) debug.note = "DRY_RUN=true; skipped posting";
    }

    // 8) Advance cursor to the highest we observed
    if (maxRound > lastRound || (maxRound === lastRound && maxIntra > lastIntra)) {
      await setCursor(maxRound, maxIntra);
      debug.cursorAdvancedTo = { round: maxRound, intra: maxIntra };
    } else {
      debug.cursorAdvancedTo = null;
    }

    return NextResponse.json({ ok: true, ...debug });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    debug.error = message;
    return NextResponse.json(debug, { status: 500 });
  }
}
