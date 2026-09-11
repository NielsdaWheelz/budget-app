import { expect, test } from "bun:test"
import { Schema } from "effect"
import { type Cents, CentsSchema, add, sum } from "./money"

test("cents reject unsafe integers and arithmetic overflow", () => {
	expect(Schema.is(CentsSchema)(Number.MAX_SAFE_INTEGER + 1)).toBe(false)
	expect(() => add(Number.MAX_SAFE_INTEGER as Cents, 1 as Cents)).toThrow()
})

test("sums preserve exact cancellation before checking the final range", () => {
	expect(sum([Number.MAX_SAFE_INTEGER, 2, -2] as Cents[])).toBe(Number.MAX_SAFE_INTEGER as Cents)
})
