import { Data } from "effect"
import { type Cents, toMonthly, toYearly } from "./money"

export class Monthly extends Data.TaggedClass("Monthly")<Record<string, never>> {}
export class Yearly extends Data.TaggedClass("Yearly")<Record<string, never>> {}

export type Period = Monthly | Yearly

export const projectCents = (cents: Cents, from: Period, to: Period): Cents => {
	if (from._tag === to._tag) return cents
	if (from._tag === "Monthly" && to._tag === "Yearly") return toYearly(cents)
	return toMonthly(cents)
}
