<script lang="ts">
  import { relinkMissing } from "../storage.svelte";
  import { tip } from "../ui/tips.svelte";
  import { Pause, Play, Repeat, Volume1, Volume2, VolumeX } from "@lucide/svelte";
  import { doc } from "../app.svelte";
  import { backend } from "../backend";
  import type { Asset, CanvasNode } from "../doc/types";
  import { forget, formatTime, loops, muted, playing, positions, togglePlaying, volumes } from "../media/playback.svelte";
  import { acquireMediaUrl } from "../media/source";

  let { node, asset }: { node: CanvasNode; asset: Asset } = $props();

  const id = $derived(node.id);
  const isPlaying = $derived(playing.has(id));
  const loop = $derived(loops(node));
  // Volume and mute are session state per node, like a video's (playback.svelte.ts).
  const volume = $derived(volumes.get(id) ?? 1);
  const isMuted = $derived(muted.has(id));

  function setVolume(v: number) {
    volumes.set(id, v);
    if (v > 0) muted.delete(id);
    else muted.add(id);
  }

  // Loudness (RMS) per bar comes from Rust (decoded once, cached); 0–255, loudest = 255.
  let wave = $state<{ duration: number; peaks: number[] } | null>(null);
  $effect(() => {
    const url = asset.missing ? "" : backend.waveformUrl(asset);
    if (!url) return;
    let cancelled = false;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((w) => !cancelled && (wave = w))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  });

  // The card's layout in world units: everything is in em of a font that follows the height.
  const em = $derived(node.h / 6.8);
  /** The waveform's size: the card minus paddings (0.9em + 1em), play button (3.6em) and gap (0.8em). */
  const waveW = $derived(Math.max(1, node.w - 6.3 * em));
  const waveH = $derived(2.4 * em);

  /** One bar per ~3 world units of width, merged by maximum. */
  const bars = $derived.by(() => {
    const peaks = wave?.peaks ?? [];
    const n = Math.max(1, Math.min(peaks.length, Math.round(waveW / 3)));
    if (!peaks.length) return [];
    return Array.from({ length: n }, (_, i) => {
      const a = Math.floor((i * peaks.length) / n), b = Math.max(a + 1, Math.floor(((i + 1) * peaks.length) / n));
      // Squared for contrast: loudly mastered music sits near the top for most of a song.
      return (Math.max(...peaks.slice(a, b)) / 255) ** 2;
    });
  });
  // Drawn in the waveform's real proportions, so bars get truly round ends.
  const barsPath = $derived.by(() => {
    const slot = waveW / Math.max(1, bars.length);
    const w = slot * 0.62, r = w / 2;
    return bars
      .map((p, i) => {
        const h = Math.max(w, p * waveH);
        const x = i * slot + (slot - w) / 2, y = (waveH - h) / 2;
        return `M${x},${y + r}a${r},${r} 0 0 1 ${w},0v${h - w}a${r},${r} 0 0 1 ${-w},0Z`;
      })
      .join("");
  });
  /** Where the pointer is over the waveform, as a fraction, previewing a seek. */
  let hoverAt = $state<number | null>(null);

  // The <audio> element exists only while playing; the position is kept between plays.
  let audio = $state<HTMLAudioElement>();
  /** Loaded and moved to where it was left; until then its clock reads 0 and mustn't be recorded. */
  let ready = $state(false);
  // Starts where the node was left (its element may have unmounted since).
  const resumeAt = () => positions.get(id) ?? 0;
  let time = $state(resumeAt());
  let elementDuration = $state(0);
  let failed = $state(false);
  const duration = $derived(wave?.duration || elementDuration);
  const progress = $derived(duration ? Math.min(1, time / duration) : 0);

  let src = $state<string>();
  $effect(() => {
    if (!isPlaying) return;
    const media = acquireMediaUrl(asset);
    let cancelled = false;
    media.url.then(
      (url) => !cancelled && (src = url),
      () => {
        if (cancelled) return;
        failed = true;
        playing.delete(id);
      },
    );
    return () => {
      cancelled = true;
      media.release();
      src = undefined;
      ready = false;
    };
  });

  $effect(() => {
    if (!audio) return;
    audio.volume = volume;
    audio.muted = isMuted;
  });

  function setTime(t: number) {
    time = t;
    positions.set(id, t);
  }

  function onLoaded() {
    if (!audio) return;
    elementDuration = audio.duration;
    const resume = resumeAt();
    if (resume > 0 && resume < audio.duration) audio.currentTime = resume;
    ready = true;
    audio.play().catch(() => playing.delete(id));
  }

  function onEnded() {
    playing.delete(id);
    setTime(0);
  }

  // Not before `ready`: a fresh element reads 0 and would overwrite the saved position.
  $effect(() => {
    if (!audio || !isPlaying || !ready) return;
    let frame = requestAnimationFrame(function tick() {
      if (audio) setTime(audio.currentTime);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  });

  $effect(() => () => {
    if (!doc.nodes[id]) forget(id);
  });

  // In the node's own (possibly rotated) frame, so offsetX is the right measure.
  let scrubbing = false;
  function seekTo(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    if (!duration) return;
    const t = Math.min(1, Math.max(0, e.offsetX / el.offsetWidth)) * duration;
    hoverAt = null;
    setTime(t);
    if (audio) audio.currentTime = t;
  }
</script>

<!-- The font size follows the node's height, so the whole card scales with it. -->
<div class="card" class:playing={isPlaying} style:font-size="{em}px">
  <button
    class="play"
    aria-label={isPlaying ? "Pause" : "Play"}
    disabled={asset.missing || failed}
    onpointerdown={(e) => e.stopPropagation()}
    ondblclick={(e) => e.stopPropagation()}
    onclick={() => togglePlaying(id)}
  >
    {#if isPlaying}<Pause fill="currentColor" />{:else}<Play fill="currentColor" />{/if}
  </button>
  <div class="body">
    <div class="meta">
      <span class="name" {@attach tip(asset.name)}>{asset.name}</span>
      {#if loop}<span class="loop" {@attach tip("Loops")}><Repeat /></span>{/if}
      <span class="time">
        {#if asset.missing}Missing file <button class="find" onpointerdown={(e) => e.stopPropagation()} ondblclick={(e) => e.stopPropagation()} onclick={() => void relinkMissing()}>Find…</button>{:else if failed}Can't play{:else if time > 0 || isPlaying}{formatTime(time)} / {duration ? formatTime(duration) : "–:––"}{:else}{duration ? formatTime(duration) : "–:––"}{/if}
      </span>
      <!-- The volume slider opens while the pointer is over the speaker. -->
      {#if !asset.missing && !failed}
        <span class="volume">
          <button
            aria-label={isMuted ? "Unmute" : "Mute"}
            {@attach tip(isMuted ? "Unmute" : "Mute")}
            onpointerdown={(e) => e.stopPropagation()}
            ondblclick={(e) => e.stopPropagation()}
            onclick={() => (isMuted ? setVolume(volume || 1) : muted.add(id))}
          >
            {#if isMuted || volume === 0}<VolumeX />{:else if volume < 0.5}<Volume1 />{:else}<Volume2 />{/if}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            aria-label="Volume"
            value={isMuted ? 0 : volume}
            onpointerdown={(e) => e.stopPropagation()}
            ondblclick={(e) => e.stopPropagation()}
            oninput={(e) => setVolume(Number((e.target as HTMLInputElement).value))}
          />
        </span>
      {/if}
    </div>
    <div
      class="wave"
      role="slider"
      tabindex="-1"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={time}
      onpointerdown={(e) => {
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        scrubbing = true;
        seekTo(e);
      }}
      onpointermove={(e) => {
        if (scrubbing) return seekTo(e);
        const el = e.currentTarget as HTMLElement;
        hoverAt = Math.min(1, Math.max(0, e.offsetX / el.offsetWidth));
      }}
      onpointerleave={() => (hoverAt = null)}
      onpointerup={() => (scrubbing = false)}
      onpointercancel={() => (scrubbing = false)}
      ondblclick={(e) => e.stopPropagation()}
    >
      {#if bars.length}
        <svg viewBox="0 0 {waveW} {waveH}" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <clipPath id="played-{id}"><rect width={progress * waveW} height={waveH} /></clipPath>
            <clipPath id="hover-{id}"><rect width={(hoverAt ?? 0) * waveW} height={waveH} /></clipPath>
          </defs>
          <path class="bars" d={barsPath} />
          {#if hoverAt !== null}<path class="bars hovered" d={barsPath} clip-path="url(#hover-{id})" />{/if}
          <path class="bars played" d={barsPath} clip-path="url(#played-{id})" />
        </svg>
      {:else}
        <div class="flat"><div class="flat-played" style:width="{progress * 100}%"></div></div>
      {/if}
    </div>
  </div>
  {#if isPlaying && src}
    <audio
      bind:this={audio}
      {src}
      preload="auto"
      {loop}
      onloadedmetadata={onLoaded}
      onended={onEnded}
      onerror={() => {
        failed = true;
        playing.delete(id);
      }}
    ></audio>
  {/if}
</div>

<style>
  .card {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    gap: 0.8em;
    padding: 0 1em 0 0.9em;
    border-radius: calc(0.8em * var(--round));
    background: var(--panel-solid);
    color: var(--text);
    box-shadow: 0 calc(4px * var(--inv-zoom)) calc(18px * var(--inv-zoom)) var(--node-shadow);
    overflow: hidden;
  }
  .play {
    flex: none;
    /* Buttons don't inherit font-size; without this the button wouldn't scale with the card. */
    font: inherit;
    width: 3.6em;
    height: 3.6em;
    display: grid;
    place-items: center;
    padding: 0;
    border: none;
    border-radius: 50%;
    color: var(--on-accent);
    background: var(--accent);
    box-shadow: 0 0.15em 0.6em color-mix(in srgb, var(--accent) 35%, transparent);
    cursor: pointer;
    /* Hover brightens instead of growing: an animated scale gets a compositing layer (HANDOFF §8). */
    transition: background 140ms;
  }
  .play:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 82%, white);
  }
  .play:active:not(:disabled) {
    scale: 0.94;
  }
  /* A soft ring breathes out while playing. */
  .playing .play {
    animation: pulse 1.8s ease-out infinite;
  }
  @keyframes pulse {
    from {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent);
    }
    to {
      box-shadow: 0 0 0 0.7em transparent;
    }
  }
  :global(:root[data-calm]) .playing .play {
    animation: none;
  }
  .play:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .play :global(svg) {
    width: 1.5em;
    height: 1.5em;
  }
  .card:not(.playing) .play :global(svg) {
    margin-left: 0.15em;
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35em;
  }
  .meta {
    display: flex;
    align-items: baseline;
    gap: 0.5em;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .loop {
    align-self: center;
    display: grid;
    color: var(--accent);
  }
  .loop :global(svg) {
    width: 0.9em;
    height: 0.9em;
  }
  .time {
    flex: none;
    font-size: 0.8em;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .volume {
    flex: none;
    align-self: center;
    display: flex;
    align-items: center;
  }
  .volume button {
    /* Buttons don't inherit font-size; everything here is in em. */
    font: inherit;
    display: grid;
    place-items: center;
    padding: 0.1em;
    border: none;
    border-radius: calc(0.3em * var(--round));
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }
  .volume button:hover {
    color: var(--text);
    background: var(--panel-hover);
  }
  .volume :global(svg) {
    width: 1em;
    height: 1em;
  }
  .volume input {
    width: 0;
    margin: 0;
    accent-color: var(--accent);
    cursor: pointer;
    /* Opens by width (layout), not by scale or opacity (compositing, HANDOFF §8). */
    transition:
      width 140ms ease-out,
      margin 140ms ease-out;
  }
  .volume:hover input,
  .volume:focus-within input {
    width: 4.5em;
    margin: 0 0.2em;
  }
  .wave {
    height: 2.4em;
    cursor: pointer;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .bars {
    fill: var(--text-muted);
    opacity: 0.4;
  }
  .bars.hovered {
    fill: var(--accent);
    opacity: 0.35;
  }
  .bars.played {
    fill: var(--accent);
    opacity: 1;
  }
  .flat {
    position: relative;
    top: calc(50% - 0.1em);
    height: 0.2em;
    border-radius: calc(0.1em * var(--round));
    background: color-mix(in srgb, var(--text-muted) 45%, transparent);
  }
  .flat-played {
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
  }

  /* "Find…" on a missing file: runs Find missing files (buttons don't inherit font-size). */
  .find {
    font: inherit;
    font-size: 0.8em;
    margin-top: 0.3em;
    padding: 0.25em 0.9em;
    border: none;
    border-radius: calc(0.4em * var(--round));
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
    cursor: pointer;
  }
  .find:hover {
    filter: brightness(1.08);
  }
  .time .find {
    font-size: 1em;
    margin: 0 0 0 0.4em;
    padding: 0.05em 0.6em;
  }
</style>
