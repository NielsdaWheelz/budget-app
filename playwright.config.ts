import { defineConfig } from "@playwright/test"

export default defineConfig({
	testDir: "./tests",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	use: {
		baseURL: "http://127.0.0.1:4173",
		trace: "retain-on-failure",
	},
	projects: [
		{ name: "interface", testMatch: "**/*.browser.spec.ts" },
		{
			name: "journey",
			testMatch: "**/*.journey.spec.ts",
			use: { baseURL: "http://127.0.0.1:4174" },
		},
	],
	webServer: [
		{
			command: "bunx vite --host 127.0.0.1 --port 4173 --strictPort",
			url: "http://127.0.0.1:4173",
			reuseExistingServer: false,
		},
		{
			command: "bun tests/browser-server.ts",
			url: "http://127.0.0.1:4174",
			reuseExistingServer: false,
			gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
		},
	],
})
