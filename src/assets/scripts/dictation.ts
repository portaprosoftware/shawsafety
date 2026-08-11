/**
 * Browser-side dictation: record, normalise, transcribe.
 *
 * Extracted from VoiceInput so the chat composer can dictate too. The two
 * callers want completely different chrome, a microphone tucked into the
 * corner of a tall form field, versus a button in a chat composer's button row
 *, but identical behaviour underneath, and the behaviour is the part with the
 * sharp edges: MediaRecorder's per-browser containers, the WAV normalisation
 * that fixed an opaque upstream 400, the auto-stop that closes a forgotten
 * microphone, and releasing the device on every exit path.
 *
 * So this module owns all of that and owns no markup. A caller supplies
 * callbacks and gets back a controller; what it draws in response is its own
 * business.
 *
 * Audio is posted to /api/transcribe, which holds the ElevenLabs key. Nothing
 * is stored: the blob is discarded once the text comes back.
 */
import { toWav } from '@scripts/wavEncoder';

/** Auto-stop, in ms. A forgotten open mic is a bill and a privacy problem. */
const MAX_RECORDING_MS = 120_000;

export interface DictationHandlers {
  /** Transcribed text, ready to be placed wherever the caller wants it. */
  onText: (text: string) => void;
  /** Progress and errors, already phrased for a visitor. */
  onStatus: (text: string, isError: boolean) => void;
  /** Recording started or stopped, for swapping the icon and colour. */
  onRecordingChange: (recording: boolean) => void;
  /** In flight to the transcription service; the control should be disabled. */
  onBusyChange?: (busy: boolean) => void;
}

export interface Dictation {
  /** Start if idle, stop if recording. What a single button needs. */
  toggle: () => void;
  stop: () => void;
  isRecording: () => boolean;
}

/**
 * Recording needs both APIs and a secure context; getUserMedia is undefined
 * over plain HTTP. Callers use this to decide whether to render a control at
 * all, a button that cannot work is worse than no button.
 */
export function isDictationSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

/**
 * Pick a container the browser will actually produce.
 *
 * Chrome and Firefox record WebM/Opus; Safari ignores the request and gives
 * MP4. Passing an unsupported type throws, so an empty string (meaning "your
 * default") is the honest fallback rather than a guess.
 */
function preferredMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) ?? '';
}

/**
 * Insert text at the caret, keeping whatever is already typed.
 *
 * Dictation adds to a field rather than replacing it, someone who typed two
 * sentences and then spoke a third should end up with three.
 */
export function insertAtCaret(
  field: HTMLTextAreaElement | HTMLInputElement,
  text: string
): void {
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? start;
  const before = field.value.slice(0, start);
  const after = field.value.slice(end);

  // Space out from adjacent text, so speaking twice does not run words
  // together, but never open the field with a leading space.
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^\s/.test(after) ? ' ' : '';
  const insert = `${lead}${text}${trail}`;

  field.value = `${before}${insert}${after}`;

  const caret = start + insert.length - trail.length;
  field.setSelectionRange(caret, caret);
  field.focus();

  // Anything watching the field (validation, autosize, character counts)
  // listens for input events, which programmatic writes do not raise.
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

export function createDictation(handlers: DictationHandlers): Dictation {
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let timer: number | undefined;
  let autoStop: number | undefined;
  let startedAt = 0;
  /** True between the click and the microphone actually opening. */
  let starting = false;
  /** Set when `stop` lands during that window, so the stream is closed on arrival. */
  let cancelStart = false;

  const status = (text: string, isError = false) =>
    handlers.onStatus(text, isError);

  /**
   * Drop the mic.
   *
   * Chrome lights the tab's recording dot for as long as anything holds a live
   * capture, and it stays lit until every one of them lets go, so ending the
   * tracks is necessary but not sufficient. Two other references have to go
   * with them: the MediaRecorder, which keeps its own sink on the track and
   * would otherwise sit in the closure until the next recording, and the
   * recorder's copy of the stream, which outlives the local variable on any
   * path that clears `stream` first.
   */
  const releaseMic = () => {
    for (const open of [stream, recorder?.stream]) {
      open?.getTracks().forEach(track => track.stop());
    }
    stream = null;
    recorder = null;
    window.clearInterval(timer);
    window.clearTimeout(autoStop);
  };

  const tick = () => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    status(`Recording ${mm}:${ss}, tap stop when finished`);
  };

  const transcribe = async (recorded: Blob) => {
    handlers.onBusyChange?.(true);
    status('Transcribing…');

    /*
     * Convert to WAV before uploading. Browsers record in whatever container
     * they prefer, and the parameterised type that comes with it
     * (`audio/webm;codecs=opus`) is what upstream rejected with an opaque 400.
     * WAV has one canonical type, no codec parameter, and is accepted
     * everywhere.
     *
     * If the browser cannot decode its own recording, send the original, the
     * recorder's format may well transcribe fine, and a failed conversion is
     * no reason to throw the audio away.
     */
    let blob = recorded;
    let filename = recorded.type.includes('mp4')
      ? 'recording.mp4'
      : 'recording.webm';
    try {
      blob = await toWav(recorded);
      filename = 'recording.wav';
    } catch (error) {
      console.warn('[voice] WAV conversion failed, sending original:', error);
    }

    const body = new FormData();
    body.append('audio', blob, filename);

    try {
      const response = await fetch('/api/transcribe', { method: 'POST', body });
      const payload = await response
        .json()
        .catch(() => ({ ok: false, error: '' }));

      if (!response.ok || !payload.ok) {
        status(payload.error || 'Transcription failed. Please type.', true);
        return;
      }

      handlers.onText(payload.text);
      status('Added. Edit as needed.', false);
    } catch {
      // Offline, or the request was cut off mid-flight.
      status('Network problem. The recording was not sent.', true);
    } finally {
      handlers.onBusyChange?.(false);
    }
  };

  const stop = () => {
    // `stop()` fires onstop asynchronously; releasing the mic here rather than
    // in the handler kills the recording light immediately.
    if (starting) cancelStart = true;
    if (recorder?.state === 'recording') recorder.stop();
    releaseMic();
    handlers.onRecordingChange(false);
  };

  const start = async () => {
    status('Requesting microphone…');

    /*
     * Opening the microphone is asynchronous, and until it resolves there is
     * no recorder for `toggle` to see as running, so a second click during
     * the wait used to open a second stream and overwrite the first, leaving
     * it live with nothing left holding a reference to stop it. That is the
     * open microphone that survives pressing stop and only clears on reload.
     */
    if (starting) return;
    starting = true;

    // Anything still open from a previous round goes before a new one starts.
    releaseMic();

    let opened: MediaStream;
    try {
      opened = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      starting = false;
      // Denied, dismissed, or no input device, all land here, and the
      // distinction is what the visitor needs to hear.
      const denied =
        error instanceof DOMException &&
        (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      status(
        denied
          ? 'Microphone blocked. Allow access in your browser, or type instead.'
          : 'No microphone found. Please type instead.',
        true
      );
      return;
    }

    /*
     * Stopped while the permission prompt was still up. The chat panel does
     * this when it is dismissed. The stream arrived after the decision to
     * stop, so close it here rather than opening a recording nobody asked for.
     */
    if (cancelStart) {
      opened.getTracks().forEach(track => track.stop());
      cancelStart = false;
      starting = false;
      return;
    }

    stream = opened;
    const mimeType = preferredMimeType();
    const active = new MediaRecorder(
      opened,
      mimeType ? { mimeType } : undefined
    );
    recorder = active;
    starting = false;
    chunks = [];

    active.addEventListener('dataavailable', event => {
      if (event.data.size > 0) chunks.push(event.data);
    });

    active.addEventListener('stop', () => {
      /*
       * `active`, not `recorder`. Stopping releases the mic, which clears
       * `recorder` before this fires, and by then a later recording may
       * already own it.
       */
      const blob = new Blob(chunks, { type: active.mimeType || 'audio/webm' });
      chunks = [];
      // Belt and braces: the recorder is the last thing holding the track on
      // paths that end here without going through `stop`.
      active.stream.getTracks().forEach(track => track.stop());
      if (blob.size > 0) void transcribe(blob);
      else status('Nothing was recorded. Try again.', true);
    });

    active.start();
    startedAt = Date.now();
    handlers.onRecordingChange(true);
    tick();
    timer = window.setInterval(tick, 1000);
    autoStop = window.setTimeout(() => {
      stop();
      status('Reached the 2 minute limit, transcribing what was said.', false);
    }, MAX_RECORDING_MS);
  };

  // Leaving mid-recording must not strand an open microphone.
  window.addEventListener('pagehide', () => {
    if (starting) cancelStart = true;
    releaseMic();
  });

  return {
    toggle: () => {
      // `starting` counts as on: a second press while the permission prompt is
      // up reads as "never mind", and letting it fall through to `start` would
      // silently do nothing.
      if (starting || recorder?.state === 'recording') stop();
      else void start();
    },
    stop,
    isRecording: () => recorder?.state === 'recording',
  };
}
