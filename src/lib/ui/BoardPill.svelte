<script lang="ts">
  import { tip } from "./tips.svelte";
  import { ChevronDown, TriangleAlert } from "@lucide/svelte";
  import { camera, doc, history, project, ui } from "../app.svelte";

  let el: HTMLButtonElement;
  let width = $state(0);
  // The toolbar keeps clear of the pill (Toolbar.svelte's `--pill-width`).
  $effect(() => document.documentElement.style.setProperty("--pill-width", `${width}px`));

  const open = $derived(ui.menu?.target === "board");
  const missing = $derived(doc.usedAssets().filter((a) => a.missing).length);

  // Handled on pointerdown, before the menu's own outside-click handler would close and reopen it.
  function toggle(e: PointerEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (open) return void (ui.menu = null);
    const r = el.getBoundingClientRect();
    ui.menu = { x: r.left, y: r.bottom + 6, world: camera.toWorld(camera.width / 2, camera.height / 2), target: "board" };
  }
</script>

<button
  class="pill"
  class:open
  bind:this={el}
  bind:offsetWidth={width}
  {@attach tip(project.path ?? "Not saved yet")}
  aria-haspopup="menu"
  aria-expanded={open}
  onpointerdown={toggle}
>
  <span class="name">{project.name}</span>
  {#if history.dirty}<span class="dirty" {@attach tip("Unsaved changes")}></span>{/if}
  {#if missing}
    <span class="missing" {@attach tip({ text: `${missing} file${missing === 1 ? "" : "s"} missing`, detail: "Find missing files… is in this menu" })}>
      <TriangleAlert size={13} strokeWidth={2.2} />{missing}
    </span>
  {/if}
  <ChevronDown size={14} strokeWidth={2} />
</button>

<style>
  .pill {
    all: unset;
    position: absolute;
    top: 12px;
    left: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 260px;
    height: 30px;
    padding: 0 8px 0 12px;
    box-sizing: border-box;
    border-radius: calc(10px * var(--round));
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    backdrop-filter: blur(12px);
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
    cursor: pointer;
    user-select: none;
    transition: background 100ms;
  }
  .pill:hover,
  .pill.open {
    background: var(--panel-solid);
  }
  .pill :global(svg) {
    flex-shrink: 0;
    color: var(--text-muted);
    transition: rotate 160ms;
  }
  .pill.open :global(svg) {
    rotate: 180deg;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dirty {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }
  .missing {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 6px 1px 5px;
    border-radius: calc(8px * var(--round));
    background: color-mix(in srgb, var(--danger) 16%, transparent);
    color: var(--danger);
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
</style>
