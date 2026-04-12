import BigNumber from "bignumber.js";

export type NumInput = string | number | BigNumber;

const tryBig = (val: NumInput): BigNumber | null => {
  try {
    const bn = new BigNumber(val);
    return bn.isNaN() ? null : bn;
  } catch {
    return null;
  }
};

/**
 * Remove tailing zeros of a number, up to `precision` decimal places.
 * Returns "--" when value is NaN or `isNilExpression` is true.
 * ```ts
 * removeTailingZero("1.00000000", 8)  // "1"
 * removeTailingZero("0.50000000", 8)  // "0.5"
 * removeTailingZero("0.01230000", 8)  // "0.0123"
 * removeTailingZero(NaN)              // "--"
 * ```
 */
export const removeTailingZero = (
  input: NumInput,
  precision = 8,
  isNilExpression = false,
  unit = "",
  rm: BigNumber.RoundingMode = BigNumber.ROUND_DOWN,
): string => {
  const bn = tryBig(input);
  if (bn === null || isNilExpression) return "--";
  // Use toFixed() to avoid scientific notation (e.g. "1e-8"), then strip trailing zeros
  const fixed = bn.dp(precision, rm).toFixed();
  const stripped = fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
  return `${stripped}${unit}`;
};

/**
 * Format a decimal value as a percentage string (e.g. 0.1234 → "12.3%").
 * Returns "--" when value is nil.
 */
export const formatPercent = (value: number | null | undefined, decimals = 1): string => {
  if (value == null) return "--";
  const bn = tryBig(value);
  if (bn === null) return "--";
  return `${bn.multipliedBy(100).dp(decimals, BigNumber.ROUND_HALF_UP).toFixed()}%`;
};

// ─── arithmetic (returns string to avoid chaining pitfalls) ───────────────────

export const safePlus = (a: NumInput, b: NumInput): string => new BigNumber(a).plus(b).toString();

export const safeMinus = (a: NumInput, b: NumInput): string => new BigNumber(a).minus(b).toString();

export const safeMultipliedBy = (a: NumInput, b: NumInput): string =>
  new BigNumber(a).multipliedBy(b).toString();

export const safeDividedBy = (a: NumInput, b: NumInput): string =>
  new BigNumber(a).dividedBy(b).toString();

// ─── comparison ───────────────────────────────────────────────────────────────

export const gt = (a: NumInput, b: NumInput): boolean => new BigNumber(a).gt(b);
export const gte = (a: NumInput, b: NumInput): boolean => new BigNumber(a).gte(b);
export const lt = (a: NumInput, b: NumInput): boolean => new BigNumber(a).lt(b);
export const lte = (a: NumInput, b: NumInput): boolean => new BigNumber(a).lte(b);

// ─── BigNumber factory ────────────────────────────────────────────────────────

export const toBig = (input: NumInput): BigNumber => new BigNumber(input);
