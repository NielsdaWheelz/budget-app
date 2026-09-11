import { useBeforeLeave } from "@solidjs/router"
import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js"

const [pendingWrites, setPendingWrites] = createSignal(0)
export const hasPendingWrite = () => pendingWrites() > 0

export function usePendingWrite({
	pending,
	onBlocked,
	onPendingChange,
	busy = pending,
}: {
	pending: Accessor<boolean>
	onBlocked: (message: string) => void
	onPendingChange?: ((pending: boolean) => void) | undefined
	busy?: Accessor<boolean>
}) {
	useBeforeLeave((event) => {
		if (!pending()) return
		event.preventDefault()
		onBlocked("resolve this save with the same request before leaving. retry the pending action.")
	})
	createEffect(() => {
		onPendingChange?.(pending())
		if (!pending()) return
		const warn = (event: BeforeUnloadEvent) => event.preventDefault()
		window.addEventListener("beforeunload", warn)
		onCleanup(() => {
			window.removeEventListener("beforeunload", warn)
		})
	})
	createEffect(() => {
		if (!busy()) return
		setPendingWrites((count) => count + 1)
		onCleanup(() => setPendingWrites((count) => count - 1))
	})
	onCleanup(() => onPendingChange?.(false))
}
