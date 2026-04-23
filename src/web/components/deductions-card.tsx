import { type Component, For, Show, createSignal } from "solid-js"
import {
	computePercentageOfGross,
	formatCurrency,
	formatEffectiveRate,
	formatPercentage,
} from "../helpers/format"
import { BracketRow } from "./bracket-row"
import { InlineEdit } from "./inline-edit"
import { SummaryCard } from "./summary-card"

interface BracketResult {
	readonly bracket: { readonly rate: number }
	readonly taxableAmount: number
	readonly tax: number
}

interface TaxResult {
	readonly jurisdiction: string
	readonly brackets: ReadonlyArray<BracketResult>
	readonly totalTax: number
	readonly taxableIncome: number
}

interface PayrollDeductions {
	readonly socialSecurity: number
	readonly medicare: number
	readonly federalIncomeTax: number
	readonly stateIncomeTax: number
	readonly healthInsurance: number
	readonly rentersInsurance: number
	readonly total: number
}

interface DeductionsCardProps {
	readonly deductions: PayrollDeductions
	readonly federalTaxResult: TaxResult
	readonly stateTaxResult: TaxResult
	readonly grossIncome: number
	readonly healthInsurance: number
	readonly rentersInsurance: number
	readonly onHealthInsuranceChange: (cents: number) => void
	readonly onRentersInsuranceChange: (cents: number) => void
	readonly expanded: boolean
	readonly onToggle: () => void
}

const TaxLineWithBrackets: Component<{
	readonly label: string
	readonly taxResult: TaxResult
	readonly grossIncome: number
}> = (props) => {
	const [expanded, setExpanded] = createSignal(false)

	return (
		<div>
			<button
				type="button"
				onClick={() => setExpanded(!expanded())}
				style={{
					display: "flex",
					width: "100%",
					"justify-content": "space-between",
					"align-items": "center",
					padding: "8px 0",
					border: "none",
					"border-bottom": "1px solid #f5f5f5",
					background: "none",
					cursor: "pointer",
					"user-select": "none",
					"font-family": "inherit",
				}}
			>
				<span
					style={{
						"font-size": "14px",
						color: "#171717",
						"font-family": "Inter, sans-serif",
					}}
				>
					<span
						style={{
							"font-size": "10px",
							"margin-right": "6px",
							color: "#a3a3a3",
						}}
					>
						{expanded() ? "\u25BC" : "\u25B6"}
					</span>
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
							color: "#171717",
						}}
					>
						{"\u2212"}
						{formatCurrency(props.taxResult.totalTax)}
					</span>
					<span
						style={{
							color: "#737373",
							"font-size": "13px",
							"margin-left": "12px",
							"min-width": "48px",
							"text-align": "right",
							"font-family": "Inter, sans-serif",
							"font-variant-numeric": "tabular-nums",
						}}
					>
						{formatPercentage(
							computePercentageOfGross(props.taxResult.totalTax, props.grossIncome),
						)}
					</span>
				</div>
			</button>
			<Show when={expanded()}>
				<div style={{ "padding-left": "8px" }}>
					<For each={props.taxResult.brackets}>
						{(br) => (
							<BracketRow rate={br.bracket.rate} taxableAmount={br.taxableAmount} tax={br.tax} />
						)}
					</For>
					<div
						style={{
							display: "flex",
							"justify-content": "space-between",
							"font-size": "13px",
							color: "#171717",
							"font-weight": "500",
							padding: "6px 0 6px 16px",
							"border-top": "1px solid #f0f0f0",
							"margin-top": "4px",
							"font-family": "Inter, sans-serif",
						}}
					>
						<span>Subtotal</span>
						<span style={{ "font-variant-numeric": "tabular-nums" }}>
							{"\u2212"}
							{formatCurrency(props.taxResult.totalTax)}
						</span>
					</div>
				</div>
			</Show>
		</div>
	)
}

export const DeductionsCard: Component<DeductionsCardProps> = (props) => {
	const percentage = () => computePercentageOfGross(props.deductions.total, props.grossIncome)
	const effectiveRate = () =>
		props.grossIncome === 0 ? 0 : props.deductions.total / props.grossIncome

	return (
		<SummaryCard
			heading="Paycheck Deductions"
			subtotal={props.deductions.total}
			percentage={percentage()}
			isExpense={true}
			expanded={props.expanded}
			onToggle={props.onToggle}
			extra={<span>Effective rate: {formatEffectiveRate(effectiveRate())}</span>}
		>
			<TaxLineWithBrackets
				label="Federal Income Tax"
				taxResult={props.federalTaxResult}
				grossIncome={props.grossIncome}
			/>

			<TaxLineWithBrackets
				label="California State Tax"
				taxResult={props.stateTaxResult}
				grossIncome={props.grossIncome}
			/>

			{/* Social Security */}
			<div
				style={{
					display: "flex",
					"justify-content": "space-between",
					"align-items": "center",
					padding: "8px 0",
					"border-bottom": "1px solid #f5f5f5",
				}}
			>
				<span
					style={{
						"font-size": "14px",
						color: "#171717",
						"font-family": "Inter, sans-serif",
					}}
				>
					Social Security (FICA)
				</span>
				<div style={{ display: "flex", "align-items": "center" }}>
					<span
						style={{
							"font-family": "Inter, sans-serif",
							"font-variant-numeric": "tabular-nums",
							"font-size": "14px",
							color: "#171717",
						}}
					>
						{"\u2212"}
						{formatCurrency(props.deductions.socialSecurity)}
					</span>
					<span
						style={{
							color: "#737373",
							"font-size": "13px",
							"margin-left": "12px",
							"min-width": "48px",
							"text-align": "right",
							"font-family": "Inter, sans-serif",
							"font-variant-numeric": "tabular-nums",
						}}
					>
						{formatPercentage(
							computePercentageOfGross(props.deductions.socialSecurity, props.grossIncome),
						)}
					</span>
				</div>
			</div>

			{/* Medicare */}
			<div
				style={{
					display: "flex",
					"justify-content": "space-between",
					"align-items": "center",
					padding: "8px 0",
					"border-bottom": "1px solid #f5f5f5",
				}}
			>
				<span
					style={{
						"font-size": "14px",
						color: "#171717",
						"font-family": "Inter, sans-serif",
					}}
				>
					Medicare
				</span>
				<div style={{ display: "flex", "align-items": "center" }}>
					<span
						style={{
							"font-family": "Inter, sans-serif",
							"font-variant-numeric": "tabular-nums",
							"font-size": "14px",
							color: "#171717",
						}}
					>
						{"\u2212"}
						{formatCurrency(props.deductions.medicare)}
					</span>
					<span
						style={{
							color: "#737373",
							"font-size": "13px",
							"margin-left": "12px",
							"min-width": "48px",
							"text-align": "right",
							"font-family": "Inter, sans-serif",
							"font-variant-numeric": "tabular-nums",
						}}
					>
						{formatPercentage(
							computePercentageOfGross(props.deductions.medicare, props.grossIncome),
						)}
					</span>
				</div>
			</div>

			{/* Health Insurance - editable */}
			<div
				style={{
					display: "flex",
					"justify-content": "space-between",
					"align-items": "center",
					padding: "8px 0",
					"border-bottom": "1px solid #f5f5f5",
				}}
			>
				<span
					style={{
						"font-size": "14px",
						color: "#171717",
						"font-family": "Inter, sans-serif",
					}}
				>
					Health Insurance
				</span>
				<div style={{ display: "flex", "align-items": "center" }}>
					<span
						style={{
							"font-family": "Inter, sans-serif",
							"font-variant-numeric": "tabular-nums",
							"font-size": "14px",
							color: "#171717",
						}}
					>
						<InlineEdit value={props.healthInsurance} onCommit={props.onHealthInsuranceChange} />
					</span>
					<span
						style={{
							color: "#737373",
							"font-size": "13px",
							"margin-left": "12px",
							"min-width": "48px",
							"text-align": "right",
							"font-family": "Inter, sans-serif",
							"font-variant-numeric": "tabular-nums",
						}}
					>
						{formatPercentage(computePercentageOfGross(props.healthInsurance, props.grossIncome))}
					</span>
				</div>
			</div>

			{/* Renter's Insurance - editable */}
			<div
				style={{
					display: "flex",
					"justify-content": "space-between",
					"align-items": "center",
					padding: "8px 0",
				}}
			>
				<span
					style={{
						"font-size": "14px",
						color: "#171717",
						"font-family": "Inter, sans-serif",
					}}
				>
					Renter's Insurance
				</span>
				<div style={{ display: "flex", "align-items": "center" }}>
					<span
						style={{
							"font-family": "Inter, sans-serif",
							"font-variant-numeric": "tabular-nums",
							"font-size": "14px",
							color: "#171717",
						}}
					>
						<InlineEdit value={props.rentersInsurance} onCommit={props.onRentersInsuranceChange} />
					</span>
					<span
						style={{
							color: "#737373",
							"font-size": "13px",
							"margin-left": "12px",
							"min-width": "48px",
							"text-align": "right",
							"font-family": "Inter, sans-serif",
							"font-variant-numeric": "tabular-nums",
						}}
					>
						{formatPercentage(computePercentageOfGross(props.rentersInsurance, props.grossIncome))}
					</span>
				</div>
			</div>
		</SummaryCard>
	)
}
