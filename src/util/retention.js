// Calendar-year retention cutoff. UTC is used consistently with stored ISO timestamps.
export function retentionCutoff12Months(nowMs) {
  if (!Number.isFinite(nowMs)) throw new TypeError("nowMs must be a finite timestamp");
  const d = new Date(nowMs);
  if (!Number.isFinite(d.getTime())) throw new TypeError("nowMs is outside the supported date range");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString();
}
