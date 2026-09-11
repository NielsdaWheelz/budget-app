import type { Component } from "solid-js"
import { formatCurrency } from "../helpers/format"

interface BracketRowProps {
	readonly rate: number
	readonly taxableAmount: number
	readonly tax: number
}

export const BracketRow: Component<BracketRowProps> = (props) => {
	return (
		<div
			style={{
				display: "flex",
				"justify-content": "space-between",
				"font-size": "13px",
				color: "var(--color-text-secondary)",
				padding: "4px 0 4px 16px",
				"font-family": "Inter, sans-serif",
			}}
		>
			<span>
				{(props.rate * 100).toFixed(0)}% on {formatCurrency(props.taxableAmount)}
			</span>
			<span
				style={{
					"font-variant-numeric": "tabular-nums",
				}}
			>
				{"\u2212"}
				{formatCurrency(props.tax)}
			</span>
		</div>
	)
}
