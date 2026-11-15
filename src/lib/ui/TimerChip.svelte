<script lang="ts">
  import { Timer } from "@lucide/svelte";
  import { selectOnly } from "../app.svelte";
  import { flyToNode } from "../outline/outline.svelte";
  import { formatTime } from "../timer/model";
  import { soonestTimer } from "../timer/timers.svelte";
  import { tip } from "./tips.svelte";

  /** While a timer runs, the status bar shows the soonest countdown (or a stopwatch): click to go there. */
  const t = $derived(soonestTimer());
  const name = $derived(t ? t.d.label.trim() || (t.d.mode === "stopwatch" ? "Stopwatch" : "Timer") : "");
</script>

{#if t}
  <button class="chip" {@attach tip(`${name}: show it`)} onclick={() => (selectOnly([t.node.id]), flyToNode(t.node.id))}>
    <Timer size={14} strokeWidth={1.9} />
    <span>{formatTime(t.ms, { up: t.d.mode === "countdown" })}</span>
  </button>
{/if}

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--accent) !important;
    font-variant-numeric: tabular-nums;
  }
</style>
