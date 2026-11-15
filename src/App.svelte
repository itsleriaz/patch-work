<script lang="ts">
    import { handleShortcut } from "./lib/actions.svelte";
  import { confirmDiscard, doc, history, openPath, project, ui } from "./lib/app.svelte";
  import { backend } from "./lib/backend";
  import Canvas from "./lib/canvas/Canvas.svelte";
  import type { Interaction } from "./lib/canvas/interaction.svelte";
  import { onPaste } from "./lib/clipboard.svelte";
  import { isEditable } from "./lib/dom";
  import { initSound } from "./lib/juice/sound";
  import { settings } from "./lib/settings.svelte";
  import BoardPill from "./lib/ui/BoardPill.svelte";
  import ContextMenu from "./lib/ui/ContextMenu.svelte";
  import PerfOverlay from "./lib/ui/PerfOverlay.svelte";
  import { tickWhileRunning } from "./lib/timer/timers.svelte";
  import { preloadEditor } from "./lib/text/load-editor";
  import SettingsPanel from "./lib/ui/SettingsPanel.svelte";
  import ExportDialog from "./lib/ui/ExportDialog.svelte";
  import LinkBar from "./lib/ui/LinkBar.svelte";
  import { fmt } from "./lib/text/format.svelte";
  import { exportUi } from "./lib/export/export.svelte";
  import ShortcutsPanel from "./lib/ui/ShortcutsPanel.svelte";
  import SidePanel from "./lib/ui/SidePanel.svelte";
  import TableMenus from "./lib/ui/TableMenus.svelte";
  import SearchBar from "./lib/ui/SearchBar.svelte";
  import DrawBar from "./lib/ui/DrawBar.svelte";
  import MapBar from "./lib/ui/MapBar.svelte";
  import { mapUi } from "./lib/map/map.svelte";
  import { drawUi } from "./lib/drawing/draw.svelte";
  import { searchUi } from "./lib/search/search.svelte";
  import { handleTableKey, tapSpace } from "./lib/table/table.svelte";
  import DatePicker from "./lib/ui/DatePicker.svelte";
  import ColorPicker from "./lib/ui/ColorPicker.svelte";
  import Toolbar from "./lib/ui/Toolbar.svelte";
  import Tooltip from "./lib/ui/Tooltip.svelte";
  import CreateRail from "./lib/ui/CreateRail.svelte";
  import Navigator from "./lib/ui/Navigator.svelte";
  import TaskCard from "./lib/ui/TaskCard.svelte";
  import RecoveryCard from "./lib/ui/RecoveryCard.svelte";
  import { initRecovery } from "./lib/recovery.svelte";
  import { cleanBlobStore } from "./lib/storage.svelte";

  let interaction = $state<Interaction>();

  $effect(() => {
    backend.setTitle(`${history.dirty ? "• " : ""}${project.name} — Patchwork`);
  });

  backend.onCloseRequested(confirmDiscard);
  // Text cards' editor, ready before the first edit.
  setTimeout(() => void preloadEditor(), 1500);
  // A board opened with timers running: keep their clock going (and finish what ran out meanwhile).
  $effect(() => tickWhileRunning());
  // A watched file changed on disk (a sprite saved in Aseprite): its new hash refreshes every
  // node showing it. Not a change to the board, so no undo step.
  backend.onAssetChanged((a) => {
    const known = doc.assets[a.id];
    if (known) Object.assign(known, { hash: a.hash, size: a.size, mtime: a.mtime, width: a.width, height: a.height, missing: false });
  });
  // Recovery copies of unsaved changes, autosave, and copies left by an earlier crash.
  initRecovery();
  backend.onOpenFile((path) => void openPath(path));
  // Unused embedded files are cleaned up quietly, once things have settled after startup.
  setTimeout(() => void cleanBlobStore(), 20_000);
  initSound();

  function onKeydown(e: KeyboardEvent) {
    if (isEditable(e.target)) return;
    // Space on a focused button presses it; elsewhere it's the pan modifier.
    if (e.code === "Space" && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      if (!e.repeat) spaceDragged = false;
      if (interaction) interaction.spaceHeld = true;
      return;
    }
    if (ui.menu) {
      if (e.key === "Escape") ui.menu = null;
      return; // the menu handles its own keys
    }
    if ((ui.settingsOpen || ui.shortcutsOpen || ui.pinsOpen) && e.key === "Escape") return; // the panel closes itself
    // Inside panels, popovers and menus Tab moves the focus as usual; elsewhere (a clicked toolbar
    // button keeps the focus) it toggles the clean view. Not `:focus-visible`: Chromium turns that
    // on for the focused button the moment any key is pressed.
    if (e.key === "Tab" && e.target instanceof Element && e.target.closest("section, aside, [role=dialog], [role=menu], [role=search], .popover")) return;
    // A selected table cell takes its keys first (arrows, Tab, Enter, typing…).
    if (handleTableKey(e)) return;
    handleShortcut(e);
  }

  // Space is the pan key while held; a tap (no drag meanwhile) cycles a selected status cell.
  let spaceDragged = false;

  function onKeyup(e: KeyboardEvent) {
    if (e.code !== "Space") return;
    releaseSpace();
    if (!spaceDragged && !isEditable(e.target)) tapSpace(e.shiftKey);
  }

  function releaseSpace() {
    if (interaction) interaction.spaceHeld = false;
  }

</script>

<svelte:window onkeydown={onKeydown} onkeyup={onKeyup} onpointerdowncapture={() => interaction?.spaceHeld && (spaceDragged = true)} onblur={releaseSpace} onpaste={onPaste} />

<main class:clean={ui.chromeHidden}>
  <Canvas bind:interaction />
  <BoardPill />
  <Toolbar />
  <ContextMenu />
  {#if ui.settingsOpen}<SettingsPanel />{/if}
  {#if exportUi.ids.length}<ExportDialog />{/if}
  {#if fmt.linking}<LinkBar />{/if}
  {#if ui.shortcutsOpen}<ShortcutsPanel />{/if}
  {#if ui.panel}<SidePanel />{/if}
  <DatePicker />
  <ColorPicker />
  <TableMenus />
  {#if searchUi.open}<SearchBar />{/if}
  {#if drawUi.active}<DrawBar />{/if}
  {#if mapUi.editing}<MapBar />{/if}
  {#if settings.perf}<PerfOverlay />{/if}

  <!-- The left edge: the create rail under the board pill, the navigator in the corner. -->
  <div class="left-chrome">
    <CreateRail />
    <Navigator />
  </div>
  <TaskCard />
  <RecoveryCard />
  <Tooltip />

  {#key ui.toast?.id}
    {#if ui.toast}
      <div class="toast" class:has-action={ui.toast.action}>
        {ui.toast.text}
        {#if ui.toast.action}
          {@const action = ui.toast.action}
          <button
            onclick={() => {
              ui.dismissToast();
              action.run();
            }}>{action.label}</button
          >
        {/if}
      </div>
    {/if}
  {/key}
</main>

<style>
  main {
    position: fixed;
    inset: 0;
  }
  /* The clean view (Tab): the chrome fades away; menus, the find bar, settings and toasts stay. */
  main > :global(.pill),
  main > :global(.toolbar-row),
  main > .left-chrome,
  main > :global(aside.panel) {
    transition:
      opacity 180ms ease-out,
      visibility 0s linear 0s;
  }
  main.clean > :global(.pill),
  main.clean > :global(.toolbar-row),
  main.clean > .left-chrome,
  main.clean > :global(aside.panel) {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition:
      opacity 180ms ease-out,
      visibility 0s linear 180ms;
  }
  .left-chrome {
    position: absolute;
    left: 12px;
    top: 54px;
    bottom: 12px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    pointer-events: none;
  }
  .toast {
    position: absolute;
    left: 50%;
    bottom: 16px;
    translate: -50% 0;
    padding: 8px 14px;
    border-radius: calc(10px * var(--round));
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    backdrop-filter: blur(12px);
    color: var(--text);
    font-size: 13px;
    pointer-events: none;
    animation: toast-in 260ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .toast.has-action {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-right: 6px;
    pointer-events: auto;
  }
  .toast button {
    all: unset;
    padding: 3px 10px;
    border-radius: calc(7px * var(--round));
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
    cursor: pointer;
  }
  .toast button:hover {
    filter: brightness(1.08);
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      translate: -50% 10px;
    }
  }
</style>
