import { type LineItem, LineItemKey } from "../domain/budget"
import { type Cents, fromDollars } from "../domain/money"

export const DEFAULT_GROSS_MONTHLY_INCOME: Cents = fromDollars(15000)

export const DEFAULT_HEALTH_INSURANCE: Cents = fromDollars(1000)

export const DEFAULT_RENTERS_INSURANCE: Cents = fromDollars(100)

export const BASE_LINE_ITEMS: ReadonlyArray<LineItem> = [
	// ── Fixed Expenses ──
	{
		key: LineItemKey("Rent"),
		label: "Rent / Mortgage",
		amount: fromDollars(3200),
		group: "FixedExpenses",
		editable: true,
	},
	{
		key: LineItemKey("Internet"),
		label: "Internet",
		amount: fromDollars(100),
		group: "FixedExpenses",
		editable: true,
	},
	{
		key: LineItemKey("Phone"),
		label: "Phone",
		amount: fromDollars(50),
		group: "FixedExpenses",
		editable: true,
	},

	// ── Variable Expenses ──
	{
		key: LineItemKey("Groceries"),
		label: "Groceries",
		amount: fromDollars(500),
		group: "VariableExpenses",
		editable: true,
	},
	{
		key: LineItemKey("Utilities"),
		label: "Utilities",
		amount: fromDollars(200),
		group: "VariableExpenses",
		editable: true,
	},
	{
		key: LineItemKey("Transportation"),
		label: "Transportation",
		amount: fromDollars(0),
		group: "VariableExpenses",
		editable: true,
	},
	{
		key: LineItemKey("Healthcare"),
		label: "Healthcare",
		amount: fromDollars(0),
		group: "VariableExpenses",
		editable: true,
	},
	{
		key: LineItemKey("PersonalCare"),
		label: "Personal Care",
		amount: fromDollars(50),
		group: "VariableExpenses",
		editable: true,
	},

	// ── Discretionary ──
	{
		key: LineItemKey("DiningOut"),
		label: "Dining Out",
		amount: fromDollars(200),
		group: "Discretionary",
		editable: true,
	},
	{
		key: LineItemKey("Entertainment"),
		label: "Entertainment",
		amount: fromDollars(300),
		group: "Discretionary",
		editable: true,
	},
	{
		key: LineItemKey("Fitness"),
		label: "Fitness",
		amount: fromDollars(130),
		group: "Discretionary",
		editable: true,
	},
	{
		key: LineItemKey("Subscriptions"),
		label: "Subscriptions",
		amount: fromDollars(40),
		group: "Discretionary",
		editable: true,
	},
	{
		key: LineItemKey("Shopping"),
		label: "Shopping",
		amount: fromDollars(0),
		group: "Discretionary",
		editable: true,
	},
	{
		key: LineItemKey("Travel"),
		label: "Travel",
		amount: fromDollars(1000),
		group: "Discretionary",
		editable: true,
	},
	{
		key: LineItemKey("GiftsDonations"),
		label: "Gifts & Donations",
		amount: fromDollars(0),
		group: "Discretionary",
		editable: true,
	},
]
