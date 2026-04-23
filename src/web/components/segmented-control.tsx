import { For } from "solid-js"

interface SegmentedControlProps<T extends string> {
	readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>
	readonly value: T
	readonly onChange: (value: T) => void
}

export function SegmentedControl<T extends string>(props: SegmentedControlProps<T>) {
	return (
		<div
			style={{
				display: "flex",
				background: "#f5f5f5",
				"border-radius": "8px",
				padding: "2px",
			}}
		>
			<For each={props.options}>
				{(option) => (
					<button
						type="button"
						onClick={() => props.onChange(option.value)}
						style={{
							background: props.value === option.value ? "#2563eb" : "transparent",
							color: props.value === option.value ? "#ffffff" : "#737373",
							"font-weight": props.value === option.value ? "500" : "400",
							"border-radius": "6px",
							padding: "6px 16px",
							"font-size": "13px",
							cursor: "pointer",
							border: "none",
							"font-family": "Inter, sans-serif",
							transition: "background-color 150ms ease",
						}}
					>
						{option.label}
					</button>
				)}
			</For>
		</div>
	)
}
