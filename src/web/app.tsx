import {
	A,
	Navigate,
	Route,
	type RouteSectionProps,
	Router,
	createAsync,
	revalidate,
} from "@solidjs/router"
import { ErrorBoundary, Show, Suspense, createSignal } from "solid-js"
import { Toaster } from "solid-sonner"
import { authApi } from "./api-client"
import { AuthForm } from "./components/auth-form"
import { SegmentedControl } from "./components/segmented-control"
import { loadPlanner, loadSession } from "./data"
import { EvidenceInbox, inboxPreload } from "./evidence-inbox"
import { apiErrorMessage } from "./helpers/error-message"
import { HistoryPage, historyPreload } from "./history"
import { hasPendingWrite } from "./hooks/use-pending-write"
import { PlannerPage } from "./planner"
import { ThemeProvider, useTheme } from "./theme"
import "./history.css"

function Shell(props: RouteSectionProps) {
	const session = createAsync(() => loadSession())
	const { theme, setTheme } = useTheme()
	const [error, setError] = createSignal<string | null>(null)
	const logout = async () => {
		setError(null)
		try {
			await authApi.logout()
			await revalidate()
		} catch (error) {
			setError(apiErrorMessage(error))
		}
	}
	return (
		<ErrorBoundary
			fallback={(error, reset) => (
				<main class="budget-workspace">
					<h1>budget</h1>
					<p role="alert" class="error">
						couldn't load your session. {apiErrorMessage(error)}
					</p>
					<button
						type="button"
						onClick={() => {
							void revalidate(loadSession.key)
							reset()
						}}
					>
						retry
					</button>
				</main>
			)}
		>
			<Suspense
				fallback={
					<main class="budget-workspace">
						<output>loading budget…</output>
					</main>
				}
			>
				<Show
					when={session()}
					fallback={
						<AuthForm
							onAuth={() => {
								void revalidate()
							}}
						/>
					}
				>
					<main class="budget-workspace">
						<header>
							<div class="topline">
								<h1>budget</h1>
								<div class="toolbar">
									<SegmentedControl
										options={[
											{ value: "system", label: "system" },
											{ value: "light", label: "light" },
											{ value: "dark", label: "dark" },
										]}
										value={theme()}
										onChange={setTheme}
									/>
									<button type="button" onClick={logout} disabled={hasPendingWrite()}>
										log out
									</button>
								</div>
							</div>
							<nav aria-label="main">
								<A href="/planner">planner</A>
								<A href="/history">history</A>
								<A href="/inbox">inbox</A>
							</nav>
						</header>
						<Show when={error()}>
							<p role="alert" class="error">
								{error()}
							</p>
						</Show>
						<ErrorBoundary
							fallback={(error, reset) => (
								<section class="panel">
									<h2>couldn't load this view</h2>
									<p role="alert" class="error">
										{apiErrorMessage(error)}
									</p>
									<button
										type="button"
										onClick={() => {
											void revalidate()
											reset()
										}}
									>
										retry
									</button>
								</section>
							)}
						>
							<Suspense fallback={<output>loading…</output>}>{props.children}</Suspense>
						</ErrorBoundary>
					</main>
				</Show>
			</Suspense>
		</ErrorBoundary>
	)
}

export function App() {
	return (
		<ThemeProvider>
			<Toaster position="bottom-right" />
			<Router>
				<Route path="/" component={Shell} preload={() => loadSession()}>
					<Route path="/" component={() => <Navigate href="/planner" />} />
					<Route
						path="/planner"
						component={PlannerPage}
						preload={async () => {
							if (await loadSession()) await loadPlanner()
						}}
					/>
					<Route path="/history" component={HistoryPage} preload={historyPreload} />
					<Route path="/inbox" component={EvidenceInbox} preload={inboxPreload} />
					<Route
						path="*rest"
						component={() => (
							<section class="panel">
								<h2>page not found</h2>
								<A href="/planner">open planner</A>
							</section>
						)}
					/>
				</Route>
			</Router>
		</ThemeProvider>
	)
}
