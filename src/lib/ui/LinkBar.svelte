<script lang="ts">
  import { Link } from "@lucide/svelte";
  import { applyLink, closeLinkBar, currentLink } from "../text/format.svelte";

  /**
   * The link bar under the toolbar (Ctrl/⌘+K or the Link button while a text card is edited): the
   * selection's link, to set, change or (emptied) remove. Enter applies, Esc goes back to the text.
   */
  const initial = currentLink();

  function focus(el: HTMLInputElement) {
    el.focus({ preventScroll: true });
    el.select();
  }
</script>

<div class="bar" role="dialog" aria-label="Link">
  <Link size={15} strokeWidth={1.8} />
  <input
    value={initial}
    placeholder="Paste or type a link"
    spellcheck="false"
    {@attach focus}
    onkeydown={(e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        applyLink((e.target as HTMLInputElement).value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeLinkBar();
      }
    }}
    onblur={() => closeLinkBar()}
  />
  <span class="hint">{initial ? "Empty removes it" : "Enter to link"}</span>
</div>

<style>
  .bar {
    position: absolute;
    left: 50%;
    top: 64px;
    translate: -50% 0;
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 8px;
    width: min(420px, calc(100vw - 48px));
    padding: 6px 10px;
    box-sizing: border-box;
    border-radius: calc(10px * var(--round));
    background: var(--panel-solid);
    border: 1px solid var(--panel-border);
    box-shadow: 0 8px 28px var(--panel-shadow);
    color: var(--text-muted);
    font-size: 13px;
  }
  input {
    all: unset;
    flex: 1;
    min-width: 0;
    color: var(--text);
    user-select: text;
    -webkit-user-select: text;
  }
  input::placeholder {
    color: var(--text-muted);
  }
  .hint {
    flex: none;
    font-size: 12px;
  }
</style>
