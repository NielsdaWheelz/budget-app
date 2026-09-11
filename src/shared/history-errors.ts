import { Schema } from "effect"

const fields = {
	message: Schema.String,
	issues: Schema.optional(
		Schema.Array(
			Schema.Struct({
				path: Schema.Array(Schema.Union(Schema.String, Schema.Number)),
				message: Schema.String,
			}),
		),
	),
}

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
	"UnauthorizedError",
	fields,
) {}
export class ForbiddenError extends Schema.TaggedError<ForbiddenError>()(
	"ForbiddenError",
	fields,
) {}
export class NotFoundError extends Schema.TaggedError<NotFoundError>()("NotFoundError", fields) {}
export class ConflictError extends Schema.TaggedError<ConflictError>()("ConflictError", fields) {}
export class ValidationError extends Schema.TaggedError<ValidationError>()(
	"ValidationError",
	fields,
) {}
export class TooLargeError extends Schema.TaggedError<TooLargeError>()("TooLargeError", fields) {}

export const HistoryError = Schema.Union(
	UnauthorizedError,
	ForbiddenError,
	NotFoundError,
	ConflictError,
	ValidationError,
	TooLargeError,
)
export type HistoryError = typeof HistoryError.Type
