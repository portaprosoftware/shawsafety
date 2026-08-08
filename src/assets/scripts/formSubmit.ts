/**
 * Shared submit handling for the contact and quote forms.
 *
 * Both post to /api/contact, so the loading, success, and failure states live
 * here rather than being written twice.
 */

interface Options {
  formId: string;
  statusId: string;
  submitId: string;
  /** Button label restored after a failure. */
  idleLabel: string;
}

export function attachFormHandler({
  formId,
  statusId,
  submitId,
  idleLabel,
}: Options): void {
  const form = document.getElementById(formId) as HTMLFormElement | null;
  const status = document.getElementById(statusId);
  const submit = document.getElementById(submitId) as HTMLButtonElement | null;
  if (!form || !status || !submit) return;

  const show = (message: string, tone: 'ok' | 'error') => {
    status.textContent = message;
    status.classList.remove('hidden');
    status.classList.toggle('bg-green-50', tone === 'ok');
    status.classList.toggle('text-green-700', tone === 'ok');
    status.classList.toggle('bg-maroon-50', tone === 'error');
    status.classList.toggle('text-maroon-900', tone === 'error');
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();

    // Let the browser surface its own field-level messages first.
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Sending…';
    status.classList.add('hidden');

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        body: new FormData(form),
      });

      // A non-JSON body means something upstream failed (a proxy error page,
      // say), so treat a parse failure as a failed send rather than throwing.
      const result = await response.json().catch(() => null);

      if (response.ok && result?.ok) {
        form.reset();
        show(
          'Thanks — we have got it. We reply within one business day.',
          'ok'
        );
        // Nothing left to submit; leave the button disabled.
        submit.textContent = 'Sent';
        return;
      }

      show(
        result?.error ??
          'Something went wrong. Please email sales@shawsafety.com.',
        'error'
      );
    } catch {
      show(
        'Could not reach the server. Please check your connection or email sales@shawsafety.com.',
        'error'
      );
    }

    submit.disabled = false;
    submit.textContent = idleLabel;
  });
}
