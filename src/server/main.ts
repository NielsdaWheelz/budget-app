import { Duration, Redacted, Schema } from "effect"
import { makeApp } from "./app"
import { AuthenticationConfig } from "./auth"

const url = process.env.DATABASE_URL_UNPOOLED
if (!url) throw new Error("DATABASE_URL_UNPOOLED is required")

export default makeApp({
	database: { url: Redacted.make(url), ssl: true, connectTimeout: Duration.seconds(30) },
	authentication: Schema.decodeUnknownSync(AuthenticationConfig)({
		origin: process.env.BUDGET_ORIGIN,
		ownerEmail: process.env.BUDGET_OWNER_EMAIL,
		readTokenSha256: process.env.BUDGET_READ_TOKEN_SHA256,
		writeTokenSha256: process.env.BUDGET_WRITE_TOKEN_SHA256,
	}),
})
