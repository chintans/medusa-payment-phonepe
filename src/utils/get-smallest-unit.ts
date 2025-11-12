import { BigNumberInput } from "@medusajs/framework/types";
import { BigNumber, MathBN } from "@medusajs/framework/utils";

/**
 * Map of currency codes to their decimal power (exponent for 10^power multiplier).
 * Currencies with power 0 have no decimal places (multiplier = 1).
 * Currencies with power 3 have 3 decimal places (multiplier = 1000).
 * Default power is 2 (multiplier = 100) for most currencies.
 */
const CURRENCY_POWER_MAP = new Map<string, number>([
	// Power 0 currencies (multiplier = 1)
	["BIF", 0],
	["CLP", 0],
	["DJF", 0],
	["GNF", 0],
	["JPY", 0],
	["KMF", 0],
	["KRW", 0],
	["MGA", 0],
	["PYG", 0],
	["RWF", 0],
	["UGX", 0],
	["VND", 0],
	["VUV", 0],
	["XAF", 0],
	["XOF", 0],
	["XPF", 0],
	// Power 3 currencies (multiplier = 1000)
	["BHD", 3],
	["IQD", 3],
	["JOD", 3],
	["KWD", 3],
	["OMR", 3],
	["TND", 3],
]);

/**
 * Gets the currency multiplier based on the currency code.
 * @param currency - The currency code (e.g., 'INR', 'USD', 'JPY').
 * @returns The multiplier (10^power) for the currency. Default is 100 (power 2).
 */
function getCurrencyMultiplier(currency: string): number {
	const currencyUpper = currency.toUpperCase();
	const power = CURRENCY_POWER_MAP.get(currencyUpper) ?? 2;
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
	currency: string,
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

	return Math.floor(numeric);
}

/**
 * Converts an amount from the smallest currency unit to the standard unit based on currency.
 * @param {BigNumberInput} amount - The amount in the smallest currency unit.
 * @param {string} currency - The currency code (e.g., 'INR', 'USD').
 * @returns {number} - The converted amount in the standard currency unit.
 */
export function getAmountFromSmallestUnit(
	amount: BigNumberInput,
	currency: string,
): number {
	const multiplier = getCurrencyMultiplier(currency);
	const standardAmount = new BigNumber(MathBN.div(amount, multiplier));
	return standardAmount.numeric;
}
