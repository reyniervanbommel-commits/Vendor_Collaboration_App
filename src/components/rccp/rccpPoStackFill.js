/**
 * Fill color and opacity per stack-segment status for the PO-stack bars.
 * Split out of rccpPoStack.js to keep that file under the 300-line limit.
 */

/**
 * Fill color and opacity for one above/below-axis stack segment.
 * Above the axis: "open" (still outstanding) paints full color; "ordered" is the
 * already-filled part of that same order and is shown faded in the received color, so it
 * reads as a preview of what has come in. Below the axis is always "received" at full opacity.
 * @param {string} status
 * @param {{ openColor: string, receivedColor: string, side: 'above'|'below' }} colors
 * @returns {{ fill: string, opacity: number }}
 */
export function poStackSegmentFill(status, { openColor, receivedColor, side } = {}) {
  if (side === 'below') return { fill: receivedColor, opacity: 1 };
  if (status === 'open') return { fill: openColor, opacity: 1 };
  return { fill: receivedColor, opacity: 0.3 };
}

/**
 * Groups a stack's layout rects (already ordered axis-out by `stackRectLayout`) into
 * contiguous same-status bands, so each status paints as one seamless rect instead of one
 * rect per item (which would show white seams between items of the same status).
 * @param {{ y: number, height: number, segment: object }[]} layout
 * @returns {{ status: string, top: number, bottom: number }[]}
 */
export function groupStackLayoutByStatus(layout) {
  const groups = [];
  for (const entry of layout || []) {
    const status = entry.segment?.status;
    const last = groups[groups.length - 1];
    if (last && last.status === status) {
      last.top = Math.min(last.top, entry.y);
      last.bottom = Math.max(last.bottom, entry.y + entry.height);
    } else {
      groups.push({ status, top: entry.y, bottom: entry.y + entry.height });
    }
  }
  return groups;
}
