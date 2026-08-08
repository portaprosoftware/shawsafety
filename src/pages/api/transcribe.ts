/**
 * Speech-to-text for the dictation button on multi-line form fields.
 *
 * The browser records audio, posts it here, and gets plain text back. This
 * route exists purely so the ElevenLabs key stays on the server — calling
 * their API straight from the page would publish it to anyone who opens
 * devtools, and it is a billable credential.
 *
 * Environment (set in Vercel → Project → Settings → Environment Variables):
 *   ELEVENLABS_API_KEY  required. Server-only; never prefix with PUBLIC_.
 */
import type { APIRoute } from 'astro';
import { readEnv } from '@utils/env';

export const prerender = false;

const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';

/** ElevenLabs' general-purpose transcription model. */
const MODEL_ID = 'scribe_v1';

/**
 * Ceiling on an upload, in bytes.
 *
 * Opus at the browser's default bitrate runs well under 1MB/minute, so this is
 * roughly twenty minutes of speech — far more than anyone dictates into a
 * quote form, while still bounding what an unauthenticated caller can push
 * through a billable API.
 */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/** Give up rather than hold a serverless function open indefinitely. */
const UPSTREAM_TIMEOUT_MS = 30_000;

const ACCEPTED_TYPE = /^(audio|video)\//;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Answer GET rather than letting the router 404.
 *
 * Opening the endpoint in a browser is the first thing anyone does when
 * dictation misbehaves, and an unhandled GET logs a router warning that looks
 * like a routing fault rather than someone visiting a POST-only URL. Reports
 * whether the key is configured, which is the one piece of setup worth
 * checking from outside — the key itself is never echoed.
 */
export const GET: APIRoute = () =>
  json(
    {
      ok: false,
      error: 'Method not allowed. POST audio as multipart/form-data.',
      configured: Boolean(readEnv('ELEVENLABS_API_KEY')),
    },
    405
  );

/**
 * Strip parameters from a media type: `audio/webm;codecs=opus` to `audio/webm`.
 *
 * A validator matching against an allowlist compares the whole string, so the
 * codec parameter the browser attaches turns an accepted type into a rejected
 * one — and the resulting 400 says nothing about why.
 */
function baseType(type: string): string {
  return type.split(';')[0]!.trim().toLowerCase();
}

export const POST: APIRoute = async ({ request }) => {
  const apiKey = readEnv('ELEVENLABS_API_KEY');

  /*
   * Misconfiguration is reported as such rather than as a transcription
   * failure: without this the button would look broken to a visitor and
   * mysterious to whoever has to debug it.
   */
  if (!apiKey) {
    console.error('[transcribe] ELEVENLABS_API_KEY is not set');
    return json(
      { ok: false, error: 'Dictation is not configured. Please type instead.' },
      503
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: 'Could not read the recording.' }, 400);
  }

  const audio = form.get('audio');
  if (!(audio instanceof File) || audio.size === 0) {
    return json({ ok: false, error: 'No audio was received.' }, 400);
  }

  if (audio.size > MAX_AUDIO_BYTES) {
    return json(
      { ok: false, error: 'That recording is too long. Try a shorter one.' },
      413
    );
  }

  /*
   * The type is browser-reported and trivially forgeable, so this is not a
   * security boundary — it just fails an obvious mistake here instead of
   * spending an API call to have ElevenLabs reject it.
   */
  if (audio.type && !ACCEPTED_TYPE.test(audio.type)) {
    return json({ ok: false, error: 'That is not an audio recording.' }, 415);
  }

  /*
   * Re-wrap rather than forwarding the File as received. Appending it directly
   * carries its original content type through, parameters and all, and
   * `audio/webm;codecs=opus` is not the same string as `audio/webm` to a
   * validator doing an allowlist match.
   */
  const filename = audio.name || 'recording.wav';
  const clean = new Blob([await audio.arrayBuffer()], {
    type: baseType(audio.type) || 'audio/wav',
  });

  const upstream = new FormData();
  upstream.append('file', clean, filename);
  upstream.append('model_id', MODEL_ID);

  let response: Response;
  try {
    response = await fetch(ELEVENLABS_STT_URL, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: upstream,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    console.error('[transcribe] request to ElevenLabs failed:', error);
    return json(
      { ok: false, error: 'Could not reach the transcription service.' },
      502
    );
  }

  if (!response.ok) {
    /*
     * Logged, not returned: an upstream error body can name the account or
     * quota state, which is nothing a visitor should see.
     *
     * The request shape is logged alongside it because the body on its own
     * does not say what was sent — an earlier round of this failed with a bare
     * `400 {"detail":...}` and no way to tell which field it objected to.
     */
    console.error(
      `[transcribe] ElevenLabs returned ${response.status}`,
      JSON.stringify({
        sent: {
          filename,
          contentType: clean.type,
          originalType: audio.type,
          bytes: clean.size,
          model: MODEL_ID,
        },
        body: await response.text().catch(() => '(no body)'),
      })
    );
    return json({ ok: false, error: 'Could not transcribe that audio.' }, 502);
  }

  let text: string;
  try {
    const payload = (await response.json()) as { text?: unknown };
    text = typeof payload.text === 'string' ? payload.text.trim() : '';
  } catch (error) {
    console.error('[transcribe] unreadable response from ElevenLabs:', error);
    return json({ ok: false, error: 'Could not transcribe that audio.' }, 502);
  }

  /*
   * Silence transcribes to an empty string, which is a success upstream but a
   * confusing no-op in the field. Say so rather than appearing to do nothing.
   */
  if (!text) {
    return json(
      { ok: false, error: 'No speech detected. Try again, closer to the mic.' },
      422
    );
  }

  return json({ ok: true, text }, 200);
};
