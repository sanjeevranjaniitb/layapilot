import { Simulation } from "./simulation.js";
import { SceneRenderer } from "./scene.js";

const sim = new Simulation(42);
const wrap = document.getElementById("canvas-wrap");
const canvas = document.createElement("canvas");
wrap.appendChild(canvas);
const renderer = new SceneRenderer(canvas);
renderer.init(sim);

// ── Route labels from map selection ──────────────────────────────────────────
const srcLabel = sessionStorage.getItem("lp_src_label") ?? "Millbrook";
const dstLabel = sessionStorage.getItem("lp_dst_label") ?? "Cedar Town";

// ── Steering map: Laya choice → steering value ────────────────────────────────
const STEER_MAP = { hard_left: -0.55, left: -0.22, straight: 0.0, right: 0.22, hard_right: 0.55 };

// ── Speed map: Laya choice → target m/s ──────────────────────────────────────
function targetSpeed(speedChoice, routingChoice, currentSpeed, speedLimit, destM) {
  // prepare_stop only within 30m of destination — otherwise ignore it
  if (routingChoice === "prepare_stop" && destM < 30) return Math.max(0, currentSpeed - 3);
  // merge: boost to highway speed
  if (routingChoice === "merge") return Math.min(speedLimit, currentSpeed + 4);
  // take_exit: gentle slow, never below 8 m/s
  if (routingChoice === "take_exit") return Math.max(8, speedLimit * 0.75);
  // prepare_turn: slow to junction speed but never below 5 m/s
  if (routingChoice === "prepare_turn") return Math.max(5, speedLimit * 0.6);

  // Normal speed choices — always maintain a minimum of 5 m/s so car never stalls
  switch (speedChoice) {
    case "accelerate":    return Math.min(speedLimit, currentSpeed + 3);
    case "maintain":      return Math.max(5, speedLimit * 0.92);
    case "slow_slightly": return Math.max(5, speedLimit * 0.65);
    case "brake":         return destM < 20 ? Math.max(0, currentSpeed - 4) : Math.max(5, currentSpeed - 3);
    default:              return Math.max(5, speedLimit * 0.85);
  }
}

// ── HUD elements ──────────────────────────────────────────────────────────────
const elSpeed    = document.getElementById("speed-big");
const elDest     = document.getElementById("dest-info");
const elBadge    = document.getElementById("mode-badge");
const elApBtn    = document.getElementById("ap-btn");
const elMotion   = document.getElementById("motion-val");
const elDir      = document.getElementById("dir-val");
const elRouting  = document.getElementById("routing-val");
const elBarDrive = document.getElementById("bar-drive");
const elBarStop  = document.getElementById("bar-stop");
const elBarStr   = document.getElementById("bar-straight");
const elBarLeft  = document.getElementById("bar-left");
const elBarRight = document.getElementById("bar-right");
const elPctDrive = document.getElementById("pct-drive");
const elPctStop  = document.getElementById("pct-stop");
const elPctStr   = document.getElementById("pct-straight");
const elPctLeft  = document.getElementById("pct-left");
const elPctRight = document.getElementById("pct-right");
const elRiskDots = document.getElementById("risk-dots").children;
const elRiskLbl  = document.getElementById("risk-label");
const elReason   = document.getElementById("reasoning");
const elLatency  = document.getElementById("latency");

// Set route labels
document.getElementById("route-from").textContent = srcLabel;
document.getElementById("route-to").textContent = dstLabel;

const RISK_LABELS = ["Safe", "Low Risk", "Moderate", "High Risk", "Critical"];
const ROUTING_LABELS = {
  follow_route: "FOLLOW ROUTE", prepare_turn: "PREPARE TURN",
  take_exit: "TAKE EXIT", merge: "MERGING", prepare_stop: "STOPPING",
};

function pct(v) { return `${Math.round((v ?? 0) * 100)}%`; }
function setBar(bar, pctEl, v) {
  bar.style.width = pct(v);
  if (pctEl) pctEl.textContent = pct(v);
}

function updateHUD(result, state, latencyMs) {
  const sa  = result.answers?.steering;
  const spa = result.answers?.speed;
  const ra  = result.answers?.risk;
  const rta = result.answers?.routing;

  if (sa) {
    const sp = sa.probabilities || {};
    const leftP  = (sp.hard_left ?? 0) + (sp.left ?? 0);
    const rightP = (sp.hard_right ?? 0) + (sp.right ?? 0);
    setBar(elBarStr,   elPctStr,   sp.straight ?? 0);
    setBar(elBarLeft,  elPctLeft,  leftP);
    setBar(elBarRight, elPctRight, rightP);
    const dir = sa.choice.includes("left") ? "LEFT" : sa.choice.includes("right") ? "RIGHT" : "STRAIGHT";
    elDir.textContent = dir;
    elDir.className = `decision-value ${dir.toLowerCase()}`;
  }

  if (spa) {
    const sp = spa.probabilities || {};
    const driveP = (sp.accelerate ?? 0) + (sp.maintain ?? 0) + (sp.slow_slightly ?? 0);
    setBar(elBarDrive, elPctDrive, driveP);
    setBar(elBarStop,  elPctStop,  sp.brake ?? 0);
    const motionText = spa.choice === "brake" ? "BRAKING" :
                       spa.choice === "accelerate" ? "ACCELERATING" :
                       spa.choice === "slow_slightly" ? "SLOWING" : "CRUISING";
    elMotion.textContent = motionText;
    elMotion.className = `decision-value ${spa.choice === "brake" ? "stop" : "drive"}`;
  }

  if (rta) {
    elRouting.textContent = ROUTING_LABELS[rta.choice] ?? rta.choice.toUpperCase().replace("_", " ");
    const isAlert = ["prepare_turn", "take_exit", "merge", "prepare_stop"].includes(rta.choice);
    elRouting.className = `decision-value routing${isAlert ? " alert" : ""}`;
  }

  if (ra) {
    const score = Math.round(ra.score ?? 0);
    Array.from(elRiskDots).forEach((dot, i) => {
      dot.className = `risk-dot r${i}${i <= score ? " active" : ""}`;
    });
    elRiskLbl.textContent = RISK_LABELS[score] ?? "—";
  }

  // Reasoning text
  const kmh    = (Math.abs(sim.player.speed) * 3.6).toFixed(1);
  const limit  = (state.speed_limit_kmh ?? 0).toFixed(0);
  const dest   = (state.destination_m ?? 0).toFixed(0);
  const curve  = state.curvature_30m_deg ?? 0;
  const offset = state.lane_offset_m ?? 0;

  const lines = [];
  lines.push(`${state.road_name} · ${kmh} km/h · Limit ${limit} km/h`);
  lines.push(`${dest}m to ${dstLabel}`);
  if (state.junction_ahead_m !== null) lines.push(`Junction in ${state.junction_ahead_m}m`);
  if (state.next_road_type && state.next_road_ahead_m !== null)
    lines.push(`${state.next_road_type} ahead in ${state.next_road_ahead_m}m`);
  if (Math.abs(curve) > 5) lines.push(`Curve: ${curve > 0 ? "left" : "right"} ${Math.abs(curve).toFixed(0)}°`);
  if (Math.abs(offset) > 0.3) lines.push(`Lane offset: ${offset > 0 ? "right" : "left"} ${Math.abs(offset).toFixed(2)}m`);
  if (rta?.choice) lines.push(`Routing: ${ROUTING_LABELS[rta.choice] ?? rta.choice} (${pct(rta.probabilities?.[rta.choice])})`);
  if (sa?.choice)  lines.push(`Steering: ${sa.choice.replace("_", " ")} (${pct(sa.probabilities?.[sa.choice])})`);

  elReason.textContent = lines.join("\n");
  if (latencyMs) elLatency.textContent = `Laya inference: ${latencyMs}ms · Apple MPS`;
}

// ── Mini-map ──────────────────────────────────────────────────────────────────
const miniCanvas = document.getElementById("mini-map");
const mctx = miniCanvas.getContext("2d");
const MW = miniCanvas.width, MH = miniCanvas.height;
const world = sim.world;
const bx = world.bounds.maxX - world.bounds.minX;
const bz = world.bounds.maxZ - world.bounds.minZ;
const mScale = Math.min((MW - 16) / bx, (MH - 16) / bz);
const mOffX = (MW - bx * mScale) / 2 - world.bounds.minX * mScale;
const mOffZ = (MH - bz * mScale) / 2 - world.bounds.minZ * mScale;
const mtx = (x) => x * mScale + mOffX;
const mtz = (z) => z * mScale + mOffZ;

function drawMiniMap() {
  mctx.clearRect(0, 0, MW, MH);
  mctx.fillStyle = "rgba(8,12,20,.9)";
  mctx.fillRect(0, 0, MW, MH);

  // Roads
  const drawLine = (pts, color, w) => {
    if (!pts?.length) return;
    mctx.beginPath();
    mctx.moveTo(mtx(pts[0].x), mtz(pts[0].z));
    for (let i = 1; i < pts.length; i++) mctx.lineTo(mtx(pts[i].x), mtz(pts[i].z));
    mctx.strokeStyle = color; mctx.lineWidth = w; mctx.stroke();
  };

  for (const road of world.connectorRoads)
    drawLine(road.points, "#3a3a2a", 1);
  drawLine(world.roadSamples, "#2a4a7a", 3);
  for (const edge of world.edges)
    if (edge.path) drawLine(edge.path, "#2a4a3a", 1.5);

  // Route highlight
  if (sim.player.route?.points)
    drawLine(sim.player.route.points, "#4af", 1.5);

  // Car dot
  const v = sim.player;
  const cx = mtx(v.x), cz = mtz(v.z);
  mctx.beginPath(); mctx.arc(cx, cz, 3, 0, Math.PI * 2);
  mctx.fillStyle = "#4dff88"; mctx.fill();

  // Direction tick
  mctx.beginPath();
  mctx.moveTo(cx, cz);
  mctx.lineTo(cx + Math.sin(v.heading) * 6, cz - Math.cos(v.heading) * 6);
  mctx.strokeStyle = "#4dff88"; mctx.lineWidth = 1.5; mctx.stroke();

  // Destination dot
  const dest = sim.player.route?.points?.at(-1);
  if (dest) {
    mctx.beginPath(); mctx.arc(mtx(dest.x), mtz(dest.z), 3, 0, Math.PI * 2);
    mctx.fillStyle = "#ff6644"; mctx.fill();
  }
}

// ── Laya decision loop ────────────────────────────────────────────────────────
let layaBusy = false;

async function askLaya() {
  if (layaBusy || !sim.autopilot || sim.arrived) return;
  layaBusy = true;
  const t0 = performance.now();
  try {
    const state = sim.getStateForLaya();
    const resp = await fetch("http://127.0.0.1:8001/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    const result = await resp.json();
    const latency = Math.round(performance.now() - t0);

    const steerChoice   = result.answers?.steering?.choice ?? "straight";
    const speedChoice   = result.answers?.speed?.choice ?? "maintain";
    const routingChoice = result.answers?.routing?.choice ?? "follow_route";

    const steer = STEER_MAP[steerChoice] ?? 0;
    const speed = targetSpeed(speedChoice, routingChoice, sim.player.speed, state.speed_limit_mps, state.destination_m);

    sim.applyLayaDecision(steer, speed);
    updateHUD(result, state, latency);
  } catch (e) {
    elReason.textContent = "Laya: connection error — " + e.message;
    console.error(e);
  }
  layaBusy = false;
}

setInterval(() => { if (sim.autopilot) askLaya(); }, 500);

// ── Controls ──────────────────────────────────────────────────────────────────
const keys = {};
addEventListener("keydown", e => {
  keys[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase() === "j") window._toggleAP();
  if (e.key.toLowerCase() === "v") renderer.mode = renderer.mode === "follow" ? "hood" : "follow";
  if (e.key.toLowerCase() === "m") window.location.href = "/map.html";
});
addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);

window._toggleAP = () => {
  sim.autopilot = !sim.autopilot;
  elBadge.textContent = sim.autopilot ? "LAYA AUTOPILOT" : "MANUAL";
  elBadge.className   = sim.autopilot ? "active" : "manual";
  elApBtn.textContent = sim.autopilot ? "J — Disable Autopilot" : "Press J — Enable Laya Autopilot";
  elApBtn.className   = sim.autopilot ? "active" : "";
  if (sim.autopilot) askLaya();
  else elReason.textContent = "Manual control — use WASD to drive";
};

function updatePedals() {
  sim.pedals.throttle = (keys.w || keys.arrowup)    ? 1 : 0;
  sim.pedals.brake    = (keys.s || keys.arrowdown || keys[" "]) ? 1 : 0;
  sim.pedals.steer    = (keys.a || keys.arrowleft)  ? -1 : (keys.d || keys.arrowright) ? 1 : 0;
}

// ── Render loop ───────────────────────────────────────────────────────────────
let last = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (!sim.autopilot) updatePedals();
  sim.step(dt);
  renderer.render(dt);
  drawMiniMap();

  const kmh  = (Math.abs(sim.player.speed) * 3.6).toFixed(1);
  const dest = (sim.player.route.length - (sim.player.s || 0)).toFixed(0);
  elSpeed.innerHTML = `${kmh}<span>km/h</span>`;

  if (sim.arrived) {
    elDest.textContent = `✓ Arrived at ${dstLabel}`;
    elDest.style.color = "#4dff88";
  } else {
    elDest.textContent = `${srcLabel} → ${dstLabel} · ${dest}m`;
    elDest.style.color = "";
  }
}
animate();
