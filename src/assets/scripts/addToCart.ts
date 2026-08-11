/**
 * Delegated handler for every `[data-add-to-cart]` button on the page.
 *
 * One listener on the document covers product cards, the PDP buy box, and
 * cross-sell bands alike, so new call sites need no extra wiring.
 */
import { addItem, openDrawer } from './cart';

let bound = false;

export function initAddToCart(): void {
  if (bound || typeof document === 'undefined') return;
  bound = true;

  document.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-add-to-cart]'
    );
    if (!button) return;

    let payload;
    try {
      payload = JSON.parse(button.dataset.addToCart!);
    } catch {
      return;
    }

    const { qty = 1, ...item } = payload;
    addItem(item, qty);
    flashConfirmed(button);
    openDrawer();
  });
}

/**
 * Swap the label to a confirmation for a beat. Purely cosmetic, the cart
 * badge is the authoritative feedback.
 */
function flashConfirmed(button: HTMLElement): void {
  const label = button.querySelector<HTMLElement>('[data-label]');
  if (!label || label.dataset.busy) return;
  const original = label.textContent ?? '';
  label.dataset.busy = 'true';
  label.textContent = 'Added';
  window.setTimeout(() => {
    label.textContent = original;
    delete label.dataset.busy;
  }, 1200);
}
