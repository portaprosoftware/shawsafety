/**
 * One-click reorder.
 *
 * A reorder is a URL: `/cart?reorder=fluorescent-yellow:300,hi-vis-lime:10`.
 * The cart page parses the parameter and rebuilds the basket from the site's
 * own catalogue, so the link carries quantities and nothing else, prices are
 * still resolved by the catalogue on the page and repriced by Stripe at
 * checkout, exactly as if the lines were added by hand. A tampered link can
 * change what lands in the cart, never what it costs.
 *
 * The same encoding rides through checkout: the adapter stashes the basket
 * here as a pending order at handoff, and the success page promotes it to the
 * remembered last order once the purchase actually completes. Abandoning
 * Stripe therefore never overwrites a real previous order.
 */

export interface ReorderLine {
  variantId: string;
  qty: number;
}

const PENDING_KEY = 'shawsafety:pendingOrder:v1';
const LAST_KEY = 'shawsafety:lastOrder:v1';

/** Bounds a crafted URL: more distinct lines than the catalogue has SKUs. */
const MAX_LINES = 20;
const MAX_QTY = 9999;

export function serializeReorder(lines: ReorderLine[]): string {
  return lines
    .map(line => `${line.variantId}:${Math.max(1, Math.floor(line.qty))}`)
    .join(',');
}

/**
 * Parse a `reorder` parameter. Malformed entries are dropped rather than
 * failing the whole link: a truncated paste should still rebuild what it can.
 */
export function parseReorder(value: string | null): ReorderLine[] {
  if (!value) return [];
  const lines: ReorderLine[] = [];
  for (const part of value.split(',').slice(0, MAX_LINES)) {
    const [variantId, rawQty] = part.split(':');
    const qty = Math.floor(Number(rawQty));
    if (
      !variantId ||
      !/^[a-z0-9-]+$/.test(variantId) ||
      !Number.isFinite(qty) ||
      qty < 1
    ) {
      continue;
    }
    lines.push({ variantId, qty: Math.min(qty, MAX_QTY) });
  }
  return lines;
}

export function reorderPath(lines: ReorderLine[]): string {
  return `/cart?reorder=${encodeURIComponent(serializeReorder(lines))}`;
}

/*
 * Storage is best-effort throughout, matching the cart store: private mode or
 * a full quota must never break checkout itself.
 */
function read(key: string): ReorderLine[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.lines)) return [];
    return parseReorder(serializeReorder(parsed.lines.filter(isLine)));
  } catch {
    return [];
  }
}

function isLine(value: unknown): value is ReorderLine {
  return (
    !!value &&
    typeof (value as ReorderLine).variantId === 'string' &&
    typeof (value as ReorderLine).qty === 'number'
  );
}

function write(key: string, lines: ReorderLine[]): void {
  try {
    localStorage.setItem(key, JSON.stringify({ lines, savedAt: Date.now() }));
  } catch {
    /* Private mode, or a full quota. */
  }
}

/** Called by the checkout adapter at the moment of handoff to Stripe. */
export function savePendingOrder(lines: ReorderLine[]): void {
  if (lines.length) write(PENDING_KEY, lines);
}

/**
 * Called by the success page. Moves the pending snapshot into the remembered
 * last order and returns it, or falls back to the previous last order when
 * the page is revisited after the pending key is gone.
 */
export function promotePendingOrder(): ReorderLine[] {
  const pending = read(PENDING_KEY);
  if (pending.length) {
    write(LAST_KEY, pending);
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {
      /* Already best-effort. */
    }
    return pending;
  }
  return read(LAST_KEY);
}

export function loadLastOrder(): ReorderLine[] {
  return read(LAST_KEY);
}
