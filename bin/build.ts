import { cp, mkdir, rm, writeFile } from "node:fs/promises"
import { $ } from "bun"

const OUT = ".vercel/output"
const FN = `${OUT}/functions/api/handler.func`

await rm(OUT, { recursive: true, force: true })

await $`vite build`

await mkdir(`${FN}/api`, { recursive: true })
await $`bun build api/handler.ts --target=bun --outfile=${FN}/api/handler.js --sourcemap=inline`

await writeFile(
	`${FN}/.vc-config.json`,
	JSON.stringify(
		{
			handler: "api/handler.js",
			runtime: "bun1.x",
			launcherType: "Nodejs",
			shouldAddHelpers: true,
			shouldAddSourcemapSupport: true,
		},
		null,
		2,
	),
)

await mkdir(`${OUT}/static`, { recursive: true })
await cp("dist", `${OUT}/static`, { recursive: true })

await writeFile(
	`${OUT}/config.json`,
	JSON.stringify(
		{
			version: 3,
			routes: [
				{ handle: "filesystem" },
				{ src: "^/api(?:/(.*))$", dest: "/api/handler" },
				{ src: "^/api(/.*)?$", status: 404 },
				{ handle: "error" },
				{ status: 404, src: "^(?!/api).*$", dest: "/404.html" },
			],
		},
		null,
		2,
	),
)
