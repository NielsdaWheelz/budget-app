import { type JSX, Show } from "solid-js"
import type { Component } from "solid-js"

interface SummaryCardProps {
	readonly heading: string
	readonly subtotal: number
	readonly percentage: number
	readonly isExpense: boolean
	readonly expanded: boolean
	readonly onToggle: () => void
	readonly children: JSX.Element
	readonly itemCount?: number | undefined
	readonly extra?: JSX.Element | undefined
}

const fmt = (cents: number): string => {
	const dollars = Math.abs(cents) / 100
	return dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const fmtPct = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`

export const SummaryCard: Component<SummaryCardProps> = (props) => {
	const displayAmount = () => {
		const formatted = fmt(props.subtotal)
		return props.isExpense ? `\u2212$${formatted}` : `$${formatted}`
	}

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
			<button
				type="button"
				onClick={props.onToggle}
				style={{
					display: "flex",
					width: "100%",
					"justify-content": "space-between",
					"align-items": "center",
					cursor: "pointer",
					"user-select": "none",
					background: "none",
					border: "none",
					padding: "0",
					"font-family": "inherit",
				}}
			>
				<div style={{ display: "flex", "align-items": "center" }}>
					<span
						style={{
							"font-size": "12px",
							"margin-right": "8px",
							color: "var(--color-text-muted)",
						}}
					>
						{props.expanded ? "\u25BC" : "\u25B6"}
					</span>
					<span
						style={{
							"font-size": "16px",
							"font-weight": "600",
							color: "var(--color-text)",
						}}
					>
						{props.heading}
					</span>
				</div>
				<div style={{ display: "flex", "align-items": "center" }}>
					<span
						style={{
							"font-size": "16px",
							"font-weight": "500",
							"font-variant-numeric": "tabular-nums",
							color: "var(--color-text)",
						}}
					>
						{displayAmount()}
					</span>
					<span
						style={{
							color: "var(--color-text-secondary)",
							"font-size": "13px",
							"margin-left": "12px",
							"font-variant-numeric": "tabular-nums",
						}}
					>
						{fmtPct(props.percentage)}
					</span>
				</div>
			</button>

			<Show when={props.extra}>
				{(extra) => (
					<div
						style={{
							"text-align": "right",
							"font-size": "13px",
							color: "var(--color-text-secondary)",
							"margin-top": "2px",
						}}
					>
						{extra()}
					</div>
				)}
			</Show>

			<Show when={!props.expanded && props.itemCount !== undefined}>
				<div
					style={{
						color: "var(--color-text-muted)",
						"font-size": "13px",
						"padding-top": "4px",
					}}
				>
					{"\u25B6"} {props.itemCount} items...
				</div>
			</Show>

			<Show when={props.expanded}>
				<div
					style={{
						"border-top": "1px solid var(--color-border-section)",
						"margin-top": "12px",
						"padding-top": "12px",
					}}
				>
					{props.children}
				</div>
			</Show>
		</div>
	)
}
