import { Schema } from "effect"

export class RegisterRequest extends Schema.Class<RegisterRequest>("RegisterRequest")({
	email: Schema.compose(Schema.Trim, Schema.Lowercase).pipe(Schema.compose(Schema.NonEmptyString)),
	password: Schema.String.pipe(Schema.minLength(8)),
}) {}

export class LoginRequest extends Schema.Class<LoginRequest>("LoginRequest")({
	email: Schema.compose(Schema.Trim, Schema.Lowercase).pipe(Schema.compose(Schema.NonEmptyString)),
	password: Schema.String.pipe(Schema.minLength(1)),
}) {}

export class AuthResult extends Schema.Class<AuthResult>("AuthResult")({
	email: Schema.String,
}) {}

export class BudgetState extends Schema.Class<BudgetState>("BudgetState")({
	grossIncome: Schema.Number,
	healthInsurance: Schema.Number,
	rentersInsurance: Schema.Number,
	scenarioName: Schema.String,
	period: Schema.String,
	lineItemAmounts: Schema.Record({ key: Schema.String, value: Schema.Number }),
}) {}
