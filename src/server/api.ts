import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform"
import { Schema } from "effect"
import * as D from "../domain/history"
import {
	ConflictError,
	ForbiddenError,
	NotFoundError,
	TooLargeError,
	UnauthorizedError,
	ValidationError,
} from "../shared/history-errors"
import * as H from "../shared/history-schemas"
import { AuthResult, LoginRequest, RegisterRequest } from "../shared/schemas"
import { AuthMiddleware } from "./auth"

const commandHeaders = Schema.Struct({
	"idempotency-key": Schema.NonEmptyTrimmedString.pipe(Schema.maxLength(200)),
})

export class AuthGroup extends HttpApiGroup.make("auth")
	.add(
		HttpApiEndpoint.post("register", "/register")
			.setPayload(RegisterRequest)
			.addSuccess(AuthResult),
	)
	.add(HttpApiEndpoint.post("login", "/login").setPayload(LoginRequest).addSuccess(AuthResult))
	.add(HttpApiEndpoint.post("logout", "/logout").addSuccess(Schema.Void).middleware(AuthMiddleware))
	.add(HttpApiEndpoint.get("me", "/me").addSuccess(AuthResult).middleware(AuthMiddleware))
	.prefix("/auth") {}

export class HistoryGroup extends HttpApiGroup.make("history")
	.add(HttpApiEndpoint.get("catalog", "/catalog").addSuccess(H.HistoryCatalog))
	.add(HttpApiEndpoint.get("description", "/openapi.json").addSuccess(Schema.Unknown))
	.add(HttpApiEndpoint.get("planner", "/planner").addSuccess(H.PlannerRecord))
	.add(
		HttpApiEndpoint.put("savePlanner", "/planner")
			.setHeaders(commandHeaders)
			.setPayload(H.PlannerSave)
			.addSuccess(H.PlannerRecord),
	)
	.add(
		HttpApiEndpoint.get("plan", "/plans/:month")
			.setPath(Schema.Struct({ month: D.CalendarMonth }))
			.addSuccess(H.MonthPlanRecord),
	)
	.add(
		HttpApiEndpoint.put("savePlan", "/plans/:month")
			.setPath(Schema.Struct({ month: D.CalendarMonth }))
			.setHeaders(commandHeaders)
			.setPayload(H.MonthPlanSave)
			.addSuccess(H.MonthPlanRecord),
	)
	.add(
		HttpApiEndpoint.get("report", "/reports")
			.setUrlParams(H.ReportQuery)
			.addSuccess(D.HistoryReport),
	)
	.add(
		HttpApiEndpoint.get("transactions", "/transactions")
			.setUrlParams(H.TransactionListQuery)
			.addSuccess(H.TransactionPage),
	)
	.add(
		HttpApiEndpoint.get("transaction", "/transactions/:id")
			.setPath(Schema.Struct({ id: D.TransactionId }))
			.addSuccess(H.TransactionRecord),
	)
	.add(
		HttpApiEndpoint.post("createTransaction", "/transactions")
			.setHeaders(commandHeaders)
			.setPayload(H.TransactionCreate)
			.addSuccess(H.TransactionRecord),
	)
	.add(
		HttpApiEndpoint.put("updateTransaction", "/transactions/:id")
			.setPath(Schema.Struct({ id: D.TransactionId }))
			.setHeaders(commandHeaders)
			.setPayload(H.TransactionUpdate)
			.addSuccess(H.TransactionRecord),
	)
	.add(
		HttpApiEndpoint.get("sources", "/sources")
			.setUrlParams(H.SourceListQuery)
			.addSuccess(H.SourcePage),
	)
	.add(
		HttpApiEndpoint.post("uploadSource", "/sources")
			.setHeaders(commandHeaders)
			.setPayload(H.SourceUpload)
			.addSuccess(H.SourceRecord),
	)
	.add(
		HttpApiEndpoint.get("source", "/sources/:id")
			.setPath(Schema.Struct({ id: H.SourceId }))
			.setUrlParams(H.SourceDetailQuery)
			.addSuccess(H.SourceDetail),
	)
	.add(
		HttpApiEndpoint.get("sourceContent", "/sources/:id/content")
			.setPath(Schema.Struct({ id: H.SourceId }))
			.addSuccess(HttpApiSchema.Uint8Array({ contentType: "application/octet-stream" })),
	)
	.add(
		HttpApiEndpoint.post("completeSource", "/sources/:id/complete")
			.setPath(Schema.Struct({ id: H.SourceId }))
			.setHeaders(commandHeaders)
			.setPayload(H.SourceComplete)
			.addSuccess(H.SourceRecord),
	)
	.add(
		HttpApiEndpoint.post("importItem", "/imports")
			.setHeaders(commandHeaders)
			.setPayload(H.ImportCommand)
			.addSuccess(H.ImportResult),
	)
	.add(
		HttpApiEndpoint.get("command", "/commands/:key")
			.setPath(Schema.Struct({ key: Schema.NonEmptyString }))
			.addSuccess(H.CommandOutcome),
	)
	.add(
		HttpApiEndpoint.get("changes", "/changes")
			.setUrlParams(H.ChangesQuery)
			.addSuccess(H.ChangePage),
	)
	.middleware(AuthMiddleware) {}

export class BudgetApi extends HttpApi.make("BudgetApi")
	.add(AuthGroup)
	.add(HistoryGroup)
	.addError(UnauthorizedError, { status: 401 })
	.addError(ForbiddenError, { status: 403 })
	.addError(NotFoundError, { status: 404 })
	.addError(ConflictError, { status: 409 })
	.addError(TooLargeError, { status: 413 })
	.addError(ValidationError, { status: 422 })
	.prefix("/api") {}
