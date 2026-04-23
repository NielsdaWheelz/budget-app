import type { Component } from "solid-js"
import { formatCurrency, formatPercentage } from "../helpers/format"

interface SavingsCardProps {
	readonly savings: number
	readonly grossIncome: number
	readonly takeHomePay: number
}

export const SavingsCard: Component<SavingsCardProps> = (props) => {
	const percentOfGross = () => (props.grossIncome === 0 ? 0 : props.savings / props.grossIncome)
	const percentOfTakeHome = () => (props.takeHomePay === 0 ? 0 : props.savings / props.takeHomePay)

	return (
		<div
			style={{
				background: "var(--color-bg-card)",
				border: "1px solid var(--color-border)",
				"border-radius": "12px",
				padding: "16px 20px",
				"margin-bottom": "12px",
				"font-family": "Inter, sans-serif",
			}}
		>
			<div
				style={{
					display: "flex",
					"justify-content": "space-between",
					"align-items": "center",
				}}
			>
				<span
					style={{
						"font-size": "16px",
						"font-weight": "600",
						color: "var(--color-text)",
					}}
				>
					Savings
				</span>
				<div style={{ display: "flex", "align-items": "center" }}>
					<span
						style={{
							"font-size": "16px",
							"font-weight": "500",
							color: "var(--color-success)",
							"font-variant-numeric": "tabular-nums",
						}}
					>
						{formatCurrency(props.savings)}
					</span>
					<span
						style={{
							color: "var(--color-text-secondary)",
							"font-size": "13px",
							"margin-left": "12px",
							"font-variant-numeric": "tabular-nums",
						}}
					>
						{formatPercentage(percentOfGross())}
					</span>
				</div>
			</div>
			<div
				style={{
					"text-align": "right",
					"font-size": "13px",
					color: "var(--color-text-secondary)",
					"margin-top": "4px",
				}}
			>
				{formatPercentage(percentOfTakeHome())} of take-home pay
			</div>
		</div>
	)
}
