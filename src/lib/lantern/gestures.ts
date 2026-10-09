export interface NormPoint {
  x: number;
  y: number;
  visibility?: number;
}

const TIPS = [8, 12, 16, 20];
const PIPS = [6, 10, 14, 18];
const MCPS = [5, 9, 13, 17];

function hypot(a: NormPoint, b: NormPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function fingerOut(lm: NormPoint[], index: number) {
  const wrist = lm[0];
  const tip = lm[TIPS[index]];
  const pip = lm[PIPS[index]];
  const mcp = lm[MCPS[index]];
  if (!wrist || !tip || !pip || !mcp) return false;
  const tipD = hypot(tip, wrist);
  const pipD = hypot(pip, wrist);
  const mcpD = hypot(mcp, wrist);
  return tipD > pipD * 1.1 && tipD > mcpD * 1.02;
}

export interface Gesture {
  fist: boolean;
  openPalm: boolean;
  pointing: boolean;
  closeness: number;
}

/** Classify a single MediaPipe hand. Coordinates are normalized and unmirrored. */
export function classifyHand(lm: NormPoint[]): Gesture {
  const outs = [0, 1, 2, 3].map((i) => fingerOut(lm, i));
  const count = outs.filter(Boolean).length;
  const wrist = lm[0];
  let curled = 0;
  if (wrist) {
    for (let i = 0; i < 4; i++) {
      const tip = lm[TIPS[i]];
      const mcp = lm[MCPS[i]];
      if (!tip || !mcp) continue;
      if (hypot(tip, wrist) < hypot(mcp, wrist) * 1.28) curled += 1;
    }
  }
  const pointing = Boolean(outs[0] && count <= 2 && !outs[2] && !outs[3]);
  const fist = !pointing && (curled >= 3 || count === 0);
  const openPalm = count >= 3;
  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;
  for (const p of lm) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return {
    fist,
    openPalm,
    pointing,
    closeness: Math.max(maxX - minX, maxY - minY),
  };
}

/**
 * Map an unmirrored normalized landmark into on-screen CSS pixels.
 * The video is object-fit: cover and mirrored with scaleX(-1).
 */
export function mapMirroredCover(
  nx: number,
  ny: number,
  vidW: number,
  vidH: number,
  boxW: number,
  boxH: number,
) {
  const scale = Math.max(boxW / vidW, boxH / vidH);
  const dispW = vidW * scale;
  const dispH = vidH * scale;
  const offX = (boxW - dispW) / 2;
  const offY = (boxH - dispH) / 2;
  const rawX = offX + nx * dispW;
  const rawY = offY + ny * dispH;
  return { x: boxW - rawX, y: rawY };
}

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Forgiving fingertip hit. Padding is in CSS pixels. No hardcoded row split. */
export function fingerHits(x: number, y: number, rect: ScreenRect, padX = 16, padY = 12) {
  return x >= rect.left - padX && x <= rect.right + padX && y >= rect.top - padY && y <= rect.bottom + padY;
}
