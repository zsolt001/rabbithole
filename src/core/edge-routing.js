const CLEARANCE = 18;

/** @param {{ x: number, y: number }[]} points */
function segments(points) {
  const result = [];
  for (let i = 1; i < points.length; i++) result.push([points[i - 1], points[i]]);
  return result;
}

/** @param {{ x: number, y: number }} a @param {{ x: number, y: number }} b @param {{ minX: number, minY: number, maxX: number, maxY: number }} rect */
function segmentHitsRect(a, b, rect) {
  if (a.x === b.x) return a.x > rect.minX && a.x < rect.maxX && Math.max(a.y, b.y) > rect.minY && Math.min(a.y, b.y) < rect.maxY;
  if (a.y === b.y) return a.y > rect.minY && a.y < rect.maxY && Math.max(a.x, b.x) > rect.minX && Math.min(a.x, b.x) < rect.maxX;
  return false;
}

/** @param {{ x: number, y: number }} a @param {{ x: number, y: number }} b @param {{ x: number, y: number }} c @param {{ x: number, y: number }} d */
function segmentsCross(a, b, c, d) {
  if (a.x === b.x && c.y === d.y) return c.x < a.x && a.x < d.x && a.y < c.y && c.y < b.y
    || d.x < a.x && a.x < c.x && b.y < c.y && c.y < a.y;
  if (a.y === b.y && c.x === d.x) return a.x < c.x && c.x < b.x && c.y < a.y && a.y < d.y
    || b.x < c.x && c.x < a.x && d.y < a.y && a.y < c.y;
  return false;
}

/** @param {{ x: number, y: number }[]} points */
function compact(points) {
  const result = [];
  for (const point of points) {
    const last = result[result.length - 1];
    if (last && last.x === point.x && last.y === point.y) continue;
    result.push(point);
    while (result.length >= 3) {
      const a = result[result.length - 3], b = result[result.length - 2], c = result[result.length - 1];
      if (!a || !b || !c) break;
      if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) result.splice(result.length - 2, 1);
      else break;
    }
  }
  return result;
}

/**
 * Route one connector through deterministic orthogonal candidates.
 * @param {{ x: number, y: number }} start
 * @param {{ x: number, y: number }} end
 * @param {{ obstacles?: { minX: number, minY: number, maxX: number, maxY: number }[], routes?: { x: number, y: number }[][] }} [options]
 */
export function routeConnector(start, end, { obstacles = [], routes = [] } = {}) {
  const xs = new Set([(start.x + end.x) / 2]);
  const ys = new Set([(start.y + end.y) / 2]);
  for (const rect of obstacles) {
    xs.add(rect.minX - CLEARANCE);
    xs.add(rect.maxX + CLEARANCE);
    ys.add(rect.minY - CLEARANCE);
    ys.add(rect.maxY + CLEARANCE);
  }
  const candidates = [
    [start, { x: end.x, y: start.y }, end],
    [start, { x: start.x, y: end.y }, end],
  ];
  for (const x of xs) candidates.push([start, { x, y: start.y }, { x, y: end.y }, end]);
  for (const y of ys) candidates.push([start, { x: start.x, y }, { x: end.x, y }, end]);
  /** @type {{ points: { x: number, y: number }[], key: (number | string)[] } | null} */
  let best = null;
  for (const raw of candidates) {
    const points = compact(raw);
    const parts = segments(points);
    let hits = 0;
    for (const part of parts) {
      const a = part[0], b = part[1];
      if (!a || !b) continue;
      for (const rect of obstacles) if (segmentHitsRect(a, b, rect)) hits += 1;
    }
    let crossings = 0;
    for (const part of parts) for (const route of routes) for (const other of segments(route)) {
      const a = part[0], b = part[1], c = other[0], d = other[1];
      if (a && b && c && d && segmentsCross(a, b, c, d)) crossings += 1;
    }
    let length = 0;
    for (const part of parts) {
      const a = part[0], b = part[1];
      if (a && b) length += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    }
    const key = [hits, crossings, points.length, length, points.map((point) => point.x + "," + point.y).join(";")];
    const currentKey = best ? best.key : null;
    if (!currentKey || compareRouteKeys(key, currentKey) < 0) {
      best = { points, key };
    }
  }
  return best ? best.points : [start, end];
}

/** @param {(number | string)[]} a @param {(number | string)[]} b */
function compareRouteKeys(a, b) {
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (left === right) continue;
    if (typeof left === "number" && typeof right === "number") return left - right;
    return String(left).localeCompare(String(right));
  }
  return 0;
}

/** @param {{ x: number, y: number }[]} points @param {number} [radius] */
export function roundedOrthogonalPath(points, radius = 10) {
  if (points.length < 2) return "";
  const start = points[0];
  if (!start) return "";
  let path = "M " + start.x + " " + start.y;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1], point = points[i], next = points[i + 1];
    if (!prev || !point || !next) continue;
    const incoming = Math.min(radius, (Math.abs(point.x - prev.x) + Math.abs(point.y - prev.y)) / 2);
    const outgoing = Math.min(radius, (Math.abs(next.x - point.x) + Math.abs(next.y - point.y)) / 2);
    const before = { x: point.x + Math.sign(prev.x - point.x) * incoming, y: point.y + Math.sign(prev.y - point.y) * incoming };
    const after = { x: point.x + Math.sign(next.x - point.x) * outgoing, y: point.y + Math.sign(next.y - point.y) * outgoing };
    path += " L " + before.x + " " + before.y + " Q " + point.x + " " + point.y + " " + after.x + " " + after.y;
  }
  const end = points[points.length - 1];
  if (!end) return path;
  return path + " L " + end.x + " " + end.y;
}
