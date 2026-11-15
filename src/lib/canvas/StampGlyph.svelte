<svelte:options namespace="svg" />

<script lang="ts">
  import { ICON_SCALE, stampDef } from "../map/stamps";

  /** A map stamp's symbol, drawn in a box from -1 to 1 (the caller places and scales it). */
  let { kind }: { kind: string } = $props();

  const look = $derived(stampDef(kind)?.look);
  const icon = $derived(look && "icon" in look ? look.icon : null);
  const own = $derived(look && !("icon" in look) ? look : null);
</script>

{#if icon}
  <path d={icon} transform="translate(-1 -1) scale({ICON_SCALE})" class="glyph-fill" />
{:else if own}
  {#if own.fill}<path d={own.fill} class="glyph-fill" />{/if}
  {#if own.stroke}<path d={own.stroke} class="glyph-stroke" />{/if}
{:else}
  <!-- A stamp this version doesn't know (from a newer one): a plain marker. -->
  <path d="M-0.5,-0.5H0.5V0.5H-0.5Z" class="glyph-stroke" />
{/if}

<style>
  .glyph-fill {
    fill: currentColor;
  }
  .glyph-stroke {
    fill: none;
    stroke: currentColor;
    stroke-width: 0.1;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
