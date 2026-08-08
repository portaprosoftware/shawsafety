/**
 * Volume pricing math.
 *
 * Shared by the server-rendered tier tables and the client cart, so a price
 * shown on the PDP and the price charged in the cart come from one function.
 */

export interface Tier {
  minQty: number;
  maxQty: number | null;
  pricePerUnit: number;
}

/**
 * The tier that applies at `qty`. Tiers are authored ascending; the last one
 * is open-ended (`maxQty: null`).
 */
export function resolveTier(tiers: Tier[], qty: number): Tier {
  const n = Math.max(1, Math.floor(qty));
  return (
    tiers.find(t => n >= t.minQty && (t.maxQty === null || n <= t.maxQty)) ??
    tiers[tiers.length - 1]
  );
}

/** Unit price at `qty`, after volume discount. */
export function unitPriceAt(tiers: Tier[], qty: number): number {
  return resolveTier(tiers, qty).pricePerUnit;
}

/** Line total at `qty`, rounded to cents. */
export function lineTotal(tiers: Tier[], qty: number): number {
  return roundMoney(unitPriceAt(tiers, qty) * Math.max(1, Math.floor(qty)));
}

/**
 * Percent saved against the first (list-price) tier, e.g. `11` for 11% off.
 * Returns 0 for the list tier itself.
 */
export function savingsPercent(tiers: Tier[], pricePerUnit: number): number {
  const list = tiers[0]?.pricePerUnit ?? pricePerUnit;
  if (!list || pricePerUnit >= list) return 0;
  return Math.round((1 - pricePerUnit / list) * 100);
}

/**
 * The next cheaper tier and how many more units are needed to reach it.
 * Returns null once the buyer is already in the deepest tier — this drives
 * the "add N more to save X%" nudge on the PDP.
 */
export function nextTierNudge(
  tiers: Tier[],
  qty: number
): { unitsAway: number; percent: number; pricePerUnit: number } | null {
  const current = resolveTier(tiers, qty);
  const index = tiers.indexOf(current);
  const next = tiers[index + 1];
  if (!next) return null;
  return {
    unitsAway: next.minQty - Math.max(1, Math.floor(qty)),
    percent: savingsPercent(tiers, next.pricePerUnit),
    pricePerUnit: next.pricePerUnit,
  };
}

/** Round to cents, avoiding float drift like 8.070000000000002. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** `$2.69` — the single currency formatter for the whole site. */
export function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

/**
 * Per-sub-unit price, e.g. $0.0269 per tie inside a $2.69 100-pack.
 * Uses 4 decimals because fractions of a cent are the whole selling point.
 */
export function formatUnitPrice(price: number, packSize: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(price / packSize);
}
