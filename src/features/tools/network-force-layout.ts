import type {
  NetworkVisualizerEdge,
  NetworkVisualizerNode,
  NetworkVisualizerNodeKind,
} from './network-visualizer';

interface LayoutBody {
  id: string;
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  anchorStrength: number;
  velocityX: number;
  velocityY: number;
  mass: number;
  fixed: boolean;
  radius: number;
}

interface LayoutSpring {
  from: number;
  to: number;
  length: number;
}

const repulsion = 1_800;
const springStrength = .032;
const damping = .68;
const maximumSpeed = 18;
const centerGravity = .002;
const collisionPadding = 20;
const collisionStrength = .85;
const repulsionCellSize = 180;

const nodeMass: Record<NetworkVisualizerNodeKind, number> = {
  local: 4,
  interface: 2.5,
  nextHop: 1,
  destination: 1,
};

const badgeRadius: Record<NetworkVisualizerNodeKind, number> = {
  local: 38,
  interface: 31,
  nextHop: 27,
  destination: 27,
};

const nodeAnchorStrength: Record<NetworkVisualizerNodeKind, number> = {
  local: 0,
  interface: .12,
  nextHop: .1,
  destination: .08,
};

function collisionRadius(node: NetworkVisualizerNode): number {
  // Labels are rendered outside Svelte Flow's node box. Include an estimate of
  // their half-width so the force pass does not produce readable badges with
  // overlapping names underneath them.
  const visibleLabelLength = Math.min(node.kind === 'local' ? 22 : 18, node.label.length);
  return Math.max(badgeRadius[node.kind], Math.min(72, visibleLabelLength * 3.6));
}

function iterationCount(nodeCount: number): number {
  if (nodeCount >= 200) return 100;
  return 140;
}

/**
 * Settles a deterministic, one-shot force layout inspired by MeshChatX.
 * Svelte Flow owns interaction after this pass, so users can still freely
 * drag nodes without an active simulation pulling them back into place.
 */
export function settleNetworkVisualizerLayout(
  nodes: readonly NetworkVisualizerNode[],
  edges: readonly NetworkVisualizerEdge[],
): NetworkVisualizerNode[] {
  if (nodes.length === 0) return [];

  const local = nodes.find((node) => node.kind === 'local');
  const origin = local ? { x: local.x, y: local.y } : { x: 0, y: 0 };
  const indexById = new Map<string, number>();
  const bodies = nodes.map((node, index): LayoutBody => {
    indexById.set(node.id, index);
    const x = node.x - origin.x;
    const y = node.y - origin.y;
    return {
      id: node.id,
      x,
      y,
      anchorX: x,
      anchorY: y,
      anchorStrength: nodeAnchorStrength[node.kind],
      velocityX: 0,
      velocityY: 0,
      mass: nodeMass[node.kind],
      fixed: node.kind === 'local',
      radius: collisionRadius(node),
    };
  });
  const springs = edges.flatMap((edge): LayoutSpring[] => {
    const from = indexById.get(edge.from);
    const to = indexById.get(edge.to);
    if (from === undefined || to === undefined || from === to) return [];
    return [{
      from,
      to,
      length: Math.hypot(
        bodies[to].x - bodies[from].x,
        bodies[to].y - bodies[from].y,
      ),
    }];
  });

  for (let iteration = 0; iteration < iterationCount(bodies.length); iteration += 1) {
    const forceX = new Float64Array(bodies.length);
    const forceY = new Float64Array(bodies.length);

    for (const [index, body] of bodies.entries()) {
      if (body.fixed) continue;
      forceX[index] -= body.x * centerGravity * body.mass;
      forceY[index] -= body.y * centerGravity * body.mass;
      forceX[index] += (body.anchorX - body.x) * body.anchorStrength;
      forceY[index] += (body.anchorY - body.y) * body.anchorStrength;
    }

    const buckets = new Map<string, number[]>();
    for (const [index, body] of bodies.entries()) {
      const cellX = Math.floor(body.x / repulsionCellSize);
      const cellY = Math.floor(body.y / repulsionCellSize);
      const key = `${cellX}:${cellY}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(index);
      buckets.set(key, bucket);
    }
    for (const [index, body] of bodies.entries()) {
      const cellX = Math.floor(body.x / repulsionCellSize);
      const cellY = Math.floor(body.y / repulsionCellSize);
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          const neighbours = buckets.get(`${cellX + offsetX}:${cellY + offsetY}`) ?? [];
          for (const otherIndex of neighbours) {
            if (otherIndex <= index) continue;
            const other = bodies[otherIndex];
            let differenceX = body.x - other.x;
            let differenceY = body.y - other.y;
            if (Math.abs(differenceX) + Math.abs(differenceY) < .001) {
              // Identical seeds would otherwise have no direction in which to separate.
              differenceX = index % 2 === 0 ? .1 : -.1;
              differenceY = otherIndex % 2 === 0 ? .1 : -.1;
            }
            const distanceSquared = differenceX ** 2 + differenceY ** 2 + .01;
            const distance = Math.sqrt(distanceSquared);
            let force = repulsion * body.mass * other.mass / distanceSquared;
            const minimumDistance = body.radius + other.radius + collisionPadding;
            if (distance < minimumDistance) {
              force += (minimumDistance - distance) * collisionStrength;
            }
            const normalizedX = differenceX / distance * force;
            const normalizedY = differenceY / distance * force;
            if (!body.fixed) {
              forceX[index] += normalizedX;
              forceY[index] += normalizedY;
            }
            if (!other.fixed) {
              forceX[otherIndex] -= normalizedX;
              forceY[otherIndex] -= normalizedY;
            }
          }
        }
      }
    }

    for (const spring of springs) {
      const from = bodies[spring.from];
      const to = bodies[spring.to];
      const differenceX = to.x - from.x;
      const differenceY = to.y - from.y;
      const distance = Math.max(.01, Math.hypot(differenceX, differenceY));
      const force = springStrength * (distance - spring.length);
      const normalizedX = differenceX / distance * force;
      const normalizedY = differenceY / distance * force;
      if (!from.fixed) {
        forceX[spring.from] += normalizedX;
        forceY[spring.from] += normalizedY;
      }
      if (!to.fixed) {
        forceX[spring.to] -= normalizedX;
        forceY[spring.to] -= normalizedY;
      }
    }

    for (const [index, body] of bodies.entries()) {
      if (body.fixed) {
        body.velocityX = 0;
        body.velocityY = 0;
        continue;
      }
      body.velocityX = (body.velocityX + forceX[index] / body.mass) * damping;
      body.velocityY = (body.velocityY + forceY[index] / body.mass) * damping;
      const speed = Math.hypot(body.velocityX, body.velocityY);
      if (speed > maximumSpeed) {
        const scale = maximumSpeed / speed;
        body.velocityX *= scale;
        body.velocityY *= scale;
      }
      body.x += body.velocityX;
      body.y += body.velocityY;
    }
  }

  return nodes.map((node, index) => ({
    ...node,
    x: bodies[index].x + origin.x,
    y: bodies[index].y + origin.y,
  }));
}
