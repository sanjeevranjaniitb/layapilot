import { dist } from "./math.js";

// A* pathfinding over the world node/edge graph.
// Returns ordered array of node IDs from fromId → toId, or null if unreachable.
export function findRoute(world, fromId, toId) {
  if (fromId === toId) return [fromId];

  const h = (id) => dist(world.byId[id], world.byId[toId]);

  // open: id → {g, f, parent}
  const open = new Map([[fromId, { g: 0, f: h(fromId), parent: null }]]);
  // closed: id → {g, parent}  (stores settled nodes)
  const closed = new Map();

  while (open.size) {
    // Pick node with lowest f score
    let curId = null, best = Infinity;
    for (const [id, n] of open) { if (n.f < best) { best = n.f; curId = id; } }

    const cur = open.get(curId);
    open.delete(curId);
    closed.set(curId, cur);

    if (curId === toId) {
      // Reconstruct path by walking parent pointers through closed
      const path = [];
      let id = curId;
      while (id !== null) {
        path.unshift(id);
        id = closed.get(id)?.parent ?? null;
      }
      return path;
    }

    for (const neighborId of (world.byId[curId]?.neighbors ?? [])) {
      if (closed.has(neighborId)) continue;
      // Respect one-way edges
      const edge = world.edges.find(e =>
        (e.a === curId && e.b === neighborId) ||
        (!e.oneWay && e.b === curId && e.a === neighborId)
      );
      if (!edge) continue;

      const g = cur.g + dist(world.byId[curId], world.byId[neighborId]);
      const existing = open.get(neighborId);
      if (!existing || g < existing.g)
        open.set(neighborId, { g, f: g + h(neighborId), parent: curId });
    }
  }
  return null; // unreachable
}

// BFS to find all nodes reachable from fromId (respecting one-way edges).
export function reachableFrom(world, fromId) {
  const visited = new Set([fromId]);
  const queue = [fromId];
  while (queue.length) {
    const curId = queue.shift();
    for (const neighborId of (world.byId[curId]?.neighbors ?? [])) {
      if (visited.has(neighborId)) continue;
      const edge = world.edges.find(e =>
        (e.a === curId && e.b === neighborId) ||
        (!e.oneWay && e.b === curId && e.a === neighborId)
      );
      if (edge) { visited.add(neighborId); queue.push(neighborId); }
    }
  }
  visited.delete(fromId);
  return [...visited];
}
