// Original NCWnd saved-position admission and reset-anchor arithmetic.
// Source and narrow scope: docs/native-layout-evidence.md.
const finiteRect = r => r && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k]));

export function windowCornerInside(rect, parent) {
  if (!finiteRect(rect) || !finiteRect(parent)) return false;
  // NCRect::Intersects checks the child's four corners, inclusively. A
  // containing/overlapping rectangle with no corner inside is NOT admitted.
  // The argument's right/bottom corners are integer conversions of the
  // sums. The parent's upper bounds remain untruncated floats.
  return [rect.x, Math.trunc(rect.x + rect.width)].some(x =>
    [rect.y, Math.trunc(rect.y + rect.height)].some(y => x >= parent.x && x <= parent.x + parent.width
      && y >= parent.y && y <= parent.y + parent.height));
}

export function defaultWindowPosition(rule, rect, parent) {
  if (!rule || !Number.isInteger(rule.anchor) || rule.anchor < 1 || rule.anchor > 9
      || ![rule.offsetX, rule.offsetY].every(Number.isFinite)
      || !finiteRect(rect) || !finiteRect(parent)) return null;
  const width = rule.w == null ? rect.width : rule.w;
  const height = rule.h == null ? rect.height : rule.h;
  if (![width, height].every(v => Number.isFinite(v) && v >= 0)) return null;
  // Native reset positions before applying any explicit new dimensions.
  // anchored=false then clears anchoring, so resize cannot reposition it.
  const anchorWidth = rule.anchored ? width : rect.width;
  const anchorHeight = rule.anchored ? height : rect.height;
  const i = rule.anchor - 1, fx = (i % 3) / 2, fy = Math.floor(i / 3) / 2;
  return {
    x: rect.x + rule.offsetX - Math.trunc(rect.x + anchorWidth * fx) + Math.trunc(parent.x + parent.width * fx),
    y: rect.y + rule.offsetY - Math.trunc(rect.y + anchorHeight * fy) + Math.trunc(parent.y + parent.height * fy),
    width, height,
  };
}
