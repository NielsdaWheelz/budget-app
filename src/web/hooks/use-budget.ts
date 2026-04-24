import { Effect, Layer } from "effect"
import { batch, createEffect, createMemo, createSignal } from "solid-js"
import { toast } from "solid-sonner"
import payrollRatesRaw from "../../../data/payroll-rates-2025.json"
import federalBracketsRaw from "../../../data/tax-brackets-2025.json"
import {
	BASE_LINE_ITEMS,
	DEFAULT_GROSS_MONTHLY_INCOME,
	DEFAULT_HEALTH_INSURANCE,
	DEFAULT_RENTERS_INSURANCE,
} from "../../config/budget-config"
import type { LineItem } from "../../domain/budget"
import type { Cents } from "../../domain/money"
import type { PayrollRates } from "../../domain/payroll"
import { SCENARIOS } from "../../domain/scenario"
import type { TaxBracketTable } from "../../domain/tax"
import { BudgetService } from "../../services/budget-service"
import { PayrollService } from "../../services/payroll-service"
import { ScenarioService } from "../../services/scenario-service"
import { TaxService } from "../../services/tax-service"
import { budgetApi } from "../api-client"

const federalTable: TaxBracketTable = {
	jurisdiction: "Federal",
	filingStatus: "Single",
	standardDeduction: federalBracketsRaw.federal.standardDeduction as Cents,
	brackets: federalBracketsRaw.federal.brackets.map((b) => ({
		min: b.min as Cents,
		max: b.max as Cents | null,
		rate: b.rate,
	})),
}

const stateTable: TaxBracketTable = {
	jurisdiction: "California",
	filingStatus: "Single",
	standardDeduction: federalBracketsRaw.california.standardDeduction as Cents,
	brackets: federalBracketsRaw.california.brackets.map((b) => ({
		min: b.min as Cents,
		max: b.max as Cents | null,
		rate: b.rate,
	})),
}

const payrollRates: PayrollRates = {
	socialSecurityRate: payrollRatesRaw.socialSecurityRate,
	socialSecurityWageBase: payrollRatesRaw.socialSecurityWageBase as Cents,
	medicareRate: payrollRatesRaw.medicareRate,
	additionalMedicareRate: payrollRatesRaw.additionalMedicareRate,
	additionalMedicareThreshold: payrollRatesRaw.additionalMedicareThreshold as Cents,
}

const AppLayer = Layer.mergeAll(
	TaxService.layer,
	PayrollService.layer,
	BudgetService.layer,
	ScenarioService.layer,
)

const GROUP_HEADINGS: Record<string, string> = {
	FixedExpenses: "Fixed Expenses",
	VariableExpenses: "Variable Expenses",
	Discretionary: "Discretionary",
}

export function useBudget() {
	const [ready, setReady] = createSignal(false)
	const [grossIncome, setGrossIncome] = createSignal<number>(DEFAULT_GROSS_MONTHLY_INCOME as number)
	const [healthInsurance, setHealthInsurance] = createSignal<number>(
		DEFAULT_HEALTH_INSURANCE as number,
	)
	const [rentersInsurance, setRentersInsurance] = createSignal<number>(
		DEFAULT_RENTERS_INSURANCE as number,
	)
	const [scenarioName, setScenarioName] = createSignal<string>("Solo")
	const [period, setPeriod] = createSignal<string>("Monthly")
	const [baseItems, setBaseItems] = createSignal<ReadonlyArray<LineItem>>(BASE_LINE_ITEMS)
	const [expandedSections, setExpandedSections] = createSignal<Set<string>>(new Set())
	const [allExpanded, setAllExpanded] = createSignal(false)

	// ── Load from API ──

	const loadFromApi = async () => {
		const saved = await budgetApi.load()
		if (saved) {
			batch(() => {
				setGrossIncome(saved.grossIncome)
				setHealthInsurance(saved.healthInsurance)
				setRentersInsurance(saved.rentersInsurance)
				setScenarioName(saved.scenarioName)
				setPeriod(saved.period)
				setBaseItems(
					BASE_LINE_ITEMS.map((item) => {
						const amount = saved.lineItemAmounts[item.key as string]
						return amount !== undefined ? { ...item, amount: amount as Cents } : item
					}),
				)
			})
		}
		setReady(true)
	}

	// ── Auto-save (debounced 500ms) ──

	let saveTimeout: ReturnType<typeof setTimeout> | undefined
	createEffect(() => {
		if (!ready()) return
		const state = {
			grossIncome: grossIncome(),
			healthInsurance: healthInsurance(),
			rentersInsurance: rentersInsurance(),
			scenarioName: scenarioName(),
			period: period(),
			lineItemAmounts: Object.fromEntries(
				baseItems().map((item) => [item.key as string, item.amount as number]),
			),
		}
		clearTimeout(saveTimeout)
		saveTimeout = setTimeout(() => {
			budgetApi.save(state).catch(() => toast.error("Failed to save budget"))
		}, 500)
	})

	const scenario = createMemo(() => {
		const found = SCENARIOS.find((s) => s.name === scenarioName())
		// biome-ignore lint/style/noNonNullAssertion: SCENARIOS is a non-empty constant array
		return found ?? SCENARIOS[0]!
	})

	const effectiveItems = createMemo(() => {
		return Effect.runSync(
			Effect.gen(function* () {
				const svc = yield* ScenarioService
				return yield* svc.applyScenario({
					baseItems: baseItems(),
					scenario: scenario(),
				})
			}).pipe(Effect.provide(AppLayer)),
		)
	})

	const yearlyGross = createMemo(() => grossIncome() * 12)

	const federalTaxResult = createMemo(() => {
		return Effect.runSync(
			Effect.gen(function* () {
				const svc = yield* TaxService
				return yield* svc.computeTax({
					grossIncome: yearlyGross() as Cents,
					table: federalTable,
				})
			}).pipe(Effect.provide(AppLayer)),
		)
	})

	const stateTaxResult = createMemo(() => {
		return Effect.runSync(
			Effect.gen(function* () {
				const svc = yield* TaxService
				return yield* svc.computeTax({
					grossIncome: yearlyGross() as Cents,
					table: stateTable,
				})
			}).pipe(Effect.provide(AppLayer)),
		)
	})

	const takeHomePayResult = createMemo(() => {
		return Effect.runSync(
			Effect.gen(function* () {
				const svc = yield* PayrollService
				return yield* svc.computeDeductions({
					grossIncome: yearlyGross() as Cents,
					federalTable,
					stateTable,
					payrollRates,
					healthInsurance: (healthInsurance() * 12) as Cents,
					rentersInsurance: (rentersInsurance() * 12) as Cents,
				})
			}).pipe(Effect.provide(AppLayer)),
		)
	})

	const budgetResult = createMemo(() => {
		const thp = takeHomePayResult()
		return Effect.runSync(
			Effect.gen(function* () {
				const svc = yield* BudgetService
				return yield* svc.computeBudget({
					grossIncome: yearlyGross() as Cents,
					takeHomePay: thp,
					lineItems: effectiveItems().map((item) => ({
						...item,
						amount: (item.amount * 12) as Cents,
					})),
				})
			}).pipe(Effect.provide(AppLayer)),
		)
	})

	const scale = createMemo(() => (period() === "Yearly" ? 1 : 1 / 12))

	const displayed = createMemo(() => {
		const br = budgetResult()
		const s = scale()
		const gi = Math.round(br.grossIncome * s)
		const net = Math.round(br.takeHomePay.netIncome * s)
		const deductions = {
			socialSecurity: Math.round(br.takeHomePay.deductions.socialSecurity * s),
			medicare: Math.round(br.takeHomePay.deductions.medicare * s),
			federalIncomeTax: Math.round(br.takeHomePay.deductions.federalIncomeTax * s),
			stateIncomeTax: Math.round(br.takeHomePay.deductions.stateIncomeTax * s),
			healthInsurance: Math.round(br.takeHomePay.deductions.healthInsurance * s),
			rentersInsurance: Math.round(br.takeHomePay.deductions.rentersInsurance * s),
			total: Math.round(br.takeHomePay.deductions.total * s),
		}
		const savings = Math.round(br.savings * s)

		const fedResult = federalTaxResult()
		const displayedFederalTax = {
			jurisdiction: fedResult.jurisdiction,
			totalTax: Math.round(fedResult.totalTax * s),
			taxableIncome: Math.round(fedResult.taxableIncome * s),
			brackets: fedResult.brackets.map((b) => ({
				bracket: b.bracket,
				taxableAmount: Math.round(b.taxableAmount * s),
				tax: Math.round(b.tax * s),
			})),
		}

		const stResult = stateTaxResult()
		const displayedStateTax = {
			jurisdiction: stResult.jurisdiction,
			totalTax: Math.round(stResult.totalTax * s),
			taxableIncome: Math.round(stResult.taxableIncome * s),
			brackets: stResult.brackets.map((b) => ({
				bracket: b.bracket,
				taxableAmount: Math.round(b.taxableAmount * s),
				tax: Math.round(b.tax * s),
			})),
		}

		const categories = br.categories
			.filter((c) => c.group !== "PaycheckDeductions" && c.group !== "Savings")
			.map((c) => ({
				group: c.group,
				heading: GROUP_HEADINGS[c.group] ?? c.group,
				items: c.items.map((item) => ({
					key: item.key as string,
					label: item.label,
					amount: Math.round(item.amount * s),
					editable: item.editable,
				})),
				subtotal: Math.round(c.subtotal * s),
			}))

		return {
			grossIncome: gi,
			takeHomePay: net,
			deductions,
			federalTaxResult: displayedFederalTax,
			stateTaxResult: displayedStateTax,
			categories,
			savings,
		}
	})

	const toggleSection = (group: string) => {
		setExpandedSections((prev) => {
			const next = new Set(prev)
			if (next.has(group)) {
				next.delete(group)
			} else {
				next.add(group)
			}
			return next
		})
	}

	const toggleAll = () => {
		const expanding = !allExpanded()
		batch(() => {
			setAllExpanded(expanding)
			if (expanding) {
				setExpandedSections(
					new Set<string>([
						"PaycheckDeductions",
						"FixedExpenses",
						"VariableExpenses",
						"Discretionary",
					]),
				)
			} else {
				setExpandedSections(new Set<string>())
			}
		})
	}

	const isSectionExpanded = (group: string) => expandedSections().has(group)

	const updateLineItem = (key: string, cents: number) => {
		setBaseItems((prev) =>
			prev.map((item) =>
				(item.key as string) === key ? { ...item, amount: cents as Cents } : item,
			),
		)
	}

	return {
		ready,
		loadFromApi,
		grossIncome,
		setGrossIncome: (cents: number) => setGrossIncome(cents),
		healthInsurance,
		setHealthInsurance: (cents: number) => setHealthInsurance(cents),
		rentersInsurance,
		setRentersInsurance: (cents: number) => setRentersInsurance(cents),
		scenarioName,
		setScenarioName,
		period,
		setPeriod,
		displayed,
		expandedSections,
		isSectionExpanded,
		toggleSection,
		allExpanded,
		toggleAll,
		updateLineItem,
	}
}
