<script lang="ts">
  import { History, X } from "@lucide/svelte";
  import { SvelteMap } from "svelte/reactivity";
  import { scale } from "svelte/transition";
  import type { RecoveryMeta } from "../backend/types";
  import FramePreview from "../canvas/FramePreview.svelte";
  import type { Asset, CanvasNode, ProjectDoc } from "../doc/types";
  import { frameData } from "../frame/model";
  import { play } from "../juice/sound";
  import { discardAllRecoveries, discardRecovery, readRecoveryPreview, recoveryUi, restoreRecovery } from "../recovery.svelte";

  /**
   * The recovery copies, side by side with a preview: the list on the left (newest first), the
   * chosen copy's board drawn small on the right (pictures as thumbnails, cards as shapes, like a
   * collapsed frame's preview), with what it is and where it came from. ↑/↓ step through them,
   * Enter restores, Delete discards, Esc goes back to the pill. Discard all asks for a second click.
   */

  const offers = $derived(recoveryUi.offers);
  let chosen = $state<string | null>(null);
  const current = $derived(offers.find((m) => m.key === chosen) ?? offers[0]);

  /** Each copy's board once read (small JSON), or "failed". */
  const boards = new SvelteMap<string, { doc: ProjectDoc; assets: Map<string, Asset> } | "failed">();
  $effect(() => {
    for (const m of offers) {
      if (boards.has(m.key)) continue;
      readRecoveryPreview(m).then(
        (doc) => boards.set(m.key, { doc, assets: new Map(doc.assets.map((a) => [a.id, a])) }),
        () => boards.set(m.key, "failed"),
      );
    }
  });

  /** What the board shows: everything but the members of collapsed frames. */
  function shown(doc: ProjectDoc): CanvasNode[] {
    const hidden = new Set(doc.nodes.filter((n) => n.kind === "frame" && frameData(n.data).collapsed).flatMap((f) => frameData(f.data).members));
    return doc.nodes.filter((n) => !hidden.has(n.id));
  }

  const board = $derived(current ? boards.get(current.key) : undefined);
  const nodes = $derived(board && board !== "failed" ? shown(board.doc) : []);

  function when(time: number) {
    const d = new Date(time), now = new Date();
    const at = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return `today at ${at}`;
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return `yesterday at ${at}`;
    return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} at ${at}`;
  }
  const nameOf = (m: RecoveryMeta) => (m.path ? m.name : "Untitled board");
  const countOf = (m: RecoveryMeta) => {
    const b = boards.get(m.key);
    if (!b) return "";
    if (b === "failed") return "can't be read";
    const n = b.doc.nodes.length;
    return n === 1 ? "1 item" : `${n} items`;
  };

  function step(by: number) {
    if (!offers.length || !current) return;
    const i = offers.findIndex((m) => m.key === current.key);
    const next = offers[(i + by + offers.length) % offers.length];
    if (next.key !== current.key) play("tap", { volume: 0.35, pitch: by > 0 ? 1.05 : 0.95 });
    chosen = next.key;
  }

  /** Discard all takes a second click. */
  let confirmAll = $state(false);
  function discardAll() {
    if (!confirmAll) return void (confirmAll = true);
    discardAllRecoveries();
  }

  const close = () => (recoveryUi.reviewing = false);

  /** Discards a copy and moves on to the one after it (or before, at the end). */
  function discard(m: RecoveryMeta) {
    const i = offers.findIndex((o) => o.key === m.key);
    discardRecovery(m);
    chosen = offers[Math.min(i, offers.length - 1)]?.key ?? null;
  }

  let panel = $state<HTMLElement>();
</script>

<svelte:window
  onpointerdown={(e) => !panel?.contains(e.target as Node) && close()}
  onkeydowncapture={(e) => {
    // The window has the keys while it's open: none reach the board behind it.
    const keys: Record<string, () => void> = {
      ArrowDown: () => step(1),
      ArrowUp: () => step(-1),
      Escape: close,
      Enter: () => current && void restoreRecovery(current),
      Delete: () => current && discard(current),
      Backspace: () => current && discard(current),
    };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    run();
  }}
/>

<div class="panel" role="dialog" tabindex="-1" aria-label="Unsaved changes from last time" bind:this={panel} transition:scale={{ duration: 150, start: 0.96 }}>
  <header>
    <History size={15} strokeWidth={1.9} />
    <h2>Unsaved changes from last time</h2>
    <button class="icon" aria-label="Close" onclick={close}><X size={15} /></button>
  </header>

  <div class="body">
    <ul class="list" role="listbox" aria-label="Recovery copies">
      {#each offers as m (m.key)}
        <li>
          <button role="option" aria-selected={m.key === current?.key} class:on={m.key === current?.key} onclick={() => (chosen = m.key)}>
            <span class="name">{nameOf(m)}</span>
            <span class="detail">{[when(m.time), countOf(m)].filter(Boolean).join(" · ")}</span>
          </button>
        </li>
      {/each}
    </ul>

    {#if current}
      <div class="detail-pane">
        <div class="preview">
          {#if board === "failed"}
            <p class="note">This copy can't be read.</p>
          {:else if !board}
            <p class="note">Loading…</p>
          {:else if !nodes.length}
            <p class="note">An empty board.</p>
          {:else}
            <FramePreview members={nodes} labels assetOf={(n) => (n.assetId ? (board as { assets: Map<string, Asset> }).assets.get(n.assetId) : undefined)} />
          {/if}
        </div>
        <div class="facts">
          <strong>{nameOf(current)}</strong>
          <span>{current.path ?? "Never saved to a file"}</span>
          <span>{[`Changed ${when(current.time)}`, countOf(current)].filter(Boolean).join(" · ")}</span>
        </div>
        <div class="actions">
          <button onclick={() => discard(current)}>Discard</button>
          <button class="primary" onclick={() => void restoreRecovery(current)}>Restore</button>
        </div>
      </div>
    {/if}
  </div>

  <footer>
    {#if offers.length > 1}
      <button class:danger={confirmAll} onclick={discardAll} onpointerleave={() => (confirmAll = false)}>{confirmAll ? `Discard all ${offers.length}?` : "Discard all"}</button>
    {/if}
    <span class="hint">↑ ↓ to switch · Enter to restore</span>
    <button onclick={close}>Later</button>
  </footer>
</div>

<style>
  .panel {
    position: absolute;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    z-index: 97;
    width: min(720px, calc(100vw - 48px));
    height: min(460px, calc(100vh - 96px));
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    padding: 12px 14px 12px;
    gap: 10px;
    border-radius: calc(14px * var(--round));
    background: var(--panel-solid);
    border: 1px solid var(--panel-border);
    box-shadow: 0 18px 60px var(--panel-shadow);
    color: var(--text);
    font-size: 13px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-muted);
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 12px;
  }
  .list {
    flex: none;
    width: 220px;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-y: auto;
  }
  .list button {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 7px 10px;
    border-radius: calc(8px * var(--round));
  }
  .list button.on {
    background: var(--accent-wash);
  }
  .list button.on .name {
    color: var(--accent);
  }
  .name,
  .detail {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name {
    font-weight: 600;
  }
  .detail {
    font-size: 11.5px;
    color: var(--text-muted);
  }
  .detail-pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .preview {
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
    padding: 12px;
    box-sizing: border-box;
    border-radius: calc(10px * var(--round));
    background: var(--canvas-bg);
    border: 1px solid var(--panel-border);
    overflow: hidden;
  }
  .preview > :global(svg) {
    max-height: 100%;
  }
  .note {
    margin: 0;
    color: var(--text-muted);
  }
  .facts {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .facts span {
    font-size: 12px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .hint {
    flex: 1;
    text-align: right;
    font-size: 11.5px;
    color: var(--text-muted);
  }
  button {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    padding: 5px 12px;
    border-radius: calc(7px * var(--round));
    color: var(--text-muted);
  }
  button:hover {
    background: var(--panel-hover);
    color: var(--text);
  }
  .list button {
    color: var(--text);
  }
  button.primary {
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }
  button.primary:hover {
    background: color-mix(in srgb, var(--accent) 85%, var(--text));
  }
  button.danger {
    color: var(--danger);
  }
  button.icon {
    display: grid;
    place-items: center;
    padding: 4px;
  }
</style>
