import type { Component } from "solid-js"
import { formatCurrency } from "../helpers/format"

interface TakeHomeCardProps {
	readonly takeHomePay: number
}

export const TakeHomeCard: Component<TakeHomeCardProps> = (props) => {
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
					Take-Home Pay
				</span>
				<span
					style={{
						"font-size": "16px",
						"font-weight": "500",
						color: "#16a34a",
						"font-variant-numeric": "tabular-nums",
					}}
				>
					{formatCurrency(props.takeHomePay)}
				</span>
			</div>
		</div>
	)
}
