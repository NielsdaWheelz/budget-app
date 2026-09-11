import type { InvalidIncomeError } from "../../domain/tax"
import { ApiError } from "../api-client"

export const budgetErrorMessage = (error: InvalidIncomeError): string => {
	switch (error._tag) {
		case "InvalidIncomeError":
			return "please enter a valid income amount"
	}
}

export const apiErrorMessage = (error: unknown): string => {
	if (error instanceof ApiError) {
		if (error._tag === "UnauthorizedError") return "your session expired. sign in again."
		if (error._tag === "ConflictError")
			return `${error.message}. review the latest version before saving again.`
		if (error.issues.length > 0) return error.issues.map((issue) => issue.message).join("; ")
		return error.message
	}
	if (error instanceof TypeError) return "couldn't reach budget. retry the request."
	return "couldn't complete this request. try loading it again."
}
