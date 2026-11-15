import { GAME_ICONS } from "./icons.generated";

/**
 * Map stamps: small symbols placed on the map. Architecture is drawn by us, in the map's ink and
 * line weights (classic map conventions: stairs as treads, a pit hatched); things and creatures
 * are icons from game-icons.net (`icons.generated.ts`, CC BY 3.0, credited in Settings).
 *
 * Every stamp is drawn in a box from -1 to 1, scaled to its size on the map.
 */

export type StampGroup = "architecture" | "treasure" | "creatures" | "traps" | "objects";

export const STAMP_GROUPS: [StampGroup, string][] = [
  ["architecture", "Architecture"],
  ["treasure", "Treasure"],
  ["creatures", "Creatures"],
  ["traps", "Traps"],
  ["objects", "Objects"],
];

/** How a stamp is drawn: our own lines and fills, or an icon's path (in its 512 box). */
export type StampLook = { stroke?: string; fill?: string } | { icon: string };

export type StampDef = { id: string; label: string; group: StampGroup; look: StampLook };

const circle = (r: number, cx = 0, cy = 0) => `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
const rect = (x0: number, y0: number, x1: number, y1: number) => `M${x0},${y0}H${x1}V${y1}H${x0}Z`;

/** Diagonal hatching inside a circle: chords along x − y = c. */
function hatchedCircle(r: number, gaps: number[]): string {
  return gaps
    .map((c) => {
      const h = Math.sqrt(Math.max(0, 2 * r * r - c * c));
      const x0 = (c - h) / 2, x1 = (c + h) / 2;
      return `M${x0.toFixed(3)},${(x0 - c).toFixed(3)}L${x1.toFixed(3)},${(x1 - c).toFixed(3)}`;
    })
    .join("");
}

const OWN: StampDef[] = [
  {
    id: "stairs",
    label: "Stairs",
    group: "architecture",
    // Rails, treads, and an arrow toward the top (up): turn the stamp to point them elsewhere.
    look: {
      stroke: "M-0.8,-0.9V0.9M0.8,-0.9V0.9" + [0.85, 0.57, 0.29, 0.01, -0.27, -0.55].map((y) => `M-0.8,${y}H0.8`).join(""),
      fill: "M0,-0.98L0.24,-0.7H-0.24Z",
    },
  },
  { id: "pit", label: "Pit", group: "architecture", look: { stroke: circle(0.8) + hatchedCircle(0.8, [-0.8, -0.4, 0, 0.4, 0.8]) } },
  { id: "trapdoor", label: "Trapdoor", group: "architecture", look: { stroke: rect(-0.75, -0.75, 0.75, 0.75) + "M-0.75,-0.75L0.75,0.75M0.75,-0.75L-0.75,0.75" } },
  { id: "pillar", label: "Pillar", group: "architecture", look: { fill: circle(0.6) } },
  { id: "column", label: "Column", group: "architecture", look: { fill: rect(-0.55, -0.55, 0.55, 0.55) } },
  { id: "altar", label: "Altar", group: "architecture", look: { stroke: rect(-0.85, -0.5, 0.85, 0.5), fill: rect(-0.5, -0.2, 0.5, 0.2) } },
  { id: "fountain", label: "Fountain", group: "architecture", look: { stroke: circle(0.85) + circle(0.45), fill: circle(0.15) } },
  { id: "statue", label: "Statue", group: "architecture", look: { stroke: rect(-0.75, -0.75, 0.75, 0.75), fill: circle(0.42) } },
  {
    id: "rubble",
    label: "Rubble",
    group: "architecture",
    look: {
      fill: [
        "M-0.7,-0.3L-0.4,-0.55L-0.15,-0.35L-0.3,-0.05Z",
        "M0.1,-0.65L0.4,-0.7L0.5,-0.4L0.2,-0.35Z",
        "M0.25,0L0.65,-0.1L0.75,0.25L0.4,0.35Z",
        "M-0.55,0.25L-0.2,0.15L-0.1,0.5L-0.45,0.6Z",
        "M0,0.55L0.2,0.5L0.25,0.7L0.05,0.75Z",
        "M-0.05,-0.1L0.1,-0.15L0.12,0.02L-0.02,0.05Z",
      ].join(""),
    },
  },
];

export const STAMPS: StampDef[] = [...OWN, ...GAME_ICONS.map((i) => ({ id: i.id, label: i.label, group: i.group, look: { icon: i.d } }))];

const byId = new Map(STAMPS.map((s) => [s.id, s]));
export const stampDef = (id: string): StampDef | undefined => byId.get(id);

/** Scale from an icon's 512 box to the stamp's -1..1 box. */
export const ICON_SCALE = 2 / 512;
