import { A, type RoutePreloadFunc, createAsync, revalidate, useSearchParams } from "@solidjs/router"
import { Either, Option, Schema } from "effect"
import { For, Show, createSignal } from "solid-js"
import { Allocation, CalendarDate, PositiveCents, type TransactionInput } from "../domain/history"
import { parseMoney } from "../domain/money"
import {
	type HistoryCatalog,
	type ImportCommand,
	type ReviewReason,
	type SourceDetail,
	type SourceItemRecord,
	type SourceRecord,
	SourceUpload,
	type TransactionProposal,
	type TransactionRecord,
} from "../shared/history-schemas"
import { ApiError, historyApi } from "./api-client"
import {
	loadCatalog,
	loadChanges,
	loadReport,
	loadSession,
	loadSource,
	loadSources,
	loadTransaction,
	loadTransactions,
} from "./data"
import { apiErrorMessage } from "./helpers/error-message"
import { centsToDecimal, formatCurrency } from "./helpers/format"
import { AuditHistory, TransactionPanel } from "./history"
import { hasPendingWrite, usePendingWrite } from "./hooks/use-pending-write"
import { TransactionEditor } from "./transaction-editor"

const reviewCopy = {
	unreadable: "some details could not be read",
	payment_unconfirmed: "payment is not confirmed",
	possible_duplicate: "another transaction may represent this purchase",
	correction_conflict: "a proposed correction needs your review",
	unsupported_currency: "this document uses an unsupported currency",
} satisfies Record<ReviewReason, string>

export const inboxPreload: RoutePreloadFunc = async ({ location }) => {
	if (!(await loadSession())) return
	await Promise.all([
		loadCatalog(),
		loadSources({ pending: location.query.pending === "false" ? "false" : "true" }),
	])
	if (typeof location.query.source === "string") await loadSource({ id: location.query.source })
}

export function EvidenceInbox() {
	const [search, setSearch] = useSearchParams<{
		source: string
		item: string
		pending: string
		cursor: string
		item_cursor: string
	}>()
	const catalog = createAsync(() => loadCatalog())
	const sources = createAsync(() =>
		loadSources({
			pending: search.pending === "false" ? "false" : "true",
			...(search.cursor ? { cursor: search.cursor } : {}),
		}),
	)
	const detail = createAsync(() =>
		search.source
			? loadSource({
					id: search.source,
					...(search.item_cursor ? { cursor: search.item_cursor } : {}),
				})
			: Promise.resolve(null),
	)
	const refresh = async () => {
		await revalidate([
			loadSources.key,
			loadSource.key,
			loadTransactions.key,
			loadReport.key,
			loadChanges.key,
			loadTransaction.key,
		])
	}
	return (
		<>
			<h2>evidence inbox</h2>
			<p class="muted">
				upload a receipt or document. originals stay here while jarvis prepares the data. you can
				also record or link entries yourself.
			</p>
			<Show when={catalog()}>
				{(categories) => (
					<UploadForm
						catalog={categories()}
						onUploaded={async (source) => {
							await refresh()
							setSearch({ source: source.id, item: null, item_cursor: null })
						}}
					/>
				)}
			</Show>
			<div class="toolbar">
				<label>
					show
					<select
						value={search.pending === "false" ? "all" : "pending"}
						onChange={(event) =>
							setSearch({
								pending: event.currentTarget.value === "all" ? "false" : "true",
								cursor: null,
							})
						}
					>
						<option value="pending">awaiting extraction or review</option>
						<option value="all">all documents</option>
					</select>
				</label>
				<button type="button" onClick={refresh} disabled={hasPendingWrite()}>
					refresh
				</button>
			</div>
			<Show when={sources()}>
				{(page) => (
					<section class="panel">
						<ul class="history-list">
							<For
								each={page().items}
								fallback={
									<li class="muted">
										{search.pending === "false"
											? "no documents uploaded."
											: "no documents awaiting extraction or review."}
									</li>
								}
							>
								{(source) => (
									<li>
										<button
											type="button"
											class="text-button"
											onClick={() =>
												setSearch({ source: source.id, item: null, item_cursor: null })
											}
										>
											{source.label}
										</button>
										<div class="muted">
											{source.extraction_complete
												? "extraction complete"
												: "uploaded; awaiting extraction"}{" "}
											· received {source.created_at.slice(0, 10)}
										</div>
									</li>
								)}
							</For>
						</ul>
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
					</section>
				)}
			</Show>
			<Show when={detail()}>
				{(data) => (
					<Show when={catalog()}>
						{(categories) => (
							<Show when={data().source.id} keyed>
								{(_sourceId) => (
									<SourcePanel
										detail={data()}
										catalog={categories()}
										selectedItem={search.item ?? null}
										onSelect={(item) => setSearch({ item })}
										onRefresh={refresh}
										onClose={() => setSearch({ source: null, item: null, item_cursor: null })}
										onNext={(cursor) => setSearch({ item_cursor: cursor, item: null })}
									/>
								)}
							</Show>
						)}
					</Show>
				)}
			</Show>
		</>
	)
}

function UploadForm(props: {
	catalog: HistoryCatalog
	onUploaded: (source: SourceRecord) => Promise<void>
}) {
	const [file, setFile] = createSignal<File | null>(null)
	const [error, setError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)
	const [attempt, setAttempt] = createSignal<{ body: SourceUpload; key: string } | null>(null)
	usePendingWrite({
		pending: () => attempt() !== null,
		onBlocked: setError,
		busy: () => saving() || attempt() !== null,
	})
	let input: HTMLInputElement | undefined
	const upload = async (event: SubmitEvent) => {
		event.preventDefault()
		setError(null)
		setSaving(true)
		try {
			let request = attempt()
			if (!request) {
				const original = file()
				if (!original) {
					setError("choose a document to upload.")
					return
				}
				if (original.name.length > props.catalog.input_limits.max_label_length) {
					setError(
						`rename this file to ${props.catalog.input_limits.max_label_length} characters or fewer before uploading.`,
					)
					return
				}
				if (original.size > props.catalog.input_limits.max_source_bytes) {
					setError(
						"this file is larger than 2 mib. upload a smaller original; files are never compressed automatically.",
					)
					return
				}
				const buffer = await original.arrayBuffer()
				const digest = Array.from(
					new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
					(byte) => byte.toString(16).padStart(2, "0"),
				).join("")
				const base64 = await new Promise<string>((resolve, reject) => {
					const reader = new FileReader()
					reader.onerror = () => reject(new Error("couldn't read this file."))
					reader.onload = () => {
						if (typeof reader.result !== "string") {
							reject(new Error("couldn't read this file."))
							return
						}
						resolve(reader.result.slice(reader.result.indexOf(",") + 1))
					}
					reader.readAsDataURL(original)
				})
				const parsed = Schema.decodeUnknownEither(SourceUpload)({
					expected_revision: null,
					namespace: "browser.upload",
					external_key: digest,
					label: original.name,
					media_type: original.type || (original.name.endsWith(".txt") ? "text/plain" : ""),
					content_base64: base64,
					external_reference: null,
				})
				if (Either.isLeft(parsed)) {
					setError("upload a pdf, jpeg, png, webp, or utf-8 text file.")
					return
				}
				request = { body: parsed.right, key: crypto.randomUUID() }
				setAttempt(request)
			}
			const source = await historyApi.uploadSource(request)
			setAttempt(null)
			setFile(null)
			if (input) input.value = ""
			await props.onUploaded(source)
		} catch (error) {
			setError(apiErrorMessage(error))
			if (error instanceof ApiError && error.status < 500) setAttempt(null)
		} finally {
			setSaving(false)
		}
	}
	return (
		<form class="panel" onSubmit={upload}>
			<label>
				receipt or document
				<input
					ref={input}
					type="file"
					accept="application/pdf,image/jpeg,image/png,image/webp,text/plain"
					disabled={saving() || attempt() !== null || hasPendingWrite()}
					onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
				/>
			</label>
			<p class="muted">pdf, jpeg, png, webp, or text · up to 2 mib</p>
			<Show when={error()}>
				<p role="alert" class="error">
					{error()}
				</p>
			</Show>
			<Show when={attempt() && !saving()}>
				<p class="muted">
					the upload outcome is unknown. retry uses the same document and request.
				</p>
			</Show>
			<button
				class="primary"
				type="submit"
				disabled={saving() || (hasPendingWrite() && attempt() === null)}
			>
				{saving() ? "uploading…" : attempt() ? "retry upload" : "upload document"}
			</button>
		</form>
	)
}

function SourcePanel(props: {
	detail: SourceDetail
	catalog: HistoryCatalog
	selectedItem: string | null
	onSelect: (id: string | null) => void
	onRefresh: () => Promise<void>
	onClose: () => void
	onNext: (cursor: string | null) => void
}) {
	const [adding, setAdding] = createSignal(false)
	const [completing, setCompleting] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	const [completionAttempt, setCompletionAttempt] = createSignal<{
		key: string
		revision: number
	} | null>(null)
	const [itemPending, setItemPending] = createSignal(false)
	usePendingWrite({
		pending: () => completionAttempt() !== null,
		onBlocked: setError,
		busy: () => completing() || completionAttempt() !== null,
	})
	const locked = () => itemPending() || completionAttempt() !== null
	const selected = () => props.detail.items.find((item) => item.id === props.selectedItem) ?? null
	const finish = async () => {
		const request = completionAttempt() ?? {
			key: crypto.randomUUID(),
			revision: props.detail.source.revision,
		}
		setCompletionAttempt(request)
		setCompleting(true)
		setError(null)
		try {
			await historyApi.completeSource({
				id: props.detail.source.id,
				body: { expected_revision: request.revision },
				key: request.key,
			})
			setCompletionAttempt(null)
			await props.onRefresh()
		} catch (error) {
			setError(apiErrorMessage(error))
			if (error instanceof ApiError && error.status < 500) setCompletionAttempt(null)
		} finally {
			setCompleting(false)
		}
	}
	return (
		<section class="panel" aria-label="document details">
			<div class="topline">
				<h3>{props.detail.source.label}</h3>
				<button type="button" onClick={props.onClose} disabled={locked()}>
					close document
				</button>
			</div>
			<p class="muted">
				received {props.detail.source.created_at} ·{" "}
				{props.detail.source.extraction_complete
					? "all extracted entries received"
					: "uploaded; awaiting extraction"}
			</p>
			<a href={historyApi.sourceContentUrl(props.detail.source.id)}>download original</a>
			<ul class="history-list">
				<For
					each={props.detail.items}
					fallback={<li class="muted">no entries extracted yet. the original is saved.</li>}
				>
					{(item) => (
						<li>
							<button
								type="button"
								class="text-button"
								disabled={locked()}
								onClick={() => {
									setAdding(false)
									props.onSelect(item.id)
								}}
							>
								{item.proposal?.payee || `entry ${item.item_key}`}
							</button>
							<div class="muted">
								{item.resolution}
								{item.review_reason ? ` · ${reviewCopy[item.review_reason]}` : ""}
							</div>
							<Show when={item.transaction_id}>
								<A
									href={`/history?transaction=${item.transaction_id}&period=${item.proposal?.date?.slice(0, 7) ?? new Date().toISOString().slice(0, 7)}`}
								>
									view transaction
								</A>
							</Show>
						</li>
					)}
				</For>
			</ul>
			<div class="actions">
				<button
					type="button"
					disabled={locked()}
					onClick={() => {
						props.onSelect(null)
						setAdding(true)
					}}
				>
					{props.detail.source.extraction_complete ? "add a missed entry" : "add an entry"}
				</button>
				<Show when={!props.detail.source.extraction_complete}>
					<button
						type="button"
						disabled={
							completing() || itemPending() || (hasPendingWrite() && completionAttempt() === null)
						}
						onClick={finish}
					>
						{completing()
							? "saving…"
							: completionAttempt()
								? "retry completion"
								: "no more entries to add"}
					</button>
				</Show>
				<Show when={props.detail.next_cursor}>
					<button type="button" onClick={() => props.onNext(props.detail.next_cursor)}>
						more entries
					</button>
				</Show>
				<button type="button" onClick={() => props.onNext(null)}>
					first entries
				</button>
			</div>
			<Show when={error()}>
				<p class="error" role="alert">
					{error()}
				</p>
			</Show>
			<Show when={adding()}>
				<SourceItemPanel
					source={props.detail.source}
					onPendingChange={setItemPending}
					item={null}
					catalog={props.catalog}
					onDone={async () => {
						await props.onRefresh()
						setAdding(false)
					}}
					onCancel={() => setAdding(false)}
				/>
			</Show>
			<Show when={selected()?.id} keyed>
				{(_itemId) => (
					<SourceItemPanel
						source={props.detail.source}
						onPendingChange={setItemPending}
						item={selected()}
						catalog={props.catalog}
						onDone={async () => {
							await props.onRefresh()
							props.onSelect(null)
						}}
						onCancel={() => props.onSelect(null)}
					/>
				)}
			</Show>
			<AuditHistory entityKind="source" entityId={props.detail.source.id} />
		</section>
	)
}

function initialProposal(proposal: TransactionProposal | null): Partial<TransactionInput> {
	if (!proposal) return {}
	const date = Option.getOrUndefined(Schema.decodeUnknownOption(CalendarDate)(proposal.date))
	const amount =
		proposal.currency === undefined || proposal.currency === null || proposal.currency === "USD"
			? Option.getOrUndefined(Schema.decodeUnknownOption(PositiveCents)(proposal.amount_cents))
			: undefined
	const allocations = Option.getOrUndefined(
		Schema.decodeUnknownOption(Schema.Array(Allocation))(proposal.allocations),
	)
	return {
		date,
		amount_cents: amount,
		kind: proposal.kind,
		payee: proposal.payee ?? undefined,
		note: proposal.note ?? null,
		payment_reference: proposal.payment_reference ?? null,
		original_expense_id: proposal.original_expense_id ?? null,
		allocations: amount === undefined || !allocations?.length ? undefined : allocations,
	}
}

function SourceItemPanel(props: {
	source: SourceRecord
	item: SourceItemRecord | null
	onPendingChange: (pending: boolean) => void
	catalog: HistoryCatalog
	onDone: () => Promise<void>
	onCancel: () => void
}) {
	const [mode, setMode] = createSignal<
		"record" | "link" | "hold" | "ignore" | "reopen" | "relink" | "correct" | "retarget" | null
	>(props.item === null ? "record" : null)
	const [reason, setReason] = createSignal("")
	const [reviewReason, setReviewReason] = createSignal<ReviewReason>(
		props.item?.review_reason ?? "payment_unconfirmed",
	)
	const [error, setError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)
	const [attempt, setAttempt] = createSignal<{ body: ImportCommand; key: string } | null>(null)
	const [editorPending, setEditorPending] = createSignal(false)
	usePendingWrite({
		pending: () => attempt() !== null || editorPending(),
		onBlocked: setError,
		onPendingChange: props.onPendingChange,
		busy: () => saving() || attempt() !== null || editorPending(),
	})
	const itemKey = props.item?.item_key ?? `manual.${crypto.randomUUID()}`
	const envelope = () => ({
		source_id: props.source.id,
		item_key: itemKey,
		expected_source_revision: props.source.revision,
		expected_item_revision: props.item?.revision ?? null,
	})
	const settle = async (
		body: ImportCommand,
		key: string = crypto.randomUUID(),
		confirmed?: () => void,
	) => {
		const request = attempt() ?? { body, key }
		setAttempt(request)
		setSaving(true)
		setError(null)
		try {
			await historyApi.importItem(request)
			setAttempt(null)
			confirmed?.()
			setEditorPending(false)
			await props.onDone()
		} catch (error) {
			setError(apiErrorMessage(error))
			if (error instanceof ApiError && error.status < 500) setAttempt(null)
			throw error
		} finally {
			setSaving(false)
		}
	}
	const run = async (body: ImportCommand) => {
		try {
			await settle(body)
		} catch (error) {
			if (error instanceof ApiError || error instanceof TypeError) {
				// justify-ignore-error: settle displays this request failure and retains its retry key and review draft.
				return
			}
			throw error
		}
	}
	const pending = () => props.item === null || props.item.resolution === "pending"
	const correction = () =>
		props.item?.review_reason === "correction_conflict" ||
		(props.item?.correction_target_id !== null && props.item?.correction_target_id !== undefined)
	const selectMode = (value: ReturnType<typeof mode>) => {
		setMode(value)
		setError(null)
	}
	return (
		<div class="source-item">
			<h3>
				{props.item
					? "review entry"
					: props.source.extraction_complete
						? "add missed entry"
						: "add document entry"}
			</h3>
			<Show when={props.item?.review_reason}>
				{(reason) => <p class="muted">{reviewCopy[reason()]}</p>}
			</Show>
			<Show when={props.item?.proposal}>
				{(proposal) => (
					<div class="muted">
						<p>
							observed: {proposal().payee ?? "merchant unknown"} ·{" "}
							{proposal().date ?? "date unknown"} · {proposal().currency ?? "currency unknown"}{" "}
							{Number.isSafeInteger(proposal().amount_cents)
								? centsToDecimal(Number(proposal().amount_cents))
								: (proposal().amount_cents ?? "amount unknown")}
						</p>
						<Show when={proposal().note}>
							<p>{proposal().note}</p>
						</Show>
						<Show when={proposal().allocations}>
							<details>
								<summary>observed split details</summary>
								<pre>{JSON.stringify(proposal().allocations, null, 2)}</pre>
							</details>
						</Show>
					</div>
				)}
			</Show>
			<fieldset disabled={saving() || attempt() !== null || editorPending() || hasPendingWrite()}>
				<div class="actions">
					<Show when={pending()}>
						<Show when={!correction()}>
							<button type="button" onClick={() => selectMode("record")}>
								record expense or refund
							</button>
							<button type="button" onClick={() => selectMode("link")}>
								link to existing
							</button>
						</Show>
						<Show when={correction()}>
							<button type="button" onClick={() => selectMode("correct")}>
								review existing transaction
							</button>
							<button type="button" onClick={() => selectMode("retarget")}>
								change correction target
							</button>
						</Show>
						<button type="button" onClick={() => selectMode("hold")}>
							keep pending
						</button>
						<button type="button" onClick={() => selectMode("ignore")}>
							ignore entry
						</button>
					</Show>
					<Show when={props.item?.resolution === "ignored"}>
						<button type="button" onClick={() => selectMode("reopen")}>
							reopen entry
						</button>
					</Show>
					<Show when={props.item?.resolution === "recorded" || props.item?.resolution === "linked"}>
						<button type="button" onClick={() => selectMode("relink")}>
							change evidence link
						</button>
						<p class="muted">changing a link does not remove or correct the former transaction.</p>
					</Show>
				</div>
			</fieldset>
			<Show when={mode() === "record" && !correction()}>
				<TransactionEditor
					catalog={props.catalog}
					initial={initialProposal(props.item?.proposal ?? null)}
					onCancel={props.onCancel}
					onPendingChange={setEditorPending}
					onSave={({ transaction, key }, confirmed) =>
						settle({ ...envelope(), kind: "record", transaction }, key, confirmed)
					}
				/>
			</Show>
			<Show when={mode() === "link" || mode() === "relink" || mode() === "retarget"}>
				<Show when={mode() === "relink"}>
					<label>
						reason for changing the link
						<input
							type="text"
							value={reason()}
							disabled={saving() || attempt() !== null || hasPendingWrite()}
							onInput={(event) => setReason(event.currentTarget.value)}
						/>
					</label>
				</Show>
				<TransactionMatcher
					payee={props.item?.proposal?.payee ?? ""}
					disabled={saving() || attempt() !== null || hasPendingWrite()}
					onChoose={async (transaction) => {
						if (mode() === "retarget") {
							await run({
								...envelope(),
								kind: "hold",
								proposal: props.item?.proposal ?? {},
								reason: "correction_conflict",
								correction_target_id: transaction.id,
							})
							return
						}
						if (mode() === "relink") {
							if (!reason().trim()) {
								setError("give a reason for changing this link.")
								return
							}
							await run({
								...envelope(),
								kind: "relink",
								transaction_id: transaction.id,
								target_revision: transaction.revision,
								reason: reason().trim(),
							})
							return
						}
						await run({
							...envelope(),
							kind: "link",
							transaction_id: transaction.id,
							target_revision: transaction.revision,
						})
					}}
				/>
			</Show>
			<Show when={mode() === "hold" || mode() === "ignore" || mode() === "reopen"}>
				<form
					onSubmit={(event) => {
						event.preventDefault()
						const selected = mode()
						if (selected === "hold") {
							void run({
								...envelope(),
								kind: "hold",
								proposal: props.item?.proposal ?? {},
								reason: correction() ? "correction_conflict" : reviewReason(),
								correction_target_id: props.item?.correction_target_id ?? null,
							})
							return
						}
						if (selected === "ignore" && reason().trim())
							void run({ ...envelope(), kind: "ignore", reason: reason().trim() })
						if (selected === "reopen" && reason().trim())
							void run({
								...envelope(),
								kind: "reopen",
								reason: reason().trim(),
								review_reason: reviewReason(),
							})
					}}
				>
					<fieldset disabled={saving() || attempt() !== null || hasPendingWrite()}>
						<Show when={mode() === "reopen"}>
							<label>
								review reason
								<select
									value={reviewReason()}
									onChange={(event) => setReviewReason(event.currentTarget.value as ReviewReason)}
								>
									<For
										each={Object.entries(reviewCopy).filter(
											([reason]) => reason !== "correction_conflict" || correction(),
										)}
									>
										{([value, label]) => <option value={value}>{label}</option>}
									</For>
								</select>
							</label>
						</Show>
						<Show
							when={mode() === "hold"}
							fallback={
								<label>
									reason
									<input
										type="text"
										required
										value={reason()}
										onInput={(event) => setReason(event.currentTarget.value)}
									/>
								</label>
							}
						>
							<label>
								what needs review?
								<select
									value={reviewReason()}
									disabled={correction()}
									onChange={(event) => {
										const found = Object.keys(reviewCopy).find(
											(reason) => reason === event.currentTarget.value,
										)
										if (found) setReviewReason(found as ReviewReason)
									}}
								>
									<For
										each={Object.entries(reviewCopy).filter(
											([reason]) => reason !== "correction_conflict" || correction(),
										)}
									>
										{([value, label]) => <option value={value}>{label}</option>}
									</For>
								</select>
							</label>
						</Show>
						<div class="actions">
							<button type="submit">
								{mode() === "hold"
									? "save pending entry"
									: mode() === "ignore"
										? "confirm ignore"
										: "reopen entry"}
							</button>
						</div>
					</fieldset>
				</form>
			</Show>
			<Show when={mode() === "correct" && props.item?.correction_target_id}>
				{(target) => (
					<TransactionPanel
						id={target()}
						onPendingChange={setEditorPending}
						onLink={(transaction) =>
							run({
								...envelope(),
								kind: "link",
								transaction_id: transaction.id,
								target_revision: transaction.revision,
							})
						}
						correctionOnly
						catalog={props.catalog}
						onClose={() => setMode(null)}
						onSaved={async () => {
							const transaction = await historyApi.transaction(target())
							await settle({
								...envelope(),
								kind: "link",
								transaction_id: transaction.id,
								target_revision: transaction.revision,
							})
						}}
					/>
				)}
			</Show>
			<Show when={error()}>
				<p role="alert" class="error">
					{error()}
				</p>
			</Show>
			<Show when={attempt() && !saving() && mode() !== "record"}>
				<p class="muted">the outcome is unknown. retry uses the same request.</p>
				<button
					type="button"
					onClick={() => {
						const request = attempt()
						if (request) void run(request.body)
					}}
				>
					retry action
				</button>
			</Show>
			<Show when={props.item}>
				{(item) => <AuditHistory entityKind="source_item" entityId={item().id} />}
			</Show>
		</div>
	)
}

function TransactionMatcher(props: {
	payee: string
	disabled: boolean
	onChoose: (transaction: TransactionRecord) => Promise<void>
}) {
	const [payee, setPayee] = createSignal(props.payee)
	const [amount, setAmount] = createSignal("")
	const [filters, setFilters] = createSignal<{
		payee: string
		amount_cents?: string
		cursor?: string
	} | null>(null)
	const [error, setError] = createSignal<string | null>(null)
	const results = createAsync(() => {
		const query = filters()
		return query ? loadTransactions(query) : Promise.resolve(null)
	})
	return (
		<>
			<form
				onSubmit={(event) => {
					event.preventDefault()
					setError(null)
					if (!amount()) {
						setFilters({ payee: payee() })
						return
					}
					const cents = parseMoney(amount())
					if (Option.isNone(cents) || cents.value === 0) {
						setError("enter an exact amount greater than zero.")
						return
					}
					setFilters({ payee: payee(), amount_cents: String(cents.value) })
				}}
			>
				<fieldset disabled={props.disabled}>
					<div class="fields">
						<label>
							find merchant
							<input
								type="text"
								value={payee()}
								onInput={(event) => setPayee(event.currentTarget.value)}
							/>
						</label>
						<label>
							exact amount (optional)
							<input
								inputmode="decimal"
								value={amount()}
								onInput={(event) => setAmount(event.currentTarget.value)}
							/>
						</label>
					</div>
					<button type="submit">find transactions</button>
				</fieldset>
			</form>
			<Show when={error()}>
				<p role="alert" class="error">
					{error()}
				</p>
			</Show>
			<Show when={results()}>
				{(page) => (
					<>
						<ul class="history-list">
							<For
								each={page().items}
								fallback={
									<li class="muted">
										no matching transactions found. adjust the merchant or amount.
									</li>
								}
							>
								{(transaction) => (
									<li>
										{transaction.payee} · {transaction.date} ·{" "}
										{formatCurrency(transaction.amount_cents)}
										<button
											type="button"
											disabled={props.disabled}
											onClick={() => props.onChoose(transaction)}
											style={{ "margin-left": "10px" }}
										>
											choose transaction
										</button>
									</li>
								)}
							</For>
						</ul>
						<Show when={page().next_cursor}>
							<button
								type="button"
								onClick={() =>
									setFilters((value) =>
										value ? { ...value, cursor: page().next_cursor ?? undefined } : null,
									)
								}
							>
								next matches
							</button>
						</Show>
					</>
				)}
			</Show>
		</>
	)
}
