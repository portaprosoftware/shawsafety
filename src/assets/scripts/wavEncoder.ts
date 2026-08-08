/**
 * Converts a recorded audio blob to 16 kHz mono 16-bit PCM WAV.
 *
 * MediaRecorder gives you whatever container the browser prefers — Chrome and
 * Firefox produce `audio/webm;codecs=opus`, Safari `audio/mp4` — and that type
 * string travels with the upload. A transcription API that validates the part's
 * content type against an allowlist will reject a parameterised type like
 * `audio/webm;codecs=opus` even when it accepts `audio/webm`, which is an
 * opaque 400 with nothing in it that names the real problem.
 *
 * Normalising to WAV before upload removes the whole class of failure: one
 * container, one content type, no codec parameter, accepted everywhere. 16 kHz
 * mono is also what speech models want — anything above it is resampled away
 * upstream, so sending 48 kHz stereo just pays for bytes that get discarded.
 *
 * The trade is size: PCM is roughly ten times Opus, about 32 KB per second of
 * speech. At the ten-second recording cap that is under 350 KB.
 */

/** What speech models run at. Higher buys nothing and costs upload. */
export const TARGET_SAMPLE_RATE = 16000;

/**
 * Downmix to mono and resample, using the browser's own resampler.
 *
 * Falls back to the source rate if the platform refuses the target — older
 * Safari only allowed hardware sample rates in an OfflineAudioContext. A
 * higher-rate WAV is still perfectly transcribable, just larger, so this
 * degrades on size rather than failing.
 */
async function toMonoAtRate(
  buffer: AudioBuffer,
  rate: number
): Promise<{ samples: Float32Array; sampleRate: number }> {
  const render = async (target: number) => {
    const frames = Math.max(1, Math.ceil(buffer.duration * target));
    // One output channel makes the context do the downmix for us.
    const offline = new OfflineAudioContext(1, frames, target);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return { samples: rendered.getChannelData(0), sampleRate: target };
  };

  try {
    return await render(rate);
  } catch {
    return await render(buffer.sampleRate);
  }
}

/** Float samples in [-1, 1] to a 16-bit PCM WAV file. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample; // mono
  const dataBytes = samples.length * bytesPerSample;
  const view = new DataView(new ArrayBuffer(44 + dataBytes));

  let offset = 0;
  const str = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i));
  };
  const u32 = (v: number) => {
    view.setUint32(offset, v, true);
    offset += 4;
  };
  const u16 = (v: number) => {
    view.setUint16(offset, v, true);
    offset += 2;
  };

  str('RIFF');
  u32(36 + dataBytes); // file size minus the first 8 bytes
  str('WAVE');
  str('fmt ');
  u32(16); // PCM fmt chunk length
  u16(1); // format: PCM
  u16(1); // channels: mono
  u32(sampleRate);
  u32(sampleRate * blockAlign); // byte rate
  u16(blockAlign);
  u16(8 * bytesPerSample); // bits per sample
  str('data');
  u32(dataBytes);

  for (let i = 0; i < samples.length; i++) {
    // Clamp before scaling: a sample slightly outside [-1, 1] would wrap to
    // the opposite extreme and read as a click.
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([view.buffer], { type: 'audio/wav' });
}

/**
 * Recorded blob in, WAV blob out.
 *
 * Throws if the browser cannot decode what it just recorded, which the caller
 * should treat as "send the original instead" rather than as a dead end — an
 * upload in the recorder's own format may still transcribe fine.
 */
export async function toWav(blob: Blob): Promise<Blob> {
  const bytes = await blob.arrayBuffer();
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(bytes);
    const { samples, sampleRate } = await toMonoAtRate(
      decoded,
      TARGET_SAMPLE_RATE
    );
    return encodeWav(samples, sampleRate);
  } finally {
    // Contexts are a limited per-page resource; leaking one per recording
    // eventually refuses to open any more.
    void context.close();
  }
}
