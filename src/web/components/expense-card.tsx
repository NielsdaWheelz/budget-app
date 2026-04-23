import { type Component, For } from "solid-js"
import { computePercentageOfGross } from "../helpers/format"
import { LineItemRow } from "./line-item-row"
import { SummaryCard } from "./summary-card"

interface ExpenseItem {
	readonly key: string
	readonly label: string
	readonly amount: number
	readonly editable: boolean
}

interface ExpenseCardProps {
	readonly heading: string
	readonly items: ReadonlyArray<ExpenseItem>
	readonly subtotal: number
	readonly grossIncome: number
	readonly expanded: boolean
	readonly onToggle: () => void
	readonly onItemChange: (key: string, cents: number) => void
}

export const ExpenseCard: Component<ExpenseCardProps> = (props) => {
	const percentage = () => computePercentageOfGross(props.subtotal, props.grossIncome)

	return (
		<SummaryCard
			heading={props.heading}
			subtotal={props.subtotal}
			percentage={percentage()}
			isExpense={true}
			expanded={props.expanded}
			onToggle={props.onToggle}
			itemCount={props.items.length}
		>
			<For each={props.items}>
				{(item) => (
					<LineItemRow
						label={item.label}
						amount={item.amount}
						percentage={computePercentageOfGross(item.amount, props.grossIncome)}
						editable={item.editable}
						onAmountChange={(cents) => props.onItemChange(item.key, cents)}
						isExpense={true}
					/>
				)}
			</For>
		</SummaryCard>
	)
}
