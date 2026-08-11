/**
 * Client-side cart store.
 *
 * The cart is purely a UI ledger. It is NOT the source of truth for money.
 * Stripe (or Square) reprices everything server-side at checkout; see
 * `checkout.ts`. Persisted to localStorage so a reload or a return visit
 * keeps the basket.
 */

import { lineTotal, resolveTier, roundMoney, type Tier } from './pricing';

const STORAGE_KEY = 'shawsafety:cart:v1';
const CHANGE_EVENT = 'cart:change';

export interface CartItem {
  /** Stable line key: productId + variantId. */
  key: string;
  productId: string;
  variantId: string;
  title: string;
  variantName: string;
  /** Swatch color, for the drawer thumbnail chip. */
  hex: string;
  image: string;
  sku: string;
  unit: string;
  qty: number;
  tiers: Tier[];
  href: string;
}

export interface CartTotals {
  count: number;
  subtotal: number;
  /** Sum of list-price line totals, for showing "you saved". */
  listSubtotal: number;
  savings: number;
}

type Listener = (items: CartItem[], totals: CartTotals) => void;

/** Order over the free-shipping threshold ships free. */
export const FREE_SHIPPING_THRESHOLD = 35;

let items: CartItem[] = [];
let hydrated = false;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

/**
 * Read persisted state. Anything malformed is discarded rather than thrown,
 * a corrupt cart must never take the whole page down.
 */
function hydrate(): void {
  if (hydrated || !isBrowser()) return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      items = parsed.filter(
        (i): i is CartItem =>
          i &&
          typeof i.key === 'string' &&
          typeof i.qty === 'number' &&
          i.qty > 0 &&
          Array.isArray(i.tiers)
      );
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function persist(): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Quota or private-mode failure: the in-memory cart still works.
  }
}

function emit(): void {
  persist();
  if (!isBrowser()) return;
  window.dispatchEvent(
    new CustomEvent(CHANGE_EVENT, {
      detail: { items: getItems(), totals: getTotals() },
    })
  );
}

export function getItems(): CartItem[] {
  hydrate();
  return items.map(i => ({ ...i }));
}

export function getTotals(): CartTotals {
  hydrate();
  let subtotal = 0;
  let listSubtotal = 0;
  let count = 0;
  for (const item of items) {
    count += item.qty;
    subtotal += lineTotal(item.tiers, item.qty);
    listSubtotal += (item.tiers[0]?.pricePerUnit ?? 0) * item.qty;
  }
  subtotal = roundMoney(subtotal);
  listSubtotal = roundMoney(listSubtotal);
  return {
    count,
    subtotal,
    listSubtotal,
    savings: roundMoney(Math.max(0, listSubtotal - subtotal)),
  };
}

/** Current unit price for a line, after its volume discount. */
export function unitPriceFor(item: CartItem): number {
  return resolveTier(item.tiers, item.qty).pricePerUnit;
}

export function addItem(
  item: Omit<CartItem, 'key' | 'qty'>,
  qty: number = 1
): void {
  hydrate();
  const key = `${item.productId}::${item.variantId}`;
  const existing = items.find(i => i.key === key);
  if (existing) {
    // Quantity accumulates, so adding the same variant twice deepens the
    // volume discount rather than creating a second line.
    existing.qty += Math.max(1, Math.floor(qty));
  } else {
    items.push({ ...item, key, qty: Math.max(1, Math.floor(qty)) });
  }
  emit();
}

export function updateQty(key: string, qty: number): void {
  hydrate();
  const next = Math.floor(qty);
  if (next <= 0) {
    removeItem(key);
    return;
  }
  const item = items.find(i => i.key === key);
  if (!item) return;
  item.qty = next;
  emit();
}

export function removeItem(key: string): void {
  hydrate();
  items = items.filter(i => i.key !== key);
  emit();
}

export function clear(): void {
  hydrate();
  items = [];
  emit();
}

/**
 * Subscribe to cart changes. Fires immediately with current state so
 * consumers do not need a separate initial render path. Returns an
 * unsubscribe function.
 */
export function subscribe(listener: Listener): () => void {
  const handler = () => listener(getItems(), getTotals());
  if (!isBrowser()) return () => {};
  window.addEventListener(CHANGE_EVENT, handler);
  // Keep tabs in sync when the cart is edited in another window.
  const storageHandler = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    hydrated = false;
    items = [];
    hydrate();
    handler();
  };
  window.addEventListener('storage', storageHandler);
  handler();
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener('storage', storageHandler);
  };
}

export function openDrawer(): void {
  if (!isBrowser()) return;
  window.dispatchEvent(new CustomEvent('cart:open'));
}

export function closeDrawer(): void {
  if (!isBrowser()) return;
  window.dispatchEvent(new CustomEvent('cart:close'));
}
