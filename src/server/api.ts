import {
	HttpApi,
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiMiddleware,
	HttpApiSecurity,
} from "@effect/platform"
import { Context, Schema } from "effect"
import { AuthResult, BudgetState, LoginRequest, RegisterRequest } from "../shared/schemas"

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AuthError extends Schema.TaggedError<AuthError>()("AuthError", {
	message: Schema.String,
}) {}

export class ConflictError extends Schema.TaggedError<ConflictError>()("ConflictError", {
	message: Schema.String,
}) {}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

export const sessionSecurity = HttpApiSecurity.apiKey({
	key: "session",
	in: "cookie",
})

// ---------------------------------------------------------------------------
// Current user context (provided by auth middleware)
// ---------------------------------------------------------------------------

export class CurrentUser extends Context.Tag("CurrentUser")<
	CurrentUser,
	{ readonly userId: string; readonly email: string }
>() {}

// ---------------------------------------------------------------------------
// Auth middleware tag
// ---------------------------------------------------------------------------

export class AuthMiddleware extends HttpApiMiddleware.Tag<AuthMiddleware>()("AuthMiddleware", {
	failure: AuthError,
	provides: CurrentUser,
	security: { session: sessionSecurity },
}) {}

// ---------------------------------------------------------------------------
// API Groups
// ---------------------------------------------------------------------------

export class AuthGroup extends HttpApiGroup.make("auth")
	.add(
		HttpApiEndpoint.post("register", "/register")
			.setPayload(RegisterRequest)
			.addSuccess(AuthResult)
			.addError(ConflictError, { status: 409 }),
	)
	.add(
		HttpApiEndpoint.post("login", "/login")
			.setPayload(LoginRequest)
			.addSuccess(AuthResult)
			.addError(AuthError, { status: 401 }),
	)
	.add(HttpApiEndpoint.post("logout", "/logout").middleware(AuthMiddleware))
	.prefix("/auth") {}

export class BudgetGroup extends HttpApiGroup.make("budget")
	.add(HttpApiEndpoint.get("load", "/load").addSuccess(Schema.NullOr(BudgetState)))
	.add(HttpApiEndpoint.post("save", "/save").setPayload(BudgetState).addSuccess(Schema.Void))
	.middleware(AuthMiddleware)
	.prefix("/budget") {}

// ---------------------------------------------------------------------------
// Top-level API
// ---------------------------------------------------------------------------

export class BudgetApi extends HttpApi.make("BudgetApi")
	.add(AuthGroup)
	.add(BudgetGroup)
	.prefix("/api") {}
