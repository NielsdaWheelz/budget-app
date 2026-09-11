import { Option } from "effect"
import { type Component, Show, createSignal, createUniqueId } from "solid-js"
import { parseMoney } from "../../domain/money"
import { centsToDecimal, formatCurrency } from "../helpers/format"

interface InlineEditProps {
	readonly value: number
	readonly onCommit: (cents: number) => void
	readonly disabled?: boolean | undefined
	readonly label?: string | undefined
}

export const InlineEdit: Component<InlineEditProps> = (props) => {
	const [editing, setEditing] = createSignal(false)
	const [text, setText] = createSignal("")
	const [error, setError] = createSignal<string | null>(null)
	const id = createUniqueId()
	const commit = () => {
		const parsed = parseMoney(text())
		if (Option.isNone(parsed)) {
			setError("enter a dollar amount with no more than two decimal places.")
			return
		}
		props.onCommit(parsed.value)
		setEditing(false)
		setError(null)
	}
	return (
		<Show
			when={editing()}
			fallback={
				<button
					type="button"
					disabled={props.disabled}
					aria-label={`edit ${props.label ?? "amount"}: ${formatCurrency(props.value)}`}
					onClick={() => {
						setText(centsToDecimal(props.value))
						setError(null)
						setEditing(true)
					}}
					style={{
						background: "none",
						border: "none",
						padding: "0",
						color: "inherit",
						"font-size": "inherit",
						"font-variant-numeric": "tabular-nums",
						cursor: "pointer",
					}}
				>
					{formatCurrency(props.value)}
				</button>
			}
		>
			<span>
				<input
					id={id}
					aria-label={props.label ?? "amount"}
					aria-invalid={error() !== null}
					aria-describedby={error() ? `${id}-error` : undefined}
					inputmode="decimal"
					value={text()}
					ref={(el) =>
						requestAnimationFrame(() => {
							el.focus()
							el.select()
						})
					}
					onInput={(event) => setText(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault()
							commit()
						}
						if (event.key === "Escape") {
							event.preventDefault()
							setEditing(false)
						}
					}}
					style={{ width: "110px", "text-align": "right" }}
				/>
				<button type="button" onClick={commit}>
					apply
				</button>
				<button type="button" onClick={() => setEditing(false)}>
					cancel
				</button>
				<Show when={error()}>
					<span id={`${id}-error`} role="alert" class="error">
						{error()}
					</span>
				</Show>
			</span>
		</Show>
	)
}
