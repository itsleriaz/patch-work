<script lang="ts">
  import type { CanvasNode } from "../doc/types";
  import { finishText, mapUi } from "../map/map.svelte";
  import StampGlyph from "./StampGlyph.svelte";
  import { settings } from "../settings.svelte";
  import { arrowAt, roughLoops, roughRuns, groundMarks, groundOutline, triMap, cellSet, doorEdge, floorBeside, edgesPath, footprints, linePath, liveDoors, liveLabels, liveWalls, loopsPath, mapData, outlineLoops, pathLine, stampAt, TEXT_SIZE, unitEdges, type Door } from "../map/model";

  /**
   * A map, old-school style, as SVG in units (half cells; sharp at any zoom, paint-only): hatching
   * outside the walls (a patterned stroke along the floor's outline, its inner half covered by the
   * floor), the floor with a faint grid of full cells, black walls, doors, labels and room numbers.
   * While it's edited, a grid over the whole area (half lines too when painting half cells), the
   * cell or edge under the pointer, and the room being dragged.
   */
  let { node }: { node: CanvasNode } = $props();

  const d = $derived(mapData(node.data));
  const editing = $derived(mapUi.editing === node.id);
  const cells = $derived(mapUi.preview?.nodeId === node.id ? mapUi.preview.cells : d.cells);
  const set = $derived(cellSet(cells));
  const tris = $derived(triMap(mapUi.preview?.nodeId === node.id && mapUi.preview.tris !== undefined ? mapUi.preview.tris : d.tris));
  const cave = $derived(d.style === "cave");
  const outline = $derived(loopsPath(cave ? roughLoops(outlineLoops(set, tris)) : outlineLoops(set, tris)));
  const preview = $derived(mapUi.preview?.nodeId === node.id ? mapUi.preview : null);
  const walls = $derived(cave ? roughRuns(edgesPath(liveWalls(preview?.walls ?? d.walls, set, tris))) : edgesPath(liveWalls(preview?.walls ?? d.walls, set, tris)));
  const doors = $derived(liveDoors(d.doors, set, tris));
  const labels = $derived(liveLabels(d.labels, set, tris));
  const v = $derived(d.view);
  const textEdit = $derived(mapUi.textEdit?.nodeId === node.id ? mapUi.textEdit : null);
  // The label being typed into shows as the text box instead.
  const texts = $derived((preview?.texts ?? d.texts).filter((t) => t.id !== textEdit?.id));
  const stamps = $derived(preview?.stamps ?? d.stamps);
  const paths = $derived((preview?.paths ?? d.paths).map((p) => ({ p, line: pathLine(p) })));
  // Exterior: marks for the strokes painted so far (worked out when a stroke ends); the stroke being
  // drawn shows as a faint outline meanwhile, which keeps drawing quick.
  const marks = $derived(groundMarks(d.ground));
  const liveGround = $derived(preview?.ground && preview.ground.length > d.ground.length ? preview.ground[preview.ground.length - 1] : null);


  function focus(el: HTMLInputElement) {
    el.focus();
    el.select();
  }
  const id = $derived(node.id);

  /** Half a door's length along its edge (per unit of its length), and half its thickness, in units. */
  const DOOR_HALF = 0.26;
  const DOOR_THICK = 0.24;

  function doorShape(door: Door) {
    const [a, b] = doorEdge(door);
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const half = DOOR_HALF * (door.len ?? 1);
    // A half-size door is thinner too.
    const thick = (door.len ?? 1) < 2 ? DOOR_THICK * 0.7 : DOOR_THICK;
    const across = door.side === "n";
    const rect = across ? { x: mx - half, y: my - thick, w: half * 2, h: thick * 2 } : { x: mx - thick, y: my - half, w: thick * 2, h: half * 2 };
    // Between two floor cells there's no wall: draw stubs from the corners to the door (or, for a
    // secret door, the whole wall).
    const open = unitEdges(door).every((u) => floorBeside(u, set, tris).every(Boolean));
    const stubs = !open
      ? ""
      : door.kind === "secret"
        ? `M${a.join(",")}L${b.join(",")}`
        : across
          ? `M${a.join(",")}L${mx - half},${my}M${mx + half},${my}L${b.join(",")}`
          : `M${a.join(",")}L${mx},${my - half}M${mx},${my + half}L${b.join(",")}`;
    const bar = across ? `M${mx},${my - thick}L${mx},${my + thick}` : `M${mx - thick},${my}L${mx + thick},${my}`;
    return { mx, my, rect, stubs, bar };
  }

  const hover = $derived(editing && !mapUi.preview ? mapUi.hover : null);
</script>

<div class="map" data-style={d.style}>
<svg viewBox="{v.x} {v.y} {v.w} {v.h}" preserveAspectRatio="none" aria-hidden="true">
  <defs>
    {#if d.style === "cave"}
      <!-- Stippling instead of lines: rubble around the cave. -->
      <pattern id="hatch-{id}" width="0.5" height="0.5" patternUnits="userSpaceOnUse">
        <circle cx="0.12" cy="0.14" r="0.05" class="hatch-dot" />
        <circle cx="0.37" cy="0.31" r="0.035" class="hatch-dot" />
        <circle cx="0.2" cy="0.43" r="0.04" class="hatch-dot" />
      </pattern>
    {:else}
      <pattern id="hatch-{id}" width="0.44" height="0.44" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="0.44" class="hatch-line" />
      </pattern>
    {/if}
    <!-- The floor's grid shows full cells (2 units). -->
    <pattern id="grid-{id}" width="2" height="2" patternUnits="userSpaceOnUse">
      <path d="M2,0L0,0L0,2" class="grid-line" />
    </pattern>
    {#if editing}
      <pattern id="edit-grid-{id}" width="2" height="2" patternUnits="userSpaceOnUse">
        {#if settings.mapGrid === "half"}<path d="M1,0L1,2M0,1L2,1" class="edit-grid-line half" />{/if}
        <path d="M2,0L0,0L0,2" class="edit-grid-line" />
      </pattern>
    {/if}
  </defs>

 {#if d.style !== "oldschool"}
    <!-- The paper under a styled map (the others sit on the board itself). -->
    <rect class="paper" x={v.x} y={v.y} width={v.w} height={v.h} />
  {/if}

  {#if editing}
    <rect class="edit-grid" x={Math.floor(v.x / 2) * 2 - 12} y={Math.floor(v.y / 2) * 2 - 12} width={v.w + 26} height={v.h + 26} fill="url(#edit-grid-{id})" />
  {/if}

  {#if marks}
    <path d={marks.dirt} class="marks dots dirt" />
    <path d={marks.road} class="marks dots road" />
    <path d={marks.grass} class="marks grass" />
    <path d={marks.water} class="marks water" />
    <path d={marks.edges} class="road-edge" />
  {/if}
  {#if liveGround}
    <path d={groundOutline(liveGround)} class="live-ground {liveGround.kind}" />
  {/if}

  <!-- A cave's rock is rough: its outline and walls are wobbled geometry (roughLoops), not a filter. -->
  <g>
    <path d={outline} class="hatch" stroke="url(#hatch-{id})" />
    <path d={outline} class="floor" />
    <path d={outline} fill="url(#grid-{id})" />
    <path d={outline} class="wall" />
    <!-- Interior walls: square ends, so they join the outer walls and each other cleanly. -->
    <path d={walls} class="wall inner" />
  </g>

  {#each doors as door (`${door.x},${door.y},${door.side}`)}
    {@const s = doorShape(door)}
    {#if s.stubs}<path d={s.stubs} class="wall" />{/if}
    {#if door.kind === "secret"}
      <text x={s.mx} y={s.my} class="secret">S</text>
    {:else}
      <rect x={s.rect.x} y={s.rect.y} width={s.rect.w} height={s.rect.h} class="door" />
      {#if door.kind === "locked"}<path d={s.bar} class="lock" />{/if}
    {/if}
  {/each}

  {#each stamps as st (st.id)}
    <g class="stamp" transform="translate({st.x} {st.y}) rotate({st.rot}) scale({st.size / 2})"><StampGlyph kind={st.kind} /></g>
  {/each}

  <!-- Overlay paths: over floors, walls and stamps, under labels and numbers. -->
  {#each paths as { p, line } (p.id)}
    <g class="route {p.color}">
      {#if p.style === "footprints"}
        {#each footprints(line) as f, i (i)}
          <g transform="translate({f.x} {f.y}) rotate({f.angle})">
            <!-- A shoe print: the sole (toes ahead, wider at the front) and the heel. -->
            <path d="M0,-0.3C0.11,-0.3 0.13,-0.12 0.1,0C0.08,0.07 -0.08,0.07 -0.1,0C-0.13,-0.12 -0.11,-0.3 0,-0.3Z" />
            <ellipse cx="0" cy="0.2" rx="0.075" ry="0.09" />
          </g>
        {/each}
      {:else}
        <path d={linePath(line)} class="route-line {p.style}" />
        {@const head = arrowAt(line)}
        {#if head}
          <path d="M0.08,0L-0.42,-0.26L-0.3,0L-0.42,0.26Z" transform="translate({head.x} {head.y}) rotate({head.angle})" />
        {/if}
      {/if}
    </g>
  {/each}

  {#each texts as t (t.id)}
    <text x={t.x} y={t.y} class="note">{t.text}</text>
  {/each}

  {#each labels as l (`${l.x},${l.y}`)}
    <!-- A number in a half cell (centered on a half unit) is smaller. -->
    <text x={l.x} y={l.y + 0.06} class="number" class:small={l.x % 1 !== 0 || l.y % 1 !== 0}>{l.n}</text>
  {/each}

  {#if hover}
    {#if mapUi.tool === "stamp"}
      <!-- Where the stamp would go, faint (or nothing over an existing stamp: a click turns that one). -->
      {#if !stampAt(stamps, hover.cell[0] + hover.size / 2, hover.cell[1] + hover.size / 2)}
        <g class="stamp ghost" transform="translate({hover.cell[0] + hover.size / 2} {hover.cell[1] + hover.size / 2}) scale({hover.size / 2})"><StampGlyph kind={settings.mapStamp} /></g>
      {/if}
    {:else if mapUi.tool === "diagonal"}
      <!-- The diagonal a click would cut: away from the corner nearest the pointer. -->
      {@const [x, y] = hover.cell}
      {@const z = hover.size}
      {@const slash = hover.corner === "ne" || hover.corner === "sw"}
      <rect x={x} y={y} width={z} height={z} class="hover-cell" />
      <path d={slash ? `M${x},${y}L${x + z},${y + z}` : `M${x + z},${y}L${x},${y + z}`} class="hover-edge" />
    {:else if mapUi.tool === "door" || mapUi.tool === "wall"}
      {@const [a, b] = doorEdge(hover.edge)}
      <path d="M{a.join(',')}L{b.join(',')}" class="hover-edge" />
    {:else}
      <rect x={hover.cell[0]} y={hover.cell[1]} width={hover.size} height={hover.size} class="hover-cell" class:erase={mapUi.tool === "erase"} />
    {/if}
  {/if}
  {#if editing && preview?.rect}
    {@const r = preview.rect}
    <rect x={r.x} y={r.y} width={r.w} height={r.h} class="room-rect" />
  {/if}
  {#if editing && preview?.run?.length}
    <!-- The grid line a wall drag covers (walls only stay where floor is on both sides). -->
    <path d={edgesPath(preview.run)} class="wall-run" class:removing={preview.removing} />
  {/if}
</svg>
{#if textEdit}
  <!-- Typed in place; positioned in cells, sized like the label it becomes. -->
  <input
    class="note-edit"
    data-editor
    bind:value={textEdit.text}
    placeholder="Label"
    spellcheck="false"
    style:left="{((textEdit.x - v.x) / v.w) * 100}%"
    style:top="{((textEdit.y - v.y) / v.h) * 100}%"
    style:font-size="{TEXT_SIZE * (node.h / v.h)}px"
    {@attach focus}
    onkeydown={(e) => {
      e.stopPropagation();
      if (e.key === "Enter") finishText(true);
      if (e.key === "Escape") finishText(false);
    }}
    onblur={() => finishText(true)}
  />
{/if}
</div>

<style>
  .map {
    position: relative;
    width: 100%;
    height: 100%;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  /*
   * Styles: each sets the map's colors (the --map-* variables) on the map itself, so everything
   * inside, and the export, follows. Old-school sets nothing: it follows the app's theme. The
   * others keep their own colors in both themes.
   */
  .map[data-style="blueprint"] {
    --map-paper: #17407a;
    --map-floor: #1f5199;
    --map-ink: #eaf3ff;
    --map-grid: rgba(234, 243, 255, 0.28);
    --map-hatch: rgba(234, 243, 255, 0.32);
    --map-red: #ffd36b;
    --map-water: #8ec5ff;
    --map-grass: #b4e3a4;
    --map-dirt: #bcd2f0;
  }
  .map[data-style="parchment"] {
    --map-paper: #e6d3a6;
    --map-floor: #f5e9c8;
    --map-ink: #4a3220;
    --map-grid: rgba(74, 50, 32, 0.16);
    --map-hatch: rgba(74, 50, 32, 0.5);
    --map-red: #a8321f;
    --map-water: #4f86a8;
    --map-grass: #5f8a3f;
    --map-dirt: #8f6a3d;
  }
  .map[data-style="cave"] {
    --map-paper: #2a2521;
    --map-floor: #6b6157;
    --map-ink: #15110d;
    --map-grid: rgba(21, 17, 13, 0.2);
    --map-hatch: rgba(168, 154, 138, 0.55);
    --map-red: #e8796f;
    --map-water: #6fa3cf;
    --map-grass: #86b36e;
    --map-dirt: #b59a74;
  }
  .paper {
    fill: var(--map-paper);
  }
  .hatch-dot {
    fill: var(--map-hatch);
  }
  .map[data-style="cave"] .wall {
    stroke-width: 0.5;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .map[data-style="cave"] .hatch {
    stroke-width: 2.6;
  }
  /* Theme colors (app.css --map-*): lines in the text color on the card color, so maps follow the theme. */
  .hatch {
    fill: none;
    stroke-width: 2.2;
    stroke-linejoin: round;
  }
  .hatch-line {
    stroke: var(--map-hatch);
    stroke-width: 0.07;
  }
  .floor {
    fill: var(--map-floor);
  }
  /* Exterior: marks only, no fills (groundMarks), in the theme's terrain hues. */
  .marks {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .marks.dots {
    stroke-width: 0.1;
  }
  .marks.dirt,
  .marks.road {
    stroke: var(--map-dirt);
  }
  .marks.road {
    stroke-width: 0.11;
  }
  .marks.grass {
    stroke: var(--map-grass);
    stroke-width: 0.06;
  }
  .marks.water {
    stroke: var(--map-water);
    stroke-width: 0.07;
  }
  .road-edge {
    fill: none;
    stroke: var(--map-dirt);
    stroke-width: 0.07;
    stroke-dasharray: 0.4 0.25;
  }
  /* The stroke being drawn: a faint outline until it's painted. */
  .live-ground {
    fill: color-mix(in srgb, var(--map-dirt) 22%, transparent);
  }
  .live-ground.grass {
    fill: color-mix(in srgb, var(--map-grass) 22%, transparent);
  }
  .live-ground.water {
    fill: color-mix(in srgb, var(--map-water) 22%, transparent);
  }
  .live-ground.erase {
    fill: color-mix(in srgb, var(--map-ink) 10%, transparent);
  }
  .grid-line {
    fill: none;
    stroke: var(--map-grid);
    stroke-width: 0.04;
  }
  .wall {
    fill: none;
    stroke: var(--map-ink);
    stroke-width: 0.32;
    stroke-linejoin: miter;
    stroke-linecap: square;
  }
  .wall.inner {
    stroke-linecap: square;
  }
  .wall-run {
    fill: none;
    stroke: var(--accent);
    stroke-width: 0.12;
    stroke-dasharray: 0.4 0.28;
    stroke-linecap: round;
  }
  .wall-run.removing {
    stroke: var(--danger);
  }
  .door {
    fill: var(--map-floor);
    stroke: var(--map-ink);
    stroke-width: 0.11;
  }
  .lock {
    fill: none;
    stroke: var(--map-ink);
    stroke-width: 0.14;
  }
  .secret {
    font: 600 0.84px Georgia, "Times New Roman", serif;
    fill: var(--map-ink);
    text-anchor: middle;
    dominant-baseline: central;
    paint-order: stroke;
    stroke: var(--map-floor);
    stroke-width: 0.24;
  }
  .note {
    font: italic 500 1px Georgia, "Times New Roman", serif;
    fill: var(--map-ink);
    text-anchor: middle;
    dominant-baseline: central;
    /* A halo in the floor's color, so it reads over walls and hatching. */
    paint-order: stroke;
    stroke: var(--map-floor);
    stroke-width: 0.32;
    stroke-linejoin: round;
  }
  .note-edit {
    position: absolute;
    translate: -50% -50%;
    min-width: 4em;
    field-sizing: content;
    padding: 0.05em 0.3em;
    border: none;
    border-radius: 0.2em;
    outline: 0.08em solid var(--accent);
    background: var(--map-floor);
    color: var(--map-ink);
    font-family: Georgia, "Times New Roman", serif;
    font-style: italic;
    text-align: center;
    user-select: text;
    -webkit-user-select: text;
  }
  .number {
    font: 700 1.12px Georgia, "Times New Roman", serif;
    fill: var(--map-ink);
    text-anchor: middle;
    dominant-baseline: central;
  }
  .stamp {
    color: var(--map-ink);
  }
  .route {
    fill: var(--map-ink);
  }
  .route.red {
    fill: var(--map-red);
  }
  .route-line {
    fill: none;
    stroke: var(--map-ink);
    stroke-width: 0.13;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .route.red .route-line {
    stroke: var(--map-red);
  }
  .route-line.dashed {
    stroke-dasharray: 0.55 0.35;
  }
  /* Round caps on near-zero dashes: dots. */
  .route-line.dotted {
    stroke-width: 0.18;
    stroke-dasharray: 0.001 0.38;
  }
  .stamp.ghost {
    color: var(--accent);
    opacity: 0.5;
  }
  .number.small {
    font-size: 0.8px;
  }
  .edit-grid-line {
    fill: none;
    stroke: color-mix(in srgb, var(--accent) 35%, transparent);
    stroke-width: 0.05;
  }
  .edit-grid-line.half {
    stroke: color-mix(in srgb, var(--accent) 18%, transparent);
    stroke-width: 0.03;
  }
  .hover-cell {
    fill: color-mix(in srgb, var(--accent) 30%, transparent);
  }
  .hover-cell.erase {
    fill: color-mix(in srgb, var(--danger) 30%, transparent);
  }
  .hover-edge {
    stroke: var(--accent);
    stroke-width: 0.28;
    stroke-linecap: round;
  }
  .room-rect {
    fill: none;
    stroke: var(--accent);
    stroke-width: 0.12;
    stroke-dasharray: 0.4 0.28;
  }
</style>
