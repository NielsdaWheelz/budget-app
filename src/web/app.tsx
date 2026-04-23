import { type Component, For } from "solid-js"
import { DeductionsCard } from "./components/deductions-card"
import { ExpenseCard } from "./components/expense-card"
import { IncomeCard } from "./components/income-card"
import { SavingsCard } from "./components/savings-card"
import { SegmentedControl } from "./components/segmented-control"
import { TakeHomeCard } from "./components/take-home-card"
import { useBudget } from "./hooks/use-budget"
import { ThemeProvider, useTheme } from "./theme"

const SCENARIO_OPTIONS: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
	{ value: "Solo", label: "Solo" },
	{ value: "OneRoommate", label: "1 Roommate" },
	{ value: "MultiRoommates", label: "Multi" },
]

const PERIOD_OPTIONS: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
	{ value: "Monthly", label: "Monthly" },
	{ value: "Yearly", label: "Yearly" },
]

const AppContent: Component = () => {
	const budget = useBudget()
	const { theme, setTheme } = useTheme()

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
						color: "var(--color-text)",
						margin: "0",
					}}
				>
					Budget
				</h1>
				<div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
					<SegmentedControl
						options={[
							{ label: "System", value: "system" },
							{ label: "Light", value: "light" },
							{ label: "Dark", value: "dark" },
						]}
						value={theme()}
						onChange={(v) => setTheme(v as "system" | "light" | "dark")}
					/>
					<button
						type="button"
						onClick={budget.toggleAll}
						style={{
							background: "none",
							border: "1px solid var(--color-border)",
							"border-radius": "6px",
							padding: "6px 12px",
							"font-size": "13px",
							color: "var(--color-text-secondary)",
							cursor: "pointer",
							"font-family": "Inter, sans-serif",
						}}
					>
						{budget.allExpanded() ? "Collapse All" : "Expand All"}
					</button>
				</div>
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

export const App: Component = () => {
	return (
		<ThemeProvider>
			<AppContent />
		</ThemeProvider>
	)
}
