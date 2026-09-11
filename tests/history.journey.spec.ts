import { expect, test } from "@playwright/test"
import { Schema } from "effect"
import { ImportResult, SourceRecord } from "../src/shared/history-schemas"

test("the owner adopts a plan and sees jarvis's source-backed expense in the built browser app", async ({
	page,
	request,
}, testInfo) => {
	await page.goto("/planner")
	await page.getByRole("button", { name: /register|sign up|create account/i }).click()
	await page.getByLabel("email", { exact: false }).fill("journey@example.test")
	await page.getByLabel(/^password$/i).fill("synthetic-test-password")
	await page.getByRole("button", { name: /register|sign up|create account/i }).click()
	await expect(page.getByRole("heading", { name: "planner", exact: true })).toBeVisible()
	await page.getByRole("button", { name: "save planner", exact: true }).click()
	await expect(page.getByText(/planner saved/i)).toBeVisible()
	await page.getByRole("link", { name: "history", exact: true }).click()
	await page.getByLabel("month", { exact: true }).fill("2026-09")
	await page.getByRole("button", { name: "set plan for september 2026", exact: true }).click()
	await page.getByRole("button", { name: /use current plan for/i }).click()
	await page.getByRole("button", { name: "save month plan", exact: true }).click()
	await expect(page.getByRole("table", { name: "planned and recorded spending" })).toBeVisible()
	const headers = {
		authorization: "Bearer synthetic-write-token-for-browser-proof",
		"idempotency-key": "journey-upload",
	}
	const uploaded = await request.post("/api/sources", {
		headers,
		data: {
			expected_revision: null,
			namespace: "journey/mail",
			external_key: "receipt",
			label: "receipt.txt",
			media_type: "text/plain",
			content_base64: Buffer.from("groceries paid 515.95 usd").toString("base64"),
			external_reference: null,
		},
	})
	expect(uploaded.status()).toBe(200)
	const source = Schema.decodeUnknownSync(SourceRecord)(await uploaded.json())
	const recorded = await request.post("/api/imports", {
		headers: { ...headers, "idempotency-key": "journey-record" },
		data: {
			source_id: source.id,
			item_key: "purchase",
			expected_source_revision: 1,
			expected_item_revision: null,
			kind: "record",
			transaction: {
				date: "2026-09-11",
				kind: "expense",
				amount_cents: 51595,
				currency: "USD",
				payee: "journey grocer",
				note: null,
				payment_reference: null,
				original_expense_id: null,
				allocations: [{ category_key: "Groceries", amount_cents: 51595 }],
			},
		},
	})
	expect(recorded.status()).toBe(200)
	const result = Schema.decodeUnknownSync(ImportResult)(await recorded.json())
	expect(result.status).toBe("recorded")
	await page.reload()
	const row = page.getByRole("row").filter({ has: page.getByText("groceries", { exact: true }) })
	await expect(row).toContainText("+$15.95")
	await row.getByRole("button").click()
	await page.getByRole("button", { name: "journey grocer", exact: true }).click()
	await expect(page.getByRole("link", { name: "receipt.txt", exact: false })).toBeVisible()
	const evidence = await request.get(`/api/sources/${source.id}/content`, {
		headers: { authorization: headers.authorization },
	})
	expect(await evidence.text()).toBe("groceries paid 515.95 usd")
	await page.screenshot({ path: testInfo.outputPath("history-desktop.png"), fullPage: true })
	await page.setViewportSize({ width: 390, height: 844 })
	await page.screenshot({ path: testInfo.outputPath("history-mobile.png"), fullPage: true })
})
