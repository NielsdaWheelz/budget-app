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
				background: "#ffffff",
				border: "1px solid #e5e5e5",
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
						color: "#171717",
					}}
				>
					Savings
				</span>
				<div style={{ display: "flex", "align-items": "center" }}>
					<span
						style={{
							"font-size": "16px",
							"font-weight": "500",
							color: "#16a34a",
							"font-variant-numeric": "tabular-nums",
						}}
					>
						{formatCurrency(props.savings)}
					</span>
					<span
						style={{
							color: "#737373",
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
					color: "#737373",
					"margin-top": "4px",
				}}
			>
				{formatPercentage(percentOfTakeHome())} of take-home pay
			</div>
		</div>
	)
}
