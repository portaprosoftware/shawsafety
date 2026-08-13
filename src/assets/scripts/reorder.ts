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
 * The same encoding rides through checkout as Stripe session metadata, so the
 * remembered last order is derived from the paid session itself. The adapter
 * also stashes the basket here at handoff, but that snapshot is only consulted
 * for orders too long for Stripe's metadata cap, and only once the session has
 * been confirmed. Abandoning Stripe therefore never overwrites a real previous
 * order, and loading the success page proves nothing on its own.
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

function clearPending(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* Already best-effort. */
  }
}

/**
 * Remember an order the server read back off a paid Checkout Session.
 *
 * This is the trustworthy path: the lines came from Stripe's own record of
 * what was bought, not from a browser key that no one has correlated with a
 * payment. Any pending snapshot is dropped, the order it stood in for is now
 * confirmed by a better source.
 */
export function rememberOrder(lines: ReorderLine[]): ReorderLine[] {
  const confirmed = parseReorder(serializeReorder(lines));
  if (!confirmed.length) return read(LAST_KEY);
  write(LAST_KEY, confirmed);
  clearPending();
  return confirmed;
}

/**
 * Fall back to the snapshot the checkout adapter saved at handoff, for the
 * orders Stripe could not carry: metadata is capped, so a long enough order
 * travels with no `reorder` value on the session. Only call this once the
 * session itself has been confirmed paid, or an abandoned basket would be
 * promoted on the strength of having merely loaded the success page.
 */
export function promotePendingOrder(): ReorderLine[] {
  const pending = read(PENDING_KEY);
  if (pending.length) {
    write(LAST_KEY, pending);
    clearPending();
    return pending;
  }
  return read(LAST_KEY);
}

export function loadLastOrder(): ReorderLine[] {
  return read(LAST_KEY);
}
