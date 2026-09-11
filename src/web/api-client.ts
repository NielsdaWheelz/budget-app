import { Schema } from "effect"
import * as D from "../domain/history"
import * as H from "../shared/history-schemas"
import { AuthResult } from "../shared/schemas"

const ErrorBody = Schema.Struct({
	_tag: Schema.optional(Schema.String),
	message: Schema.String,
	issues: Schema.optional(
		Schema.Array(
			Schema.Struct({
				path: Schema.Array(Schema.Union(Schema.String, Schema.Number)),
				message: Schema.String,
			}),
		),
	),
})

export class ApiError extends Error {
	readonly status: number
	readonly _tag: string
	readonly issues: ReadonlyArray<{
		readonly path: ReadonlyArray<string | number>
		readonly message: string
	}>
	constructor(status: number, body: typeof ErrorBody.Type) {
		super(body.message)
		this.status = status
		this._tag = body._tag ?? "HttpError"
		this.issues = body.issues ?? []
	}
}

async function request<A, I>(
	path: string,
	schema: Schema.Schema<A, I>,
	options: RequestInit = {},
): Promise<A> {
	const response = await fetch(path, {
		...options,
		credentials: "include",
		headers: { "Content-Type": "application/json", ...options.headers },
	})
	if (!response.ok) {
		if (!response.headers.get("content-type")?.includes("application/json")) {
			throw new ApiError(response.status, { message: "the server could not complete this request" })
		}
		throw new ApiError(response.status, Schema.decodeUnknownSync(ErrorBody)(await response.json()))
	}
	if (response.status === 204) return Schema.decodeUnknownSync(schema)(undefined)
	return Schema.decodeUnknownSync(schema)(await response.json())
}

function search(path: string, params: Readonly<Record<string, string | number | undefined>>) {
	const query = new URLSearchParams()
	for (const [key, value] of Object.entries(params))
		if (value !== undefined) query.set(key, String(value))
	return `${path}?${query}`
}

function write<A, I>(
	path: string,
	schema: Schema.Schema<A, I>,
	{ body, key }: { body: unknown; key: string },
	method = "POST",
) {
	return request(path, schema, {
		method,
		headers: { "idempotency-key": key },
		body: JSON.stringify(body),
	})
}

export const authApi = {
	me: async () => {
		try {
			return await request("/api/auth/me", AuthResult)
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) return null
			throw error
		}
	},
	register: (email: string, password: string) =>
		request("/api/auth/register", AuthResult, {
			method: "POST",
			body: JSON.stringify({ email, password }),
		}),
	login: (email: string, password: string) =>
		request("/api/auth/login", AuthResult, {
			method: "POST",
			body: JSON.stringify({ email, password }),
		}),
	logout: () => request("/api/auth/logout", Schema.Void, { method: "POST" }),
}

export const historyApi = {
	catalog: () => request("/api/catalog", H.HistoryCatalog),
	planner: async () => {
		try {
			return await request("/api/planner", H.PlannerRecord)
		} catch (error) {
			if (error instanceof ApiError && error.status === 404) return null
			throw error
		}
	},
	savePlanner: (args: { body: typeof H.PlannerSave.Encoded; key: string }) =>
		write("/api/planner", H.PlannerRecord, args, "PUT"),
	plan: async (month: string) => {
		try {
			return await request(`/api/plans/${encodeURIComponent(month)}`, H.MonthPlanRecord)
		} catch (error) {
			if (error instanceof ApiError && error.status === 404) return null
			throw error
		}
	},
	savePlan: (args: { month: string; body: typeof H.MonthPlanSave.Encoded; key: string }) =>
		write(`/api/plans/${encodeURIComponent(args.month)}`, H.MonthPlanRecord, args, "PUT"),
	report: (query: typeof H.ReportQuery.Encoded) =>
		request(search("/api/reports", query), D.HistoryReport),
	transactions: (query: typeof H.TransactionListQuery.Encoded) =>
		request(search("/api/transactions", query), H.TransactionPage),
	transaction: (id: string) =>
		request(`/api/transactions/${encodeURIComponent(id)}`, H.TransactionRecord),
	saveTransaction: (args: {
		id: string | null
		body: typeof H.TransactionCreate.Encoded | typeof H.TransactionUpdate.Encoded
		key: string
	}) =>
		args.id === null
			? write("/api/transactions", H.TransactionRecord, args)
			: write(`/api/transactions/${encodeURIComponent(args.id)}`, H.TransactionRecord, args, "PUT"),
	sources: (query: typeof H.SourceListQuery.Encoded) =>
		request(search("/api/sources", query), H.SourcePage),
	source: ({ id, ...query }: { id: string } & typeof H.SourceDetailQuery.Encoded) =>
		request(search(`/api/sources/${encodeURIComponent(id)}`, query), H.SourceDetail),
	uploadSource: (args: { body: typeof H.SourceUpload.Encoded; key: string }) =>
		write("/api/sources", H.SourceRecord, args),
	completeSource: (args: { id: string; body: typeof H.SourceComplete.Encoded; key: string }) =>
		write(`/api/sources/${encodeURIComponent(args.id)}/complete`, H.SourceRecord, args),
	importItem: (args: { body: typeof H.ImportCommand.Encoded; key: string }) =>
		write("/api/imports", H.ImportResult, args),
	changes: (query: typeof H.ChangesQuery.Encoded) =>
		request(search("/api/changes", query), H.ChangePage),
	command: (key: string) => request(`/api/commands/${encodeURIComponent(key)}`, H.CommandOutcome),
	sourceContentUrl: (id: string) => `/api/sources/${encodeURIComponent(id)}/content`,
}
