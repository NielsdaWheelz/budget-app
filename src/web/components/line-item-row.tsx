import { type Component, Show } from "solid-js"
import { formatCurrency } from "../helpers/format"
import { InlineEdit } from "./inline-edit"

interface LineItemRowProps {
	readonly label: string
	readonly amount: number
	readonly percentage: number
	readonly editable: boolean
	readonly onAmountChange?: ((cents: number) => void) | undefined
	readonly isExpense: boolean
}

const fmtPct = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`

export const LineItemRow: Component<LineItemRowProps> = (props) => {
	const displayAmount = () => {
		const formatted = formatCurrency(props.amount)
		return props.isExpense ? `\u2212${formatted}` : formatted
	}

	return (
		<div
			style={{
				display: "flex",
				"justify-content": "space-between",
				"align-items": "center",
				padding: "8px 0",
				"border-bottom": "1px solid var(--color-border-subtle)",
			}}
		>
			<span
				style={{
					"font-size": "14px",
					color: "var(--color-text)",
					"font-family": "Inter, sans-serif",
				}}
			>
				{props.label}
			</span>
			<div
				style={{
					display: "flex",
					"align-items": "center",
				}}
			>
				<span
					style={{
						"font-family": "Inter, sans-serif",
						"font-variant-numeric": "tabular-nums",
						"font-size": "14px",
						color: "var(--color-text)",
					}}
				>
					<Show
						when={props.editable && props.onAmountChange}
						fallback={<span>{displayAmount()}</span>}
					>
						{(onChange) => (
							<InlineEdit value={props.amount} label={props.label} onCommit={onChange()} />
						)}
					</Show>
				</span>
				<span
					style={{
						color: "var(--color-text-secondary)",
						"font-size": "13px",
						"margin-left": "12px",
						"min-width": "48px",
						"text-align": "right",
						"font-family": "Inter, sans-serif",
						"font-variant-numeric": "tabular-nums",
					}}
				>
					{fmtPct(props.percentage)}
				</span>
			</div>
		</div>
	)
}
