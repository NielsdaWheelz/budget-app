import type { Component } from "solid-js"
import { formatCurrency } from "../helpers/format"

interface TakeHomeCardProps {
	readonly takeHomePay: number
}

export const TakeHomeCard: Component<TakeHomeCardProps> = (props) => {
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
					Take-Home Pay
				</span>
				<span
					style={{
						"font-size": "16px",
						"font-weight": "500",
						color: "var(--color-success)",
						"font-variant-numeric": "tabular-nums",
					}}
				>
					{formatCurrency(props.takeHomePay)}
				</span>
			</div>
		</div>
	)
}
