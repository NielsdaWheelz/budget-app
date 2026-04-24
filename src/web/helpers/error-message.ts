import type { InvalidIncomeError } from "../../domain/tax"

export const budgetErrorMessage = (error: InvalidIncomeError): string => {
	switch (error._tag) {
		case "InvalidIncomeError":
			return "Please enter a valid income amount"
	}
}

export const apiErrorMessage = (error: unknown): string => {
	if (error instanceof Error) return error.message
	return "An unexpected error occurred"
}
