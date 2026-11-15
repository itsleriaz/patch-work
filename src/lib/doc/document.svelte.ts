import type { Asset, CanvasLink, CanvasNode } from "./types";

export class Doc {
  assets = $state<Record<string, Asset>>({});
  nodes = $state<Record<string, CanvasNode>>({});
  links = $state<Record<string, CanvasLink>>({});

  nodeList = $derived(Object.values(this.nodes));
  linkList = $derived(Object.values(this.links));

  maxZ(): number {
    let z = 0;
    for (const n of this.nodeList) z = Math.max(z, n.z);
    return z;
  }

  assetOf(node: CanvasNode): Asset | undefined {
    return node.assetId ? this.assets[node.assetId] : undefined;
  }

  /** Links touching any of these nodes. */
  linksOf(nodeIds: Iterable<string>): CanvasLink[] {
    const ids = new Set(nodeIds);
    return this.linkList.filter((l) => ids.has(l.from) || ids.has(l.to));
  }

  /** Links with both ends among these nodes (what copy and duplicate carry along). */
  linksWithin(nodeIds: Iterable<string>): CanvasLink[] {
    const ids = new Set(nodeIds);
    return this.linkList.filter((l) => ids.has(l.from) && ids.has(l.to));
  }

  /** An existing link between two nodes, in either direction. */
  linkBetween(a: string, b: string): CanvasLink | undefined {
    return this.linkList.find((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a));
  }

  replace(assets: Asset[], nodes: CanvasNode[], links: CanvasLink[] = []) {
    this.assets = Object.fromEntries(assets.map((a) => [a.id, a]));
    this.nodes = Object.fromEntries(nodes.map((n) => [n.id, n]));
    this.links = Object.fromEntries(links.filter((l) => this.nodes[l.from] && this.nodes[l.to]).map((l) => [l.id, l]));
  }

  /** Assets referenced by at least one node. Unreferenced ones are not saved. */
  usedAssets(): Asset[] {
    const ids = new Set(this.nodeList.map((n) => n.assetId).filter((id) => id !== null));
    return [...ids].map((id) => this.assets[id]).filter((a) => a !== undefined);
  }
}
