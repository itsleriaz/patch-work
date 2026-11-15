<script lang="ts">
  import { relinkMissing } from "../storage.svelte";
  import { tip } from "../ui/tips.svelte";
  import { Film, Pause, Play, Repeat, Volume1, Volume2, VolumeX } from "@lucide/svelte";
  import { toggleLoop } from "../actions.svelte";
  import { camera, doc } from "../app.svelte";
  import { backend } from "../backend";
  import type { Asset, CanvasNode, MediaData } from "../doc/types";
  import { ensurePoster } from "../media/probe";
  import { acquireMediaUrl } from "../media/source";
  import { forget, formatTime, loops, muted, pausedFrames, playing, positions, togglePlaying, volumes } from "../media/playback.svelte";

  let { node, asset }: { node: CanvasNode; asset: Asset } = $props();

  const id = $derived(node.id);
  const flip = $derived((node.data ?? {}) as MediaData);
  const isPlaying = $derived(playing.has(id));
  const isMuted = $derived(muted.has(id));
  const volume = $derived(volumes.get(id) ?? 1);
  const loop = $derived(loops(node));

  // The poster is a plain image; a missing one (another machine, cleared cache) is captured again.
  let posterTry = $state(0);
  let posterFailed = $state(false);
  const posterUrl = $derived(backend.posterUrl(asset) + (posterTry ? `&try=${posterTry}` : ""));
  function onPosterError() {
    if (posterTry || asset.missing) return void (posterFailed = true);
    void ensurePoster(asset).then((ok) => (ok ? posterTry++ : (posterFailed = true)));
  }

  // A real <video> exists only while playing, or shortly after the pointer settles on the node
  // (so the controls can show time and seek). Idle videos cost no decoder.
  let warm = $state(false);
  let hovered = $state(false);
  let warmTimer: ReturnType<typeof setTimeout> | undefined;
  function enter() {
    hovered = true;
    warmTimer = setTimeout(() => (warm = true), 150);
  }
  function leave() {
    hovered = false;
    clearTimeout(warmTimer);
    warm = false;
    preview = null;
  }
  let scrubbing = $state(false);
  const live = $derived(!asset.missing && (isPlaying || warm || scrubbing));

  let video = $state<HTMLVideoElement>();
  let ready = $state(false);
  let failed = $state(false);
  // Starts where the node was left (its element may have unmounted since).
  const resumeAt = () => positions.get(id) ?? 0;
  let time = $state(resumeAt());
  let duration = $state(0);
  /** Previewing frames by moving the pointer across a paused video: where, as a fraction. */
  let preview = $state<number | null>(null);
  // The poster stays up until there's a frame worth replacing it with (not the first, often black).
  const showVideo = $derived(live && ready && (isPlaying || time > 0 || preview !== null));
  /** The frame it was paused at, kept for when the element is gone (see keepFrame). */
  const pausedFrame = $derived(!isPlaying && time > 0 ? pausedFrames.get(id) : undefined);

  // Where the element loads from (a blob for small files on Linux; see media/source.ts).
  let src = $state<string>();
  $effect(() => {
    if (!live) return;
    const media = acquireMediaUrl(asset);
    let cancelled = false;
    media.url.then(
      (url) => !cancelled && (src = url),
      () => !cancelled && (failed = true),
    );
    return () => {
      cancelled = true;
      media.release();
      src = undefined;
      ready = false;
    };
  });

  $effect(() => {
    if (!video || !ready) return;
    if (isPlaying) video.play().catch(() => playing.delete(id));
    else video.pause();
  });

  $effect(() => {
    if (video) video.volume = volume;
  });

  // Progress while playing, from the frames actually shown (requestVideoFrameCallback): WebKitGTK's
  // currentTime trails the picture by up to a second. Elsewhere, read it every animation frame.
  // Not before `ready`: a fresh element reads 0 and would overwrite the position to resume from.
  $effect(() => {
    const v = video;
    if (!v || !isPlaying || !ready) return;
    if (typeof v.requestVideoFrameCallback === "function") {
      let handle = v.requestVideoFrameCallback(function tick(_now, frame) {
        setTime(frame.mediaTime);
        handle = v.requestVideoFrameCallback(tick);
      });
      return () => v.cancelVideoFrameCallback(handle);
    }
    let frame = requestAnimationFrame(function tick() {
      setTime(v.currentTime);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  });

  // Unmounted because the node left the document (deleted, another board): stop for good.
  $effect(() => () => {
    if (!doc.nodes[id]) forget(id);
  });

  function setTime(t: number) {
    time = t;
    positions.set(id, t);
  }

  function onLoaded() {
    if (!video) return;
    duration = video.duration;
    const resume = resumeAt();
    if (resume > 0 && resume < duration) video.currentTime = resume;
    ready = true;
    failed = false;
  }

  function onEnded() {
    playing.delete(id);
    setTime(0);
    pausedFrames.delete(id);
  }

  function onPause() {
    if (video && ready) setTime(video.currentTime);
    keepFrame();
  }

  /**
   * Keeps the frame a paused video shows, as a small JPEG, so the node still shows it after the
   * element unmounts (the pointer left) instead of jumping back to the poster.
   */
  function keepFrame() {
    const v = video;
    if (!v || !v.videoWidth || isPlaying || preview !== null || seekBusy) return;
    if (v.currentTime === 0) return void pausedFrames.delete(id);
    const k = Math.min(1, 1280 / v.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(v.videoWidth * k);
    canvas.height = Math.round(v.videoHeight * k);
    try {
      canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
      pausedFrames.set(id, canvas.toDataURL("image/jpeg", 0.85));
    } catch {
      // A frame that can't be read (a tainted canvas): the poster it is.
    }
  }

  // Previewing seeks one at a time: a new position waits for the last seek to land.
  let seekBusy = false;
  let seekNext: number | null = null;
  function previewSeek(t: number) {
    if (!video) return;
    if (seekBusy) return void (seekNext = t);
    seekBusy = true;
    video.currentTime = t;
  }
  function onSeeked() {
    if (seekNext !== null) {
      const t = seekNext;
      seekNext = null;
      seekBusy = false;
      return previewSeek(t);
    }
    seekBusy = false;
    if (preview === null && !isPlaying) keepFrame();
  }

  /** Moving across a paused video's picture shows the frames along it (left: start, right: end). */
  function scrubPicture(e: PointerEvent) {
    if (isPlaying || scrubbing || !ready || !video || !duration) return;
    const target = e.target as HTMLElement;
    if (target.closest(".bar")) return endPreview();
    if (!(target instanceof HTMLImageElement || target instanceof HTMLVideoElement)) return;
    // In the picture's own frame (rotation-proof); a flipped picture still runs left to right.
    let f = Math.min(1, Math.max(0, e.offsetX / target.offsetWidth));
    if (flip.flipX) f = 1 - f;
    preview = f;
    previewSeek(f * duration);
  }

  /** Back to where it was paused. */
  function endPreview() {
    if (preview === null) return;
    preview = null;
    previewSeek(time);
  }

  // The track is in the node's own (possibly rotated) frame, so offsetX is the right measure.
  function seekTo(e: PointerEvent) {
    const track = e.currentTarget as HTMLElement;
    if (!duration) return;
    const t = Math.min(1, Math.max(0, e.offsetX / track.offsetWidth)) * duration;
    setTime(t);
    if (video) previewSeek(t);
  }

  function setVolume(v: number) {
    volumes.set(id, v);
    if (v > 0) muted.delete(id);
    else muted.add(id);
  }

  /** Where the pointer is over the track, as a fraction, for the time preview. */
  let hoverAt = $state<number | null>(null);
  function trackHover(e: PointerEvent) {
    const track = e.currentTarget as HTMLElement;
    hoverAt = Math.min(1, Math.max(0, e.offsetX / track.offsetWidth));
    if (scrubbing) seekTo(e);
  }

  function startSeek(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    preview = null;
    scrubbing = true;
    seekTo(e);
  }

  // Controls keep a constant screen size, and shed parts as the node gets small on screen.
  const screenWidth = $derived(node.w * camera.zoom);
  const showBar = $derived(screenWidth >= 140);
  const showTime = $derived(screenWidth >= 260);
  const showControls = $derived(!asset.missing && !failed && (hovered || scrubbing));
</script>

<div class="video" role="presentation" onpointerenter={enter} onpointerleave={leave} onpointermove={scrubPicture}>
  <div class="visual" style:transform="scale({flip.flipX ? -1 : 1}, {flip.flipY ? -1 : 1})">
    {#if asset.missing}
      <div class="placeholder missing"><span>Missing file</span><small>{asset.name}</small><button class="find" onpointerdown={(e) => e.stopPropagation()} ondblclick={(e) => e.stopPropagation()} onclick={() => void relinkMissing()}>Find…</button></div>
    {:else if posterFailed}
      <div class="placeholder"><Film size={28} strokeWidth={1.5} /><small>{asset.name}</small></div>
    {:else}
      <img src={posterUrl} alt={asset.name} draggable="false" onerror={onPosterError} />
    {/if}
    {#if pausedFrame && !asset.missing}<img class="paused" src={pausedFrame} alt="" draggable="false" />{/if}
    {#if live && src}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={video}
        class:shown={showVideo}
        {src}
        preload="auto"
        playsinline
        crossorigin="anonymous"
        muted={isMuted}
        {loop}
        onloadeddata={onLoaded}
        onpause={onPause}
        onseeked={onSeeked}
        onended={onEnded}
        onerror={() => {
          failed = true;
          playing.delete(id);
        }}
      ></video>
    {/if}
  </div>

  {#if preview !== null && duration}
    <div class="scrub-time">{formatTime(preview * duration)}</div>
  {/if}
  {#if isPlaying && !showControls && showBar && duration}
    <!-- Where it is while it plays, with the controls hidden. -->
    <div class="progress"><div style:width="{(time / duration) * 100}%"></div></div>
  {/if}

  {#if failed}
    <div class="badge">Can't play this video here</div>
  {:else if !asset.missing && !posterFailed && !showControls && !isPlaying && showBar}
    <div class="kind" aria-hidden="true"><Play size={12} fill="currentColor" /></div>
  {/if}

  {#if showControls}
    <!-- Controls handle their own pointer events, so clicks don't select or drag the node. -->
    <div class="controls" role="presentation" onpointerdown={(e) => e.stopPropagation()} ondblclick={(e) => e.stopPropagation()}>
      {#if !isPlaying && !scrubbing}
        <button class="big-play" aria-label="Play" onclick={() => togglePlaying(id)}><Play size={22} fill="currentColor" /></button>
      {/if}
      {#if showBar}
        <div class="bar">
          <button aria-label={isPlaying ? "Pause" : "Play"} onclick={() => togglePlaying(id)}>
            {#if isPlaying}<Pause size={15} fill="currentColor" />{:else}<Play size={15} fill="currentColor" />{/if}
          </button>
          <div
            class="track"
            role="slider"
            tabindex="-1"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={time}
            onpointerdown={startSeek}
            onpointermove={trackHover}
            onpointerleave={() => (hoverAt = null)}
            onpointerup={() => (scrubbing = false)}
            onpointercancel={() => (scrubbing = false)}
          >
            <div class="rail">
              {#if (preview ?? hoverAt) !== null && !scrubbing}<div class="preview" style:width="{(preview ?? hoverAt ?? 0) * 100}%"></div>{/if}
              <div class="fill" style:width="{duration ? (time / duration) * 100 : 0}%"></div>
            </div>
            <div class="knob" style:left="{duration ? (time / duration) * 100 : 0}%"></div>
            {#if hoverAt !== null && duration}
              <div class="tip" style:left="{hoverAt * 100}%">{formatTime(hoverAt * duration)}</div>
            {/if}
          </div>
          {#if showTime}<span class="time">{formatTime(time)} / {formatTime(duration)}</span>{/if}
          <button class:on={loop} aria-label="Loop" {@attach tip("Loop")} onclick={() => toggleLoop([node])}><Repeat size={15} /></button>
          <!-- The volume slider opens while the pointer is over the speaker. -->
          <div class="volume">
            <button aria-label={isMuted ? "Unmute" : "Mute"} onclick={() => (isMuted ? setVolume(volume || 1) : muted.add(id))}>
              {#if isMuted || volume === 0}<VolumeX size={15} />{:else if volume < 0.5}<Volume1 size={15} />{:else}<Volume2 size={15} />{/if}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              aria-label="Volume"
              value={isMuted ? 0 : volume}
              oninput={(e) => setVolume(Number((e.target as HTMLInputElement).value))}
            />
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .video,
  .visual {
    position: relative;
    width: 100%;
    height: 100%;
  }
  .visual {
    background: #000;
  }
  img,
  video {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  video {
    opacity: 0;
  }
  video.shown {
    opacity: 1;
  }
  img.paused {
    pointer-events: none;
  }
  .placeholder {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5em;
    padding: 1em;
    color: var(--text-muted);
    background: var(--node-placeholder);
    text-align: center;
    overflow: hidden;
  }
  .placeholder small {
    font-size: 0.75em;
    word-break: break-all;
  }
  .missing {
    background: repeating-linear-gradient(45deg, var(--node-placeholder) 0 12px, transparent 12px 24px);
    border: 1px dashed var(--text-muted);
  }
  .badge {
    position: absolute;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    font-size: calc(12px * var(--inv-zoom));
    padding: 0.4em 0.8em;
    border-radius: calc(0.5em * var(--round));
    color: #fff;
    background: rgb(0 0 0 / 0.7);
    white-space: nowrap;
  }
  /* Sized in screen pixels: --inv-zoom undoes the camera's scale. */
  .controls {
    position: absolute;
    inset: 0;
    font-size: calc(12px * var(--inv-zoom));
    color: #fff;
    pointer-events: none;
  }
  .controls button,
  .track {
    pointer-events: auto;
  }
  button {
    display: grid;
    place-items: center;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    cursor: pointer;
    /* Buttons don't inherit font-size, and every size here is in em of the screen-px font. */
    font: inherit;
  }
  button :global(svg) {
    width: 1.25em;
    height: 1.25em;
  }
  .big-play {
    position: absolute;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    width: 4.6em;
    height: 4.6em;
    border-radius: 50%;
    /* No backdrop-filter: it would make the whole camera layer a GPU layer (HANDOFF §8). */
    background: rgb(20 20 24 / 0.62);
    border: 1px solid rgb(255 255 255 / 0.18);
    box-shadow: 0 0.3em 1.2em rgb(0 0 0 / 0.3);
    /* No fade or grow on hover: animated opacity and scale get compositing layers (HANDOFF §8). */
    transition: background 140ms;
  }
  .big-play :global(svg) {
    width: 1.9em;
    height: 1.9em;
    margin-left: 0.2em;
  }
  .big-play:hover {
    background: rgb(20 20 24 / 0.7);
  }
  /* A quiet corner mark on idle videos, so they read as videos rather than images. */
  .kind {
    position: absolute;
    right: 0.6em;
    bottom: 0.6em;
    font-size: calc(12px * var(--inv-zoom));
    width: 2em;
    height: 2em;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: #fff;
    background: rgb(20 20 24 / 0.55);
    pointer-events: none;
  }
  .kind :global(svg) {
    width: 1em;
    height: 1em;
    margin-left: 0.1em;
  }
  /* A floating pill, dark enough to read over bright footage. */
  .bar {
    position: absolute;
    left: 0.6em;
    right: 0.6em;
    bottom: 0.6em;
    display: flex;
    align-items: center;
    gap: 0.5em;
    height: 2.6em;
    padding: 0 0.5em;
    border-radius: calc(0.9em * var(--round));
    background: rgb(20 20 24 / 0.72);
    border: 1px solid rgb(255 255 255 / 0.1);
    box-shadow: 0 0.3em 1.2em rgb(0 0 0 / 0.25);
    pointer-events: auto;
  }
  .bar button {
    flex: none;
    width: 1.9em;
    height: 1.9em;
    border-radius: calc(0.5em * var(--round));
    /* Hover changes color, not opacity (an opacity transition gets a compositing layer). */
    color: rgb(255 255 255 / 0.85);
    transition:
      color 100ms,
      background 100ms;
  }
  .bar button:hover {
    color: #fff;
    background: rgb(255 255 255 / 0.14);
  }
  .bar button.on {
    color: var(--accent-base);
  }
  .track {
    position: relative;
    flex: 1;
    height: 1.9em;
    display: flex;
    align-items: center;
    margin: 0 0.3em;
    cursor: pointer;
  }
  .rail {
    position: relative;
    width: 100%;
    height: 0.3em;
    border-radius: calc(0.15em * var(--round));
    background: rgb(255 255 255 / 0.25);
    overflow: hidden;
    pointer-events: none;
    transition: height 120ms ease-out;
  }
  .track:hover .rail {
    height: 0.45em;
  }
  .fill,
  .preview {
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
  }
  .fill {
    background: var(--accent-base);
  }
  .preview {
    background: rgb(255 255 255 / 0.3);
  }
  .knob {
    position: absolute;
    top: 50%;
    border-radius: 50%;
    background: #fff;
    pointer-events: none;
    /* Grows by size, not scale: an animated scale gets a compositing layer. */
    width: 0;
    height: 0;
    margin: 0;
    transition:
      width 120ms ease-out,
      height 120ms ease-out,
      margin 120ms ease-out;
  }
  .track:hover .knob {
    box-shadow: 0 0 0 0.2em color-mix(in srgb, var(--accent-base) 55%, transparent);
    width: 0.9em;
    height: 0.9em;
    margin: -0.45em 0 0 -0.45em;
  }
  .tip {
    position: absolute;
    bottom: 2.2em;
    translate: -50% 0;
    padding: 0.2em 0.5em;
    border-radius: calc(0.4em * var(--round));
    background: rgb(20 20 24 / 0.8);
    font-size: 0.9em;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    pointer-events: none;
  }
  .volume {
    flex: none;
    display: flex;
    align-items: center;
  }
  .volume input {
    width: 0;
    margin: 0;
    accent-color: var(--accent-base);
    cursor: pointer;
    /* Opens by width (layout), not by scale or opacity (compositing). */
    transition:
      width 140ms ease-out,
      margin 140ms ease-out;
  }
  .volume:hover input,
  .volume:focus-within input {
    width: 4.5em;
    margin: 0 0.3em 0 0.2em;
  }
  /* While playing with the controls hidden: a thin line of progress along the bottom. */
  .progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: calc(3px * var(--inv-zoom));
    background: rgb(255 255 255 / 0.2);
    pointer-events: none;
  }
  .progress div {
    height: 100%;
    background: var(--accent-base);
  }
  /* The time a preview is showing, while moving across a paused video. */
  .scrub-time {
    position: absolute;
    left: 50%;
    top: 0.6em;
    translate: -50% 0;
    font-size: calc(12px * var(--inv-zoom));
    padding: 0.2em 0.6em;
    border-radius: calc(0.5em * var(--round));
    color: #fff;
    background: rgb(20 20 24 / 0.72);
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  .time {
    flex: none;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    opacity: 0.9;
    padding-right: 0.2em;
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
</style>
