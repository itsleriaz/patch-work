<script lang="ts">
  import { BellRing, Timer } from "@lucide/svelte";
  import { scale } from "svelte/transition";
  import { play } from "../juice/sound";
  import { formatTime, timerData } from "../timer/model";
  import { clearMissed, missedTimers, showMissed } from "../timer/timers.svelte";
  import { tip } from "./tips.svelte";

  /**
   * The navigator's bell: countdowns that finished while likely unwatched (the app not in front,
   * the timer off-screen, or the board closed), shown only while there are some. Its list says
   * how long ago each finished; clicking one goes there (and takes it off), Clear all empties it.
   */

  const missed = $derived(missedTimers());
  let open = $state(false);
  let host = $state<HTMLElement>();

  // "Finished 4 min ago" stays current while the list is open.
  let now = $state(Date.now());
  $effect(() => {
    if (!open) return;
    now = Date.now();
    const t = setInterval(() => (now = Date.now()), 15_000);
    return () => clearInterval(t);
  });
  // An emptied list closes.
  $effect(() => {
    if (!missed.length) open = false;
  });

  function ago(at: number) {
    const s = Math.max(0, Math.round((now - at) / 1000));
    if (s < 45) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h ${m % 60 ? `${m % 60} min ` : ""}ago`;
    return new Date(at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function toggle() {
    open = !open;
    play("tap", { pitch: open ? 1.15 : 0.9 });
  }

  function go(id: string) {
    open = false;
    showMissed(id);
  }
</script>

<svelte:window
  onpointerdown={(e) => open && !host?.contains(e.target as Node) && (open = false)}
  onkeydown={(e) => e.key === "Escape" && open && (open = false)}
/>

{#if missed.length}
  <div class="host" bind:this={host}>
    <button
      class="bell"
      class:on={open}
      aria-label="Missed timers"
      aria-expanded={open}
      {@attach tip({ text: missed.length === 1 ? `${missed[0].name} finished` : `${missed.length} timers finished`, detail: "While you weren't looking" })}
      onclick={toggle}
    >
      <BellRing size={14} strokeWidth={1.9} />
      <span>{missed.length}</span>
    </button>

    {#if open}
      <section class="popover" aria-label="Missed timers" transition:scale={{ duration: 140, start: 0.92 }}>
        <header>Finished while you weren't looking</header>
        {#each missed as m (m.node.id)}
          <button class="row" onclick={() => go(m.node.id)}>
            <Timer size={14} strokeWidth={1.8} />
            <span class="name">{m.name}</span>
            <span class="when">{formatTime(timerData(m.node.data).duration)} · {ago(m.at)}</span>
          </button>
        {/each}
        <button class="clear" onclick={() => (clearMissed(), play("vanish", { volume: 0.4 }))}>Clear all</button>
      </section>
    {/if}
  </div>
{/if}

<style>
  .host {
    position: relative;
    display: grid;
    padding: 0 !important;
  }
  button {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
  }
  /* The bell asks to be noticed: the accent, with its count. */
  .bell {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 7px;
    border-radius: calc(7px * var(--round));
    background: var(--accent-wash);
    color: var(--accent);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    transition: scale 100ms;
  }
  .bell:hover,
  .bell.on {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
  }
  .bell:active {
    scale: 0.92;
  }
  .popover {
    position: absolute;
    left: -4px;
    bottom: calc(100% + 10px);
    z-index: 5;
    width: 260px;
    padding: 6px;
    border-radius: calc(10px * var(--round));
    background: var(--panel-solid);
    border: 1px solid var(--panel-border);
    box-shadow: 0 10px 32px var(--panel-shadow);
    font-size: 13px;
    color: var(--text);
    transform-origin: bottom left;
  }
  header {
    padding: 2px 6px 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px;
    border-radius: calc(6px * var(--round));
    color: var(--accent);
  }
  .row:hover {
    background: var(--panel-hover);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }
  .when {
    flex: none;
    font-size: 11.5px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .clear {
    display: block;
    width: 100%;
    margin-top: 4px;
    padding: 5px 6px;
    border-top: 1px solid var(--panel-border);
    font-size: 12px;
    color: var(--text-muted);
    text-align: center;
  }
  .clear:hover {
    color: var(--text);
  }
</style>
