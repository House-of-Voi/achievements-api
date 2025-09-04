// src/lib/utils/assets.ts
/** Make a public-relative path absolute for this request’s origin. */
export function absolutePublicUrl(req: Request, relOrAbs?: string | null): string | undefined {
  if (!relOrAbs) return undefined;
  if (/^https?:\/\//i.test(relOrAbs)) return relOrAbs; // already absolute
  const origin = new URL(req.url).origin;              // e.g. https://achievements.houseofvoi.com
  return origin + (relOrAbs.startsWith('/') ? relOrAbs : `/${relOrAbs}`);
}

/** Convention: derive a relative image path from an achievement id. */
export function relImageFromId(id: string): string {
  // adjust if you want per-series folders
  return `/achievements/${id}.webp`;
}
