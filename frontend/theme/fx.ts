/** Small colour helpers for the lighting / depth effects. All inputs are 6-digit hex strings. */

function parse(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

/** Blend `a` towards `b` by `ratio` (0 = a, 1 = b). */
export function mix(a: string, b: string, ratio: number): string {
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  return `#${toHex(ar + (br - ar) * ratio)}${toHex(ag + (bg - ag) * ratio)}${toHex(ab + (bb - ab) * ratio)}`;
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = parse(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}
