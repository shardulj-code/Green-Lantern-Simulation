import { CONSTRUCTS, constructById, type ConstructId } from "@/lib/lantern/catalog";

export interface Pix {
  x: number;
  y: number;
  visibility?: number;
}

export interface HandDraw {
  landmarks: Pix[];
  index: Pix;
  palm: Pix;
  wrist: Pix;
  ring: Pix;
  ringRadius: number;
  angle: number;
  span: number;
  fist: boolean;
  pointing: boolean;
}

export interface ConstructDraw {
  id: ConstructId;
  phase: "form" | "active" | "dismiss";
  age: number;
}

export interface FrameInput {
  cssW: number;
  cssH: number;
  dpr: number;
  dt: number;
  time: number;
  hand: HandDraw | null;
  pose: Pix[] | null;
  face: Pix[] | null;
  bodyWidth: number;
  bodyHeight: number;
  ring: boolean;
  equipP: number;
  chargeP: number;
  construct: ConstructDraw | null;
  suit: number;
  debug: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
}

const particles: Particle[] = Array.from({ length: 200 }, () => ({
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  life: 0,
  max: 1,
  r: 2,
}));
let cursor = 0;

const images = new Map<ConstructId, HTMLImageElement>();

export function preloadConstructs() {
  if (typeof Image === "undefined") return;
  for (const item of CONSTRUCTS) {
    if (images.has(item.id)) continue;
    const img = new Image();
    img.decoding = "async";
    img.src = `/constructs/${item.file}`;
    images.set(item.id, img);
  }
}

function emit(x: number, y: number, vx: number, vy: number, life: number, r: number) {
  const p = particles[cursor % particles.length];
  cursor += 1;
  p.x = x;
  p.y = y;
  p.vx = vx;
  p.vy = vy;
  p.life = life;
  p.max = life;
  p.r = r;
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function easeOut(t: number) {
  const x = clamp(t, 0, 1);
  return 1 - (1 - x) ** 3;
}

function ready(id: ConstructId) {
  const img = images.get(id);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

function sized(id: ConstructId, bodyWidth: number, bodyHeight: number) {
  const spec = constructById(id);
  const aspect = spec.srcW / spec.srcH;
  let w: number;
  let h: number;
  if (spec.limit === "width") {
    w = bodyWidth * spec.ratio;
    h = w / aspect;
  } else {
    const long = bodyHeight * spec.ratio;
    if (spec.srcW >= spec.srcH) {
      w = long;
      h = long / aspect;
    } else {
      h = long;
      w = h * aspect;
    }
  }
  return { w, h };
}

function fitToSafe(
  x: number,
  y: number,
  w: number,
  h: number,
  angle: number,
  anchor: "center" | "tail",
  cssW: number,
  cssH: number,
) {
  const safeL = cssW * 0.05;
  const safeR = cssW * 0.95;
  const safeT = cssH * 0.1;
  const safeB = cssH * 0.84;
  const safeW = safeR - safeL;
  const safeH = safeB - safeT;
  const boxOf = (bw: number, bh: number) => {
    const corners =
      anchor === "center"
        ? [
            [-bw / 2, -bh / 2],
            [bw / 2, -bh / 2],
            [bw / 2, bh / 2],
            [-bw / 2, bh / 2],
          ]
        : [
            [0, -bh / 2],
            [bw, -bh / 2],
            [bw, bh / 2],
            [0, bh / 2],
          ];
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [px, py] of corners) {
      const rx = x + px * c - py * s;
      const ry = y + px * s + py * c;
      minX = Math.min(minX, rx);
      maxX = Math.max(maxX, rx);
      minY = Math.min(minY, ry);
      maxY = Math.max(maxY, ry);
    }
    return { minX, maxX, minY, maxY, bw: maxX - minX, bh: maxY - minY };
  };
  let box = boxOf(w, h);
  if (box.bw > safeW || box.bh > safeH) {
    const k = Math.min(safeW / box.bw, safeH / box.bh) * 0.98;
    w *= k;
    h *= k;
    box = boxOf(w, h);
  }
  if (box.minX < safeL) x += safeL - box.minX;
  if (box.maxX > safeR) x -= box.maxX - safeR;
  box = boxOf(w, h);
  if (box.minY < safeT) y += safeT - box.minY;
  if (box.maxY > safeB) y -= box.maxY - safeB;
  return { x, y, w, h };
}

function drawImageLocal(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
  anchor: "center" | "tail",
  clip?: { x: number; y: number; w: number; h: number },
) {
  ctx.save();
  if (clip) {
    ctx.beginPath();
    ctx.rect(clip.x, clip.y, clip.w, clip.h);
    ctx.clip();
  }
  if (anchor === "tail") ctx.drawImage(img, 0, -h / 2, w, h);
  else ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

function slice(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  vbW: number,
  vbH: number,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  ctx.drawImage(img, (sx / vbW) * iw, (sy / vbH) * ih, (sw / vbW) * iw, (sh / vbH) * ih, dx, dy, dw, dh);
}

function drawConstruct(
  ctx: CanvasRenderingContext2D,
  frame: FrameInput,
  hand: HandDraw | null,
  pose: Pix[] | null,
) {
  const item = frame.construct;
  if (!item) return;
  const spec = constructById(item.id);
  const reveal =
    item.phase === "form" ? easeOut(item.age / 0.55) : item.phase === "dismiss" ? 1 - easeOut(item.age / 0.3) : 1;
  if (reveal <= 0.02) return;
  const { w: rawW, h: rawH } = sized(item.id, frame.bodyWidth, frame.bodyHeight);
  const pop = item.id === "sword" || item.id === "wall" ? 1 : 0.62 + 0.38 * reveal;
  let w = rawW * pop;
  let h = rawH * pop;
  const torso = torsoPoint(pose, frame);
  const palm = hand?.palm ?? torso;
  const aim = hand?.angle ?? -0.4;
  const reach = hand ? hand.span * 0.85 : 36;
  let x = palm.x;
  let y = palm.y;
  let angle = spec.aim ? aim : 0;
  const anchor: "center" | "tail" = spec.aim ? "tail" : "center";
  if (item.id === "shield") {
    x = palm.x + Math.cos(aim) * reach;
    y = palm.y + Math.sin(aim) * reach;
    angle = aim * 0.12;
  } else if (item.id === "burst") {
    x = palm.x + Math.cos(aim) * reach * 0.45;
    y = palm.y + Math.sin(aim) * reach * 0.45;
  } else if (item.id === "wall") {
    x = torso.x;
    y = torso.y + frame.bodyHeight * 0.08;
  } else if (item.id === "cage") {
    x = torso.x + (palm.x - torso.x) * 0.35;
    y = torso.y + frame.bodyHeight * 0.02;
  } else if (item.id === "fist") {
    const punch = Math.sin(frame.time * 2.4) * Math.min(18, w * 0.08);
    x = palm.x + Math.cos(aim) * (reach + punch);
    y = palm.y + Math.sin(aim) * (reach + punch);
  } else if (item.id === "jet") {
    y += Math.sin(frame.time * 3) * 7;
  } else if (item.id === "bat") {
    angle += Math.sin(frame.time * 2.6) * 0.42;
  } else if (item.id === "hammer") {
    y += Math.sin(frame.time * 2.1) * 5;
  }
  const fit = fitToSafe(x, y, w, h, angle, anchor, frame.cssW, frame.cssH);
  x = fit.x;
  y = fit.y;
  w = fit.w;
  h = fit.h;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = reveal;
  ctx.shadowColor = "#3dff8a";
  ctx.shadowBlur = 18;

  const img = ready(item.id);
  if (item.id === "grapple" && img) {
    drawGrapple(ctx, img, w, h, frame.time, reveal);
  } else if (img) {
    let clip: { x: number; y: number; w: number; h: number } | undefined;
    if (item.id === "sword") {
      const len = w * (item.phase === "dismiss" ? reveal : item.phase === "form" ? reveal : 1);
      clip = { x: 0, y: -h / 2 - 4, w: Math.max(2, len), h: h + 8 };
    } else if (item.id === "wall") {
      const grown = h * (item.phase === "dismiss" ? reveal : item.phase === "form" ? reveal : 1);
      clip = { x: -w / 2 - 4, y: h / 2 - grown, w: w + 8, h: grown + 4 };
    }
    if (item.id === "bat") {
      ctx.save();
      ctx.globalAlpha = reveal * 0.25;
      ctx.rotate(-0.18);
      drawImageLocal(ctx, img, w, h, anchor);
      ctx.restore();
    }
    drawImageLocal(ctx, img, w, h, anchor, clip);
    if (item.id === "sword") {
      const gleam = ((frame.time * 0.45) % 1) * w;
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(244,255,246,0.75)";
      ctx.fillRect(gleam, -h * 0.08, Math.max(6, w * 0.04), h * 0.16);
    }
  } else {
    drawFallback(ctx, item.id, w, h, anchor);
  }
  ctx.restore();

  if (item.id === "shield") {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(frame.time * 1.4);
    ctx.globalAlpha = reveal;
    ctx.strokeStyle = "#d6ff4a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(w, h) * 0.46, 0, Math.PI * 1.35);
    ctx.stroke();
    ctx.restore();
    if (Math.random() < 0.6) {
      const a = Math.random() * Math.PI * 2;
      const rad = Math.max(w, h) * 0.42;
      emit(x + Math.cos(a) * rad, y + Math.sin(a) * rad, Math.cos(a) * 20, Math.sin(a) * 20, 0.5, 2);
    }
  }
  if (item.id === "burst") {
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = reveal * 0.85;
    ctx.strokeStyle = "#eaffea";
    ctx.lineWidth = 2;
    for (let i = 0; i < 10; i++) {
      const a = frame.time * 1.6 + (i * Math.PI * 2) / 10;
      const len = w * (0.35 + 0.2 * Math.sin(frame.time * 7 + i));
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * w * 0.12, Math.sin(a) * w * 0.12);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.stroke();
    }
    const wave = (frame.time % 0.8) / 0.8;
    ctx.globalAlpha = (1 - wave) * reveal;
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.2 + wave * w * 0.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    emit(x, y, (Math.random() - 0.5) * 180, (Math.random() - 0.5) * 180, 0.35, 2.4);
  }
  if (item.id === "drill") {
    const tipX = x + Math.cos(angle) * w;
    const tipY = y + Math.sin(angle) * w;
    emit(tipX, tipY, Math.cos(angle) * 40 + (Math.random() - 0.5) * 30, Math.sin(angle) * 40, 0.3, 2);
    ctx.save();
    ctx.translate(x + Math.cos(angle) * w * 0.55, y + Math.sin(angle) * w * 0.55);
    ctx.rotate(angle + frame.time * 9);
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, h * 0.28, frame.time * 3, frame.time * 3 + 1.2);
    ctx.stroke();
    ctx.restore();
  }
  if (item.id === "cannon") {
    const mx = x + Math.cos(angle) * w * 0.92;
    const my = y + Math.sin(angle) * w * 0.92;
    const pulse = 0.5 + 0.5 * Math.sin(frame.time * 8);
    ctx.save();
    ctx.globalAlpha = reveal * (0.35 + pulse * 0.45);
    ctx.fillStyle = "#eaffea";
    ctx.beginPath();
    ctx.arc(mx, my, h * (0.18 + pulse * 0.16), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (item.id === "jet") {
    const bx = x - Math.cos(angle) * 6;
    const by = y - Math.sin(angle) * 6;
    emit(bx, by, -Math.cos(angle) * (80 + Math.random() * 80), -Math.sin(angle) * 90, 0.35, 3);
    emit(
      bx + Math.sin(angle) * 8,
      by - Math.cos(angle) * 8,
      -Math.cos(angle) * 70,
      -Math.sin(angle) * 70,
      0.28,
      2,
    );
  }
  if (item.id === "cage" && Math.random() < 0.5) {
    emit(x + (Math.random() - 0.5) * w, y + (Math.random() - 0.5) * h, 0, -20, 0.45, 1.6);
  }
  if (item.id === "wall") {
    ctx.save();
    ctx.globalAlpha = 0.35 * reveal;
    ctx.strokeStyle = "#f4fff6";
    ctx.lineWidth = 2;
    const scan = ((frame.time * 0.35) % 1) * h;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.42, y - h / 2 + scan);
    ctx.lineTo(x + w * 0.42, y - h / 2 + scan);
    ctx.stroke();
    ctx.restore();
  }
}

function drawGrapple(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
  time: number,
  reveal: number,
) {
  const cycle = (time % 1.7) / 1.7;
  let ext: number;
  if (cycle < 0.42) ext = easeOut(cycle / 0.42);
  else if (cycle < 0.62) ext = 1;
  else ext = 1 - easeOut((cycle - 0.62) / 0.38);
  ext *= reveal;
  const launcherW = w * 0.28;
  const hookW = w * 0.22;
  slice(ctx, img, 360, 150, 0, 36, 120, 90, 0, -h * 0.32, launcherW, h * 0.64);
  const hookX = launcherW * 0.7 + ext * (w - launcherW - hookW);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#b6ff6a";
  ctx.lineWidth = Math.max(2, h * 0.06);
  ctx.beginPath();
  ctx.moveTo(launcherW * 0.85, 0);
  ctx.quadraticCurveTo((launcherW + hookX) / 2, -h * 0.35 * Math.sin(time * 2), hookX, 0);
  ctx.stroke();
  ctx.shadowBlur = 16;
  slice(ctx, img, 360, 150, 280, 48, 80, 90, hookX, -h * 0.34, hookW, h * 0.68);
}

function drawFallback(
  ctx: CanvasRenderingContext2D,
  id: ConstructId,
  w: number,
  h: number,
  anchor: "center" | "tail",
) {
  ctx.fillStyle = "rgba(20, 255, 140, 0.35)";
  ctx.strokeStyle = "#d6ff4a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  if (anchor === "tail") {
    if (id === "sword" || id === "bat" || id === "drill") {
      ctx.moveTo(0, 0);
      ctx.lineTo(w, -h / 2);
      ctx.lineTo(w, h / 2);
      ctx.closePath();
    } else {
      ctx.rect(0, -h / 2, w, h);
    }
  } else if (id === "shield") {
    ctx.moveTo(0, -h / 2);
    ctx.lineTo(w / 2, -h * 0.2);
    ctx.lineTo(w * 0.35, h / 2);
    ctx.lineTo(-w * 0.35, h / 2);
    ctx.lineTo(-w / 2, -h * 0.2);
    ctx.closePath();
  } else {
    ctx.rect(-w / 2, -h / 2, w, h);
  }
  ctx.fill();
  ctx.stroke();
}

function torsoPoint(pose: Pix[] | null, frame: FrameInput) {
  if (pose && pose[11] && pose[12]) {
    return { x: (pose[11].x + pose[12].x) / 2, y: (pose[11].y + pose[12].y) / 2 + frame.bodyHeight * 0.12 };
  }
  return { x: frame.cssW * 0.5, y: frame.cssH * 0.55 };
}

function drawSuit(ctx: CanvasRenderingContext2D, frame: FrameInput) {
  if (frame.suit < 0.02 || !frame.pose) return;
  const pose = frame.pose;
  const a = frame.suit;
  const shoulderL = pose[11];
  const shoulderR = pose[12];
  const elbowL = pose[13];
  const elbowR = pose[14];
  const wristL = pose[15];
  const wristR = pose[16];
  const hipL = pose[23];
  const hipR = pose[24];
  if (!shoulderL || !shoulderR || !hipL || !hipR) return;
  ctx.save();
  ctx.globalAlpha = 0.22 * a;
  ctx.fillStyle = "#14c96a";
  ctx.beginPath();
  ctx.moveTo(shoulderL.x, shoulderL.y);
  ctx.lineTo(shoulderR.x, shoulderR.y);
  ctx.lineTo(hipR.x, hipR.y);
  ctx.lineTo(hipL.x, hipL.y);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = a;
  ctx.strokeStyle = "#b6ff6a";
  ctx.lineWidth = Math.max(2, frame.bodyWidth * 0.015);
  ctx.shadowColor = "#3dff8a";
  ctx.shadowBlur = 12;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(shoulderL.x, shoulderL.y);
  ctx.lineTo(shoulderR.x, shoulderR.y);
  ctx.moveTo(shoulderL.x, shoulderL.y);
  if (elbowL) ctx.lineTo(elbowL.x, elbowL.y);
  if (wristL && elbowL) ctx.lineTo(wristL.x, wristL.y);
  ctx.moveTo(shoulderR.x, shoulderR.y);
  if (elbowR) ctx.lineTo(elbowR.x, elbowR.y);
  if (wristR && elbowR) ctx.lineTo(wristR.x, wristR.y);
  const cx = (shoulderL.x + shoulderR.x) / 2;
  const cy = (shoulderL.y + shoulderR.y) / 2;
  const hx = (hipL.x + hipR.x) / 2;
  const hy = (hipL.y + hipR.y) / 2;
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + (hx - cx) * 0.55, cy + (hy - cy) * 0.55);
  ctx.stroke();
  const ex = cx + (hx - cx) * 0.28;
  const ey = cy + (hy - cy) * 0.28;
  const er = Math.max(10, frame.bodyWidth * 0.06) * (0.4 + 0.6 * a);
  ctx.beginPath();
  ctx.arc(ex, ey, er, 0, Math.PI * 2);
  ctx.strokeStyle = "#eaffea";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(ex, ey, er * 0.45, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ex - er * 0.7, ey);
  ctx.lineTo(ex - er * 0.2, ey);
  ctx.moveTo(ex + er * 0.2, ey);
  ctx.lineTo(ex + er * 0.7, ey);
  ctx.stroke();
  ctx.restore();

  if (!frame.face || frame.face.length < 460) return;
  const face = frame.face;
  const le = face[33];
  const re = face[263];
  const cheekL = face[234];
  const cheekR = face[454];
  if (!le || !re || !cheekL || !cheekR) return;
  const eye = Math.hypot(re.x - le.x, re.y - le.y);
  const ang = Math.atan2(re.y - le.y, re.x - le.x);
  const mx = (le.x + re.x) / 2;
  const my = (le.y + re.y) / 2;
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(ang);
  ctx.globalAlpha = 0.82 * a;
  ctx.fillStyle = "#063d22";
  ctx.strokeStyle = "#d6ff4a";
  ctx.lineWidth = Math.max(2, eye * 0.08);
  ctx.shadowColor = "#3dff8a";
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.moveTo(-eye * 1.35, -eye * 0.05);
  ctx.lineTo(-eye * 0.15, -eye * 0.42);
  ctx.lineTo(0, -eye * 0.08);
  ctx.lineTo(eye * 0.15, -eye * 0.42);
  ctx.lineTo(eye * 1.35, -eye * 0.05);
  ctx.lineTo(eye * 0.95, eye * 0.28);
  ctx.quadraticCurveTo(0, eye * 0.55, -eye * 0.95, eye * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.ellipse(-eye * 0.55, 0, eye * 0.32, eye * 0.16, 0, 0, Math.PI * 2);
  ctx.ellipse(eye * 0.55, 0, eye * 0.32, eye * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawRing(ctx: CanvasRenderingContext2D, frame: FrameInput) {
  const hand = frame.hand;
  if (!frame.ring || !hand) return;
  const pop = easeOut(frame.equipP);
  const r = Math.max(8, hand.ringRadius) * (0.35 + 0.65 * pop);
  ctx.save();
  ctx.translate(hand.ring.x, hand.ring.y);
  ctx.rotate(hand.angle);
  ctx.globalAlpha = 0.35 + 0.65 * pop;
  ctx.shadowColor = "#3dff8a";
  ctx.shadowBlur = 16;
  ctx.strokeStyle = "#9cffc4";
  ctx.lineWidth = Math.max(3, r * 0.28);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#042616";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#eaffea";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "#d6ff4a";
  ctx.lineWidth = Math.max(2, r * 0.12);
  ctx.beginPath();
  ctx.moveTo(-r * 0.62, 0);
  ctx.lineTo(-r * 0.18, 0);
  ctx.moveTo(r * 0.18, 0);
  ctx.lineTo(r * 0.62, 0);
  ctx.stroke();
  ctx.fillStyle = "#f4fff6";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (frame.chargeP > 0.02) {
    ctx.save();
    ctx.translate(hand.palm.x, hand.palm.y);
    ctx.strokeStyle = "#d6ff4a";
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(0, 0, hand.span * 0.9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frame.chargeP);
    ctx.stroke();
    ctx.restore();
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, dt: number) {
  ctx.save();
  for (const p of particles) {
    if (p.life <= 0) continue;
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const t = Math.max(0, p.life / p.max);
    ctx.globalAlpha = t;
    ctx.fillStyle = "#b6ff6a";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawDebug(ctx: CanvasRenderingContext2D, frame: FrameInput) {
  if (!frame.debug) return;
  ctx.save();
  ctx.shadowBlur = 0;
  if (frame.hand) {
    ctx.fillStyle = "#d6ff4a";
    for (const p of frame.hand.landmarks) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "#f4fff6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(frame.hand.index.x, frame.hand.index.y, 14, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (frame.pose && frame.pose[11] && frame.pose[12] && frame.pose[23] && frame.pose[24]) {
    const xs = [frame.pose[11], frame.pose[12], frame.pose[23], frame.pose[24]].map((p) => p.x);
    const ys = [frame.pose[11], frame.pose[12], frame.pose[23], frame.pose[24]].map((p) => p.y);
    ctx.strokeStyle = "rgba(214,255,74,0.8)";
    ctx.strokeRect(
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
    );
  }
  if (frame.face && frame.face[10] && frame.face[152] && frame.face[234] && frame.face[454]) {
    ctx.strokeStyle = "rgba(180,255,220,0.7)";
    const xs = [frame.face[234].x, frame.face[454].x];
    const ys = [frame.face[10].y, frame.face[152].y];
    ctx.strokeRect(Math.min(...xs), Math.min(...ys), Math.abs(xs[1] - xs[0]), Math.abs(ys[1] - ys[0]));
  }
  ctx.restore();
}

export function drawFrame(ctx: CanvasRenderingContext2D, frame: FrameInput) {
  const { cssW, cssH, dpr } = frame;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const vignette = ctx.createRadialGradient(
    cssW * 0.5,
    cssH * 0.45,
    cssW * 0.2,
    cssW * 0.5,
    cssH * 0.5,
    cssW * 0.75,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, cssW, cssH);

  drawSuit(ctx, frame);
  drawConstruct(ctx, frame, frame.hand, frame.pose);
  drawParticles(ctx, frame.dt);
  if (frame.ring) drawRing(ctx, frame);
  else if (frame.hand && frame.equipP > 0.02) {
    ctx.save();
    ctx.translate(frame.hand.palm.x, frame.hand.palm.y);
    ctx.strokeStyle = "#3dff8a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, frame.hand.span, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frame.equipP);
    ctx.stroke();
    ctx.restore();
  }
  drawDebug(ctx, frame);
}
