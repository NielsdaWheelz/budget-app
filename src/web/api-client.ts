import type { BudgetState } from "../shared/schemas"

export class ApiError extends Error {
	readonly status: number
	readonly issues: ReadonlyArray<{
		readonly path: ReadonlyArray<string | number>
		readonly message: string
	}>

	constructor(status: number, body: Record<string, unknown>) {
		super(typeof body.message === "string" ? body.message : `API error ${status}`)
		this.status = status
		this.issues = Array.isArray(body.issues) ? body.issues : []
	}
}

async function api(path: string, opts: RequestInit = {}): Promise<Response> {
	const res = await fetch(path, {
		...opts,
		headers: { "Content-Type": "application/json", ...opts.headers },
		credentials: "include",
	})
	if (!res.ok) {
		const body = await res.json().catch(() => ({}))
		throw new ApiError(res.status, body)
	}
	return res
}

export const authApi = {
	register: async (email: string, password: string) => {
		await api("/api/auth/register", {
			method: "POST",
			body: JSON.stringify({ email, password }),
		})
	},
	login: async (email: string, password: string) => {
		await api("/api/auth/login", {
			method: "POST",
			body: JSON.stringify({ email, password }),
		})
	},
	logout: () => api("/api/auth/logout", { method: "POST" }),
}

export const budgetApi = {
	load: async (): Promise<typeof BudgetState.Type | null> => {
		try {
			const res = await api("/api/budget/load")
			return await res.json()
		} catch {
			return null
		}
	},
	save: async (state: typeof BudgetState.Type) => {
		await api("/api/budget/save", {
			method: "POST",
			body: JSON.stringify(state),
		})
	},
}
