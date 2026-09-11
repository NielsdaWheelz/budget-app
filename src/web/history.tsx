import {
	A,
	Navigate,
	type RoutePreloadFunc,
	createAsync,
	revalidate,
	useSearchParams,
} from "@solidjs/router"
import { Option } from "effect"
import { ErrorBoundary, For, Index, Show, Suspense, createMemo, createSignal } from "solid-js"
import { type MonthPlanLine, snapshotPlan } from "../domain/history"
import { parseMoney } from "../domain/money"
import type {
	ChangesQuery,
	HistoryCatalog,
	MonthPlanRecord,
	MonthPlanSave,
	PlannerRecord,
	TransactionRecord,
} from "../shared/history-schemas"
import { ApiError, historyApi } from "./api-client"
import { SegmentedControl } from "./components/segmented-control"
import {
	loadCatalog,
	loadChanges,
	loadPlan,
	loadPlanner,
	loadReport,
	loadSession,
	loadSources,
	loadTransaction,
	loadTransactions,
} from "./data"
import { apiErrorMessage } from "./helpers/error-message"
import {
	centsToDecimal,
	differenceDescription,
	formatCurrency,
	formatDifference,
	formatSignedCurrency,
	monthLabel,
} from "./helpers/format"
import { hasPendingWrite, usePendingWrite } from "./hooks/use-pending-write"
import { TransactionEditor } from "./transaction-editor"

export const historyPreload: RoutePreloadFunc = async ({ location }) => {
	if (!(await loadSession())) return
	const period =
		typeof location.query.period === "string"
			? location.query.period
			: new Date().toISOString().slice(0, 7)
	await Promise.all([
		loadCatalog(),
		loadReport({
			period,
			...(typeof location.query.through_month === "string"
				? { through_month: location.query.through_month }
				: {}),
		}),
	])
}

export function HistoryPage() {
	const [search, setSearch] = useSearchParams<{
		period: string
		through_month: string
		category: string
		transaction: string
		action: string
		cursor: string
	}>()
	const period = () => search.period ?? new Date().toISOString().slice(0, 7)
	const catalog = createAsync(() => loadCatalog())
	const report = createAsync(() =>
		loadReport({
			period: period(),
			...(search.through_month ? { through_month: search.through_month } : {}),
		}),
	)
	const monthly = () => period().length === 7
	const todayMonth = new Date().toISOString().slice(0, 7)
	const listing = createAsync(async () => {
		const data = report()
		if (!data) return null
		return loadTransactions({
			from: data.from,
			until: data.until,
			...(search.category ? { category: search.category } : {}),
			...(search.cursor ? { cursor: search.cursor } : {}),
		})
	})
	const changePeriod = (value: string) =>
		setSearch({
			period: value,
			through_month: null,
			category: null,
			transaction: null,
			action: null,
			cursor: null,
		})
	const close = () => setSearch({ action: null, transaction: null })
	const refresh = async () => {
		await revalidate([
			loadReport.key,
			loadTransactions.key,
			loadTransaction.key,
			loadSources.key,
			loadChanges.key,
			loadPlan.key,
		])
	}
	const reload = async () => {
		await refresh()
		close()
	}
	const title = () => {
		const months = report()?.included_months
		if (!months?.length) return period()
		return months.length === 1
			? monthLabel(months[0] ?? period())
			: `${monthLabel(months[0] ?? period())} – ${monthLabel(months[months.length - 1] ?? period())}`
	}
	return (
		<>
			<Show when={!search.period}>
				<Navigate href={`/history?period=${todayMonth}`} />
			</Show>
			<div class="topline">
				<h2>spending history</h2>
				<button type="button" onClick={() => setSearch({ action: "new", transaction: null })}>
					add transaction
				</button>
			</div>
			<div class="toolbar">
				<SegmentedControl
					options={[
						{ value: "month", label: "month" },
						{ value: "year", label: "year" },
					]}
					value={monthly() ? "month" : "year"}
					onChange={(value) =>
						changePeriod(value === "year" ? period().slice(0, 4) : `${period().slice(0, 4)}-01`)
					}
				/>
				<Show
					when={monthly()}
					fallback={
						<label>
							year
							<input
								type="number"
								min="1"
								max="9998"
								value={period()}
								onChange={(event) => {
									if (/^\d{4}$/.test(event.currentTarget.value))
										changePeriod(event.currentTarget.value)
								}}
							/>
						</label>
					}
				>
					<label>
						month
						<input
							type="month"
							value={period()}
							onChange={(event) => {
								if (event.currentTarget.value) changePeriod(event.currentTarget.value)
							}}
						/>
					</label>
				</Show>
				<Show when={!monthly()}>
					<label>
						through month
						<select
							value={
								search.through_month ??
								String(Number(report()?.included_months.at(-1)?.slice(5)) || 12)
							}
							onChange={(event) =>
								setSearch({
									through_month: event.currentTarget.value,
									cursor: null,
									transaction: null,
								})
							}
						>
							<For each={Array.from({ length: 12 }, (_, i) => i + 1)}>
								{(month) => (
									<option value={String(month)}>
										{monthLabel(`2026-${String(month).padStart(2, "0")}`).split(" ")[0]}
									</option>
								)}
							</For>
						</select>
					</label>
				</Show>
			</div>
			<Show when={report()}>
				{(data) => (
					<>
						<p>
							<strong>{title()}</strong>
							<Show when={data().included_months.some((month) => month === todayMonth)}>
								<span class="muted"> · {monthLabel(todayMonth).split(" ")[0]} is in progress</span>
							</Show>
						</p>
						<p class="muted">
							recorded spending includes saved expenses minus refunds. missing transactions are not
							included.
						</p>
						<Show when={data().missing_plan_months.length > 0}>
							<p class="muted">
								plan saved for {data().included_months.length - data().missing_plan_months.length}{" "}
								of {data().included_months.length}{" "}
								{data().included_months.length === 1 ? "month" : "months"}.
								<Show when={data().known_planned_cents > 0}>
									{" "}
									known plan subtotal: {formatCurrency(data().known_planned_cents)}.
								</Show>
							</p>
						</Show>
						<div class="scroll-table">
							<table aria-label="planned and recorded spending">
								<thead>
									<tr>
										<th scope="col">category</th>
										<th scope="col">planned</th>
										<th scope="col">recorded</th>
										<th scope="col">difference</th>
									</tr>
								</thead>
								<tbody>
									<For each={data().rows}>
										{(row) => (
											<tr>
												<th scope="row">{row.label.toLowerCase()}</th>
												<td class="number">
													{row.planned_cents === null
														? "no plan"
														: formatCurrency(row.planned_cents)}
												</td>
												<td>
													<button
														type="button"
														class="text-button number"
														aria-label={`${row.label.toLowerCase()}: ${formatSignedCurrency(row.recorded_cents)} recorded, view transactions`}
														onClick={() =>
															setSearch({
																category: row.category_key ?? "uncategorized",
																cursor: null,
																transaction: null,
																action: null,
															})
														}
													>
														{formatSignedCurrency(row.recorded_cents)}
													</button>
												</td>
												<td class="number">
													<Show when={row.difference_cents !== null} fallback="no plan">
														<span aria-label={differenceDescription(row.difference_cents ?? 0)}>
															{formatDifference(row.difference_cents ?? 0)}
														</span>
													</Show>
												</td>
											</tr>
										)}
									</For>
								</tbody>
								<tfoot>
									<tr>
										<th scope="row">total spending</th>
										<td>
											{data().planned_cents === null
												? "no complete plan"
												: formatCurrency(data().planned_cents ?? 0)}
										</td>
										<td>{formatSignedCurrency(data().recorded_cents)}</td>
										<td>
											<Show when={data().difference_cents !== null} fallback="no complete plan">
												<span aria-label={differenceDescription(data().difference_cents ?? 0)}>
													{formatDifference(data().difference_cents ?? 0)}
												</span>
											</Show>
										</td>
									</tr>
								</tfoot>
							</table>
						</div>
						<Show when={monthly()}>
							<div class="actions">
								<button
									type="button"
									onClick={() => setSearch({ action: "plan", transaction: null })}
								>
									{data().missing_plan_months.length
										? `set plan for ${monthLabel(period())}`
										: "amend this month's plan"}
								</button>
							</div>
						</Show>
						<Show
							when={data().awaiting_extraction_source_count > 0 || data().pending_item_count > 0}
						>
							<p class="muted">
								<A href="/inbox">
									{data().awaiting_extraction_source_count} document
									{data().awaiting_extraction_source_count === 1 ? "" : "s"} awaiting extraction ·{" "}
									{data().pending_item_count} item
									{data().pending_item_count === 1 ? " needs" : "s need"} review
								</A>
							</p>
						</Show>
					</>
				)}
			</Show>
			<Show when={search.action === "plan" && monthly() ? period() : null} keyed>
				{(month) => (
					<Show when={catalog()}>
						{(categories) => (
							<PlanPanel month={month} catalog={categories()} onSaved={reload} onCancel={close} />
						)}
					</Show>
				)}
			</Show>
			<Show when={search.action === "new"}>
				<section class="panel">
					<h3>new transaction</h3>
					<Show when={catalog()}>
						{(categories) => (
							<TransactionEditor
								catalog={categories()}
								initial={{}}
								onCancel={close}
								onSave={async ({ transaction, key }, confirmed) => {
									await historyApi.saveTransaction({
										id: null,
										body: { expected_revision: null, transaction },
										key,
									})
									confirmed()
									await reload()
								}}
							/>
						)}
					</Show>
				</section>
			</Show>
			<Show when={search.transaction} keyed>
				{(id) => (
					<Show when={catalog()}>
						{(categories) => (
							<TransactionPanel id={id} catalog={categories()} onClose={close} onSaved={refresh} />
						)}
					</Show>
				)}
			</Show>
			<section class="panel">
				<div class="topline">
					<h3>
						{search.category
							? `${
									catalog()
										?.categories.find(
											(category) => (category.category_key ?? "uncategorized") === search.category,
										)
										?.label.toLowerCase() ?? search.category
								} transactions`
							: "transactions"}
					</h3>
					<Show when={search.category}>
						<button type="button" onClick={() => setSearch({ category: null, cursor: null })}>
							all categories
						</button>
					</Show>
				</div>
				<Show when={listing()}>
					{(page) => (
						<>
							<Show
								when={page().items.length > 0}
								fallback={
									<p class="muted">
										{report()?.transaction_count === 0
											? `no transactions recorded for ${title()}.`
											: "no transactions in this selection."}
									</p>
								}
							>
								<div class="scroll-table">
									<table aria-label="transactions">
										<thead>
											<tr>
												<th scope="col">merchant / date</th>
												<th scope="col">
													{search.category ? "category contribution" : "recorded"}
												</th>
												<Show when={search.category}>
													<th scope="col">full amount</th>
												</Show>
											</tr>
										</thead>
										<tbody>
											<For each={page().items}>
												{(transaction) => (
													<tr>
														<td>
															<button
																type="button"
																class="text-button"
																onClick={() =>
																	setSearch({ transaction: transaction.id, action: null })
																}
															>
																{transaction.payee}
															</button>
															<div class="muted">
																{transaction.date} · {transaction.kind}
															</div>
														</td>
														<td class="number">
															{formatSignedCurrency(transaction.contribution_cents)}
														</td>
														<Show when={search.category}>
															<td class="number">{formatCurrency(transaction.amount_cents)}</td>
														</Show>
													</tr>
												)}
											</For>
										</tbody>
									</table>
								</div>
							</Show>
							<div class="actions">
								<Show when={search.cursor}>
									<button type="button" onClick={() => setSearch({ cursor: null })}>
										first page
									</button>
								</Show>
								<Show when={page().next_cursor}>
									<button type="button" onClick={() => setSearch({ cursor: page().next_cursor })}>
										next page
									</button>
								</Show>
							</div>
						</>
					)}
				</Show>
			</section>
		</>
	)
}

function PlanPanel(props: {
	month: string
	catalog: HistoryCatalog
	onSaved: () => Promise<void>
	onCancel: () => void
}) {
	const data = createAsync(async () => ({
		plan: await loadPlan(props.month),
		planner: await loadPlanner(),
	}))
	return (
		<Show when={data()}>
			{(value) => (
				<PlanForm
					month={props.month}
					catalog={props.catalog}
					initial={value().plan}
					planner={value().planner}
					onSaved={props.onSaved}
					onCancel={props.onCancel}
				/>
			)}
		</Show>
	)
}

function PlanForm(props: {
	month: string
	catalog: HistoryCatalog
	initial: MonthPlanRecord | null
	planner: PlannerRecord | null
	onSaved: () => Promise<void>
	onCancel: () => void
}) {
	const initialLines =
		props.initial?.lines ??
		(props.planner
			? snapshotPlan(props.planner.state)
			: props.catalog.categories.map((category) => ({ ...category, planned_cents: 0 })))
	const [lines, setLines] = createSignal(
		initialLines.map((line) => ({ ...line, text: centsToDecimal(line.planned_cents) })),
	)
	const [adopting, setAdopting] = createSignal(props.initial === null && props.planner !== null)
	const [reason, setReason] = createSignal("")
	const [error, setError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)
	const [attempt, setAttempt] = createSignal<{ key: string; body: MonthPlanSave } | null>(null)
	const [expectedRevision, setExpectedRevision] = createSignal(props.initial?.revision ?? null)
	const [conflict, setConflict] = createSignal(false)
	const [latest, setLatest] = createSignal<MonthPlanRecord | null | undefined>(undefined)
	usePendingWrite({
		pending: () => attempt() !== null,
		onBlocked: setError,
		busy: () => saving() || attempt() !== null,
	})
	const total = createMemo(() =>
		lines().reduce((sum, line) => sum + Option.getOrElse(parseMoney(line.text), () => 0), 0),
	)
	const save = async (event: SubmitEvent) => {
		event.preventDefault()
		setError(null)
		let request = attempt()
		if (!request) {
			if (expectedRevision() !== null && !reason().trim()) {
				setError("give a reason for changing this month's plan.")
				return
			}
			const parsed: MonthPlanLine[] = []
			for (const line of lines()) {
				const cents = parseMoney(line.text)
				if (Option.isNone(cents)) {
					setError(`enter an exact dollar amount for ${line.label.toLowerCase()}.`)
					return
				}
				parsed.push({
					category_key: line.category_key,
					label: line.label,
					group: line.group,
					planned_cents: cents.value,
				})
			}
			const body: MonthPlanSave =
				adopting() && props.planner
					? {
							kind: "adopt",
							expected_revision: expectedRevision(),
							planner_revision: props.planner.revision,
							reason: reason().trim() || null,
						}
					: {
							kind: "explicit",
							expected_revision: expectedRevision(),
							lines: parsed,
							reason: reason().trim() || null,
						}
			request = { key: crypto.randomUUID(), body }
			setAttempt(request)
		}
		setSaving(true)
		try {
			await historyApi.savePlan({ month: props.month, body: request.body, key: request.key })
			setAttempt(null)
			await props.onSaved()
		} catch (error) {
			setError(apiErrorMessage(error))
			if (error instanceof ApiError && error.status < 500) setAttempt(null)
			if (error instanceof ApiError && error.status === 409) setConflict(true)
		} finally {
			setSaving(false)
		}
	}
	return (
		<section class="panel">
			<h3>
				{props.initial ? "amend" : "set"} {monthLabel(props.month)} plan
			</h3>
			<p class="muted">
				changes {monthLabel(props.month)} only. income and tax estimates remain in the planner.
			</p>
			<Show when={conflict()}>
				<p class="muted">your draft is retained. review the saved month before replacing it.</p>
				<button
					type="button"
					onClick={async () => {
						try {
							setLatest(await historyApi.plan(props.month))
						} catch (error) {
							setError(apiErrorMessage(error))
						}
					}}
				>
					review latest month plan
				</button>
				<Show when={latest() === null}>
					<p>no saved plan exists for this month.</p>
					<button
						type="button"
						onClick={() => {
							setExpectedRevision(null)
							setAdopting(false)
							setConflict(false)
							setError(null)
						}}
					>
						use these amounts as an explicit month plan
					</button>
				</Show>
				<Show when={latest()}>
					{(record) => (
						<div class="panel">
							<p>saved revision {record().revision}</p>
							<For each={record().lines}>
								{(line) => (
									<p>
										{line.label.toLowerCase()}: {formatCurrency(line.planned_cents)}
									</p>
								)}
							</For>
							<button
								type="button"
								onClick={() => {
									setExpectedRevision(record().revision)
									setAdopting(false)
									setConflict(false)
									setError(null)
								}}
							>
								use revision {record().revision} for this amendment
							</button>
						</div>
					)}
				</Show>
			</Show>
			<form onSubmit={save}>
				<fieldset disabled={saving() || attempt() !== null}>
					<Show
						when={props.planner}
						fallback={
							<p class="muted">
								save the planner first to use its amounts, or enter a monthly plan here.
							</p>
						}
					>
						{(planner) => (
							<>
								<button
									type="button"
									onClick={() => {
										setLines(
											snapshotPlan(planner().state).map((line) => ({
												...line,
												text: centsToDecimal(line.planned_cents),
											})),
										)
										setAdopting(true)
									}}
								>
									use current plan for {monthLabel(props.month)}
								</button>
								<p class="muted">saved planner revision {planner().revision}</p>
							</>
						)}
					</Show>
					<table aria-label="monthly plan amounts">
						<thead>
							<tr>
								<th>category</th>
								<Show when={props.initial}>
									<th>saved</th>
								</Show>
								<th>new amount (usd)</th>
							</tr>
						</thead>
						<tbody>
							<Index each={lines()}>
								{(line, index) => (
									<tr>
										<th scope="row">{line().label.toLowerCase()}</th>
										<Show when={props.initial}>
											<td>
												{formatCurrency(
													props.initial?.lines.find(
														(original) => original.category_key === line().category_key,
													)?.planned_cents ?? 0,
												)}
											</td>
										</Show>
										<td>
											<input
												aria-label={`${line().label.toLowerCase()} planned amount`}
												inputmode="decimal"
												value={line().text}
												disabled={line().category_key === null}
												onInput={(event) => {
													const text = event.currentTarget.value
													setLines((values) =>
														values.map((value, i) => (i === index ? { ...value, text } : value)),
													)
													setAdopting(false)
												}}
											/>
										</td>
									</tr>
								)}
							</Index>
						</tbody>
						<tfoot>
							<tr>
								<th>total</th>
								<Show when={props.initial}>
									<td>
										{formatCurrency(
											props.initial?.lines.reduce((sum, line) => sum + line.planned_cents, 0) ?? 0,
										)}
									</td>
								</Show>
								<td>{formatCurrency(total())}</td>
							</tr>
						</tfoot>
					</table>
					<Show when={expectedRevision() !== null}>
						<label style={{ "margin-top": "14px" }}>
							reason for amendment
							<input
								type="text"
								required
								value={reason()}
								onInput={(event) => setReason(event.currentTarget.value)}
							/>
						</label>
					</Show>
				</fieldset>
				<Show when={error()}>
					<p class="error" role="alert">
						{error()}
					</p>
				</Show>
				<Show when={attempt() && !saving()}>
					<p class="muted">the save outcome is unknown. retry uses the same request.</p>
				</Show>
				<div class="actions">
					<button
						type="submit"
						class="primary"
						disabled={saving() || conflict() || (hasPendingWrite() && attempt() === null)}
					>
						{saving() ? "saving…" : attempt() ? "retry save" : "save month plan"}
					</button>
					<button type="button" onClick={props.onCancel} disabled={saving() || attempt() !== null}>
						cancel
					</button>
				</div>
			</form>
			<Show when={props.initial}>
				{(plan) => <AuditHistory entityKind="plan" entityId={plan().id} />}
			</Show>
		</section>
	)
}

export function TransactionPanel(props: {
	id: string
	catalog: HistoryCatalog
	onClose: () => void
	onSaved: () => Promise<void>
	onLink?: (transaction: TransactionRecord) => Promise<void>
	correctionOnly?: boolean
	onPendingChange?: ((pending: boolean) => void) | undefined
}) {
	const record = createAsync(() => loadTransaction(props.id))
	const [linking, setLinking] = createSignal(false)
	const [linkError, setLinkError] = createSignal<string | null>(null)
	const [pending, setPending] = createSignal(false)
	const pendingChanged = (value: boolean) => {
		setPending(value)
		props.onPendingChange?.(value)
	}
	const [editing, setEditing] = createSignal(false)
	const [refunding, setRefunding] = createSignal(false)
	return (
		<section class="panel" aria-label="transaction details">
			<Show when={record()}>
				{(transaction) => (
					<>
						<div class="topline">
							<h3>{transaction().payee}</h3>
							<button type="button" onClick={props.onClose} disabled={pending()}>
								close details
							</button>
						</div>
						<p class="number">
							{transaction().date} · {transaction().kind} ·{" "}
							{formatCurrency(transaction().amount_cents)}
							<Show when={transaction().voided}> · removed from spending</Show>
						</p>
						<Show when={!editing() && !refunding()}>
							<For each={transaction().allocations}>
								{(line) => (
									<p>
										{props.catalog.categories
											.find((category) => category.category_key === line.category_key)
											?.label.toLowerCase() ?? "uncategorized"}
										: {formatCurrency(line.amount_cents)}
									</p>
								)}
							</For>
							<Show when={transaction().note}>
								<p>{transaction().note}</p>
							</Show>
							<Show when={transaction().payment_reference}>
								<p class="muted">payment reference: {transaction().payment_reference}</p>
							</Show>
							<Show when={transaction().original_expense_id}>
								<p>
									<A
										href={`/history?period=${transaction().date.slice(0, 7)}&transaction=${transaction().original_expense_id}`}
									>
										original expense
									</A>
								</p>
							</Show>
							<div class="actions">
								<button type="button" onClick={() => setEditing(true)}>
									edit transaction
								</button>
								<Show when={props.onLink}>
									{(link) => (
										<button
											type="button"
											disabled={linking() || pending() || hasPendingWrite() || transaction().voided}
											onClick={async () => {
												setLinking(true)
												setLinkError(null)
												try {
													await link()(transaction())
												} catch (error) {
													setLinkError(apiErrorMessage(error))
												} finally {
													setLinking(false)
												}
											}}
										>
											{linking() ? "linking…" : "link reviewed transaction"}
										</button>
									)}
								</Show>
								<Show when={linkError()}>
									<p role="alert" class="error">
										{linkError()}
									</p>
								</Show>
								<Show
									when={
										transaction().kind === "expense" &&
										!transaction().voided &&
										!props.correctionOnly
									}
								>
									<button type="button" onClick={() => setRefunding(true)}>
										record refund
									</button>
								</Show>
							</div>
						</Show>
						<Show when={editing()}>
							<TransactionEditor
								catalog={props.catalog}
								record={transaction()}
								initial={transaction()}
								onCancel={() => setEditing(false)}
								onPendingChange={pendingChanged}
								onSave={async (
									{ transaction: input, reason, voided, key, expected_revision },
									confirmed,
								) => {
									await historyApi.saveTransaction({
										id: props.id,
										body: {
											expected_revision: expected_revision ?? transaction().revision,
											transaction: input,
											reason: reason ?? "",
											voided,
										},
										key,
									})
									confirmed()
									await props.onSaved()
									setEditing(false)
								}}
							/>
						</Show>
						<Show when={refunding()}>
							<h3 style={{ "margin-top": "16px" }}>record refund</h3>
							<TransactionEditor
								catalog={props.catalog}
								initial={{
									...transaction(),
									date: undefined,
									kind: "refund",
									original_expense_id: transaction().id,
								}}
								onCancel={() => setRefunding(false)}
								onPendingChange={pendingChanged}
								onSave={async ({ transaction: input, key }, confirmed) => {
									await historyApi.saveTransaction({
										id: null,
										body: { expected_revision: null, transaction: input },
										key,
									})
									confirmed()
									await props.onSaved()
									setRefunding(false)
								}}
							/>
						</Show>
						<h3 style={{ "margin-top": "22px" }}>supporting evidence</h3>
						<ErrorBoundary
							fallback={(error, reset) => (
								<div>
									<p role="alert" class="error">
										couldn't load supporting evidence. {apiErrorMessage(error)}
									</p>
									<button
										type="button"
										disabled={hasPendingWrite()}
										onClick={() => {
											void revalidate(loadSources.keyFor({ transaction_id: props.id }))
											reset()
										}}
									>
										retry supporting evidence
									</button>
								</div>
							)}
						>
							<Suspense fallback={<output>loading supporting evidence…</output>}>
								<TransactionSources id={props.id} />
							</Suspense>
						</ErrorBoundary>
						<AuditHistory entityKind="transaction" entityId={props.id} />
					</>
				)}
			</Show>
		</section>
	)
}

function TransactionSources(props: { id: string }) {
	const [sourceCursor, setSourceCursor] = createSignal<string | null>(null)
	const sources = createAsync(() =>
		loadSources({
			transaction_id: props.id,
			...(sourceCursor() ? { cursor: sourceCursor() ?? undefined } : {}),
		}),
	)
	return (
		<Show when={sources()}>
			{(page) => (
				<>
					<ul class="history-list">
						<For
							each={page().items}
							fallback={
								<li class="muted">no source attached. manual entries do not require a document.</li>
							}
						>
							{(source) => (
								<li>
									<A href={`/inbox?source=${source.id}&pending=false`}>{source.label}</A> ·{" "}
									<a href={historyApi.sourceContentUrl(source.id)}>download original</a>
								</li>
							)}
						</For>
					</ul>
					<Show when={page().next_cursor}>
						<button type="button" onClick={() => setSourceCursor(page().next_cursor)}>
							more sources
						</button>
					</Show>
					<Show when={sourceCursor()}>
						<button type="button" onClick={() => setSourceCursor(null)}>
							first sources
						</button>
					</Show>
				</>
			)}
		</Show>
	)
}

export function AuditHistory(props: { entityKind: ChangesQuery["entity_kind"]; entityId: string }) {
	const [expanded, setExpanded] = createSignal(false)
	return (
		<details
			onToggle={(event) => setExpanded(event.currentTarget.open)}
			style={{ "margin-top": "18px" }}
		>
			<summary>correction history</summary>
			<ErrorBoundary
				fallback={(error, reset) => (
					<div>
						<p role="alert" class="error">
							couldn't load correction history. {apiErrorMessage(error)}
						</p>
						<button
							type="button"
							disabled={hasPendingWrite()}
							onClick={() => {
								void revalidate(loadChanges.key)
								reset()
							}}
						>
							retry correction history
						</button>
					</div>
				)}
			>
				<Suspense fallback={<output>loading correction history…</output>}>
					<Show when={expanded()}>
						<AuditEntries entityKind={props.entityKind} entityId={props.entityId} />
					</Show>
				</Suspense>
			</ErrorBoundary>
		</details>
	)
}

function AuditEntries(props: { entityKind: ChangesQuery["entity_kind"]; entityId: string }) {
	const [cursor, setCursor] = createSignal<string | null>(null)
	const changes = createAsync(() =>
		loadChanges({
			entity_kind: props.entityKind,
			entity_id: props.entityId,
			...(cursor() ? { cursor: cursor() ?? undefined } : {}),
		}),
	)
	return (
		<Show when={changes()}>
			{(page) => (
				<>
					<ol class="history-list">
						<For each={page().items}>
							{(change) => (
								<li>
									<strong>revision {change.revision}</strong> ·{" "}
									{change.actor === "migration"
										? "migration"
										: change.actor.client === "browser"
											? "you"
											: "jarvis"}
									<div class="muted">{change.created_at}</div>
									<Show when={change.reason}>
										<p>{change.reason}</p>
									</Show>
									<details>
										<summary>saved values</summary>
										<pre>{JSON.stringify(change.snapshot, null, 2)}</pre>
									</details>
								</li>
							)}
						</For>
					</ol>
					<Show when={page().next_cursor}>
						<button type="button" onClick={() => setCursor(page().next_cursor)}>
							more history
						</button>
					</Show>
					<Show when={cursor()}>
						<button type="button" onClick={() => setCursor(null)}>
							latest revisions
						</button>
					</Show>
				</>
			)}
		</Show>
	)
}
