import type { ConstructId } from "@/lib/lantern/catalog";
import { fingerHits, type ScreenRect } from "@/lib/lantern/gestures";

export interface MenuRect extends ScreenRect {
  id: ConstructId;
}

export type Cue = "equip" | "select" | "form" | "active" | "dismiss" | "recharge" | "low" | "suit";

const DWELL = 0.34;
const EQUIP_T = 0.36;
const CHARGE_T = 0.8;
const FORM_T = 0.55;
const DISMISS_T = 0.3;

export interface Sense {
  dt: number;
  fist: boolean;
  openPalm: boolean;
  pointing: boolean;
  closeness: number;
  fingerX: number;
  fingerY: number;
  rects: MenuRect[];
}

export class Session {
  ring = false;
  battery = 10;
  activations = 0;
  selected: ConstructId | null = null;
  phase: "none" | "form" | "active" | "dismiss" = "none";
  phaseAge = 0;
  hover: ConstructId | null = null;
  hoverAge = 0;
  dwellLock: ConstructId | null = null;
  equipAge = 0;
  chargeAge = 0;
  sawFist = false;
  suitWanted = false;
  suit = 0;
  lowLatched = false;
  sector = false;
  flash = 0;
  private lowStamp = 0;

  get hoverP() {
    if (!this.hover) return 0;
    if (this.dwellLock === this.hover) return 1;
    return Math.min(1, this.hoverAge / DWELL);
  }

  get equipP() {
    return this.ring ? 1 : Math.min(1, this.equipAge / EQUIP_T);
  }

  get chargeP() {
    return Math.min(1, this.chargeAge / CHARGE_T);
  }

  toggleSuit(now: number): Cue[] {
    this.suitWanted = !this.suitWanted;
    if (this.suitWanted) return ["suit"];
    void now;
    return [];
  }

  select(id: ConstructId, now: number): Cue[] {
    if (!this.ring) return [];
    if (this.battery <= 0) {
      return this.lowCue(now);
    }
    if (this.selected === id && (this.phase === "form" || this.phase === "active")) return [];
    const cues: Cue[] = ["select", "form"];
    this.battery -= 1;
    this.activations += 1;
    this.selected = id;
    this.phase = "form";
    this.phaseAge = 0;
    this.sawFist = false;
    if (this.battery <= 0) cues.push(...this.lowCue(now));
    return cues;
  }

  private lowCue(now: number): Cue[] {
    this.lowLatched = true;
    if (now - this.lowStamp < 0.9) return [];
    this.lowStamp = now;
    return ["low"];
  }

  update(sense: Sense, now: number): Cue[] {
    const cues: Cue[] = [];
    const dt = Math.min(0.05, Math.max(0, sense.dt));
    const suitTarget = this.suitWanted ? 1 : 0;
    this.suit += (suitTarget - this.suit) * Math.min(1, dt * 3.4);
    if (this.ring) this.flash = Math.min(1, this.flash + dt / 0.45);

    if (!this.ring) {
      if (sense.fist && sense.closeness >= 0.2) this.equipAge += dt;
      else this.equipAge = 0;
      if (this.equipAge >= EQUIP_T) {
        this.ring = true;
        this.sector = true;
        this.equipAge = 0;
        cues.push("equip");
      }
    } else if (sense.fist && sense.closeness >= 0.33 && this.battery < 10) {
      this.chargeAge += dt;
      if (this.chargeAge >= CHARGE_T) {
        this.battery = 10;
        this.chargeAge = 0;
        this.lowLatched = false;
        cues.push("recharge");
      }
    } else {
      this.chargeAge = Math.max(0, this.chargeAge - dt * 1.6);
    }

    let hit: ConstructId | null = null;
    if (this.ring && sense.pointing) {
      let best = Infinity;
      for (const rect of sense.rects) {
        if (!fingerHits(sense.fingerX, sense.fingerY, rect)) continue;
        const cx = (rect.left + rect.right) / 2;
        const cy = (rect.top + rect.bottom) / 2;
        const dist = (sense.fingerX - cx) ** 2 + (sense.fingerY - cy) ** 2;
        if (dist < best) {
          best = dist;
          hit = rect.id;
        }
      }
    }
    if (hit !== this.hover) {
      this.hover = hit;
      this.hoverAge = 0;
      this.dwellLock = null;
    } else if (hit && this.dwellLock !== hit) {
      this.hoverAge += dt;
      if (this.hoverAge >= DWELL) {
        this.dwellLock = hit;
        cues.push(...this.select(hit, now));
      }
    }

    if (this.phase !== "none") {
      this.phaseAge += dt;
      if (sense.fist) this.sawFist = true;
      const busyHover = this.hover !== null;
      if (
        (this.phase === "form" || this.phase === "active") &&
        this.sawFist &&
        sense.openPalm &&
        !busyHover &&
        this.phaseAge > 0.28
      ) {
        this.phase = "dismiss";
        this.phaseAge = 0;
        cues.push("dismiss");
      } else if (this.phase === "form" && this.phaseAge >= FORM_T) {
        this.phase = "active";
        this.phaseAge = 0;
        cues.push("active");
      } else if (this.phase === "dismiss" && this.phaseAge >= DISMISS_T) {
        this.phase = "none";
        this.selected = null;
        this.phaseAge = 0;
        this.sawFist = false;
      }
    }

    return cues;
  }
}
