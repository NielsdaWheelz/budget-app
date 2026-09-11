import { type Page, expect, test } from "@playwright/test"
import { Schema } from "effect"
import { BASE_LINE_ITEMS } from "../src/config/budget-config"
import { HistoryReport, categories, snapshotPlan } from "../src/domain/history"
import {
	ChangePage,
	HistoryCatalog,
	ImportCommand,
	ImportResult,
	MonthPlanRecord,
	MonthPlanSave,
	PlannerRecord,
	SourceDetail,
	SourceItemRecord,
	SourcePage,
	SourceRecord,
	TransactionCreate,
	TransactionPage,
	TransactionRecord,
	TransactionUpdate,
} from "../src/shared/history-schemas"

const transactionId = "01990000-0000-7000-8000-000000000001"
const sourceId = "01990000-0000-7000-8000-000000000002"
const itemId = "01990000-0000-7000-8000-000000000003"
const createdAt = "2026-09-30T12:00:00.000Z"
const catalog = Schema.decodeUnknownSync(HistoryCatalog)({
	currency: "USD",
	categories,
	input_limits: {
		max_cents: Number.MAX_SAFE_INTEGER,
		max_source_bytes: 2 * 1024 * 1024,
		max_request_bytes: 3 * 1024 * 1024,
		max_page_size: 100,
		max_label_length: 200,
		max_text_length: 2000,
		max_proposal_bytes: 16384,
	},
})
const planner = Schema.decodeUnknownSync(PlannerRecord)({
	id: "01990000-0000-7000-8000-000000000004",
	revision: 1,
	created_at: createdAt,
	state: {
		grossIncome: 1500000,
		healthInsurance: 100000,
		rentersInsurance: 10000,
		scenarioName: "Solo",
		period: "Monthly",
		lineItemAmounts: Object.fromEntries(BASE_LINE_ITEMS.map((item) => [item.key, item.amount])),
	},
})

async function fixture(page: Page, options: { lostSave?: boolean; correction?: boolean } = {}) {
	let transaction = Schema.decodeUnknownSync(TransactionRecord)({
		id: transactionId,
		date: "2026-09-30",
		kind: "expense",
		amount_cents: 10000,
		currency: "USD",
		payee: "corner shop",
		note: null,
		payment_reference: null,
		original_expense_id: null,
		allocations: [
			{ category_key: "Groceries", amount_cents: 9000 },
			{ category_key: "Shopping", amount_cents: 1000 },
		],
		revision: 1,
		voided: false,
		owner_protected: true,
		created_at: createdAt,
	})
	let source = Schema.decodeUnknownSync(SourceRecord)({
		id: sourceId,
		namespace: "mail.test",
		external_key: "message-1",
		label: "receipt.pdf",
		media_type: "application/pdf",
		sha256: "a".repeat(64),
		byte_length: 10,
		external_reference: null,
		extraction_complete: true,
		revision: 1,
		created_at: createdAt,
	})
	let item = Schema.decodeUnknownSync(SourceItemRecord)({
		id: itemId,
		source_id: sourceId,
		item_key: "expense-1",
		revision: 1,
		proposal: {
			date: "2026-09-30",
			amount_cents: 10000,
			currency: "USD",
			payee: "corner shop",
			note: "corrected description",
		},
		review_reason: "correction_conflict",
		correction_target_id: transactionId,
		resolution: "pending",
		transaction_id: null,
		created_at: createdAt,
	})
	const writes: Array<{ path: string; key: string | null; body: unknown }> = []
	let plan = Schema.decodeUnknownSync(MonthPlanRecord)({
		id: "01990000-0000-7000-8000-000000000005",
		month: "2026-09",
		revision: 1,
		adopted_planner_revision: 1,
		lines: snapshotPlan(planner.state),
		created_at: createdAt,
	})
	await page.route("**/api/**", async (route) => {
		const request = route.request()
		const url = new URL(request.url())
		const path = url.pathname
		if (path === "/api/auth/me") return route.fulfill({ json: { email: "test@example.com" } })
		if (path === "/api/catalog") return route.fulfill({ json: catalog })
		if (path === "/api/planner") return route.fulfill({ json: planner })
		if (path.startsWith("/api/changes"))
			return route.fulfill({
				json: Schema.decodeUnknownSync(ChangePage)({ items: [], next_cursor: null }),
			})
		if (path.startsWith("/api/plans/")) {
			if (request.method() === "PUT") {
				const body = Schema.decodeUnknownSync(MonthPlanSave)(request.postDataJSON())
				writes.push({ path, body, key: request.headers()["idempotency-key"] ?? null })
				plan = {
					...plan,
					revision: 2,
					lines: body.kind === "explicit" ? body.lines : snapshotPlan(planner.state),
				}
			}
			return route.fulfill({ json: plan })
		}
		if (path === "/api/reports") {
			const period = url.searchParams.get("period") ?? "2026-09"
			const year = period.length === 4
			const through = Number(url.searchParams.get("through_month") ?? 9)
			const months = year
				? Array.from({ length: through }, (_, i) => `${period}-${String(i + 1).padStart(2, "0")}`)
				: [period]
			return route.fulfill({
				json: Schema.decodeUnknownSync(HistoryReport)({
					period,
					from: year ? `${period}-01-01` : `${period}-01`,
					until: year ? `${period}-${String(through + 1).padStart(2, "0")}-01` : "2026-10-01",
					currency: "USD",
					included_months: months,
					missing_plan_months: year ? months.slice(0, -1) : [],
					plan_revisions: year
						? [{ month: `${period}-09`, revision: 1 }]
						: [{ month: period, revision: 1 }],
					transaction_count: 1,
					awaiting_extraction_source_count: 0,
					pending_item_count: options.correction ? 1 : 0,
					rows: [
						{
							category_key: "Groceries",
							label: "Groceries",
							planned_cents: year ? null : 8000,
							recorded_cents: 9000,
							difference_cents: year ? null : 1000,
						},
						{
							category_key: "Shopping",
							label: "Shopping",
							planned_cents: year ? null : 2000,
							recorded_cents: 1000,
							difference_cents: year ? null : -1000,
						},
						{
							category_key: null,
							label: "Uncategorized",
							planned_cents: year ? null : 0,
							recorded_cents: 0,
							difference_cents: year ? null : 0,
						},
					],
					planned_cents: year ? null : 10000,
					known_planned_cents: 10000,
					recorded_cents: 10000,
					difference_cents: year ? null : 0,
				}),
			})
		}
		if (path === "/api/transactions" && request.method() === "GET") {
			const category = url.searchParams.get("category")
			const amount = category
				? (transaction.allocations.find((line) => line.category_key === category)?.amount_cents ??
					0)
				: transaction.amount_cents
			return route.fulfill({
				json: Schema.decodeUnknownSync(TransactionPage)({
					items: [{ ...transaction, contribution_cents: amount }],
					next_cursor: null,
				}),
			})
		}
		if (path === "/api/transactions" && request.method() === "POST") {
			const body = Schema.decodeUnknownSync(TransactionCreate)(request.postDataJSON())
			writes.push({ path, body, key: request.headers()["idempotency-key"] ?? null })
			transaction = Schema.decodeUnknownSync(TransactionRecord)({
				...body.transaction,
				id: transactionId,
				revision: 1,
				voided: false,
				owner_protected: true,
				created_at: createdAt,
			})
			if (options.lostSave && writes.filter((write) => write.path === path).length === 1)
				return route.abort("failed")
			return route.fulfill({ json: transaction })
		}
		if (path === `/api/transactions/${transactionId}`) {
			if (request.method() === "PUT") {
				const body = Schema.decodeUnknownSync(TransactionUpdate)(request.postDataJSON())
				writes.push({ path, body, key: request.headers()["idempotency-key"] ?? null })
				transaction = {
					...transaction,
					...body.transaction,
					voided: body.voided,
					revision: transaction.revision + 1,
				}
			}
			return route.fulfill({ json: transaction })
		}
		if (path === "/api/sources")
			return route.fulfill({
				json: Schema.decodeUnknownSync(SourcePage)({
					items: options.correction ? [source] : [],
					next_cursor: null,
				}),
			})
		if (path === `/api/sources/${sourceId}`)
			return route.fulfill({
				json: Schema.decodeUnknownSync(SourceDetail)({ source, items: [item], next_cursor: null }),
			})
		if (path === "/api/imports") {
			const body = Schema.decodeUnknownSync(ImportCommand)(request.postDataJSON())
			writes.push({ path, body, key: request.headers()["idempotency-key"] ?? null })
			item = Schema.decodeUnknownSync(SourceItemRecord)({
				...item,
				revision: 2,
				resolution: "linked",
				transaction_id: transactionId,
			})
			source = { ...source, revision: 2 }
			return route.fulfill({
				json: Schema.decodeUnknownSync(ImportResult)({ status: "linked", item, transaction }),
			})
		}
		return route.fulfill({
			status: 404,
			json: { _tag: "NotFoundError", message: `unstubbed ${path}` },
		})
	})
	return { writes, transaction, source }
}

test("comparison labels and category drilldown survive history navigation", async ({ page }) => {
	await fixture(page)
	await page.goto("/history?period=2026-09")
	await expect(page.getByRole("heading", { name: "spending history" })).toBeVisible()
	await expect(page.getByLabel("$10.00 over plan", { exact: true })).toBeVisible()
	await expect(page.getByLabel("$10.00 under plan", { exact: true })).toBeVisible()
	await page.getByRole("button", { name: "groceries: $90.00 recorded, view transactions" }).click()
	await expect(page).toHaveURL(/category=Groceries/)
	await expect(page.getByRole("table", { name: "transactions", exact: true })).toContainText(
		"category contribution",
	)
	await expect(page.getByRole("table", { name: "transactions", exact: true })).toContainText(
		"$90.00",
	)
	await expect(page.getByRole("table", { name: "transactions", exact: true })).toContainText(
		"$100.00",
	)
	await page.reload()
	await expect(page.getByRole("heading", { name: "groceries transactions" })).toBeVisible()
	await page.getByRole("button", { name: "year", exact: true }).click()
	await expect(page.getByText("plan saved for 1 of 9 months.", { exact: false })).toBeVisible()
	await expect(page.getByRole("table", { name: "planned and recorded spending" })).toContainText(
		"no complete plan",
	)
	await page.goBack()
	await expect(page).toHaveURL(/category=Groceries/)
})

test("split editing validates exact amounts and retries an uncertain save once", async ({
	page,
}) => {
	const { writes } = await fixture(page, { lostSave: true })
	await page.goto("/history?period=2026-09&action=new")
	await page.getByLabel("purchase date").fill("2026-09-30")
	await page.getByLabel("amount (usd)").fill("245.95")
	await page.getByLabel("merchant", { exact: true }).fill("receipt shop")
	await page.getByRole("combobox", { name: "category", exact: true }).selectOption("Groceries")
	await page.getByRole("button", { name: "add split" }).click()
	await page.getByLabel("split 1 amount").fill("30.00")
	await page
		.getByRole("combobox", { name: "split 2 category", exact: true })
		.selectOption("Shopping")
	await page.getByLabel("split 2 amount").fill("215.94")
	await page.getByRole("button", { name: "save transaction", exact: true }).click()
	await expect(page.getByRole("alert")).toHaveText("assign the remaining $0.01 before saving.")
	await expect.poll(() => writes.length).toBe(0)
	await page.getByLabel("split 2 amount").fill("215.95")
	await page.getByRole("button", { name: "save transaction", exact: true }).click()
	await expect(page.getByRole("button", { name: "retry save" })).toBeVisible()
	await expect(page.getByLabel("amount (usd)")).toHaveValue("245.95")
	await expect(page.getByLabel("amount (usd)")).toBeDisabled()
	await page.getByRole("link", { name: "inbox", exact: true }).click()
	await expect(page).toHaveURL(/action=new/)
	await page.getByRole("button", { name: "year", exact: true }).click()
	await expect(page).toHaveURL(/period=2026-09/)
	await expect(page.getByRole("button", { name: "log out" })).toBeDisabled()
	await page.getByRole("button", { name: "retry save" }).click()
	await expect(page.getByRole("heading", { name: "new transaction" })).toBeHidden()
	expect(writes).toHaveLength(2)
	expect(writes[0]?.key).toBe(writes[1]?.key)
	expect(writes[0]?.body).toEqual(writes[1]?.body)
})

test("a correction proposal edits its target and then links evidence", async ({ page }) => {
	const { writes } = await fixture(page, { correction: true })
	await page.goto(`/inbox?source=${sourceId}&item=${itemId}`)
	await expect(page.getByRole("button", { name: "record expense or refund" })).toBeHidden()
	await page.getByRole("button", { name: "review existing transaction" }).click()
	await page.getByRole("button", { name: "edit transaction", exact: true }).click()
	await page.getByLabel("note", { exact: true }).fill("corrected description")
	await page.getByLabel("reason for correction").fill("receipt confirms the detail")
	await page.getByRole("button", { name: "save correction" }).click()
	await expect(page.getByRole("heading", { name: "review entry", exact: true })).toBeHidden()
	expect(writes.map((write) => write.path)).toEqual([
		`/api/transactions/${transactionId}`,
		"/api/imports",
	])
	expect(writes[1]?.body).toMatchObject({
		kind: "link",
		transaction_id: transactionId,
		target_revision: 2,
	})
})

test("month amendments preview the old amount and keep their reason", async ({ page }) => {
	const { writes } = await fixture(page)
	await page.goto("/history?period=2026-09&action=plan")
	await page.getByLabel("groceries planned amount").fill("510.00")
	await page.getByLabel("reason for amendment").fill("adjust groceries for september")
	await expect(page.getByRole("table", { name: "monthly plan amounts" })).toContainText("$500.00")
	await page.getByRole("button", { name: "save month plan" }).click()
	await expect(page.getByRole("heading", { name: "amend september 2026 plan" })).toBeHidden()
	expect(writes[0]?.body).toMatchObject({
		kind: "explicit",
		expected_revision: 1,
		reason: "adjust groceries for september",
	})
})

test("large cents survive a stale edit and require explicit revision review", async ({ page }) => {
	const initial = await fixture(page)
	let record = Schema.decodeUnknownSync(TransactionRecord)({
		...initial.transaction,
		kind: "refund",
		original_expense_id: "01990000-0000-7000-8000-000000000099",
		amount_cents: 9007199254740990,
		allocations: [{ category_key: "Groceries", amount_cents: 9007199254740990 }],
	})
	const updates: TransactionUpdate[] = []
	await page.route(`**/api/transactions/${transactionId}`, async (route) => {
		if (route.request().method() === "PUT") {
			const body = Schema.decodeUnknownSync(TransactionUpdate)(route.request().postDataJSON())
			updates.push(body)
			if (updates.length === 1) {
				record = { ...record, revision: 2, note: "another saved correction" }
				return route.fulfill({
					status: 409,
					json: { _tag: "ConflictError", message: "transaction changed" },
				})
			}
			record = { ...record, ...body.transaction, revision: 3 }
		}
		return route.fulfill({ json: record })
	})
	await page.goto(`/history?period=2026-09&transaction=${transactionId}`)
	await expect(page.getByRole("region", { name: "transaction details" })).toContainText(
		"$90,071,992,547,409.90",
	)
	await page.getByRole("button", { name: "edit transaction", exact: true }).click()
	await expect(page.getByLabel("amount (usd)")).toHaveValue("90071992547409.90")
	await page.getByRole("combobox", { name: "type", exact: true }).selectOption("expense")
	await page.getByLabel("note", { exact: true }).fill("my retained draft")
	await page.getByLabel("reason for correction").fill("receipt correction")
	await page.getByRole("button", { name: "save correction" }).click()
	await expect(page.getByRole("button", { name: "save correction" })).toBeDisabled()
	await page.getByRole("button", { name: "review latest transaction" }).click()
	await expect(page.getByText("another saved correction", { exact: true })).toBeVisible()
	await expect(page.getByLabel("note", { exact: true })).toHaveValue("my retained draft")
	await page.getByRole("button", { name: "use revision 2 for this correction" }).click()
	await page.getByRole("button", { name: "save correction" }).click()
	await expect(page.getByRole("button", { name: "edit transaction", exact: true })).toBeVisible()
	expect(updates.map((update) => update.expected_revision)).toEqual([1, 2])
	expect(updates[1]?.transaction).toMatchObject({
		amount_cents: 9007199254740990,
		kind: "expense",
		original_expense_id: null,
		note: "my retained draft",
	})
})

test("a new document never inherits another document's entry draft", async ({ page }) => {
	const { source } = await fixture(page, { correction: true })
	const other = Schema.decodeUnknownSync(SourceRecord)({
		...source,
		id: "01990000-0000-7000-8000-000000000088",
		external_key: "message-2",
		label: "another.pdf",
	})
	await page.route("**/api/sources?*", (route) =>
		route.fulfill({
			json: Schema.decodeUnknownSync(SourcePage)({ items: [source, other], next_cursor: null }),
		}),
	)
	await page.route(`**/api/sources/${other.id}*`, (route) =>
		route.fulfill({
			json: Schema.decodeUnknownSync(SourceDetail)({ source: other, items: [], next_cursor: null }),
		}),
	)
	await page.goto(`/inbox?source=${sourceId}`)
	await page.getByRole("button", { name: "add a missed entry" }).click()
	await page.getByLabel("merchant", { exact: true }).fill("only belongs to first receipt")
	await page.getByRole("button", { name: "another.pdf", exact: true }).click()
	await expect(page.getByRole("heading", { name: "another.pdf", exact: true })).toBeVisible()
	await expect(page.getByLabel("merchant", { exact: true })).toBeHidden()
	await page.getByRole("button", { name: "add a missed entry" }).click()
	await expect(page.getByLabel("merchant", { exact: true })).toHaveValue("")
})

test("a late audit failure cannot discard an uncertain financial save", async ({ page }) => {
	const { writes } = await fixture(page, { lostSave: true })
	let failAudit: (() => void) | undefined
	const auditFailure = new Promise<void>((resolve) => {
		failAudit = resolve
	})
	let auditStarted = false
	await page.route("**/api/changes?*", async (route) => {
		auditStarted = true
		await auditFailure
		await route.abort("failed")
	})
	await page.goto(`/history?period=2026-09&transaction=${transactionId}`)
	await page.getByRole("button", { name: "record refund", exact: true }).click()
	await page.getByLabel("amount (usd)").fill("25.00")
	await page.getByRole("button", { name: "remove split 2" }).click()
	await page.getByText("correction history", { exact: true }).click()
	await expect.poll(() => auditStarted).toBe(true)
	await expect(page.getByLabel("amount (usd)")).toBeVisible({ timeout: 3000 })
	await page.getByRole("button", { name: "save transaction", exact: true }).click()
	await expect(page.getByRole("button", { name: "retry save" })).toBeVisible()
	failAudit?.()
	await expect(page.getByText("couldn't load correction history.", { exact: false })).toBeVisible()
	await expect(page.getByLabel("amount (usd)")).toHaveValue("25.00")
	await expect(page.getByRole("button", { name: "retry save" })).toBeEnabled()
	await page.getByRole("button", { name: "retry save" }).click()
	await expect(page.getByRole("button", { name: "edit transaction", exact: true })).toBeVisible()
	expect(writes).toHaveLength(2)
	expect(writes[1]?.key).toBe(writes[0]?.key)
	expect(writes[1]?.body).toEqual(writes[0]?.body)
})
