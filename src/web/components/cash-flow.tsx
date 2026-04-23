import { sankey, sankeyJustify, sankeyLinkHorizontal } from "d3-sankey"
import { type Component, For, createMemo, createSignal } from "solid-js"
import { computePercentageOfGross, formatCurrency, formatPercentage } from "../helpers/format"

interface DisplayedBudget {
	readonly grossIncome: number
	readonly takeHomePay: number
	readonly deductions: {
		readonly federalIncomeTax: number
		readonly stateIncomeTax: number
		readonly socialSecurity: number
		readonly medicare: number
		readonly healthInsurance: number
		readonly rentersInsurance: number
	}
	readonly categories: ReadonlyArray<{ readonly subtotal: number }>
	readonly savings: number
}

interface CashFlowProps {
	readonly displayed: DisplayedBudget
}

interface SankeyNode {
	name: string
	color: string
}

interface SankeyLink {
	source: number
	target: number
	value: number
}

const WIDTH = 688
const HEIGHT = 400
const NODE_WIDTH = 16
const NODE_PADDING = 14

const NODES: ReadonlyArray<{ name: string; color: string }> = [
	// Layer 0: Source
	{ name: "Gross Income", color: "var(--color-flow-income)" },
	// Layer 1: Deductions + Net
	{ name: "Federal Tax", color: "var(--color-flow-deductions)" },
	{ name: "CA State Tax", color: "var(--color-flow-deductions)" },
	{ name: "Social Security", color: "var(--color-flow-deductions)" },
	{ name: "Medicare", color: "var(--color-flow-deductions)" },
	{ name: "Health Insurance", color: "var(--color-flow-deductions)" },
	{ name: "Renter's Insurance", color: "var(--color-flow-deductions)" },
	{ name: "Take-Home Pay", color: "var(--color-flow-income)" },
	// Layer 2: Allocation
	{ name: "Fixed Expenses", color: "var(--color-flow-fixed)" },
	{ name: "Variable Expenses", color: "var(--color-flow-variable)" },
	{ name: "Discretionary", color: "var(--color-flow-discretionary)" },
	{ name: "Savings", color: "var(--color-flow-savings)" },
]

// Node indices
const GROSS = 0
const FED_TAX = 1
const STATE_TAX = 2
const SS = 3
const MEDICARE = 4
const HEALTH = 5
const RENTERS = 6
const TAKE_HOME = 7
const FIXED = 8
const VARIABLE = 9
const DISCRETIONARY = 10
const SAVINGS = 11

const pathGenerator = sankeyLinkHorizontal()

export const CashFlowDiagram: Component<CashFlowProps> = (props) => {
	const [hoveredLink, setHoveredLink] = createSignal<number | null>(null)

	const layout = createMemo(() => {
		const d = props.displayed

		const links: SankeyLink[] = [
			{ source: GROSS, target: FED_TAX, value: Math.max(1, d.deductions.federalIncomeTax) },
			{ source: GROSS, target: STATE_TAX, value: Math.max(1, d.deductions.stateIncomeTax) },
			{ source: GROSS, target: SS, value: Math.max(1, d.deductions.socialSecurity) },
			{ source: GROSS, target: MEDICARE, value: Math.max(1, d.deductions.medicare) },
			{ source: GROSS, target: HEALTH, value: Math.max(1, d.deductions.healthInsurance) },
			{ source: GROSS, target: RENTERS, value: Math.max(1, d.deductions.rentersInsurance) },
			{ source: GROSS, target: TAKE_HOME, value: Math.max(1, d.takeHomePay) },
			{ source: TAKE_HOME, target: FIXED, value: Math.max(1, d.categories[0]?.subtotal ?? 0) },
			{
				source: TAKE_HOME,
				target: VARIABLE,
				value: Math.max(1, d.categories[1]?.subtotal ?? 0),
			},
			{
				source: TAKE_HOME,
				target: DISCRETIONARY,
				value: Math.max(1, d.categories[2]?.subtotal ?? 0),
			},
			{ source: TAKE_HOME, target: SAVINGS, value: Math.max(1, Math.max(0, d.savings)) },
		]

		// d3-sankey mutates input — build fresh copies each time
		const generator = sankey<SankeyNode, SankeyLink>()
			.nodeWidth(NODE_WIDTH)
			.nodePadding(NODE_PADDING)
			.nodeAlign(sankeyJustify)
			.extent([
				[0, 0],
				[WIDTH, HEIGHT],
			])

		return generator({
			nodes: NODES.map((n) => ({ ...n })),
			links: links.map((l) => ({ ...l })),
		})
	})

	const linkValue = (linkIndex: number): number => {
		const d = props.displayed
		const values = [
			d.deductions.federalIncomeTax,
			d.deductions.stateIncomeTax,
			d.deductions.socialSecurity,
			d.deductions.medicare,
			d.deductions.healthInsurance,
			d.deductions.rentersInsurance,
			d.takeHomePay,
			d.categories[0]?.subtotal ?? 0,
			d.categories[1]?.subtotal ?? 0,
			d.categories[2]?.subtotal ?? 0,
			Math.max(0, d.savings),
		]
		return values[linkIndex] ?? 0
	}

	return (
		<div
			style={{
				background: "var(--color-bg-card)",
				border: "1px solid var(--color-border)",
				"border-radius": "12px",
				padding: "16px 20px",
				"margin-bottom": "12px",
				"font-family": "Inter, sans-serif",
			}}
		>
			<div
				style={{
					"font-size": "16px",
					"font-weight": "600",
					color: "var(--color-text)",
					"margin-bottom": "12px",
				}}
			>
				Cash Flow
			</div>
			<svg
				viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
				style={{ width: "100%", height: "auto" }}
				role="img"
				aria-label="Cash flow from gross income through deductions and expenses to savings"
			>
				{/* Links */}
				<For each={layout().links}>
					{(link, i) => {
						// justify-type-assertion: d3-sankey populates source/target as node objects after layout
						const sourceNode = link.source as unknown as SankeyNode & { color: string }
						return (
							<path
								d={pathGenerator(link) ?? ""}
								fill={sourceNode.color}
								fill-opacity={hoveredLink() === i() ? 0.5 : 0.25}
								stroke="none"
								style={{ transition: "fill-opacity 0.15s", cursor: "pointer" }}
								onMouseEnter={() => setHoveredLink(i())}
								onMouseLeave={() => setHoveredLink(null)}
							>
								<title>
									{/* justify-type-assertion: d3-sankey populates source/target as node objects after layout */}
									{(link.source as unknown as SankeyNode).name}
									{" → "}
									{(link.target as unknown as SankeyNode).name}
									{": "}
									{formatCurrency(linkValue(i()))}
									{" ("}
									{formatPercentage(
										computePercentageOfGross(linkValue(i()), props.displayed.grossIncome),
									)}
									{")"}
								</title>
							</path>
						)
					}}
				</For>

				{/* Nodes */}
				<For each={layout().nodes}>
					{(node) => {
						const x0 = node.x0 ?? 0
						const x1 = node.x1 ?? 0
						const y0 = node.y0 ?? 0
						const y1 = node.y1 ?? 0
						const isLeftSide = x0 < WIDTH / 2

						return (
							<g
								aria-label={`${node.name}: ${formatCurrency(
									(node.value ?? 0) === 1 ? 0 : (node.value ?? 0),
								)}`}
							>
								<rect
									x={x0}
									y={y0}
									width={x1 - x0}
									height={Math.max(1, y1 - y0)}
									fill={node.color}
									rx={2}
								/>
								<text
									x={isLeftSide ? x1 + 8 : x0 - 8}
									y={(y0 + y1) / 2}
									dy="0.35em"
									text-anchor={isLeftSide ? "start" : "end"}
									fill="var(--color-text)"
									font-size="12"
									font-family="Inter, sans-serif"
								>
									{node.name}
								</text>
								<text
									x={isLeftSide ? x1 + 8 : x0 - 8}
									y={(y0 + y1) / 2 + 14}
									dy="0.35em"
									text-anchor={isLeftSide ? "start" : "end"}
									fill="var(--color-text-secondary)"
									font-size="11"
									font-family="Inter, sans-serif"
									font-variant-numeric="tabular-nums"
								>
									{formatCurrency((node.value ?? 0) === 1 ? 0 : (node.value ?? 0))}
								</text>
							</g>
						)
					}}
				</For>
			</svg>
		</div>
	)
}
