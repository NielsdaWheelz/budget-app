import { type Component, For } from "solid-js"
import { DeductionsCard } from "./components/deductions-card"
import { ExpenseCard } from "./components/expense-card"
import { IncomeCard } from "./components/income-card"
import { SavingsCard } from "./components/savings-card"
import { SegmentedControl } from "./components/segmented-control"
import { TakeHomeCard } from "./components/take-home-card"
import { useBudget } from "./hooks/use-budget"

const SCENARIO_OPTIONS: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
	{ value: "Solo", label: "Solo" },
	{ value: "OneRoommate", label: "1 Roommate" },
	{ value: "MultiRoommates", label: "Multi" },
]

const PERIOD_OPTIONS: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
	{ value: "Monthly", label: "Monthly" },
	{ value: "Yearly", label: "Yearly" },
]

export const App: Component = () => {
	const budget = useBudget()

	return (
		<div
			style={{
				"max-width": "720px",
				margin: "0 auto",
				padding: "32px 16px",
				"font-family": "Inter, sans-serif",
			}}
		>
			{/* Header */}
			<div
				style={{
					display: "flex",
					"justify-content": "space-between",
					"align-items": "center",
					"margin-bottom": "20px",
				}}
			>
				<h1
					style={{
						"font-size": "24px",
						"font-weight": "600",
						color: "#171717",
						margin: "0",
					}}
				>
					Budget
				</h1>
				<button
					type="button"
					onClick={budget.toggleAll}
					style={{
						background: "none",
						border: "1px solid #e5e5e5",
						"border-radius": "6px",
						padding: "6px 12px",
						"font-size": "13px",
						color: "#737373",
						cursor: "pointer",
						"font-family": "Inter, sans-serif",
					}}
				>
					{budget.allExpanded() ? "Collapse All" : "Expand All"}
				</button>
			</div>

			{/* Controls */}
			<div
				style={{
					display: "flex",
					gap: "12px",
					"margin-bottom": "20px",
				}}
			>
				<SegmentedControl
					options={SCENARIO_OPTIONS}
					value={budget.scenarioName()}
					onChange={budget.setScenarioName}
				/>
				<SegmentedControl
					options={PERIOD_OPTIONS}
					value={budget.period()}
					onChange={budget.setPeriod}
				/>
			</div>

			{/* Cards */}
			<IncomeCard
				grossIncome={budget.displayed().grossIncome}
				onGrossIncomeChange={budget.setGrossIncome}
			/>

			<DeductionsCard
				deductions={budget.displayed().deductions}
				federalTaxResult={budget.displayed().federalTaxResult}
				stateTaxResult={budget.displayed().stateTaxResult}
				grossIncome={budget.displayed().grossIncome}
				healthInsurance={budget.displayed().deductions.healthInsurance}
				rentersInsurance={budget.displayed().deductions.rentersInsurance}
				onHealthInsuranceChange={budget.setHealthInsurance}
				onRentersInsuranceChange={budget.setRentersInsurance}
				expanded={budget.isSectionExpanded("PaycheckDeductions")}
				onToggle={() => budget.toggleSection("PaycheckDeductions")}
			/>

			<TakeHomeCard takeHomePay={budget.displayed().takeHomePay} />

			<For each={budget.displayed().categories}>
				{(category) => (
					<ExpenseCard
						heading={category.heading}
						items={category.items}
						subtotal={category.subtotal}
						grossIncome={budget.displayed().grossIncome}
						expanded={budget.isSectionExpanded(category.group)}
						onToggle={() => budget.toggleSection(category.group)}
						onItemChange={budget.updateLineItem}
					/>
				)}
			</For>

			<SavingsCard
				savings={budget.displayed().savings}
				grossIncome={budget.displayed().grossIncome}
				takeHomePay={budget.displayed().takeHomePay}
			/>
		</div>
	)
}
