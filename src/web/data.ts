import { query } from "@solidjs/router"
import { authApi, historyApi } from "./api-client"

export const loadSession = query(() => authApi.me(), "session")
export const loadCatalog = query(() => historyApi.catalog(), "catalog")
export const loadPlanner = query(() => historyApi.planner(), "planner")
export const loadPlan = query((month: string) => historyApi.plan(month), "month-plan")
export const loadReport = query(
	(args: Parameters<typeof historyApi.report>[0]) => historyApi.report(args),
	"report",
)
export const loadTransactions = query(
	(args: Parameters<typeof historyApi.transactions>[0]) => historyApi.transactions(args),
	"transactions",
)
export const loadTransaction = query((id: string) => historyApi.transaction(id), "transaction")
export const loadSources = query(
	(args: Parameters<typeof historyApi.sources>[0]) => historyApi.sources(args),
	"sources",
)
export const loadSource = query(
	(args: Parameters<typeof historyApi.source>[0]) => historyApi.source(args),
	"source",
)
export const loadChanges = query(
	(args: Parameters<typeof historyApi.changes>[0]) => historyApi.changes(args),
	"changes",
)
