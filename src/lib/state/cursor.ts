// src/lib/state/cursor.ts
import { Redis } from "@upstash/redis";

// Support both env name styles:
const REST_URL =
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  "";
const REST_TOKEN =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  "";

if (!REST_URL || !REST_TOKEN) {
  throw new Error(
    "Upstash REST envs missing: set KV_REST_API_URL & KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL & UPSTASH_REDIS_REST_TOKEN)"
  );
}

const redis = new Redis({ url: REST_URL, token: REST_TOKEN });

const ROUND_KEY = "hov:bigwins:lastRound";
const INTRA_KEY = "hov:bigwins:lastIntra";

export async function getCursor(): Promise<{ round: number; intra: number }> {
  const [roundStr, intraStr] =
    await redis.mget<[string | null, string | null]>(ROUND_KEY, INTRA_KEY);
  return { round: Number(roundStr ?? 0), intra: Number(intraStr ?? 0) };
}

export async function setCursor(round: number, intra: number): Promise<void> {
  await redis.mset({ [ROUND_KEY]: String(round), [INTRA_KEY]: String(intra) });
}
