export type ReviewShare = {
  id: string;
  path: string;
  url: string;
  expiresAt: string;
  revokedAt: string | null;
};
export function shareStatus(
  share: Pick<ReviewShare, "expiresAt" | "revokedAt">,
  now = Date.now(),
) {
  if (share.revokedAt) return "revoked";
  const expiry = new Date(share.expiresAt).getTime();
  return !Number.isFinite(expiry) || expiry <= now ? "expired" : "active";
}
export function filterShares(
  shares: ReviewShare[],
  filters: { status: string; path: string; soon: boolean },
  now = Date.now(),
) {
  return shares.filter(
    (s) =>
      (!filters.status || shareStatus(s, now) === filters.status) &&
      s.path.toLowerCase().includes(filters.path.toLowerCase()) &&
      (!filters.soon ||
        (shareStatus(s, now) === "active" &&
          new Date(s.expiresAt).getTime() <= now + 86400000)),
  );
}
