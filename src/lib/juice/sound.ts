import { settings } from "../settings.svelte";

/**
 * Sound effects. Samples live in public/sfx (snd.dev free pack); each play gets a little pitch
 * jitter so repeats don't sound mechanical.
 *
 * Known issue: on Linux with a Bluetooth output, WebKitGTK's Web Audio goes silent ~200 ms after
 * a context starts (see HANDOFF, known issues). Other outputs work.
 */
const SAMPLES = {
  tap: ["tap_01", "tap_02", "tap_03", "tap_04", "tap_05"],
  type: ["type_01", "type_02", "type_03", "type_04", "type_05"],
  swipe: ["swipe_01", "swipe_02", "swipe_03", "swipe_04", "swipe_05"],
  select: ["select"],
  button: ["button"],
  appear: ["transition_up"],
  vanish: ["transition_down"],
  toggleOn: ["toggle_on"],
  toggleOff: ["toggle_off"],
  denied: ["disabled"],
  caution: ["caution"],
  done: ["notification"],
  celebrate: ["celebration"],
} satisfies Record<string, string[]>;

export type Sound = keyof typeof SAMPLES;

/** Per-sound gain, evening out the pack's different loudness. */
const GAIN: Partial<Record<Sound, number>> = {
  tap: 0.5,
  appear: 0.35,
  vanish: 0.35,
  caution: 0.4,
  done: 0.5,
};

export interface PlayOptions {
  /** Multiplies the sound's gain. */
  volume?: number;
  /** Playback rate; 1.12 is about two semitones up. */
  pitch?: number;
  /** Random pitch spread, ± this fraction. */
  jitter?: number;
  /** Start later, in ms. */
  delay?: number;
  /** Skip if this sound already played within this many ms. */
  throttle?: number;
}

export type Cue = [Sound, PlayOptions?];

const MAX_VOICES = 12;

interface Output {
  /** "running" when sounds can start now; anything else drops them. */
  state(): string;
  /** Nudges a suspended output (after a user gesture). */
  wake(): void;
  ready(file: string): boolean;
  start(file: string, rate: number, gain: number, delay: number): void;
}

let output: Output | null = null;
const lastPlayed = new Map<Sound, number>();
const lastSample = new Map<Sound, string>();
let voices = 0;
const FILES = new Set(Object.values(SAMPLES).flat());
const url = (file: string) => `/sfx/${file}.wav`;
/** Recently requested sounds, newest last, for tests (logged even when no device can play them). */
const recent: Sound[] = [];

function webAudioOutput(): Output | null {
  if (typeof AudioContext === "undefined") return null;
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const buffers = new Map<string, AudioBuffer>();
  for (const file of FILES) {
    fetch(url(file))
      .then((r) => r.arrayBuffer())
      .then((data) => decodeWav(ctx, data) ?? ctx.decodeAudioData(data))
      .then((buffer) => buffers.set(file, buffer))
      .catch((e) => console.warn(`sfx ${file}:`, e));
  }
  return {
    state: () => ctx.state,
    wake: () => void (ctx.state === "suspended" && ctx.resume().catch(() => {})),
    ready: (file) => buffers.has(file),
    start(file, rate, gain, delay) {
      const source = ctx.createBufferSource();
      source.buffer = buffers.get(file)!;
      source.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = gain;
      source.connect(g).connect(master);
      voices++;
      source.onended = () => voices--;
      source.start(ctx.currentTime + delay / 1000);
    },
  };
}

/** Sets up the output and loads every sample. Safe to call more than once. */
export function initSound() {
  if (output) return;
  output = webAudioOutput();
  // Browsers start audio suspended until a user gesture.
  const unlock = () => output?.wake();
  window.addEventListener("pointerdown", unlock, { capture: true });
  window.addEventListener("keydown", unlock, { capture: true });
}

/**
 * Decodes PCM WAV (8/16/24/32-bit integer or 32-bit float) directly. WebKitGTK's own
 * decodeAudioData goes through GStreamer and fails without gst-plugins-good; this doesn't.
 * Returns null for anything else, so the caller can fall back to the platform decoder.
 */
function decodeWav(ctx: BaseAudioContext, data: ArrayBuffer): AudioBuffer | null {
  const view = new DataView(data);
  const tag = (at: number) => String.fromCharCode(...new Uint8Array(data, at, 4));
  if (data.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;

  let format = 0, channels = 0, rate = 0, bits = 0;
  for (let at = 12; at + 8 <= data.byteLength; ) {
    const id = tag(at), size = view.getUint32(at + 4, true), body = at + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      rate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      if (format === 0xfffe) format = view.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE
    } else if (id === "data") {
      const pcm = format === 1 && [8, 16, 24, 32].includes(bits);
      const float = format === 3 && bits === 32;
      if (!channels || !rate || (!pcm && !float)) return null;
      const read: (p: number) => number = float
        ? (p) => view.getFloat32(p, true)
        : {
            8: (p: number) => (view.getUint8(p) - 128) / 128,
            16: (p: number) => view.getInt16(p, true) / 32768,
            24: (p: number) => (view.getUint8(p) | (view.getUint8(p + 1) << 8) | (view.getInt8(p + 2) << 16)) / 8388608,
            32: (p: number) => view.getInt32(p, true) / 2147483648,
          }[bits]!;
      const bytes = bits / 8;
      const frames = Math.floor(Math.min(size, data.byteLength - body) / (bytes * channels));
      const buffer = ctx.createBuffer(channels, frames, rate);
      for (let c = 0; c < channels; c++) {
        const out = buffer.getChannelData(c);
        for (let i = 0; i < frames; i++) out[i] = read(body + (i * channels + c) * bytes);
      }
      return buffer;
    }
    at = body + size + (size & 1); // chunks are word-aligned
  }
  return null;
}

export function play(sound: Sound, opts: PlayOptions = {}) {
  if (!settings.sound || !output) return;
  const now = performance.now();
  if (opts.throttle && now - (lastPlayed.get(sound) ?? -Infinity) < opts.throttle) return;
  lastPlayed.set(sound, now);
  recent.push(sound);
  if (recent.length > 50) recent.shift();

  // Sounds started while suspended would all burst out on resume, so they're dropped instead.
  if (output.state() !== "running") return output.wake();
  if (voices >= MAX_VOICES) return;

  // Variants: pick at random, but never the same one twice in a row.
  const files = SAMPLES[sound];
  let file = files[Math.floor(Math.random() * files.length)];
  if (files.length > 1 && file === lastSample.get(sound)) file = files[(files.indexOf(file) + 1) % files.length];
  if (!output.ready(file)) return;
  lastSample.set(sound, file);

  const jitter = opts.jitter ?? 0.04;
  const rate = (opts.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * jitter);
  const gain = (GAIN[sound] ?? 1) * (opts.volume ?? 1) * settings.volume;
  output.start(file, rate, gain, opts.delay ?? 0);
}

export function playCue(cue: Cue | null | undefined) {
  if (cue) play(cue[0], cue[1]);
}

/** Dev/test introspection. */
export function soundState() {
  const loaded = [...FILES].filter((f) => output?.ready(f)).length;
  return { state: output?.state() ?? "none", loaded, voices, recent: [...recent] };
}
