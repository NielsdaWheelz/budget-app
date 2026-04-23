import { type Component, Show, createSignal } from "solid-js"

interface InlineEditProps {
	readonly value: number
	readonly onCommit: (cents: number) => void
	readonly disabled?: boolean | undefined
}

const formatDisplay = (cents: number): string => {
	const dollars = Math.abs(cents) / 100
	return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const formatEditValue = (cents: number): string => {
	const dollars = Math.abs(cents) / 100
	return dollars.toFixed(2)
}

export const InlineEdit: Component<InlineEditProps> = (props) => {
	const [editing, setEditing] = createSignal(false)
	const [editValue, setEditValue] = createSignal("")

	const startEdit = () => {
		if (props.disabled) return
		setEditValue(formatEditValue(props.value))
		setEditing(true)
	}

	const commit = () => {
		const parsed = Number.parseFloat(editValue())
		if (!Number.isNaN(parsed)) {
			const cents = Math.round(parsed * 100)
			props.onCommit(cents)
		}
		setEditing(false)
	}

	const cancel = () => {
		setEditing(false)
	}

	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Enter") {
			commit()
		} else if (e.key === "Escape") {
			cancel()
		}
	}

	return (
		<Show
			when={editing()}
			fallback={
				<button
					type="button"
					onClick={startEdit}
					disabled={props.disabled}
					style={{
						cursor: props.disabled ? "default" : "pointer",
						"font-family": "Inter, sans-serif",
						"font-variant-numeric": "tabular-nums",
						background: "none",
						border: "none",
						padding: "0",
						"font-size": "inherit",
						color: "inherit",
					}}
				>
					{formatDisplay(props.value)}
				</button>
			}
		>
			<input
				ref={(el) => {
					requestAnimationFrame(() => {
						el.focus()
						el.select()
					})
				}}
				type="text"
				value={editValue()}
				onInput={(e) => setEditValue(e.currentTarget.value)}
				onBlur={commit}
				onKeyDown={onKeyDown}
				style={{
					"text-align": "right",
					"font-variant-numeric": "tabular-nums",
					"font-family": "Inter, sans-serif",
					"font-size": "inherit",
					border: "1px solid #e5e5e5",
					"border-radius": "4px",
					padding: "2px 6px",
					outline: "none",
					width: "100px",
				}}
			/>
		</Show>
	)
}
