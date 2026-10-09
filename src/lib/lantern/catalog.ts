export const CONSTRUCTS = [
  { id: "shield", name: "SHIELD", file: "shield.svg", srcW: 200, srcH: 240, limit: "width", ratio: 0.85, aim: false },
  { id: "burst", name: "ENERGY BURST", file: "burst.svg", srcW: 220, srcH: 220, limit: "width", ratio: 0.3, aim: false },
  { id: "bat", name: "BAT", file: "bat.svg", srcW: 340, srcH: 90, limit: "width", ratio: 0.55, aim: true },
  { id: "hammer", name: "HAMMER", file: "hammer.svg", srcW: 260, srcH: 180, limit: "width", ratio: 0.48, aim: true },
  { id: "sword", name: "SWORD", file: "sword.svg", srcW: 360, srcH: 80, limit: "length", ratio: 0.72, aim: true },
  { id: "wall", name: "WALL", file: "wall.svg", srcW: 320, srcH: 210, limit: "width", ratio: 0.9, aim: false },
  { id: "cannon", name: "CANNON", file: "cannon.svg", srcW: 320, srcH: 180, limit: "width", ratio: 0.48, aim: true },
  { id: "drill", name: "DRILL", file: "drill.svg", srcW: 300, srcH: 120, limit: "length", ratio: 0.4, aim: true },
  { id: "grapple", name: "GRAPPLE", file: "grapple.svg", srcW: 360, srcH: 150, limit: "width", ratio: 0.65, aim: true },
  { id: "cage", name: "CAGE", file: "cage.svg", srcW: 230, srcH: 250, limit: "width", ratio: 0.95, aim: false },
  { id: "jet", name: "JET", file: "jet.svg", srcW: 320, srcH: 150, limit: "length", ratio: 0.45, aim: true },
  { id: "fist", name: "GIANT FIST", file: "fist.svg", srcW: 230, srcH: 200, limit: "width", ratio: 0.38, aim: true },
] as const;

export type ConstructId = (typeof CONSTRUCTS)[number]["id"];

export function constructById(id: ConstructId) {
  const found = CONSTRUCTS.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown construct ${id}`);
  return found;
}
