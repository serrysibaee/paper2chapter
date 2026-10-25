/** Parse a learner's numeric answer: accepts "0.25", "1/4", "2.5e-3", "25%", "−3" (unicode minus). */
export function parseNumber(input: string): number | null {
  const s = input.trim().replace(/−/g, "-").replace(/,/g, "");
  if (!s) return null;
  const pct = /^(-?\d*\.?\d+(?:e[-+]?\d+)?)\s*%$/i.exec(s);
  if (pct) return Number(pct[1]) / 100;
  const frac = /^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/.exec(s);
  if (frac) {
    const d = Number(frac[2]);
    return d === 0 ? null : Number(frac[1]) / d;
  }
  if (!/^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  return Number(s);
}

/**
 * Compare with the exercise's absolute tolerance when given; otherwise accept answers
 * within 1% (relative), which tolerates reasonable rounding.
 */
export function isNumericallyCorrect(input: string, expected: number, tolerance: number | null): boolean {
  const value = parseNumber(input);
  if (value === null || !Number.isFinite(value)) return false;
  if (tolerance !== null && tolerance > 0) return Math.abs(value - expected) <= tolerance + 1e-12;
  return Math.abs(value - expected) <= 0.01 * Math.max(1e-9, Math.abs(expected));
}
