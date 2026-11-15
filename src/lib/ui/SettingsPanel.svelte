<script lang="ts">
  import { tip } from "./tips.svelte";
  import { formatKeys } from "../actions.svelte";
  import { Folder, Info, LayoutGrid, Palette, Search, Sparkles, SquarePlus, Wrench, X } from "@lucide/svelte";
  import type { Component } from "svelte";
  import { ui } from "../app.svelte";
  import { backend } from "../backend";
  import { play } from "../juice/sound";
  import { SETTINGS, SETTINGS_PAGES, settings, type SettingDef, type SettingsPage } from "../settings.svelte";

  /**
   * Settings: a dialog with its pages listed down the side and one search across all of them.
   * Hints sit under the labels; rows hidden by their `when` stay hidden in search too.
   */

  const ICONS: Record<SettingsPage, Component> = {
    appearance: Palette,
    canvas: LayoutGrid,
    feel: Sparkles,
    new: SquarePlus,
    files: Folder,
    advanced: Wrench,
    about: Info,
  };
  const PAGE_NAMES = new Map(SETTINGS_PAGES);
  /** What search finds the About page by. */
  const ABOUT_WORDS = "about credits licenses game-icons version patchwork";

  let query = $state("");
  const words = $derived(query.toLowerCase().split(/\s+/).filter(Boolean));
  const matches = (text: string) => words.every((w) => text.toLowerCase().includes(w));

  type Group = { title: string | null; defs: SettingDef[] };

  /** Rows grouped by subheading, in the order they're defined. */
  function grouped(defs: SettingDef[], title: (d: SettingDef) => string | null): Group[] {
    const out: Group[] = [];
    for (const def of defs) {
      if (def.when && !def.when()) continue;
      const t = title(def);
      const last = out.at(-1);
      if (last && last.title === t) last.defs.push(def);
      else out.push({ title: t, defs: [def] });
    }
    return out;
  }

  const page = $derived(settings.settingsPage);
  const pageGroups = $derived(grouped(SETTINGS.filter((d) => d.page === page), (d) => d.group ?? null));
  /** While searching: matches from every page, headed "Page › Group". */
  const results = $derived(
    words.length
      ? grouped(
          SETTINGS.filter((d) => matches(`${PAGE_NAMES.get(d.page)} ${d.group ?? ""} ${d.label} ${d.hint ?? ""} ${d.keywords ?? ""}`)),
          (d) => [PAGE_NAMES.get(d.page), d.group].filter(Boolean).join(" › "),
        )
      : [],
  );
  const aboutMatches = $derived(words.length > 0 && matches(ABOUT_WORDS));

  const get = (def: SettingDef) => settings[def.key] as unknown;
  const set = (def: SettingDef, value: unknown) => ((settings as unknown as Record<string, unknown>)[def.key] = value);

  function open(p: SettingsPage) {
    settings.settingsPage = p;
    query = "";
  }

  /** ↑/↓ move between pages while the page list has focus. */
  function navKeys(e: KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const from = (e.currentTarget as HTMLElement).dataset.page;
    const i = SETTINGS_PAGES.findIndex(([p]) => p === from);
    const next = SETTINGS_PAGES[(i + (e.key === "ArrowDown" ? 1 : -1) + SETTINGS_PAGES.length) % SETTINGS_PAGES.length][0];
    open(next);
    nav?.querySelector<HTMLElement>(`[data-page="${next}"]`)?.focus();
  }

  /** "Reset to defaults" asks for a second click (within a few seconds) before it resets. */
  let armed = $state(false);
  let armTimer = 0;
  function reset() {
    clearTimeout(armTimer);
    if (!armed) {
      armed = true;
      armTimer = window.setTimeout(() => (armed = false), 4000);
      return;
    }
    armed = false;
    settings.reset();
    play("tap", { volume: 0.5, pitch: 0.9 });
  }
  $effect(() => () => clearTimeout(armTimer));

  let panel = $state<HTMLElement>();
  let nav = $state<HTMLElement>();

  function close(e: PointerEvent) {
    const target = e.target as HTMLElement;
    if (panel?.contains(target) || target.closest("[data-settings-toggle]")) return;
    ui.settingsOpen = false;
  }

  function focus(el: HTMLInputElement) {
    el.focus({ preventScroll: true });
  }
</script>

<svelte:window
  onpointerdown={close}
  onkeydown={(e) => {
    if (e.key === "Escape") ui.settingsOpen = false;
  }}
/>

{#snippet row(def: SettingDef)}
  {@const value = get(def)}
  <div class="row">
    <div class="text">
      <span class="label">{def.label}</span>
      {#if def.hint}<span class="hint">{def.hint}</span>{/if}
    </div>

    {#if def.control.kind === "toggle"}
      <button class="switch" role="switch" aria-checked={!!value} aria-label={def.label} onclick={() => set(def, !value)}><span></span></button>
    {:else if def.control.kind === "choice"}
      <div class="segmented" role="radiogroup" aria-label={def.label}>
        {#each def.control.options as [option, label] (option)}
          <button role="radio" aria-checked={value === option} class:on={value === option} onclick={() => set(def, option)}>
            {label}
          </button>
        {/each}
      </div>
    {:else if def.control.kind === "slider"}
      {@const c = def.control}
      <div class="slider">
        <input
          type="range"
          min={c.min}
          max={c.max}
          step={c.step}
          value={value as number}
          aria-label={def.label}
          oninput={(e) => set(def, Number((e.target as HTMLInputElement).value))}
        />
        <span class="value">{c.format(value as number)}</span>
      </div>
    {:else if def.control.kind === "swatches"}
      <div class="swatches" role="radiogroup" aria-label={def.label}>
        {#each def.control.options() as sw (sw.value)}
          <button
            role="radio"
            aria-checked={value === sw.value}
            aria-label={sw.label}
            {@attach tip(sw.label)}
            class:on={value === sw.value}
            class:none={sw.none}
            style:--swatch={sw.color}
            onclick={() => set(def, sw.value)}
          ></button>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet groups(list: Group[])}
  {#each list as g, i (g.title ?? i)}
    <div class="group">
      {#if g.title}<h3>{g.title}</h3>{/if}
      {#each g.defs as def (def.key)}{@render row(def)}{/each}
    </div>
  {/each}
{/snippet}

<section class="panel" bind:this={panel} aria-label="Settings">
  <header>
    <h2>Settings</h2>
    <label class="search">
      <Search size={14} strokeWidth={1.8} />
      <input
        bind:value={query}
        placeholder="Search settings"
        spellcheck="false"
        aria-label="Search settings"
        {@attach focus}
        onkeydown={(e) => {
          // Esc clears a search first, then closes.
          if (e.key === "Escape" && query) {
            e.stopPropagation();
            query = "";
          }
        }}
      />
    </label>
    <button class="close" {@attach tip({ text: "Close", keys: formatKeys("escape") })} aria-label="Close" onclick={() => (ui.settingsOpen = false)}>
      <X size={15} strokeWidth={1.8} />
    </button>
  </header>

  <div class="body">
    <nav bind:this={nav} aria-label="Settings pages">
      {#each SETTINGS_PAGES as [p, name] (p)}
        {@const Icon = ICONS[p]}
        <button data-page={p} class:on={!words.length && p === page} aria-current={!words.length && p === page ? "page" : undefined} onclick={() => open(p)} onkeydown={navKeys}>
          <Icon size={15} strokeWidth={1.8} />
          {name}
        </button>
      {/each}
    </nav>

    <div class="page">
      {#if words.length}
        {#key query}
          {@render groups(results)}
          {#if aboutMatches}
            <div class="group">
              <h3>About</h3>
              <button class="jump" onclick={() => open("about")}>Version, credits and licenses →</button>
            </div>
          {/if}
          {#if !results.length && !aboutMatches}
            <p class="empty">No setting matches “{query}”.</p>
          {/if}
        {/key}
      {:else}
        {#key page}
          <div class="content">
            <h2 class="title">{PAGE_NAMES.get(page)}</h2>
            {#if page === "about"}
              <div class="group">
                <p class="about"><strong>Patchwork</strong> <span class="muted">version {__APP_VERSION__}</span></p>
              </div>
              <!-- Credits that licenses require. -->
              <div class="group">
                <h3>Credits</h3>
                <p class="credits">
                  Map stamps from <button class="inline" onclick={() => backend.openUrl("https://game-icons.net")}>game-icons.net</button>
                  by Lorc, Delapouite and contributors, under
                  <button class="inline" onclick={() => backend.openUrl("https://creativecommons.org/licenses/by/3.0/")}>CC BY 3.0</button>.
                </p>
                <p class="credits">
                  UI sounds from <button class="inline" onclick={() => backend.openUrl("https://snd.dev")}>snd.dev</button> (Dentsu Inc.).
                </p>
              </div>
            {:else}
              {@render groups(pageGroups)}
            {/if}
            {#if page === "advanced"}
              <div class="group">
                <h3>Reset</h3>
                <div class="row">
                  <div class="text">
                    <span class="label">Reset to defaults</span>
                    <span class="hint">Every setting goes back to how it started. Your recent boards stay.</span>
                  </div>
                  <button class="button" class:armed onclick={reset}>{armed ? "Click again to reset" : "Reset"}</button>
                </div>
              </div>
            {/if}
          </div>
        {/key}
      {/if}
    </div>
  </div>
</section>

<style>
  .panel {
    position: absolute;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    width: min(760px, calc(100vw - 48px));
    height: min(560px, calc(100vh - 120px));
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    border-radius: calc(14px * var(--round));
    background: var(--panel-solid);
    border: 1px solid var(--panel-border);
    box-shadow: 0 18px 60px var(--panel-shadow);
    font-size: 13px;
    color: var(--text);
    z-index: 95;
    animation: rise 220ms cubic-bezier(0.2, 0.9, 0.3, 1.15);
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 12px 10px 18px;
    border-bottom: 1px solid var(--panel-border);
  }
  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  .search {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 7px;
    max-width: 320px;
    margin-left: auto;
    padding: 5px 9px;
    border-radius: calc(7px * var(--round));
    background: var(--control-bg);
    color: var(--text-muted);
  }
  .search input {
    all: unset;
    flex: 1;
    min-width: 0;
    color: var(--text);
    user-select: text;
    -webkit-user-select: text;
  }
  .search input::placeholder {
    color: var(--text-muted);
  }
  button {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .close {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: calc(6px * var(--round));
    color: var(--text-muted);
  }
  .close:hover {
    background: var(--panel-hover);
    color: var(--text);
  }

  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  nav {
    flex-shrink: 0;
    width: 168px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 8px;
    border-right: 1px solid var(--panel-border);
    overflow-y: auto;
  }
  nav button {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 10px;
    border-radius: calc(7px * var(--round));
    color: var(--text-muted);
    transition: background 120ms, color 120ms;
  }
  nav button:hover {
    background: var(--panel-hover);
    color: var(--text);
  }
  nav button.on {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--text);
  }
  nav button.on :global(svg) {
    color: var(--accent);
  }
  nav button:focus-visible {
    outline-offset: -2px;
  }

  .page {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 4px 20px 16px;
  }
  .content {
    animation: page-in 160ms ease-out;
  }
  .title {
    margin: 14px 0 2px;
    font-size: 16px;
  }
  .group + .group,
  .title + .group {
    margin-top: 10px;
  }
  .group {
    padding-bottom: 4px;
  }
  .group:not(:last-child) {
    border-bottom: 1px solid color-mix(in srgb, var(--panel-border) 60%, transparent);
  }
  h3 {
    margin: 14px 0 2px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding: 8px 0;
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .hint {
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-muted);
  }
  .empty {
    margin: 24px 0;
    color: var(--text-muted);
    text-align: center;
  }
  .jump {
    padding: 8px 0;
    color: var(--accent);
  }
  .jump:hover {
    text-decoration: underline;
  }

  .switch {
    position: relative;
    flex-shrink: 0;
    width: 32px;
    height: 18px;
    border-radius: calc(9px * var(--round));
    background: var(--control-bg);
    border: 1px solid var(--panel-border);
    transition: background 160ms;
  }
  .switch span {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--text-muted);
    transition:
      translate 200ms cubic-bezier(0.34, 1.56, 0.64, 1),
      background 160ms;
  }
  .switch[aria-checked="true"] {
    background: var(--accent);
  }
  .switch[aria-checked="true"] span {
    translate: 14px 0;
    background: var(--on-accent);
  }

  .segmented {
    display: flex;
    flex-shrink: 0;
    padding: 2px;
    border-radius: calc(7px * var(--round));
    background: var(--control-bg);
  }
  .segmented button {
    padding: 3px 9px;
    border-radius: calc(5px * var(--round));
    font-size: 12px;
    color: var(--text-muted);
    transition: background 120ms, color 120ms;
  }
  .segmented button:hover {
    color: var(--text);
  }
  .segmented button.on {
    background: var(--panel-solid);
    color: var(--text);
    box-shadow: 0 1px 3px var(--panel-shadow);
  }

  .slider {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 8px;
  }
  .slider input {
    width: 130px;
    accent-color: var(--accent);
  }
  .value {
    width: 34px;
    text-align: right;
    font-size: 12px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .swatches {
    display: flex;
    flex-shrink: 0;
    gap: 6px;
  }
  .swatches button {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--swatch);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 18%, transparent);
    transition: scale 120ms;
  }
  /* "No card": crossed out. */
  .swatches button.none {
    background: linear-gradient(135deg, transparent 44%, var(--danger) 44% 56%, transparent 56%);
  }
  .swatches button.none.on {
    outline-color: var(--text-muted);
  }
  .swatches button:hover {
    scale: 1.15;
  }
  .swatches button.on {
    outline: 2px solid var(--swatch);
    outline-offset: 2px;
  }

  .button {
    flex-shrink: 0;
    padding: 4px 12px;
    border-radius: calc(7px * var(--round));
    background: var(--control-bg);
    font-size: 12px;
  }
  .button:hover {
    background: var(--panel-hover);
  }
  .button.armed {
    background: var(--danger);
    color: #fff;
  }

  .about {
    margin: 10px 0 6px;
  }
  .muted {
    color: var(--text-muted);
  }
  .credits {
    margin: 4px 0 8px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-muted);
  }
  .inline {
    all: unset;
    color: var(--accent);
    cursor: pointer;
  }
  .inline:hover {
    text-decoration: underline;
  }

  @keyframes rise {
    from {
      opacity: 0;
      translate: -50% calc(-50% + 10px);
      scale: 0.98;
    }
  }
  @keyframes page-in {
    from {
      opacity: 0;
      translate: 0 4px;
    }
  }
  :global(:root[data-calm]) .panel {
    animation-name: fade;
    animation-duration: 140ms;
  }
  :global(:root[data-calm]) .content {
    animation: none;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
</style>
