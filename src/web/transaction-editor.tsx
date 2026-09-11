import { Either, Option, Schema } from "effect"
import { For, Index, Show, createMemo, createSignal } from "solid-js"
import { TransactionInput } from "../domain/history"
import { parseMoney } from "../domain/money"
import type { HistoryCatalog, TransactionRecord } from "../shared/history-schemas"
import { ApiError, historyApi } from "./api-client"
import { apiErrorMessage } from "./helpers/error-message"
import { centsToDecimal, formatCurrency, formatSignedCurrency } from "./helpers/format"
import { hasPendingWrite, usePendingWrite } from "./hooks/use-pending-write"

export function TransactionEditor(props: {
	catalog: HistoryCatalog
	initial: Partial<TransactionInput>
	record?: TransactionRecord | undefined
	onPendingChange?: ((pending: boolean) => void) | undefined
	onSave: (
		request: {
			transaction: TransactionInput
			reason: string | null
			voided: boolean
			expected_revision: number | null
			key: string
		},
		confirmed: () => void,
	) => Promise<void>
	onCancel: () => void
}) {
	const [expectedRevision, setExpectedRevision] = createSignal(props.record?.revision ?? null)
	const [committed, setCommitted] = createSignal(false)
	const [conflict, setConflict] = createSignal(false)
	const [latest, setLatest] = createSignal<TransactionRecord | null>(null)
	const [date, setDate] = createSignal(props.initial.date ?? new Date().toISOString().slice(0, 10))
	const [kind, setKind] = createSignal(props.initial.kind ?? "expense")
	const [amount, setAmount] = createSignal(
		props.initial.amount_cents === undefined ? "" : centsToDecimal(props.initial.amount_cents),
	)
	const [payee, setPayee] = createSignal(props.initial.payee ?? "")
	const [note, setNote] = createSignal(props.initial.note ?? "")
	const [reference, setReference] = createSignal(props.initial.payment_reference ?? "")
	const [reason, setReason] = createSignal("")
	const [voided, setVoided] = createSignal(props.record?.voided ?? false)
	const [allocations, setAllocations] = createSignal<
		Array<{ category: string | null; amount: string }>
	>(
		props.initial.allocations?.map((line) => ({
			category: line.category_key,
			amount: centsToDecimal(line.amount_cents),
		})) ?? [{ category: null, amount: "" }],
	)
	const [error, setError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)
	const [attempt, setAttempt] = createSignal<Parameters<typeof props.onSave>[0] | null>(null)
	usePendingWrite({
		pending: () => attempt() !== null,
		onBlocked: setError,
		onPendingChange: props.onPendingChange,
		busy: () => saving() || attempt() !== null,
	})
	const splitTotal = createMemo(() =>
		allocations().reduce(
			(total, line) => total + Option.getOrElse(parseMoney(line.amount), () => 0),
			0,
		),
	)
	const remainder = createMemo(() => Option.getOrElse(parseMoney(amount()), () => 0) - splitTotal())
	const changeAllocation = (
		index: number,
		change: Partial<{ category: string | null; amount: string }>,
	) =>
		setAllocations((lines) => lines.map((line, i) => (i === index ? { ...line, ...change } : line)))

	const save = async (event: SubmitEvent) => {
		event.preventDefault()
		setError(null)
		let request = attempt()
		if (request === null) {
			for (const [label, text, limit] of [
				["merchant", payee().trim(), props.catalog.input_limits.max_label_length],
				["note", note().trim(), props.catalog.input_limits.max_text_length],
				["payment reference", reference().trim(), props.catalog.input_limits.max_text_length],
				["correction reason", reason().trim(), props.catalog.input_limits.max_text_length],
			] as const) {
				if (text.length > limit) {
					setError(`${label} must be ${limit} characters or fewer. your draft is retained.`)
					return
				}
			}
			const cents = parseMoney(amount())
			if (Option.isNone(cents) || cents.value === 0) {
				setError("enter an amount greater than zero, with no more than two decimal places.")
				return
			}
			const lines = []
			for (const line of allocations()) {
				const value = allocations().length === 1 ? cents : parseMoney(line.amount)
				if (Option.isNone(value) || value.value === 0) {
					setError("each split needs an amount greater than zero.")
					return
				}
				lines.push({ category_key: line.category, amount_cents: value.value })
			}
			if (lines.reduce((sum, line) => sum + line.amount_cents, 0) !== cents.value) {
				setError(`assign the remaining ${formatSignedCurrency(remainder())} before saving.`)
				return
			}
			if (new Set(lines.map((line) => line.category_key)).size !== lines.length) {
				setError("use each category only once in a split.")
				return
			}
			if (props.record && !reason().trim()) {
				setError("give a reason for this correction.")
				return
			}
			const decoded = Schema.decodeUnknownEither(TransactionInput)({
				date: date(),
				kind: kind(),
				amount_cents: cents.value,
				currency: "USD",
				payee: payee().trim(),
				note: note().trim() || null,
				payment_reference: reference().trim() || null,
				original_expense_id:
					kind() === "refund" ? (props.initial.original_expense_id ?? null) : null,
				allocations: lines,
			})
			if (Either.isLeft(decoded)) {
				setError("check the date, merchant, and amounts before saving.")
				return
			}
			request = {
				transaction: decoded.right,
				reason: reason().trim() || null,
				voided: voided(),
				expected_revision: expectedRevision(),
				key: crypto.randomUUID(),
			}
			setAttempt(request)
		}
		setSaving(true)
		try {
			await props.onSave(request, () => {
				setAttempt(null)
				setCommitted(true)
			})
			setAttempt(null)
		} catch (error) {
			setError(
				committed()
					? `transaction saved. couldn't refresh this view: ${apiErrorMessage(error)}`
					: apiErrorMessage(error),
			)
			if (error instanceof ApiError && error.status < 500) setAttempt(null)
			if (!committed() && props.record && error instanceof ApiError && error.status === 409)
				setConflict(true)
		} finally {
			setSaving(false)
		}
	}

	return (
		<form onSubmit={save}>
			<Show when={conflict() && props.record}>
				<p class="muted">
					your draft is retained. review the saved transaction before replacing it.
				</p>
				<button
					type="button"
					onClick={async () => {
						try {
							setLatest(await historyApi.transaction(props.record?.id ?? ""))
						} catch (error) {
							setError(apiErrorMessage(error))
						}
					}}
				>
					review latest transaction
				</button>
				<Show when={latest()}>
					{(record) => (
						<div class="panel">
							<p>
								saved revision {record().revision}: {record().date} · {record().payee} ·{" "}
								{record().kind} · {formatCurrency(record().amount_cents)}
								{record().voided ? " · removed from spending" : ""}
							</p>
							<For each={record().allocations}>
								{(line) => (
									<p>
										{props.catalog.categories
											.find((category) => category.category_key === line.category_key)
											?.label.toLowerCase()}
										: {formatCurrency(line.amount_cents)}
									</p>
								)}
							</For>
							<p>{record().note}</p>
							<p>{record().payment_reference}</p>
							<button
								type="button"
								onClick={() => {
									setExpectedRevision(record().revision)
									setConflict(false)
									setError(null)
								}}
							>
								use revision {record().revision} for this correction
							</button>
						</div>
					)}
				</Show>
			</Show>
			<fieldset disabled={saving() || attempt() !== null || committed()}>
				<div class="fields">
					<label>
						type
						<select
							value={kind()}
							onChange={(event) =>
								setKind(event.currentTarget.value === "refund" ? "refund" : "expense")
							}
						>
							<option value="expense">expense</option>
							<option value="refund">refund</option>
						</select>
					</label>
					<label>
						{kind() === "refund" ? "refund date" : "purchase date"}
						<input
							type="date"
							required
							value={date()}
							onInput={(event) => setDate(event.currentTarget.value)}
						/>
					</label>
					<label>
						amount (usd)
						<input
							inputmode="decimal"
							required
							value={amount()}
							onInput={(event) => setAmount(event.currentTarget.value)}
						/>
					</label>
					<label>
						merchant
						<input
							type="text"
							required
							value={payee()}
							onInput={(event) => setPayee(event.currentTarget.value)}
						/>
					</label>
				</div>
				<Show when={kind() === "refund"}>
					<p class="muted">
						reduces recorded spending on the refund date. the original expense stays unchanged.
					</p>
				</Show>
				<Index each={allocations()}>
					{(line, index) => (
						<div class="allocation">
							<label>
								{allocations().length === 1 ? "category" : `split ${index + 1} category`}
								<select
									value={line().category ?? ""}
									onChange={(event) =>
										changeAllocation(index, { category: event.currentTarget.value || null })
									}
								>
									<For each={props.catalog.categories}>
										{(category) => (
											<option value={category.category_key ?? ""}>
												{category.label.toLowerCase()}
											</option>
										)}
									</For>
								</select>
							</label>
							<Show when={allocations().length > 1}>
								<label>
									split {index + 1} amount
									<input
										inputmode="decimal"
										value={line().amount}
										onInput={(event) =>
											changeAllocation(index, { amount: event.currentTarget.value })
										}
									/>
								</label>
								<button
									type="button"
									aria-label={`remove split ${index + 1}`}
									onClick={() => setAllocations((lines) => lines.filter((_, i) => i !== index))}
								>
									remove
								</button>
							</Show>
						</div>
					)}
				</Index>
				<button
					type="button"
					onClick={() =>
						setAllocations((lines) => [
							...lines.map((line) => (lines.length === 1 ? { ...line, amount: amount() } : line)),
							{ category: null, amount: "" },
						])
					}
				>
					add split
				</button>
				<Show when={allocations().length > 1}>
					<p aria-live="polite" class="muted">
						total {formatCurrency(Option.getOrElse(parseMoney(amount()), () => 0))} · assigned{" "}
						{formatCurrency(splitTotal())} · left to assign {formatSignedCurrency(remainder())}
					</p>
				</Show>
				<div class="fields">
					<label class="wide">
						note
						<textarea value={note()} onInput={(event) => setNote(event.currentTarget.value)} />
					</label>
					<label class="wide">
						payment reference (optional)
						<input
							type="text"
							value={reference()}
							onInput={(event) => setReference(event.currentTarget.value)}
						/>
					</label>
				</div>
				<Show when={props.record}>
					<label>
						reason for correction
						<input
							type="text"
							required
							value={reason()}
							onInput={(event) => setReason(event.currentTarget.value)}
						/>
					</label>
					<label style={{ display: "flex", "align-items": "center", "margin-top": "14px" }}>
						<input
							type="checkbox"
							checked={voided()}
							onChange={(event) => setVoided(event.currentTarget.checked)}
						/>
						remove from spending
					</label>
					<p class="muted">removal keeps the transaction, evidence, and correction history.</p>
				</Show>
			</fieldset>
			<Show when={error()}>
				<p role="alert" class="error">
					{error()}
				</p>
			</Show>
			<Show when={attempt() && !saving()}>
				<p class="muted">the save outcome is unknown. retry checks the same request.</p>
			</Show>
			<div class="actions">
				<button
					class="primary"
					type="submit"
					disabled={
						saving() || conflict() || committed() || (hasPendingWrite() && attempt() === null)
					}
				>
					{saving()
						? "saving…"
						: attempt()
							? "retry save"
							: props.record
								? "save correction"
								: "save transaction"}
				</button>
				<button type="button" onClick={props.onCancel} disabled={saving() || attempt() !== null}>
					cancel
				</button>
			</div>
		</form>
	)
}
