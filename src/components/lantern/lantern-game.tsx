import { useEffect, useRef, useState } from "react";
import { BatteryMedium, Bug, Shield, Volume2, VolumeX } from "lucide-react";
import { CONSTRUCTS, constructById, type ConstructId } from "@/lib/lantern/catalog";
import { drawFrame, preloadConstructs, type HandDraw, type Pix } from "@/lib/lantern/draw";
import { classifyHand, mapMirroredCover, type Gesture, type NormPoint } from "@/lib/lantern/gestures";
import { resumeAudio, setAudioMuted, sfx, unlockAudio } from "@/lib/lantern/audio";
import { Session, type Cue, type MenuRect } from "@/lib/lantern/session";

interface Hud {
  ring: boolean;
  battery: number;
  activations: number;
  selected: ConstructId | null;
  phase: Session["phase"];
  suit: boolean;
  low: boolean;
  sector: boolean;
  hover: ConstructId | null;
  chargeP: number;
  fist: boolean;
  pointing: boolean;
  closeness: number;
  fps: number;
  tracking: string;
}

const EMPTY: Hud = {
  ring: false,
  battery: 10,
  activations: 0,
  selected: null,
  phase: "none",
  suit: false,
  low: false,
  sector: false,
  hover: null,
  chargeP: 0,
  fist: false,
  pointing: false,
  closeness: 0,
  fps: 0,
  tracking: "Starting hand tracking…",
};

function playCues(cues: Cue[]) {
  for (const cue of cues) {
    if (cue === "equip") sfx.equip();
    else if (cue === "select") sfx.select();
    else if (cue === "form") sfx.form();
    else if (cue === "active") sfx.active();
    else if (cue === "dismiss") sfx.dismiss();
    else if (cue === "recharge") sfx.recharge();
    else if (cue === "low") sfx.low();
    else if (cue === "suit") sfx.suit();
  }
}

function cameraMessage(err: unknown) {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Camera permission was blocked. Allow the camera for this site, then try again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera was found on this device.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The camera is already in use. Close the other app and try again.";
  }
  if (err instanceof Error && err.message) return err.message;
  return "The camera could not be started.";
}

function smoothToward(prev: Pix[] | null, next: Pix[]) {
  if (!prev || prev.length !== next.length) return next.map((p) => ({ ...p }));
  for (let i = 0; i < next.length; i++) {
    prev[i].x += (next[i].x - prev[i].x) * 0.62;
    prev[i].y += (next[i].y - prev[i].y) * 0.62;
    if (next[i].visibility !== undefined) prev[i].visibility = next[i].visibility;
  }
  return prev;
}

function bodySize(pose: Pix[] | null, handSpan: number, cssW: number, cssH: number) {
  const capW = cssW * 0.46;
  const capH = cssH * 0.72;
  if (pose && pose[11] && pose[12] && (pose[11].visibility ?? 1) > 0.35 && (pose[12].visibility ?? 1) > 0.35) {
    const bodyWidth = Math.hypot(pose[11].x - pose[12].x, pose[11].y - pose[12].y);
    let bodyHeight = bodyWidth * 2.5;
    if (pose[0] && pose[23] && pose[24] && (pose[23].visibility ?? 1) > 0.25) {
      const hipX = (pose[23].x + pose[24].x) / 2;
      const hipY = (pose[23].y + pose[24].y) / 2;
      bodyHeight = Math.hypot(pose[0].x - hipX, pose[0].y - hipY);
    }
    if (bodyWidth > 28 && bodyHeight > 48) {
      return { bodyWidth: Math.min(bodyWidth, capW), bodyHeight: Math.min(bodyHeight, capH) };
    }
  }
  if (handSpan > 8) {
    return {
      bodyWidth: Math.min(Math.max(handSpan * 3.8, 90), capW),
      bodyHeight: Math.min(Math.max(handSpan * 7, 160), capH),
    };
  }
  return { bodyWidth: cssW * 0.34, bodyHeight: cssH * 0.56 };
}

export function LanternGame() {
  const sessionRef = useRef<Session | null>(null);
  if (sessionRef.current === null) sessionRef.current = new Session();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const buttonRefs = useRef<Partial<Record<ConstructId, HTMLButtonElement | null>>>({});
  const debugRef = useRef(false);
  const [mode, setMode] = useState<"gate" | "live" | "error">("gate");
  const [error, setError] = useState("");
  const [hud, setHud] = useState<Hud>(EMPTY);
  const [debug, setDebug] = useState(false);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    preloadConstructs();
  }, []);

  useEffect(() => {
    debugRef.current = debug;
  }, [debug]);

  useEffect(() => {
    if (mode !== "live") return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const session = sessionRef.current;
    if (!video || !canvas || !session) return;

    let dead = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let handTask: { detectForVideo: (v: HTMLVideoElement, t: number) => { landmarks: NormPoint[][] }; close: () => void } | null = null;
    let poseTask: { detectForVideo: (v: HTMLVideoElement, t: number) => { landmarks: NormPoint[][] }; close: () => void } | null = null;
    let faceTask: { detectForVideo: (v: HTMLVideoElement, t: number) => { faceLandmarks: NormPoint[][] }; close: () => void } | null = null;
    let targetHand: Pix[] | null = null;
    let smoothHand: Pix[] | null = null;
    let gesture: Gesture = { fist: false, openPalm: false, pointing: false, closeness: 0 };
    let handAt = 0;
    let targetPose: Pix[] | null = null;
    let smoothPose: Pix[] | null = null;
    let targetFace: Pix[] | null = null;
    let smoothFace: Pix[] | null = null;
    let lastHand = 0;
    let ticks = 0;
    let lastUi = 0;
    let frames = 0;
    let fpsStamp = performance.now();
    let fps = 0;
    let prev = performance.now();
    let detectErrors = 0;
    let visionState: "loading" | "ready" | "failed" = "loading";

    const trackingLabel = () =>
      visionState === "failed"
        ? "HAND TRACKING UNAVAILABLE"
        : visionState === "loading"
          ? "Starting hand tracking…"
          : "";

    const onVis = () => {
      if (document.visibilityState === "visible") resumeAudio();
    };
    document.addEventListener("visibilitychange", onVis);

    const publish = (tracking: string, force = false) => {
      const now = performance.now();
      if (!force && now - lastUi < 90) return;
      lastUi = now;
      const next: Hud = {
        ring: session.ring,
        battery: session.battery,
        activations: session.activations,
        selected: session.selected,
        phase: session.phase,
        suit: session.suitWanted,
        low: session.battery === 0,
        sector: session.sector,
        hover: session.hover,
        chargeP: session.chargeP,
        fist: gesture.fist,
        pointing: gesture.pointing,
        closeness: gesture.closeness,
        fps,
        tracking,
      };
      setHud((prevHud) => {
        const keys = Object.keys(next) as (keyof Hud)[];
        for (const key of keys) if (prevHud[key] !== next[key]) return next;
        return prevHud;
      });
    };

    const loop = (now: number) => {
      if (dead) return;
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      frames += 1;
      if (now - fpsStamp > 500) {
        fps = Math.round((frames * 1000) / (now - fpsStamp));
        frames = 0;
        fpsStamp = now;
      }
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (cssW < 2 || cssH < 2) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const bw = Math.round(cssW * dpr);
      const bh = Math.round(cssH * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }

      if (video.readyState >= 2 && video.videoWidth > 0 && now - lastHand > 48) {
        lastHand = now;
        ticks += 1;
        try {
          if (handTask) {
            const res = handTask.detectForVideo(video, now);
            const raw = res.landmarks[0];
            if (raw && raw.length > 20) {
              detectErrors = 0;
              gesture = classifyHand(raw);
              targetHand = raw.map((p) =>
                mapMirroredCover(p.x, p.y, video.videoWidth, video.videoHeight, cssW, cssH),
              );
              handAt = now;
            }
          }
          if (poseTask && ticks % 3 === 0) {
            const res = poseTask.detectForVideo(video, now + 1);
            const raw = res.landmarks[0];
            if (raw && raw.length > 24) {
              targetPose = raw.map((p) => ({
                ...mapMirroredCover(p.x, p.y, video.videoWidth, video.videoHeight, cssW, cssH),
                visibility: p.visibility,
              }));
            }
          }
          if (faceTask && session.suitWanted && ticks % 2 === 0) {
            const res = faceTask.detectForVideo(video, now + 2);
            const raw = res.faceLandmarks[0];
            if (raw && raw.length > 200) {
              targetFace = raw.map((p) =>
                mapMirroredCover(p.x, p.y, video.videoWidth, video.videoHeight, cssW, cssH),
              );
            }
          }
        } catch {
          detectErrors += 1;
          if (detectErrors > 8) visionState = "failed";
        }
      }

      if (targetHand && now - handAt < 180) smoothHand = smoothToward(smoothHand, targetHand);
      else {
        smoothHand = null;
        gesture = { fist: false, openPalm: false, pointing: false, closeness: 0 };
      }
      if (targetPose) smoothPose = smoothToward(smoothPose, targetPose);
      if (targetFace) smoothFace = smoothToward(smoothFace, targetFace);

      const box = canvas.getBoundingClientRect();
      const rects: MenuRect[] = [];
      for (const item of CONSTRUCTS) {
        const el = buttonRefs.current[item.id];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        rects.push({ id: item.id, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
        const hot = session.hover === item.id;
        if (el.dataset.hot !== (hot ? "1" : "0")) el.dataset.hot = hot ? "1" : "0";
        el.style.setProperty("--p", hot ? session.hoverP.toFixed(3) : "0");
      }

      let hand: HandDraw | null = null;
      if (smoothHand && smoothHand[0] && smoothHand[8] && smoothHand[9] && smoothHand[13] && smoothHand[14]) {
        const wrist = smoothHand[0];
        const index = smoothHand[8];
        const palm = smoothHand[9];
        const ringM = smoothHand[13];
        const ringP = smoothHand[14];
        hand = {
          landmarks: smoothHand,
          index,
          palm,
          wrist,
          ring: { x: ringM.x * 0.42 + ringP.x * 0.58, y: ringM.y * 0.42 + ringP.y * 0.58 },
          ringRadius: Math.hypot(ringP.x - ringM.x, ringP.y - ringM.y) * 1.2,
          angle: Math.atan2(palm.y - wrist.y, palm.x - wrist.x),
          span: Math.max(18, Math.hypot(palm.x - wrist.x, palm.y - wrist.y)),
          fist: gesture.fist,
          pointing: gesture.pointing,
        };
      }

      const cues = session.update(
        {
          dt,
          fist: gesture.fist,
          openPalm: gesture.openPalm,
          pointing: Boolean(hand && gesture.pointing),
          closeness: gesture.closeness,
          fingerX: hand ? box.left + hand.index.x : -9999,
          fingerY: hand ? box.top + hand.index.y : -9999,
          rects,
        },
        now / 1000,
      );
      if (cues.length) {
        playCues(cues);
        publish(trackingLabel(), true);
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const size = bodySize(smoothPose, hand?.span ?? 0, cssW, cssH);
      drawFrame(ctx, {
        cssW,
        cssH,
        dpr,
        dt,
        time: now / 1000,
        hand,
        pose: smoothPose,
        face: session.suit > 0.02 ? smoothFace : null,
        bodyWidth: size.bodyWidth,
        bodyHeight: size.bodyHeight,
        ring: session.ring,
        equipP: session.ring ? session.flash : session.equipP,
        chargeP: session.chargeP,
        construct:
          session.selected && session.phase !== "none"
            ? { id: session.selected, phase: session.phase, age: session.phaseAge }
            : null,
        suit: session.suit,
        debug: debugRef.current,
      });
      publish(trackingLabel());
    };

    const boot = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (err) {
        if (dead) return;
        setError(cameraMessage(err));
        setMode("error");
        return;
      }
      if (dead) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      video.srcObject = stream;
      video.muted = true;
      try {
        await video.play();
      } catch {
        if (!dead) {
          setError("The camera stream could not play. Tap activate again.");
          setMode("error");
        }
        return;
      }
      publish(trackingLabel(), true);
      raf = requestAnimationFrame(loop);
      try {
        const vision = await import("@mediapipe/tasks-vision");
        const files = await vision.FilesetResolver.forVisionTasks("/mediapipe");
        const model = (file: string, delegate: "GPU" | "CPU") => ({
          modelAssetPath: `/models/${file}`,
          delegate,
        });
        try {
          handTask = await vision.HandLandmarker.createFromOptions(files, {
            baseOptions: model("hand_landmarker.task", "GPU"),
            runningMode: "VIDEO",
            numHands: 1,
            minHandDetectionConfidence: 0.45,
            minHandPresenceConfidence: 0.45,
            minTrackingConfidence: 0.35,
          });
        } catch {
          handTask = await vision.HandLandmarker.createFromOptions(files, {
            baseOptions: model("hand_landmarker.task", "CPU"),
            runningMode: "VIDEO",
            numHands: 1,
            minHandDetectionConfidence: 0.45,
            minHandPresenceConfidence: 0.45,
            minTrackingConfidence: 0.35,
          });
        }
        try {
          poseTask = await vision.PoseLandmarker.createFromOptions(files, {
            baseOptions: model("pose_landmarker_lite.task", "GPU"),
            runningMode: "VIDEO",
            numPoses: 1,
            minPoseDetectionConfidence: 0.4,
            minTrackingConfidence: 0.35,
          });
        } catch {
          poseTask = await vision.PoseLandmarker.createFromOptions(files, {
            baseOptions: model("pose_landmarker_lite.task", "CPU"),
            runningMode: "VIDEO",
            numPoses: 1,
          });
        }
        try {
          faceTask = await vision.FaceLandmarker.createFromOptions(files, {
            baseOptions: model("face_landmarker.task", "GPU"),
            runningMode: "VIDEO",
            numFaces: 1,
            outputFaceBlendshapes: false,
            outputFacialTransformationMatrixes: false,
          });
        } catch {
          faceTask = await vision.FaceLandmarker.createFromOptions(files, {
            baseOptions: model("face_landmarker.task", "CPU"),
            runningMode: "VIDEO",
            numFaces: 1,
            outputFaceBlendshapes: false,
            outputFacialTransformationMatrixes: false,
          });
        }
        if (!dead) {
          visionState = "ready";
          publish(trackingLabel(), true);
        }
      } catch {
        if (!dead) {
          visionState = "failed";
          publish(trackingLabel(), true);
        }
      }
    };

    void boot();

    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
      handTask?.close();
      poseTask?.close();
      faceTask?.close();
    };
  }, [mode]);

  function activate() {
    unlockAudio();
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser does not support camera access.");
      setMode("error");
      return;
    }
    setError("");
    setMode("live");
  }

  function choose(id: ConstructId) {
    unlockAudio();
    const session = sessionRef.current;
    if (!session) return;
    playCues(session.select(id, performance.now() / 1000));
    setHud((prev) => ({
      ...prev,
      ring: session.ring,
      battery: session.battery,
      activations: session.activations,
      selected: session.selected,
      phase: session.phase,
      low: session.battery === 0,
    }));
  }

  function toggleSuit() {
    unlockAudio();
    const session = sessionRef.current;
    if (!session) return;
    playCues(session.toggleSuit(performance.now() / 1000));
    setHud((prev) => ({ ...prev, suit: session.suitWanted }));
  }

  function toggleMute() {
    unlockAudio();
    const next = !muted;
    setMuted(next);
    setAudioMuted(next);
  }

  const hint = !hud.ring
    ? "Close a fist and bring it toward the camera to equip the ring."
    : hud.battery <= 0
      ? "Battery empty. Close a fist very close to the camera to recharge."
      : hud.phase === "form" || hud.phase === "active"
        ? "Construct is live. Close your fist, then open it to dismiss."
        : hud.hover
          ? `Index finger on ${constructById(hud.hover).name}.`
          : "Point your index finger at a construct. Hold briefly to build it.";

  return (
    <main className="stage">
      <video ref={videoRef} className="camera" autoPlay playsInline muted />
      <canvas ref={canvasRef} className="fx" />

      {mode === "live" ? (
        <>
          <header className="hud inset-x-0 top-0 flex flex-col gap-2 p-2 sm:p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-display text-sm font-semibold tracking-[0.18em] text-primary sm:text-base">
                SECTOR 2814
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={toggleSuit}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold tracking-wide ${hud.suit ? "border-primary bg-primary text-bg" : "border-border bg-surface/80 text-fg"}`}
                >
                  SUIT {hud.suit ? "ON" : "OFF"}
                </button>
                <button
                  type="button"
                  aria-label={muted ? "Unmute" : "Mute"}
                  onClick={toggleMute}
                  className="grid size-9 place-items-center rounded-full border border-border bg-surface/80 text-fg"
                >
                  {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                </button>
                <button
                  type="button"
                  aria-label="Toggle debug"
                  onClick={() => setDebug((value) => !value)}
                  className={`grid size-9 place-items-center rounded-full border bg-surface/80 ${debug ? "border-accent text-accent" : "border-border text-fg"}`}
                >
                  <Bug className="size-4" />
                </button>
              </div>
            </div>

            {hud.ring ? (
              <div className="grid grid-cols-6 gap-1 sm:gap-1.5">
                {CONSTRUCTS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    ref={(node) => {
                      buttonRefs.current[item.id] = node;
                    }}
                    onClick={() => choose(item.id)}
                    className="menu-btn"
                    aria-label={item.name}
                  >
                    <img src={`/constructs/${item.file}`} alt="" />
                    <span className="max-w-full truncate text-[0.62rem] leading-none font-semibold tracking-wide text-fg">
                      {item.name}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="max-w-xl rounded-2xl border border-border bg-surface/75 px-3 py-2 text-sm text-fg backdrop-blur-md">
                {hint}
              </p>
            )}
            {hud.tracking ? (
              <p className="w-fit rounded-full border border-accent bg-surface/80 px-3 py-1 text-xs font-semibold tracking-wide text-accent">
                {hud.tracking}
              </p>
            ) : null}
          </header>

          <footer className="hud inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3 pb-16 sm:pb-14">
            <div className="min-w-0 rounded-2xl border border-border bg-surface/80 px-3 py-2 backdrop-blur-md">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted">
                <BatteryMedium className="size-3.5 text-primary" />
                ENERGY {hud.battery}/10
              </div>
              <div className="flex gap-0.5" aria-hidden="true">
                {Array.from({ length: 10 }, (_, i) => (
                  <span
                    key={i}
                    className={`h-2.5 w-2 rounded-sm sm:w-3 ${i < hud.battery ? "bg-primary" : "bg-border"}`}
                  />
                ))}
              </div>
              {hud.low ? (
                <p className="mt-1 text-xs font-bold tracking-widest text-accent">LOW BATTERY</p>
              ) : null}
              {hud.chargeP > 0.02 ? (
                <p className="mt-1 text-xs text-primary">Recharging {Math.round(hud.chargeP * 100)}%</p>
              ) : null}
              <p className="mt-1 max-w-xs text-xs text-muted">{hud.ring ? hint : "Ring not equipped"}</p>
            </div>

            <div className="rounded-2xl border border-border bg-surface/80 px-3 py-2 text-right backdrop-blur-md">
              {hud.selected ? (
                <p className="mb-1 flex items-center justify-end gap-1 text-xs text-muted">
                  <Shield className="size-3.5 text-primary" />
                  {constructById(hud.selected).name}
                </p>
              ) : null}
              {hud.sector ? (
                <>
                  <p className="font-display text-lg leading-none font-bold tracking-[0.14em] text-primary">SECTOR 2814</p>
                  <p className="font-display text-sm tracking-[0.28em] text-fg">EARTH</p>
                </>
              ) : (
                <p className="text-xs text-muted">Awaiting ring</p>
              )}
            </div>
          </footer>

          {debug ? (
            <aside className="hud top-36 left-3 w-52 rounded-2xl border border-border bg-surface/85 p-3 text-xs text-fg backdrop-blur-md sm:top-40">
              <p>FPS {hud.fps}</p>
              <p>Fist {hud.fist ? "yes" : "no"}</p>
              <p>Point {hud.pointing ? "yes" : "no"}</p>
              <p>Ring {hud.ring ? "equipped" : "off"}</p>
              <p>Construct {hud.selected ?? "none"}</p>
              <p>Phase {hud.phase}</p>
              <p>Battery {hud.battery}</p>
              <p>Uses {hud.activations}</p>
              <p>Close {hud.closeness.toFixed(2)}</p>
              <p>Suit {hud.suit ? "on" : "off"}</p>
            </aside>
          ) : null}
        </>
      ) : null}

      {mode !== "live" ? (
        <section className="absolute inset-0 z-10 flex items-center justify-center overflow-y-auto bg-bg px-4 py-8">
          <div className="w-full max-w-3xl">
            <p className="font-display text-sm tracking-[0.28em] text-primary">EARTH · WILL</p>
            <h1 className="font-display text-5xl leading-none font-bold text-fg sm:text-6xl">SECTOR 2814</h1>
            <p className="mt-3 max-w-xl text-sm text-muted sm:text-base">
              Your camera is the arena. Equip an emerald ring with a close fist, then point to build one of twelve
              energy constructs. The suit rides on your face and shoulders and does not spend battery.
            </p>
            <div className="mt-5 grid grid-cols-6 gap-1.5">
              {CONSTRUCTS.map((item) => (
                <figure key={item.id} className="rounded-xl border border-border bg-surface px-1 py-1.5 text-center">
                  <img src={`/constructs/${item.file}`} alt="" className="mx-auto h-10 w-auto object-contain" />
                  <figcaption className="truncate text-[0.62rem] font-semibold tracking-wide text-muted">
                    {item.name}
                  </figcaption>
                </figure>
              ))}
            </div>
            <ol className="mt-4 grid gap-1 text-sm text-fg sm:grid-cols-3">
              <li className="rounded-xl border border-border bg-surface/80 px-3 py-2">1. Close a fist near the lens.</li>
              <li className="rounded-xl border border-border bg-surface/80 px-3 py-2">2. Point at a construct and hold.</li>
              <li className="rounded-xl border border-border bg-surface/80 px-3 py-2">3. Fist, then open palm to dismiss.</li>
            </ol>
            {mode === "error" ? (
              <p className="mt-4 rounded-xl border border-accent bg-surface px-3 py-2 text-sm text-accent" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="button"
              onClick={activate}
              className="pulse mt-5 rounded-full bg-primary px-6 py-3 font-display text-lg font-bold tracking-wide text-bg"
            >
              {mode === "error" ? "TRY CAMERA AGAIN" : "ACTIVATE CAMERA"}
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
