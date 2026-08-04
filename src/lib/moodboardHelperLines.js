// Alignment guides for the moodboard canvas.
//
// While a single card is dragged, compare its live position against every other
// card and, for the closest matching edge within SNAP_DISTANCE on each axis,
// return the guide line to draw plus the snapped coordinate. Mirrors React
// Flow's helper-lines example but checks all six edge pairings per axis
// (left/center/right, top/middle/bottom) so cards align by their edges *or*
// their centers — which is what makes a hand-placed grid of references read as
// deliberate rather than approximate.

// How close (in flow units) a dragged edge must come to another card's edge
// before we snap to it and draw a guide.
const SNAP_DISTANCE = 6;

function bounds(x, y, w, h) {
  return { left: x, right: x + w, top: y, bottom: y + h, width: w, height: h };
}

export function getHelperLines(change, nodes, distance = SNAP_DISTANCE) {
  const result = { snapPosition: {} };
  const nodeA = nodes.find((n) => n.id === change.id);
  if (!nodeA || !change.position) return result;

  const aw = nodeA.measured?.width ?? 0;
  const ah = nodeA.measured?.height ?? 0;
  const a = bounds(change.position.x, change.position.y, aw, ah);
  const aCenterX = a.left + aw / 2;
  const aMiddleY = a.top + ah / 2;

  let vDist = distance;
  let hDist = distance;

  for (const nodeB of nodes) {
    if (nodeB.id === nodeA.id) continue;
    const bw = nodeB.measured?.width ?? 0;
    const bh = nodeB.measured?.height ?? 0;
    const b = bounds(nodeB.position.x, nodeB.position.y, bw, bh);
    const bCenterX = b.left + bw / 2;
    const bMiddleY = b.top + bh / 2;

    // --- vertical guides (align on the X axis) ---
    const vCandidates = [
      { line: b.left, snapX: b.left },                 // A.left  ↔ B.left
      { line: b.right, snapX: b.right - aw },          // A.right ↔ B.right
      { line: b.right, snapX: b.right },               // A.left  ↔ B.right
      { line: b.left, snapX: b.left - aw },            // A.right ↔ B.left
      { line: bCenterX, snapX: bCenterX - aw / 2 },    // centers
    ];
    const vRefs = [a.left, a.right, a.left, a.right, aCenterX];
    vCandidates.forEach((c, i) => {
      const d = Math.abs(vRefs[i] - c.line);
      if (d < vDist) {
        vDist = d;
        result.vertical = c.line;
        result.snapPosition.x = c.snapX;
      }
    });

    // --- horizontal guides (align on the Y axis) ---
    const hCandidates = [
      { line: b.top, snapY: b.top },                   // A.top    ↔ B.top
      { line: b.bottom, snapY: b.bottom - ah },        // A.bottom ↔ B.bottom
      { line: b.bottom, snapY: b.bottom },             // A.top    ↔ B.bottom
      { line: b.top, snapY: b.top - ah },              // A.bottom ↔ B.top
      { line: bMiddleY, snapY: bMiddleY - ah / 2 },    // centers
    ];
    const hRefs = [a.top, a.bottom, a.top, a.bottom, aMiddleY];
    hCandidates.forEach((c, i) => {
      const d = Math.abs(hRefs[i] - c.line);
      if (d < hDist) {
        hDist = d;
        result.horizontal = c.line;
        result.snapPosition.y = c.snapY;
      }
    });
  }

  return result;
}
