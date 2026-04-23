export const formatCurrency = (cents: number): string => {
	const dollars = Math.abs(cents) / 100
	return `$${dollars.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`
}

export const formatNegativeCurrency = (cents: number): string => {
	if (cents < 0) {
		return `\u2212${formatCurrency(cents)}`
	}
	return formatCurrency(cents)
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
