<script lang="ts">
  import { X } from "@lucide/svelte";
  import { untrack } from "svelte";
  import { doc } from "../app.svelte";
  import type { CanvasNode } from "../doc/types";
  import {
    closeExport,
    exportKind,
    exportSvg,
    exportText,
    exportUi,
    isExportable,
    paletteImage,
    pngSize,
    runExport,
    spriteExport,
    type ExportBackground,
    type ExportFormat,
    type ExportKind,
    type ExportTheme,
  } from "../export/export.svelte";
  import { paletteData } from "../palette/model";
  import { settings } from "../settings.svelte";
  import { sequence, spriteData, tagOf } from "../sprite/model";
  import { spriteMeta, spriteUi } from "../sprite/sprites.svelte";

  /**
   * The export dialog: for one node, its options (a map's or drawing's format, scale, colors,
   * background and floor grid; a sprite's frame, sheet or GIF; a table's or palette's format)
   * with a preview of exactly what's written (a GIF plays in it; text shows as text); for several,
   * a batch into a folder with the options of every kind among them. Options are remembered in
   * settings. Pictures, videos, audio and PDFs have no options: their own file is copied.
   */
  const nodes = $derived(exportUi.ids.map((id) => doc.nodes[id]).filter((n): n is CanvasNode => isExportable(n)));
  const batch = $derived(nodes.length > 1);
  const node = $derived(batch ? undefined : nodes[0]);
  const count = (kind: string) => nodes.filter((n) => n.kind === kind).length;
  const has = (kind: ExportKind) => nodes.some((n) => exportKind(n) === kind);
  const hasMap = $derived(count("map") > 0);
  const hasVector = $derived(has("vector"));
  const hasSprite = $derived(has("sprite"));
  const hasTable = $derived(has("table"));
  const hasPalette = $derived(has("palette"));
  /** Sections in a batch: headings only when there's more than one kind of options. */
  const sections = $derived([hasVector, hasSprite, hasTable, hasPalette].filter(Boolean).length);
  const kind = $derived(node ? exportKind(node) : null);
  const isSprite = $derived(node?.kind === "sprite");
  /** Text a single export writes, shown as it is. */
  const text = $derived(node && (kind === "text" || kind === "table" || kind === "palette") ? exportText(node) : null);
  const file = $derived(node && kind === "file" ? doc.assetOf(node) : undefined);
  const asset = $derived(node && isSprite ? doc.assetOf(node) : undefined);
  const meta = $derived(asset ? spriteMeta(asset) : null);
  // A sprite's output size: its pixels times the scale, one frame wide (or a row of them).
  const spriteFrames = $derived(
    node && meta && meta !== "failed" ? (settings.spriteExport === "png" ? 1 : sequence(meta, tagOf(meta, spriteData(node.data))).length) : 0,
  );
  // Drawings have fixed ink colors: the theme only matters for the card-colored background.
  const themed = $derived(hasMap || settings.exportBackground === "card");
  const size = $derived(node && !isSprite && settings.exportFormat === "png" ? pngSize(node, settings.exportScale) : null);
  const NOUNS: [string, string, string][] = [
    ["map", "map", "maps"],
    ["drawing", "drawing", "drawings"],
    ["sprite", "sprite", "sprites"],
    ["text", "text card", "text cards"],
    ["checklist", "checklist", "checklists"],
    ["table", "table", "tables"],
    ["palette", "palette", "palettes"],
    ["image", "picture", "pictures"],
    ["gif", "GIF", "GIFs"],
    ["video", "video", "videos"],
    ["audio", "audio file", "audio files"],
    ["pdf", "PDF", "PDFs"],
  ];
  const summary = $derived(
    NOUNS.map(([k, one, many]) => [count(k), one, many] as const)
      .filter(([n]) => n)
      .map(([n, one, many]) => `${n} ${n > 1 ? many : one}`)
      .join(", "),
  );
  const title = $derived(node ? (NOUNS.find(([k]) => k === node.kind)?.[1] ?? "item") : "");

  let preview = $state<string | null>(null);
  // A palette written as a picture (PNG) or a swatch file (ASE) previews as its swatches.
  $effect(() => {
    if (!node || node.kind !== "palette" || text) return;
    $state.snapshot(node);
    let url: string | null = null, cancelled = false;
    untrack(() => paletteImage(node)).then((b) => {
      if (cancelled) return;
      url = URL.createObjectURL(b);
      preview = url;
    }, () => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  });
  // A sprite's preview is Rust's output for the current options (and frame, for a single PNG).
  $effect(() => {
    if (!node || !isSprite || !meta) return;
    [settings.spriteExport, settings.spriteScale, settings.spriteBackground, spriteUi.steps.get(node.id)];
    $state.snapshot(node);
    let url: string | null = null, cancelled = false;
    const timer = setTimeout(() => {
      untrack(() => spriteExport(node)).then(({ bytes }) => {
        if (cancelled) return;
        url = URL.createObjectURL(bytes);
        preview = url;
      }, () => {});
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  });
  $effect(() => {
    if (!node || kind !== "vector") return;
    const opts = { theme: settings.exportTheme, background: settings.exportBackground, grid: settings.exportGrid };
    $state.snapshot(node); // follows changes to the node
    // Rendering mounts an offscreen copy, which can't happen inside an effect: just after it.
    let url: string | null = null;
    const timer = setTimeout(() => {
      const svg = untrack(() => {
        try {
          return exportSvg(node, opts);
        } catch {
          return "";
        }
      });
      url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      preview = url;
    });
    return () => {
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  });

  // The dialog closes itself when its nodes go away (deleted, undone).
  $effect(() => {
    if (exportUi.ids.length && !nodes.length) closeExport();
  });

  let panel = $state<HTMLElement>();
  function outside(e: PointerEvent) {
    if (!panel?.contains(e.target as Node)) closeExport();
  }

  const FORMATS: [ExportFormat, string][] = [["png", "PNG"], ["svg", "SVG"]];
  const SCALES: [number, string][] = [[1, "1×"], [2, "2×"], [4, "4×"]];
  const THEMES: [ExportTheme, string][] = [["light", "Light"], ["dark", "Dark"]];
  const BACKGROUNDS: [ExportBackground, string][] = [["none", "Transparent"], ["card", "Card color"], ["white", "White"]];
  const GRID: [boolean, string][] = [[true, "Shown"], [false, "Hidden"]];
  const SPRITE_FORMATS: [typeof settings.spriteExport, string][] = [["png", "Frame"], ["sheet", "Sheet"], ["gif", "GIF"]];
  const SPRITE_SCALES: [number, string][] = [[1, "1×"], [2, "2×"], [4, "4×"], [8, "8×"]];
  const SPRITE_BACKGROUNDS: [typeof settings.spriteBackground, string][] = [["none", "Transparent"], ["white", "White"]];
  const TABLE_FORMATS: [typeof settings.tableExport, string][] = [["csv", "CSV"], ["md", "Markdown"]];
  const PALETTE_FORMATS: [typeof settings.paletteExport, string][] = [["gpl", "GIMP"], ["ase", "Adobe"], ["hex", "Hex list"], ["png", "PNG"]];
  const PALETTE_HINTS: Record<typeof settings.paletteExport, string> = {
    gpl: ".gpl: GIMP, Krita, Inkscape, Aseprite",
    ase: ".ase: Photoshop, Illustrator, Affinity, Procreate",
    hex: ".txt: one hex code per line",
    png: ".png: the swatches as a picture",
  };
</script>

<svelte:window
  onpointerdown={outside}
  onkeydown={(e) => {
    if (e.key === "Escape") closeExport();
    if (e.key === "Enter" && !exportUi.busy) void runExport();
  }}
/>

{#snippet choice<T>(label: string, options: [T, string][], value: T, set: (v: T) => void)}
  <div class="row">
    <span>{label}</span>
    <div class="segmented" role="radiogroup" aria-label={label}>
      {#each options as [option, text] (text)}
        <button role="radio" aria-checked={value === option} class:on={value === option} onclick={() => set(option)}>{text}</button>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet vectorRows()}
  <div class="rows">
    {@render choice("Format", FORMATS, settings.exportFormat, (v) => (settings.exportFormat = v))}
    {#if settings.exportFormat === "png"}
      {@render choice("Scale", SCALES, settings.exportScale, (v) => (settings.exportScale = v))}
    {/if}
    {#if themed}
      {@render choice("Colors", THEMES, settings.exportTheme, (v) => (settings.exportTheme = v))}
    {/if}
    {@render choice("Background", BACKGROUNDS, settings.exportBackground, (v) => (settings.exportBackground = v))}
    {#if hasMap}
      {@render choice("Floor grid", GRID, settings.exportGrid, (v) => (settings.exportGrid = v))}
    {/if}
  </div>
{/snippet}

{#snippet spriteRows()}
  <div class="rows">
    {@render choice("Export", SPRITE_FORMATS, settings.spriteExport, (v) => (settings.spriteExport = v))}
    {@render choice("Scale", SPRITE_SCALES, settings.spriteScale, (v) => (settings.spriteScale = v))}
    {@render choice("Background", SPRITE_BACKGROUNDS, settings.spriteBackground, (v) => (settings.spriteBackground = v))}
  </div>
{/snippet}

{#snippet tableRows()}
  <div class="rows">
    {@render choice("Format", TABLE_FORMATS, settings.tableExport, (v) => (settings.tableExport = v))}
  </div>
{/snippet}

{#snippet paletteRows()}
  <div class="rows">
    {@render choice("Format", PALETTE_FORMATS, settings.paletteExport, (v) => (settings.paletteExport = v))}
    <p class="hint">{PALETTE_HINTS[settings.paletteExport]}</p>
  </div>
{/snippet}

{#if nodes.length}
  <section class="panel" bind:this={panel} aria-label="Export">
    <header>
      <h2>{batch ? `Export ${nodes.length} items` : `Export ${title}`}</h2>
      <button class="close" aria-label="Close" onclick={closeExport}><X size={15} /></button>
    </header>

    {#if batch}
      <p class="summary">{summary}, each into its own file in a folder you pick. Names come from what they are and the frame they're in; nothing is overwritten.</p>
      {#if hasVector}
        {#if sections > 1}<h3>Maps and drawings</h3>{/if}
        {@render vectorRows()}
      {/if}
      {#if hasSprite}
        {#if sections > 1}<h3>Sprites</h3>{/if}
        {@render spriteRows()}
      {/if}
      {#if hasTable}
        {#if sections > 1}<h3>Tables</h3>{/if}
        {@render tableRows()}
      {/if}
      {#if hasPalette}
        {#if sections > 1}<h3>Palettes</h3>{/if}
        {@render paletteRows()}
      {/if}
    {:else if kind === "file"}
      <p class="summary">A copy of <strong>{file?.name}</strong>, exactly as it is{file?.missing ? ", but the file is missing: find it first" : ""}.</p>
    {:else if text}
      <pre class="preview text">{text.text}</pre>
      {#if kind === "table"}{@render tableRows()}{:else if kind === "palette"}{@render paletteRows()}{/if}
    {:else}
      <div class="preview" class:checker={kind === "vector" ? settings.exportBackground === "none" : isSprite && settings.spriteBackground === "none"}>
        {#if preview}<img src={preview} alt="" draggable="false" class:pixels={isSprite || kind === "palette"} />{/if}
      </div>
      {#if isSprite}{@render spriteRows()}{:else if kind === "palette"}{@render paletteRows()}{:else}{@render vectorRows()}{/if}
    {/if}

    <footer>
      <span class="size">
        {#if batch}
          {nodes.length} files
        {:else if isSprite && meta && meta !== "failed"}
          {meta.width * settings.spriteScale * (settings.spriteExport === "sheet" ? spriteFrames : 1)} × {meta.height * settings.spriteScale} px{#if settings.spriteExport !== "png"}, {spriteFrames} frames{/if}
        {:else if kind === "file"}
          The original file
        {:else if node?.kind === "palette"}
          {paletteData(node.data).colors.length} colors
        {:else if text}
          {text.text.split("\n").length - 1} lines
        {:else if size}{size.w} × {size.h} px{:else if node}Vector, {Math.round(node.w)} × {Math.round(node.h)}{/if}
      </span>
      <button onclick={closeExport}>Cancel</button>
      <button class="primary" disabled={exportUi.busy} onclick={() => void runExport()}>{batch ? `Export ${nodes.length} files…` : "Export…"}</button>
    </footer>
  </section>
{/if}

<style>
  .panel {
    position: absolute;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    width: min(400px, calc(100vw - 48px));
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-sizing: border-box;
    padding: 14px 16px 16px;
    border-radius: calc(14px * var(--round));
    background: var(--panel-solid);
    border: 1px solid var(--panel-border);
    box-shadow: 0 18px 60px var(--panel-shadow);
    font-size: 13px;
    color: var(--text);
    z-index: 95;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .preview {
    display: grid;
    place-items: center;
    height: 200px;
    padding: 10px;
    box-sizing: border-box;
    border-radius: calc(9px * var(--round));
    background: var(--control-bg);
  }
  .preview.checker {
    background:
      repeating-conic-gradient(color-mix(in srgb, var(--text) 9%, transparent) 0 25%, transparent 0 50%) 0 0 / 14px 14px,
      var(--control-bg);
  }
  .preview img.pixels {
    image-rendering: pixelated;
  }
  .preview img {
    display: block;
    max-width: 100%;
    max-height: 180px;
    object-fit: contain;
  }
  .preview.text {
    display: block;
    margin: 0;
    max-height: 200px;
    height: auto;
    overflow: auto;
    font-family: ui-monospace, "SF Mono", "Cascadia Mono", "JetBrains Mono", monospace;
    font-size: 11.5px;
    line-height: 1.5;
    white-space: pre;
    user-select: text;
    -webkit-user-select: text;
  }
  .hint {
    margin: 0;
    text-align: right;
    font-size: 11.5px;
    color: var(--text-muted);
  }
  .summary {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--text-muted);
  }
  h3 {
    margin: 4px 0 -4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .segmented {
    display: flex;
    padding: 2px;
    border-radius: calc(7px * var(--round));
    background: var(--control-bg);
  }
  .segmented button {
    padding: 3px 9px;
    border-radius: calc(5px * var(--round));
    font-size: 12px;
    color: var(--text-muted);
  }
  .segmented button:hover {
    background: none;
    color: var(--text);
  }
  .segmented button.on {
    background: var(--panel-solid);
    color: var(--text);
    box-shadow: 0 1px 3px var(--panel-shadow);
  }
  footer {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
  }
  .size {
    flex: 1;
    font-size: 12px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
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
  button.primary {
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }
  button.primary:hover {
    background: color-mix(in srgb, var(--accent) 85%, var(--text));
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .close {
    display: grid;
    place-items: center;
    padding: 4px;
  }
</style>
