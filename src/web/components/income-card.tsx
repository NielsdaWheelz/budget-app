import type { Component } from "solid-js"
import { InlineEdit } from "./inline-edit"

interface IncomeCardProps {
	readonly grossIncome: number
	readonly onGrossIncomeChange: (cents: number) => void
}

export const IncomeCard: Component<IncomeCardProps> = (props) => {
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
					Gross Income
				</span>
				<span
					style={{
						"font-size": "16px",
						"font-weight": "500",
						color: "#16a34a",
						"font-variant-numeric": "tabular-nums",
					}}
				>
					<InlineEdit value={props.grossIncome} onCommit={props.onGrossIncomeChange} />
				</span>
			</div>
		</div>
	)
}
