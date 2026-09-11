import { createAsync, revalidate } from "@solidjs/router"
import { For, Show, createSignal } from "solid-js"
import { type PlannerState, snapshotPlan } from "../domain/history"
import type { PlannerRecord } from "../shared/history-schemas"
import { ApiError, historyApi } from "./api-client"
import { CashFlowDiagram } from "./components/cash-flow"
import { DeductionsCard } from "./components/deductions-card"
import { ExpenseCard } from "./components/expense-card"
import { IncomeCard } from "./components/income-card"
import { SavingsCard } from "./components/savings-card"
import { SegmentedControl } from "./components/segmented-control"
import { TakeHomeCard } from "./components/take-home-card"
import { loadPlanner } from "./data"
import { apiErrorMessage } from "./helpers/error-message"
import { formatCurrency } from "./helpers/format"
import { useBudget } from "./hooks/use-budget"
import { hasPendingWrite, usePendingWrite } from "./hooks/use-pending-write"

export function PlannerPage() {
	const planner = createAsync(() => loadPlanner())
	return (
		<Show when={planner() !== undefined}>
			<Planner initial={planner() ?? null} />
		</Show>
	)
}

function Planner(props: { initial: PlannerRecord | null }) {
	const budget = useBudget(props.initial?.state ?? null)
	const [revision, setRevision] = createSignal(props.initial?.revision ?? null)
	const [saved, setSaved] = createSignal(props.initial ? JSON.stringify(props.initial.state) : null)
	const [saving, setSaving] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	const [message, setMessage] = createSignal<string | null>(null)
	const [attempt, setAttempt] = createSignal<{
		key: string
		state: PlannerState
		revision: number | null
	} | null>(null)
	const [conflict, setConflict] = createSignal(false)
	const [latest, setLatest] = createSignal<PlannerRecord | null>(null)
	usePendingWrite({
		pending: () => attempt() !== null,
		onBlocked: setError,
		busy: () => saving() || attempt() !== null,
	})
	const save = async () => {
		const request = attempt() ?? {
			key: crypto.randomUUID(),
			state: budget.state(),
			revision: revision(),
		}
		setAttempt(request)
		setSaving(true)
		setError(null)
		try {
			const record = await historyApi.savePlanner({
				body: { expected_revision: request.revision, state: request.state },
				key: request.key,
			})
			setRevision(record.revision)
			setSaved(JSON.stringify(record.state))
			setAttempt(null)
			setMessage("planner saved. adopted months stay unchanged.")
			await revalidate(loadPlanner.key)
		} catch (error) {
			setError(apiErrorMessage(error))
			if (error instanceof ApiError && error.status < 500) setAttempt(null)
			if (error instanceof ApiError && error.status === 409) setConflict(true)
		} finally {
			setSaving(false)
		}
	}
	return (
		<>
			<div class="topline">
				<h2>planner</h2>
				<button type="button" onClick={budget.toggleAll}>
					{budget.allExpanded() ? "collapse all" : "expand all"}
				</button>
			</div>
			<p class="muted">
				income, taxes, and scenarios are estimates. save this planner before adopting a month in
				history.
			</p>
			<Show when={error()}>
				<p role="alert" class="error">
					{error()}
				</p>
			</Show>
			<Show when={message()}>
				<output class="success">{message()}</output>
			</Show>
			<Show when={attempt() && !saving()}>
				<p class="muted">the save outcome is unknown. retry uses the same request.</p>
			</Show>
			<Show when={conflict()}>
				<p class="muted">your draft is retained. review the saved planner before replacing it.</p>
				<button
					type="button"
					onClick={async () => {
						try {
							setLatest(await historyApi.planner())
						} catch (error) {
							setError(apiErrorMessage(error))
						}
					}}
				>
					review latest planner
				</button>
				<Show when={latest()}>
					{(record) => (
						<div class="panel">
							<p>
								saved revision {record().revision} · monthly gross income{" "}
								{formatCurrency(record().state.grossIncome)}
							</p>
							<p>
								scenario:{" "}
								{record().state.scenarioName === "Solo"
									? "solo"
									: record().state.scenarioName === "OneRoommate"
										? "one roommate"
										: "multiple roommates"}{" "}
								· view: {record().state.period.toLowerCase()}
							</p>
							<p>
								monthly health insurance: {formatCurrency(record().state.healthInsurance)} · renters
								insurance: {formatCurrency(record().state.rentersInsurance)}
							</p>
							<For each={snapshotPlan(record().state)}>
								{(line) => (
									<p>
										{line.label.toLowerCase()}: {formatCurrency(line.planned_cents)} per month
									</p>
								)}
							</For>
							<button
								type="button"
								onClick={() => {
									setRevision(record().revision)
									setConflict(false)
									setError(null)
								}}
							>
								use revision {record().revision} for this save
							</button>
						</div>
					)}
				</Show>
			</Show>
			<div class="actions">
				<button
					class="primary"
					type="button"
					onClick={save}
					disabled={
						saving() ||
						conflict() ||
						(hasPendingWrite() && attempt() === null) ||
						(!attempt() && saved() === JSON.stringify(budget.state()))
					}
				>
					{saving() ? "saving…" : attempt() ? "retry save" : "save planner"}
				</button>
				<Show when={saved() !== JSON.stringify(budget.state())}>
					<span class="muted">unsaved changes</span>
				</Show>
			</div>
			<fieldset disabled={saving() || attempt() !== null}>
				<div class="toolbar" style={{ margin: "20px 0" }}>
					<SegmentedControl
						options={[
							{ value: "Solo", label: "solo" },
							{ value: "OneRoommate", label: "1 roommate" },
							{ value: "MultiRoommates", label: "multi" },
						]}
						value={budget.scenarioName()}
						onChange={budget.setScenarioName}
					/>
					<SegmentedControl
						options={[
							{ value: "Monthly", label: "monthly" },
							{ value: "Yearly", label: "yearly" },
						]}
						value={budget.period()}
						onChange={budget.setPeriod}
					/>
				</div>
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
				<CashFlowDiagram displayed={budget.displayed()} />
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
			</fieldset>
		</>
	)
}
