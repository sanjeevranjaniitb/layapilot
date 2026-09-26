import { angle, nearestOnPath, pointAt, rng, round } from "./math.js";
import { physics, pedalPhysics, routeSection, maneuverSteering } from "./planning.js";
import { generateHighway, makeHighwayRoute } from "./highway.js";
import { findRoute } from "./router.js";

export class Simulation {
  constructor(seed = 42) {
    this.world = generateHighway(seed, { limit: 28, name: "Highway" });
    this.time = 0;
    this.distance = 0;
    this.autopilot = false;
    this.traffic = [];
    this.pedestrians = [];
    this.pedals = { throttle: 0, brake: 0, steer: 0 };
    this.planRandom = rng(seed + 1);
    this.lastDecisionState = null;
    this.lastPlan = null;

    // Load route from sessionStorage (set by map.html) or fall back to default
    let routeIds = null;
    try {
      const stored = sessionStorage.getItem("lp_route_ids");
      if (stored) routeIds = JSON.parse(stored);
    } catch (_) {}

    if (!routeIds || routeIds.length < 2) {
      // Default full route
      routeIds = [
        "local-start", "mill-market", "mill-interchange", "onramp",
        "merge-lane", "h3", "h4", "h5", "h6",
        "exit-cedar", "cedar-town", "cedar-stop",
      ];
    }

    this.routeIds = routeIds;
    const route = makeHighwayRoute(this.world, routeIds);
    this.world.route = route;
    this.world.destinationStopLine = {
      ...route.points.at(-1),
      heading: 0,
    };

    const p0 = route.points[0];
    this.player = {
      id: "player", type: "car",
      x: p0.x, z: p0.z,
      heading: p0.heading || 0,
      speed: 0,
      width: 1.9, depth: 4.75,
      route, s: 0,
      stops: {}, waitingSince: null,
      steering: 0, wheelSteering: 0,
      target: 0, maneuver: null,
    };
  }

  // Compute what Laya needs to make a decision — includes junction context
  getStateForLaya() {
    const v = this.player;
    const near = nearestOnPath(v, v.route.points);
    v.s = near.s;
    const section = routeSection(v);
    const speedLimit = section?.speedLimit ?? 28;
    const destM = round(v.route.length - near.s, 1);

    // Road ahead: sample centerline points relative to car
    const aheadPoints = [];
    for (let d = 10; d <= 80; d += 10) {
      const p = pointAt(v.route.points, Math.min(near.s + d, v.route.length - 1));
      const dx = p.x - v.x, dz = p.z - v.z;
      const ahead = dx * Math.sin(v.heading) - dz * Math.cos(v.heading);
      const right = dx * Math.cos(v.heading) + dz * Math.sin(v.heading);
      aheadPoints.push({ ahead_m: round(ahead, 1), right_m: round(right, 1) });
    }

    const laneOffset = round(
      (v.x - near.x) * Math.cos(near.heading) + (v.z - near.z) * Math.sin(near.heading), 2
    );
    const headingError = round((angle(near.heading - v.heading) * 180) / Math.PI, 1);

    const p30 = pointAt(v.route.points, Math.min(near.s + 30, v.route.length - 1));
    const p60 = pointAt(v.route.points, Math.min(near.s + 60, v.route.length - 1));
    const curvature30 = round(angle(p30.heading - near.heading) * (180 / Math.PI), 1);
    const curvature60 = round(angle(p60.heading - near.heading) * (180 / Math.PI), 1);

    const roadType = section?.kind ?? "highway";
    const roadName = section?.name ?? "Interstate 08";

    // Upcoming junction context — find nearest crossing ahead
    const nextCrossing = v.route.crossings?.find(c => c.stopS > near.s);
    const junctionAheadM = nextCrossing ? round(nextCrossing.stopS - near.s, 1) : null;

    // Upcoming section change (road type transition)
    const nextSection = v.route.sections?.find(s => s.startS > near.s);
    const nextRoadType = nextSection?.kind ?? null;
    const nextRoadAheadM = nextSection ? round(nextSection.startS - near.s, 1) : null;

    return {
      speed_mps: round(v.speed, 2),
      speed_kmh: round(v.speed * 3.6, 1),
      speed_limit_mps: speedLimit,
      speed_limit_kmh: round(speedLimit * 3.6, 1),
      lane_offset_m: laneOffset,
      heading_error_deg: headingError,
      destination_m: destM,
      road_type: roadType,
      road_name: roadName,
      curvature_30m_deg: curvature30,
      curvature_60m_deg: curvature60,
      road_ahead: aheadPoints,
      junction_ahead_m: junctionAheadM,
      next_road_type: nextRoadType,
      next_road_ahead_m: nextRoadAheadM,
    };
  }

  applyLayaDecision(steering, targetSpeed) {
    // lookahead scales with speed: longer at highway speed for smooth curve tracking
    const lookahead = Math.max(10, Math.min(25, this.player.speed * 1.0));
    this.player.maneuver = {
      steering,
      velocity_mps: targetSpeed,
      lane_offset_m: 0,
      lookahead_m: lookahead,
    };
    this.player.target = targetSpeed;
  }

  step(dt) {
    this.time += dt;
    const v = this.player;
    const routeLength = v.route.points.at(-1).s;
    const destM = routeLength - v.s;

    if (this.autopilot) {
      // ── Destination approach: override everything and stop cleanly ──────────
      if (destM < 60) {
        // Compute max speed allowed by braking distance: v = sqrt(2 * a * d)
        const brakingSpeed = Math.sqrt(2 * 4.5 * Math.max(0, destM));
        const approachTarget = Math.min(v.target ?? 5, brakingSpeed);
        const maneuver = v.maneuver ?? { steering: 0, lane_offset_m: 0, lookahead_m: 12 };
        const steer = maneuverSteering(v, { ...maneuver, lookahead_m: Math.min(destM + 2, 12) });
        physics(v, steer, approachTarget, dt);

        if (destM < 1.5) {
          // Full stop — kill speed and lock position
          v.speed = 0;
          this.arrived = true;
        }
      } else if (!v.maneuver) {
        // Before first Laya response: creep forward
        const steer = maneuverSteering(v, { steering: 0, velocity_mps: 5, lane_offset_m: 0, lookahead_m: 12 });
        physics(v, steer, 5, dt);
      } else {
        const steer = maneuverSteering(v, v.maneuver);
        physics(v, steer, v.target ?? 0, dt);
      }
    } else {
      pedalPhysics(v, this.pedals.steer, this.pedals.throttle, this.pedals.brake, dt);
    }

    this.distance += Math.abs(v.speed) * dt;
    v.s = nearestOnPath(v, v.route.points).s;
  }
}
