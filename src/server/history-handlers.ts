import { HttpApiBuilder, HttpServerRequest, HttpServerResponse, OpenApi } from "@effect/platform"
import { Effect } from "effect"
import { MAX_LABEL_LENGTH, MAX_TEXT_LENGTH, categories } from "../domain/history"
import {
	MAX_PAGE_SIZE,
	MAX_PROPOSAL_BYTES,
	MAX_REQUEST_BYTES,
	MAX_SOURCE_BYTES,
} from "../shared/history-schemas"
import { BudgetApi } from "./api"
import { CurrentUser } from "./auth"
import { historyStore } from "./history-store"

const commandContext = (key: string) =>
	Effect.gen(function* () {
		const { user_id, client, scope } = yield* CurrentUser
		const request = yield* HttpServerRequest.HttpServerRequest
		return {
			actor: { user_id, client, scope },
			key,
			method: request.method,
			target: request.url.split("?")[0] ?? request.url,
		}
	})

export const HistoryHandlersLayer = HttpApiBuilder.group(BudgetApi, "history", (handlers) =>
	handlers
		.handle("catalog", () =>
			Effect.succeed({
				currency: "USD" as const,
				categories,
				input_limits: {
					max_cents: Number.MAX_SAFE_INTEGER,
					max_source_bytes: MAX_SOURCE_BYTES,
					max_request_bytes: MAX_REQUEST_BYTES,
					max_page_size: MAX_PAGE_SIZE,
					max_label_length: MAX_LABEL_LENGTH,
					max_text_length: MAX_TEXT_LENGTH,
					max_proposal_bytes: MAX_PROPOSAL_BYTES,
				},
			}),
		)
		.handle("description", () => Effect.succeed(OpenApi.fromApi(BudgetApi)))
		.handle("planner", () =>
			Effect.flatMap(CurrentUser, (actor) => historyStore.getPlanner({ actor })),
		)
		.handle("savePlanner", ({ headers, payload }) =>
			Effect.gen(function* () {
				const context = yield* commandContext(headers["idempotency-key"])
				return (yield* historyStore.putPlanner({ context, input: payload })).body
			}),
		)
		.handle("plan", ({ path }) =>
			Effect.flatMap(CurrentUser, (actor) => historyStore.getPlan({ actor, month: path.month })),
		)
		.handle("savePlan", ({ path, headers, payload }) =>
			Effect.gen(function* () {
				const context = yield* commandContext(headers["idempotency-key"])
				return (yield* historyStore.putPlan({ context, month: path.month, input: payload })).body
			}),
		)
		.handle("report", ({ urlParams }) =>
			Effect.flatMap(CurrentUser, (actor) => historyStore.report({ actor, query: urlParams })),
		)
		.handle("transactions", ({ urlParams }) =>
			Effect.flatMap(CurrentUser, (actor) =>
				historyStore.listTransactions({ actor, query: urlParams }),
			),
		)
		.handle("transaction", ({ path }) =>
			Effect.flatMap(CurrentUser, (actor) => historyStore.getTransaction({ actor, id: path.id })),
		)
		.handle("createTransaction", ({ headers, payload }) =>
			Effect.gen(function* () {
				const context = yield* commandContext(headers["idempotency-key"])
				return (yield* historyStore.createTransaction({ context, input: payload })).body
			}),
		)
		.handle("updateTransaction", ({ path, headers, payload }) =>
			Effect.gen(function* () {
				const context = yield* commandContext(headers["idempotency-key"])
				return (yield* historyStore.updateTransaction({ context, id: path.id, input: payload }))
					.body
			}),
		)
		.handle("sources", ({ urlParams }) =>
			Effect.flatMap(CurrentUser, (actor) => historyStore.listSources({ actor, query: urlParams })),
		)
		.handle("source", ({ path, urlParams }) =>
			Effect.flatMap(CurrentUser, (actor) =>
				historyStore.getSource({ actor, id: path.id, query: urlParams }),
			),
		)
		.handleRaw("sourceContent", ({ path }) =>
			Effect.gen(function* () {
				const actor = yield* CurrentUser
				const source = yield* historyStore.getSourceContent({ actor, id: path.id })
				return HttpServerResponse.uint8Array(source.original, {
					headers: {
						"content-type": source.media_type,
						"content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(source.label).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`,
						"x-content-type-options": "nosniff",
						"cache-control": "no-store",
					},
				})
			}),
		)
		.handle("uploadSource", ({ headers, payload }) =>
			Effect.gen(function* () {
				const context = yield* commandContext(headers["idempotency-key"])
				return (yield* historyStore.createSource({ context, input: payload })).body
			}),
		)
		.handle("completeSource", ({ path, headers, payload }) =>
			Effect.gen(function* () {
				const context = yield* commandContext(headers["idempotency-key"])
				return (yield* historyStore.completeSource({ context, id: path.id, input: payload })).body
			}),
		)
		.handle("importItem", ({ headers, payload }) =>
			Effect.gen(function* () {
				const context = yield* commandContext(headers["idempotency-key"])
				return (yield* historyStore.importItem({ context, input: payload })).body
			}),
		)
		.handle("command", ({ path }) =>
			Effect.flatMap(CurrentUser, (actor) => historyStore.getCommand({ actor, key: path.key })),
		)
		.handle("changes", ({ urlParams }) =>
			Effect.flatMap(CurrentUser, (actor) => historyStore.listChanges({ actor, query: urlParams })),
		),
)
