const MYANMAR = /[က-႟ꩠ-ꩿꧠ-꧿]/;

export function hasMyanmar(text: string): boolean {
  return MYANMAR.test(text);
}

/**
 * Line height for a piece of text. Myanmar script stacks vowel and tone marks well above and below the
 * baseline, so a Latin-sized line box clips the first line; give it extra room.
 */
export function lineHeightFor(text: string, fontSize: number, latinRatio = 1.4): number {
  return Math.round(fontSize * (hasMyanmar(text) ? 1.95 : latinRatio));
}
