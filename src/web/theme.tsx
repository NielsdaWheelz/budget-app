import {
	type Accessor,
	type ParentProps,
	createContext,
	createEffect,
	createSignal,
	onCleanup,
	useContext,
} from "solid-js"

type Theme = "system" | "light" | "dark"

const ThemeContext = createContext<{ theme: Accessor<Theme>; setTheme: (t: Theme) => void }>()

function resolve(preference: Theme): "light" | "dark" {
	if (preference !== "system") return preference
	return window.matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light"
}

function apply(resolved: "light" | "dark") {
	document.documentElement.setAttribute("data-theme", resolved)
	document.documentElement.style.colorScheme = resolved
}

export function ThemeProvider(props: ParentProps) {
	const stored = localStorage.getItem("theme")
	const initial: Theme = stored === "light" || stored === "dark" ? stored : "system"
	const [theme, setThemeSignal] = createSignal<Theme>(initial)

	const setTheme = (t: Theme) => {
		setThemeSignal(t)
		localStorage.setItem("theme", t)
	}

	createEffect(() => {
		apply(resolve(theme()))
	})

	const mq = window.matchMedia("(prefers-color-scheme:dark)")
	const onchange = () => {
		if (theme() === "system") apply(resolve("system"))
	}
	mq.addEventListener("change", onchange)
	onCleanup(() => mq.removeEventListener("change", onchange))

	return <ThemeContext.Provider value={{ theme, setTheme }}>{props.children}</ThemeContext.Provider>
}

export function useTheme() {
	const ctx = useContext(ThemeContext)
	if (!ctx) throw new Error("useTheme must be used within ThemeProvider")
	return ctx
}
