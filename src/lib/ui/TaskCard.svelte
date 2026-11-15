<script lang="ts">
  import { fly } from "svelte/transition";
  import { ui } from "../app.svelte";
  import { settings } from "../settings.svelte";

  /** Something long running (`ui.task`): what it is, how it's going, a Stop button. */

  const task = $derived(ui.task);
  const enter = (node: Element) => fly(node, { y: 10, duration: settings.calm ? 0 : 200 });
</script>

{#if task}
  <div class="task" role="status" transition:enter>
    <div class="text">
      <strong>{task.title}</strong>
      <span class="detail">{task.detail}</span>
      <!-- Long paths are cut at the start, so the end (the folder itself) stays readable. -->
      {#if task.folder}<span class="folder" dir="rtl"><bdi>{task.folder}</bdi></span>{/if}
    </div>
    {#if task.stop}<button onclick={task.stop}>Stop</button>{/if}
    <div class="bar"><span></span></div>
  </div>
{/if}

<style>
  .task {
    position: absolute;
    left: 50%;
    bottom: 64px;
    translate: -50% 0;
    z-index: 95;
    width: min(380px, calc(100vw - 32px));
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px 14px 14px;
    overflow: hidden;
    border-radius: calc(10px * var(--round));
    background: var(--panel-solid);
    border: 1px solid var(--panel-border);
    box-shadow: 0 8px 28px var(--panel-shadow);
    color: var(--text);
    font-size: 13px;
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  strong {
    font-weight: 600;
  }
  .detail {
    color: var(--text-muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .folder {
    color: var(--text-muted);
    font-size: 11px;
    opacity: 0.8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }
  button {
    all: unset;
    flex: none;
    padding: 5px 12px;
    border-radius: calc(7px * var(--round));
    background: var(--control-bg);
    border: 1px solid var(--panel-border);
    cursor: pointer;
  }
  button:hover {
    background: var(--danger);
    border-color: var(--danger);
    color: var(--on-accent);
  }
  /* A sliding strip along the bottom: busy, with no end to promise. */
  .bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: var(--accent-wash);
    overflow: hidden;
  }
  .bar span {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 30%;
    background: var(--accent);
    animation: slide 1.2s ease-in-out infinite;
  }
  @keyframes slide {
    from {
      left: -30%;
    }
    to {
      left: 100%;
    }
  }
  :global(:root[data-calm]) .bar span {
    animation-duration: 2.4s;
  }
</style>
