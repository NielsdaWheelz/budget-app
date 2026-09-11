import { HttpApiBuilder, HttpApiError, HttpServer } from "@effect/platform"
import { PgClient } from "@effect/sql-pg"
import { Cause, Effect, Layer, Schema } from "effect"
import { ValidationError } from "../shared/history-errors"
import { MAX_REQUEST_BYTES } from "../shared/history-schemas"
import { BudgetApi } from "./api"
import { Authentication, type AuthenticationConfig } from "./auth"
import { HandlersLayer } from "./handlers"

export function makeApp({
	database,
	authentication,
}: {
	readonly database: PgClient.PgClientConfig
	readonly authentication: AuthenticationConfig
}) {
	const createHandler = () =>
		HttpApiBuilder.toWebHandler(
			HttpApiBuilder.api(BudgetApi).pipe(
				Layer.provide(HandlersLayer),
				Layer.provide(
					HttpApiBuilder.middleware(BudgetApi, (app) =>
						app.pipe(
							Effect.catchAllCause((cause) => {
								const error = Cause.squash(cause)
								return Schema.is(HttpApiError.HttpApiDecodeError)(error)
									? Effect.fail(
											new ValidationError({
												message: "the request does not match the required fields",
												issues: error.issues.map(({ path, message }) => ({
													path: path.map(String),
													message,
												})),
											}),
										)
									: Effect.failCause(cause)
							}),
						),
					),
				),
				Layer.provide(PgClient.layer(database)),
				Layer.provide(Layer.succeed(Authentication, authentication)),
				Layer.merge(HttpServer.layerContext),
			),
			{
				middleware: (app) =>
					app.pipe(
						// Do not log causes: database errors can contain receipt text or credentials.
						Effect.tapErrorCause(() =>
							Effect.logError("budget request failed; inspect the failing boundary"),
						),
					),
			},
		)

	let handler: ReturnType<typeof createHandler> | undefined
	return {
		dispose: () => handler?.dispose() ?? Promise.resolve(),
		fetch: async (request: Request): Promise<Response> => {
			let input = request
			if (request.body !== null) {
				const reader = request.body.getReader()
				const chunks: Uint8Array[] = []
				let size = 0
				while (true) {
					const chunk = await reader.read()
					if (chunk.done) break
					size += chunk.value.byteLength
					if (size > MAX_REQUEST_BYTES) {
						await reader.cancel()
						return Response.json(
							{ _tag: "TooLargeError", message: "request exceeds 3 mib" },
							{ status: 413 },
						)
					}
					chunks.push(chunk.value)
				}
				const body = Buffer.concat(chunks)
				if (body.byteLength > 0) {
					if (!request.headers.get("content-type")?.startsWith("application/json")) {
						return Response.json(
							{ _tag: "BadRequestError", message: "send application/json" },
							{ status: 400 },
						)
					}
					try {
						JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body))
					} catch {
						return Response.json(
							{ _tag: "BadRequestError", message: "invalid json" },
							{ status: 400 },
						)
					}
				}
				input = new Request(request.url, {
					method: request.method,
					headers: request.headers,
					body,
					signal: request.signal,
				})
			}
			// Initialization starts here so its rejection always has a request waiting for it.
			if (!handler) handler = createHandler()
			const current = handler
			let response: Response
			try {
				response = await current.handler(input)
			} catch {
				if (handler === current) {
					handler = undefined
					await current.dispose().catch(() => console.error("budget runtime cleanup failed"))
				}
				console.error("budget runtime initialization failed")
				return Response.json(
					{ _tag: "ServerError", message: "the server could not complete this request" },
					{ status: 500, headers: { "cache-control": "no-store" } },
				)
			}
			if (response.status >= 500) {
				return Response.json(
					{ _tag: "ServerError", message: "the server could not complete this request" },
					{ status: 500, headers: { "cache-control": "no-store" } },
				)
			}
			if (
				response.status === 404 &&
				!response.headers.get("content-type")?.includes("application/json")
			) {
				return Response.json(
					{ _tag: "NotFoundError", message: "resource not found" },
					{ status: 404, headers: { "cache-control": "no-store" } },
				)
			}
			response.headers.set("cache-control", "no-store")
			return response
		},
	}
}
