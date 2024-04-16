import { Repository, findRepoRoot, openRepository } from "@lix-js/client"
import type { CliStep } from "../utils"
import { Command } from "commander"
import nodeFsPromises from "node:fs/promises"
import { NodeishFilesystem } from "@lix-js/fs"
import path from "node:path"
import { Logger } from "@inlang/paraglide-js/internal"
import { Steps } from "@inlang/paraglide-js/internal/cli"

type NextConfigFile = {
	path: string
	format: "js" | "mjs"
}

export const InitCommand = new Command()
	.name("init")
	.summary("Initializes Paraglide-JS in this NextJS Project")
	.action(async () => {
		const repoRoot = await findRepoRoot({ nodeishFs: nodeFsPromises, path: process.cwd() })

		// We are risking that there is no git repo. As long as we only use FS features and no Git features
		// from the SDK we should be fine.
		// Basic operations like `loadProject` should always work without a repo since it's used in CI.
		const repo = await openRepository(repoRoot ?? "file://" + process.cwd(), {
			nodeishFs: nodeFsPromises,
		})

		const logger = new Logger()

		const ctx0 = await Steps.checkForUncommittedChanges({
			repo,
			repoRoot: repoRoot || "file://" + process.cwd(),
			logger,
			appId: "library.inlang.paraglideJsAdapterNextJs",
		})
		const ctx1 = await findAndEnforceRequiredFiles(ctx0)
		const ctx2 = { ...ctx1, outdir: path.resolve(ctx1.srcRoot, "paraglide") }
		const ctx3 = await Steps.initializeInlangProject(ctx2)
		const ctx4 = await Steps.updatePackageJson({
			dependencies: async (deps) => ({
				...deps,
				"@inlang/paraglide-js-adapter-next": "^0.0.0",
			}),
			devDependencies: async (deps) => ({
				...deps,
				"@inlang/paraglide-js": "^0.0.0",
			}),
		})(ctx3)
		const ctx5 = await createI18nFile(ctx4)
		const ctx6 = await createMiddlewareFile(ctx5)

		try {
			await Steps.runCompiler(ctx6)
		} catch (e) {
			//silently ignore
		}

		logger.success(JSON.stringify({ nextConfigFile: ctx1.nextConfigFile }, undefined, 2))
	})

const findAndEnforceRequiredFiles: CliStep<
	{
		repo: Repository
		logger: Logger
	},
	{
		/** Absolute Path to the next.config.js or next.config.mjs */
		nextConfigFile: NextConfigFile
		packageJsonPath: string
		srcRoot: string
	}
> = async (ctx) => {
	const packageJsonPath = await findPackageJson(ctx.repo.nodeishFs, process.cwd())
	if (!packageJsonPath) {
		ctx.logger.error(`Could not find package.json. Rerun this command inside a NextJS project.`)
		process.exit(1)
	}

	const nextConfigFile = await findNextConfig(ctx.repo.nodeishFs, process.cwd())
	if (!nextConfigFile) {
		ctx.logger.error(`Could not find Next Config File. Rerun this command inside a NextJS project.`)
		process.exit(1)
	}

	// if the ./src directory exists -> srcRoot = ./src
	// otherwise -> srcRoot  = .

	let srcRoot
	try {
		const stat = await ctx.repo.nodeishFs.stat(path.resolve(process.cwd(), "src"))
		if (!stat.isDirectory()) throw Error()
		srcRoot = path.resolve(process.cwd(), "src")
	} catch {
		srcRoot = process.cwd()
	}

	return { ...ctx, srcRoot, nextConfigFile: nextConfigFile, packageJsonPath }
}

/**
 * Attempts to find the next.config.js or next.config.mjs file in the current working directory.
 */
async function findNextConfig(
	fs: NodeishFilesystem,
	cwd: string
): Promise<NextConfigFile | undefined> {
	const possibleNextConfigPaths = ["./next.config.js", "./next.config.mjs"].map(
		(possibleRelativePath) => path.resolve(cwd, possibleRelativePath)
	)

	for (const possibleNextConfigPath of possibleNextConfigPaths) {
		try {
			const stat = await fs.stat(possibleNextConfigPath)
			if (!stat.isFile()) continue

			const format = possibleNextConfigPath.endsWith(".mjs") ? "mjs" : "js"
			return { path: possibleNextConfigPath, format }
		} catch {
			continue
		}
	}

	return undefined
}

/**
 * Attempts to find the package.json file in the current working directory.
 */
async function findPackageJson(fs: NodeishFilesystem, cwd: string): Promise<string | undefined> {
	const potentialPackageJsonPath = path.resolve(cwd, "package.json")
	try {
		const stat = await fs.stat(potentialPackageJsonPath)
		if (!stat.isFile()) {
			return undefined
		}
		return potentialPackageJsonPath
	} catch {
		return undefined
	}
}

const createI18nFile: CliStep<{ srcRoot: string; repo: Repository }, unknown> = async (ctx) => {
	const i18nFilePath = path.join("lib/i18n.ts", ctx.srcRoot)
	const file = `// file generated by the Paraglide-Next init command
import { createI18n } from "@inlang/paraglide-js-adapter-next"
import type { AvailableLanguageTag } from "@/paraglide/runtime"

export const { Link, middleware, useRouter, usePathname, redirect, permanentRedirect, localizePath, } 
	= createI18n<AvailableLanguageTag>();
`
	await ctx.repo.nodeishFs.writeFile(i18nFilePath, file)
	return ctx
}

const createMiddlewareFile: CliStep<{ srcRoot: string; repo: Repository }, unknown> = async (
	ctx
) => {
	const i18nFilePath = path.join("middleware.ts", ctx.srcRoot)
	const file = `// file generated by the Paraglide-Next init command
export { middleware } from "@/lib/i18n"`
	await ctx.repo.nodeishFs.writeFile(i18nFilePath, file)
	return ctx
}

