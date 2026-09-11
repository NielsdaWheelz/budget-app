import { mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PgClient } from "@effect/sql-pg"

export async function startDatabase() {
	const binaries = Bun.spawnSync(["pg_config", "--bindir"])
	if (binaries.exitCode !== 0) throw new Error("postgres test binaries are unavailable")
	const bindir = binaries.stdout.toString().trim()
	const listener = createServer()
	await new Promise<void>((resolve, reject) => {
		listener.once("error", reject)
		listener.listen(0, "127.0.0.1", resolve)
	})
	const address = listener.address()
	await new Promise<void>((resolve, reject) =>
		listener.close((error) => (error ? reject(error) : resolve())),
	)
	if (!address || typeof address === "string") throw new Error("test port allocation failed")
	const port = address.port
	const directory = await mkdtemp(join(tmpdir(), "budget-history-test-"))
	const run = async (args: string[]) => {
		const process = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
		const [code, stdout, stderr] = await Promise.all([
			process.exited,
			new Response(process.stdout).text(),
			new Response(process.stderr).text(),
		])
		if (code !== 0) throw new Error(`test postgres command failed: ${stdout}\n${stderr}`)
	}
	const close = async () => {
		const status = Bun.spawnSync([join(bindir, "pg_ctl"), "-D", directory, "status"])
		if (status.exitCode === 0)
			await run([join(bindir, "pg_ctl"), "-D", directory, "-m", "immediate", "-w", "stop"])
		else if (status.exitCode !== 3 && status.exitCode !== 4)
			throw new Error("cannot determine whether test postgres stopped")
		await rm(directory, { recursive: true, force: true })
	}
	try {
		await run([
			join(bindir, "initdb"),
			"-D",
			directory,
			"-A",
			"trust",
			"-U",
			"postgres",
			"--no-locale",
		])
		await run([
			join(bindir, "pg_ctl"),
			"-D",
			directory,
			"-l",
			join(directory, "server.log"),
			"-o",
			`-h 127.0.0.1 -p ${port} -k ${directory}`,
			"-w",
			"start",
		])
	} catch (error) {
		await close()
		throw error
	}
	const config = { host: "127.0.0.1", port, username: "postgres", database: "postgres", ssl: false }
	return {
		config,
		layer: PgClient.layer(config),
		url: `postgres://postgres@127.0.0.1:${port}/postgres`,
		bindir,
		directory,
		close,
	}
}
