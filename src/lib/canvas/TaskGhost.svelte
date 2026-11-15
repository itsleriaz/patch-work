<script lang="ts">
  import { ListPlus } from "@lucide/svelte";
  import { checklistUi } from "../checklist/state.svelte";

  const drag = $derived(checklistUi.drag);
</script>

<!-- The task being dragged, following the pointer (screen space). -->
{#if drag}
  <div class="ghost" class:new={drag.target.kind === "canvas"} style:left="{drag.pointer.x + 14}px" style:top="{drag.pointer.y + 10}px">
    <span class="box"></span>
    <span class="text">{drag.text || "Task"}</span>
    {#if drag.extra}<span class="extra">+{drag.extra}</span>{/if}
    {#if drag.target.kind === "canvas"}<span class="hint"><ListPlus size={13} /> New checklist</span>{/if}
  </div>
{/if}

<style>
  .ghost {
    position: fixed;
    z-index: 50;
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 280px;
    padding: 6px 10px;
    border-radius: calc(8px * var(--round));
    background: var(--panel-solid);
    border: 1px solid var(--panel-border);
    box-shadow: 0 8px 24px var(--panel-shadow);
    color: var(--text);
    font-size: 13px;
    pointer-events: none;
    rotate: -2deg;
    animation: lift 140ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .box {
    flex: none;
    width: 12px;
    height: 12px;
    border-radius: calc(3px * var(--round));
    border: 1.5px solid var(--text-muted);
  }
  .text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .extra {
    flex: none;
    font-size: 11px;
    color: var(--text-muted);
  }
  .hint {
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: 4px;
    color: var(--accent);
    font-size: 12px;
  }
  @keyframes lift {
    from {
      scale: 0.9;
      opacity: 0;
    }
  }
  :global(:root[data-calm]) .ghost {
    rotate: none;
    animation: none;
  }
</style>
