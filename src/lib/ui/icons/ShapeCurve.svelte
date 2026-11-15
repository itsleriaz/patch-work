<script lang="ts">
  // A curved link: Lucide-style, like Spline.
  let { size = 24, strokeWidth = 2 }: { size?: number; strokeWidth?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={strokeWidth} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="5" cy="19" r="2" />
  <circle cx="19" cy="5" r="2" />
  <path d="M5 17c0-6 14-4 14-10" />
</svg>
