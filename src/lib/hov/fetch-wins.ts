export type HoVEvent = {
  round: number;
  intra: number;
  txid: string;
  app_id: number;
  event_type: string;      // "BetClaimed"
  who: string;             // wallet / address
  amount: number;          // bet amount (raw units)
  payout: number;          // total payout (raw units)
  total_bet_amount: number;
  net_result: number;      // payout - total_bet_amount
  is_win: boolean;
  created_at: string;      // ISO
  updated_at: string;      // ISO
  replayUrl?: string;
};

export type EventsResponse = {
  data: HoVEvent[];
  count: number;
  params: {
    roundGte: number;
    isWin: boolean;
    limit: number;
    offset: number;
    order: "asc" | "desc";
  };
};

/**
 * Fetch one page of events using roundGte + offset/limit, ascending.
 */
export async function fetchEventsPage(
  baseUrl: string,
  roundGte: number,
  offset = 0,
  limit = 100,
  payoutGte?: number // 👈 new param
): Promise<EventsResponse> {
  const url = new URL(baseUrl);
  url.searchParams.set("isWin", "true");
  url.searchParams.set("roundGte", String(roundGte));
  url.searchParams.set("order", "asc");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  if (payoutGte) url.searchParams.set("payoutGte", String(payoutGte));

  const res = await fetch(url.toString(), {
    headers: { accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`HoV events API error: ${res.status}`);
  return (await res.json()) as EventsResponse;
}


/**
 * Walk pages until we exhaust results or hit hardLimit items.
 * We pass back the highest (round, intra) we observed so the caller can advance the cursor.
 */
export async function fetchAllEventsSince(
  baseUrl: string,
  roundGte: number,
  hardLimit = 1000,
  payoutGte?: number
): Promise<{ events: HoVEvent[]; maxRound: number; maxIntra: number }> {
  const events: HoVEvent[] = [];
  const pageSize = 100;
  let offset = 0;
  let maxRound = roundGte;
  let maxIntra = 0;

  while (events.length < hardLimit) {
    const page = await fetchEventsPage(baseUrl, roundGte, offset, pageSize, payoutGte);
    if (!page.data.length) break;

    for (const e of page.data) {
      events.push(e);
      if (e.round > maxRound || (e.round === maxRound && e.intra > maxIntra)) {
        maxRound = e.round;
        maxIntra = e.intra;
      }
    }

    if (page.data.length < page.params.limit) break;
    offset += page.params.limit;
  }

  return { events, maxRound, maxIntra };
}

