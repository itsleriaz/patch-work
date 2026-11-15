<script lang="ts">
  import { History, X } from "@lucide/svelte";
  import { fly } from "svelte/transition";
  import { recoveryUi } from "../recovery.svelte";
  import { settings } from "../settings.svelte";
  import { tip } from "./tips.svelte";
  import RecoveryReview from "./RecoveryReview.svelte";

  /**
   * Recovery copies found at startup (boards whose unsaved changes were left behind by a crash or
   * a forced quit), offered as one quiet line however many there are: Review opens a window to
   * look through them (RecoveryReview); × puts the line away for now and keeps the copies for the
   * next start.
   */

  const offers = $derived(recoveryUi.offers);
  const label = $derived(
    offers.length === 1 ? `Unsaved changes to “${offers[0].path ? offers[0].name : "Untitled board"}” from last time` : `${offers.length} unsaved boards from last time`,
  );
  const enter = (node: Element) => fly(node, { y: 10, duration: settings.calm ? 0 : 220 });
</script>

{#if offers.length && !recoveryUi.later && !recoveryUi.reviewing}
  <div class="recovery-pill" role="status" transition:enter>
    <History size={14} strokeWidth={1.9} />
    <span class="label">{label}</span>
    <button class="review" onclick={() => (recoveryUi.reviewing = true)}>Review…</button>
    <button class="close" aria-label="Later" {@attach tip({ text: "Later", detail: "Keeps them for the next start" })} onclick={() => (recoveryUi.later = true)}><X size={13} /></button>
  </div>
{/if}

{#if recoveryUi.reviewing && offers.length}<RecoveryReview />{/if}

<style>
  .recovery-pill {
    position: absolute;
    left: 50%;
    /* Above the toasts' spot, which it would otherwise share. */
    bottom: 60px;
    translate: -50% 0;
    z-index: 96;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: max(260px, calc(100vw - 2 * 280px));
    box-sizing: border-box;
    padding: 4px 4px 4px 12px;
    border-radius: 999px;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    backdrop-filter: blur(12px);
    box-shadow: 0 6px 24px var(--panel-shadow);
    color: var(--text-muted);
    font-size: 12.5px;
  }
  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }
  button {
    all: unset;
    flex: none;
    box-sizing: border-box;
    cursor: pointer;
    border-radius: 999px;
  }
  .review {
    padding: 3px 11px;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }
  .review:hover {
    background: color-mix(in srgb, var(--accent) 85%, var(--text));
  }
  .close {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    color: var(--text-muted);
  }
  .close:hover {
    background: var(--panel-hover);
    color: var(--text);
  }
</style>
