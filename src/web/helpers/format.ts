export const centsToDecimal = (cents: number): string => {
	const value = BigInt(Math.abs(cents))
	return `${cents < 0 ? "-" : ""}${value / 100n}.${String(value % 100n).padStart(2, "0")}`
}

export const formatCurrency = (cents: number): string => {
	const value = BigInt(Math.abs(cents))
	return `$${(value / 100n).toLocaleString("en-US")}.${String(value % 100n).padStart(2, "0")}`
}

export const formatSignedCurrency = (cents: number): string => {
	if (cents < 0) {
		return `\u2212${formatCurrency(cents)}`
	}
	return formatCurrency(cents)
}

export const formatPercentage = (value: number): string => `${(value * 100).toFixed(1)}%`

export const formatEffectiveRate = (value: number): string => `${(value * 100).toFixed(2)}%`

export const computePercentageOfGross = (amount: number, grossIncome: number): number => {
	if (grossIncome === 0) return 0
	return amount / grossIncome
}

export const formatDifference = (cents: number): string =>
	cents > 0 ? `+${formatCurrency(cents)}` : formatSignedCurrency(cents)

export const differenceDescription = (cents: number): string =>
	cents === 0 ? "matches plan" : `${formatCurrency(cents)} ${cents > 0 ? "over" : "under"} plan`

export const monthLabel = (month: string): string =>
	new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
		.format(new Date(`${month}-01T12:00:00Z`))
		.toLowerCase()
