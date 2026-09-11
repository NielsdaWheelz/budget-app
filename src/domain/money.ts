import { Brand, Option, Schema } from "effect"

export type Cents = number & Brand.Brand<"Cents">

export const CentsSchema = Schema.Int.pipe(Schema.brand("Cents"))

const cents = Brand.nominal<Cents>()

const checked = (value: number): Cents => {
	// justify-defect: owned arithmetic must never return an inexact monetary value.
	if (!Number.isSafeInteger(value)) throw new RangeError("amount exceeds safe integer cents")
	return cents(value)
}

export const ZERO: Cents = cents(0)

export const add = (a: Cents, b: Cents): Cents => checked(a + b)

export const subtract = (a: Cents, b: Cents): Cents => checked(a - b)

export const multiply = (amount: Cents, factor: number): Cents =>
	checked(Math.round(amount * factor))

export const sum = (values: ReadonlyArray<Cents>): Cents =>
	checked(Number(values.reduce((acc, value) => acc + BigInt(value), 0n)))

export const toYearly = (monthly: Cents): Cents => checked(monthly * 12)

export const toMonthly = (yearly: Cents): Cents => checked(Math.round(yearly / 12))

export const fromDollars = (dollars: number): Cents => checked(Math.round(dollars * 100))

export const parseMoney = (text: string): Option.Option<Cents> => {
	const value = text.trim()
	if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return Option.none()
	const [whole = "", fraction = ""] = value.split(".")
	const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))
	if (amount > BigInt(Number.MAX_SAFE_INTEGER)) return Option.none()
	return Option.some(cents(Number(amount)))
}
