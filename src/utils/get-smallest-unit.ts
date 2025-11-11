import { BigNumberInput } from "@medusajs/framework/types";
import { BigNumber, MathBN } from "@medusajs/framework/utils";

/**
 *
 * @param currency
 */
function getCurrencyMultiplier(currency: string): number {
  const currencyMultipliers: Record<string, string[]> = {
    0: [
      "BIF",
      "CLP",
      "DJF",
      "GNF",
      "JPY",
      "KMF",
      "KRW",
      "MGA",
      "PYG",
      "RWF",
      "UGX",
      "VND",
      "VUV",
      "XAF",
      "XOF",
      "XPF",
    ],
    3: ["BHD", "IQD", "JOD", "KWD", "OMR", "TND"],
  };

  const currencyUpper = currency.toUpperCase();
  let power = 2;
  for (const [key, value] of Object.entries(currencyMultipliers)) {
    if (value.includes(currencyUpper)) {
      power = Number.parseInt(key, 10);
      break;
    }
  }
  return Math.pow(10, power);
}

/**
 * Converts an amount to the format required by PhonePe based on currency.
 * PhonePe API v2 accepts amounts in standard currency units (e.g., 100.50 for INR),
 * but this utility can convert to smallest units if needed for consistency with Medusa patterns.
 * @param {BigNumberInput} amount - The amount to be converted.
 * @param {string} currency - The currency code (e.g., 'INR', 'USD').
 * @returns {number} - The converted amount in the smallest currency unit.
 */
export function getSmallestUnit(
  amount: BigNumberInput,
  currency: string
): number {
  const multiplier = getCurrencyMultiplier(currency);

  const amount_ =
    Math.round(new BigNumber(MathBN.mult(amount, multiplier)).numeric) /
    multiplier;

  const smallestAmount = new BigNumber(MathBN.mult(amount_, multiplier));

  let numeric = smallestAmount.numeric;
  // Check if the currency requires rounding to the nearest ten
  if (multiplier === 1e3) {
    numeric = Math.ceil(numeric / 10) * 10;
  }

  return Number.parseInt(numeric.toString().split(".").shift()!, 10);
}

/**
 * Converts an amount from the smallest currency unit to the standard unit based on currency.
 * @param {BigNumberInput} amount - The amount in the smallest currency unit.
 * @param {string} currency - The currency code (e.g., 'INR', 'USD').
 * @returns {number} - The converted amount in the standard currency unit.
 */
export function getAmountFromSmallestUnit(
  amount: BigNumberInput,
  currency: string
): number {
  const multiplier = getCurrencyMultiplier(currency);
  const standardAmount = new BigNumber(MathBN.div(amount, multiplier));
  return standardAmount.numeric;
}
