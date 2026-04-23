import { Brand, Schema } from "effect"

export type Cents = number & Brand.Brand<"Cents">

export const CentsSchema = Schema.Int.pipe(Schema.brand("Cents"))

const cents = Brand.nominal<Cents>()

export const ZERO: Cents = cents(0)

export const add = (a: Cents, b: Cents): Cents => cents(a + b)

export const subtract = (a: Cents, b: Cents): Cents => cents(a - b)

export const negate = (a: Cents): Cents => cents(-a)

export const multiply = (amount: Cents, factor: number): Cents => cents(Math.round(amount * factor))

export const sum = (values: ReadonlyArray<Cents>): Cents =>
	cents(values.reduce((acc, v) => acc + v, 0))

export const toYearly = (monthly: Cents): Cents => cents(monthly * 12)

export const toMonthly = (yearly: Cents): Cents => cents(Math.round(yearly / 12))

export const fromDollars = (dollars: number): Cents => cents(Math.round(dollars * 100))
