import type { Component } from "solid-js"

interface BracketRowProps {
	readonly rate: number
	readonly taxableAmount: number
	readonly tax: number
}

const fmt = (cents: number): string => {
	const dollars = Math.abs(cents) / 100
	return dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export const BracketRow: Component<BracketRowProps> = (props) => {
	return (
		<div
			style={{
				display: "flex",
				"justify-content": "space-between",
				"font-size": "13px",
				color: "#737373",
				padding: "4px 0 4px 16px",
				"font-family": "Inter, sans-serif",
			}}
		>
			<span>
				{(props.rate * 100).toFixed(0)}% on ${fmt(props.taxableAmount)}
			</span>
			<span
				style={{
					"font-variant-numeric": "tabular-nums",
				}}
			>
				{"\u2212"}${fmt(props.tax)}
			</span>
		</div>
	)
}
