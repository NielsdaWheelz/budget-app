import type { InvalidIncomeError } from "../../domain/tax"

export const budgetErrorMessage = (error: InvalidIncomeError): string => {
	switch (error._tag) {
		case "InvalidIncomeError":
			return "Please enter a valid income amount"
	}
}
