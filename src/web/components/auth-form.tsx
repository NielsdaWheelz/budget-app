import { type Component, Show, createSignal } from "solid-js"
import { ApiError, authApi } from "../api-client"

interface AuthFormProps {
	readonly onAuth: () => void
}

export const AuthForm: Component<AuthFormProps> = (props) => {
	const [mode, setMode] = createSignal<"login" | "register">("login")
	const [email, setEmail] = createSignal("")
	const [password, setPassword] = createSignal("")
	const [error, setError] = createSignal<string | null>(null)
	const [fieldErrors, setFieldErrors] = createSignal<Record<string, string>>({})
	const [touched, setTouched] = createSignal<Set<string>>(new Set())
	const [loading, setLoading] = createSignal(false)

	const validate = (): Record<string, string> => {
		const errors: Record<string, string> = {}
		if (email().trim().length === 0) {
			errors.email = "Email is required"
		}
		if (mode() === "register") {
			if (password().length < 8) {
				errors.password = "Password must be at least 8 characters"
			}
		} else {
			if (password().length === 0) {
				errors.password = "Password is required"
			}
		}
		return errors
	}

	const validateField = (field: string) => {
		const errors = validate()
		setFieldErrors((prev) => {
			if (errors[field]) return { ...prev, [field]: errors[field] }
			const { [field]: _, ...rest } = prev
			return rest
		})
	}

	const handleBlur = (field: string) => {
		setTouched((prev) => new Set(prev).add(field))
		validateField(field)
	}

	const handleInput = (field: string, value: string) => {
		if (field === "email") setEmail(value)
		else setPassword(value)
		if (touched().has(field) && fieldErrors()[field]) {
			validateField(field)
		}
	}

	const submit = async (e: Event) => {
		e.preventDefault()
		setError(null)

		setTouched(new Set(["email", "password"]))
		const errors = validate()
		setFieldErrors(errors)
		if (Object.keys(errors).length > 0) return

		setLoading(true)
		try {
			if (mode() === "login") {
				await authApi.login(email(), password())
			} else {
				await authApi.register(email(), password())
			}
			props.onAuth()
		} catch (err) {
			if (err instanceof ApiError && err.issues.length > 0) {
				const serverFieldErrors: Record<string, string> = {}
				for (const issue of err.issues) {
					const field = String(issue.path[0] ?? "")
					if (field) serverFieldErrors[field] = issue.message
				}
				setFieldErrors(serverFieldErrors)
			} else {
				setError(err instanceof Error ? err.message : "An error occurred")
			}
		} finally {
			setLoading(false)
		}
	}

	const toggleMode = () => {
		setMode((m) => (m === "login" ? "register" : "login"))
		setError(null)
		setFieldErrors({})
		setTouched(new Set<string>())
	}

	const fieldErrorStyle = {
		color: "var(--color-danger, #dc2626)",
		"font-size": "12px",
		"margin-top": "4px",
		"margin-bottom": "12px",
		display: "block",
	}

	const inputStyle = (field: string) => ({
		width: "100%",
		padding: "8px 12px",
		"margin-bottom": fieldErrors()[field] ? "0" : "16px",
		border: `1px solid ${fieldErrors()[field] ? "var(--color-danger, #dc2626)" : "var(--color-border)"}`,
		"border-radius": "6px",
		"font-size": "14px",
		"font-family": "Inter, sans-serif",
		"background-color": "var(--color-bg)",
		color: "var(--color-text)",
		"box-sizing": "border-box" as const,
	})

	return (
		<div
			style={{
				display: "flex",
				"justify-content": "center",
				"align-items": "center",
				"min-height": "100vh",
				"font-family": "Inter, sans-serif",
			}}
		>
			<div
				style={{
					width: "100%",
					"max-width": "400px",
					padding: "32px",
					border: "1px solid var(--color-border)",
					"border-radius": "12px",
					"background-color": "var(--color-bg-card)",
				}}
			>
				<h2
					style={{
						"font-size": "20px",
						"font-weight": "600",
						color: "var(--color-text)",
						margin: "0 0 24px",
						"text-align": "center",
					}}
				>
					{mode() === "login" ? "Sign In" : "Create Account"}
				</h2>

				<Show when={error()}>
					<div
						role="alert"
						style={{
							padding: "10px 12px",
							"margin-bottom": "16px",
							"border-radius": "6px",
							"background-color": "var(--color-danger-bg, #fef2f2)",
							color: "var(--color-danger, #dc2626)",
							"font-size": "13px",
						}}
					>
						{error()}
					</div>
				</Show>

				<form onSubmit={submit} noValidate>
					<label
						for="auth-email"
						style={{
							display: "block",
							"font-size": "13px",
							"font-weight": "500",
							color: "var(--color-text-secondary)",
							"margin-bottom": "6px",
						}}
					>
						Email
					</label>
					<input
						id="auth-email"
						type="email"
						value={email()}
						onInput={(e) => handleInput("email", e.currentTarget.value)}
						onBlur={() => handleBlur("email")}
						aria-invalid={!!fieldErrors().email}
						aria-describedby={fieldErrors().email ? "auth-email-error" : undefined}
						style={inputStyle("email")}
					/>
					<Show when={fieldErrors().email}>
						<span id="auth-email-error" role="alert" style={fieldErrorStyle}>
							{fieldErrors().email}
						</span>
					</Show>

					<label
						for="auth-password"
						style={{
							display: "block",
							"font-size": "13px",
							"font-weight": "500",
							color: "var(--color-text-secondary)",
							"margin-bottom": "6px",
						}}
					>
						Password
					</label>
					<input
						id="auth-password"
						type="password"
						value={password()}
						onInput={(e) => handleInput("password", e.currentTarget.value)}
						onBlur={() => handleBlur("password")}
						aria-invalid={!!fieldErrors().password}
						aria-describedby={fieldErrors().password ? "auth-password-error" : undefined}
						style={inputStyle("password")}
					/>
					<Show when={fieldErrors().password}>
						<span id="auth-password-error" role="alert" style={fieldErrorStyle}>
							{fieldErrors().password}
						</span>
					</Show>

					<button
						type="submit"
						disabled={loading()}
						style={{
							width: "100%",
							padding: "10px",
							"margin-top": "8px",
							border: "none",
							"border-radius": "6px",
							"background-color": "var(--color-accent, #2563eb)",
							color: "#fff",
							"font-size": "14px",
							"font-weight": "500",
							"font-family": "Inter, sans-serif",
							cursor: loading() ? "not-allowed" : "pointer",
							opacity: loading() ? "0.7" : "1",
						}}
					>
						{loading() ? "Loading..." : mode() === "login" ? "Sign In" : "Create Account"}
					</button>
				</form>

				<p
					style={{
						"text-align": "center",
						"margin-top": "16px",
						"font-size": "13px",
						color: "var(--color-text-secondary)",
					}}
				>
					{mode() === "login" ? "Don't have an account? " : "Already have an account? "}
					<button
						type="button"
						onClick={toggleMode}
						style={{
							background: "none",
							border: "none",
							color: "var(--color-accent, #2563eb)",
							cursor: "pointer",
							"font-size": "13px",
							"font-family": "Inter, sans-serif",
							padding: "0",
							"text-decoration": "underline",
						}}
					>
						{mode() === "login" ? "Create Account" : "Sign In"}
					</button>
				</p>
			</div>
		</div>
	)
}
