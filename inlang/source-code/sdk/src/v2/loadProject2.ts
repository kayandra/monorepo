import type { Repository } from "@lix-js/client"
import type { ImportFunction } from "../resolve-modules/import.js"
import { assertValidProjectPath } from "../validateProjectPath.js"
import { normalizePath } from "@lix-js/fs"
import { maybeAddModuleCache } from "../migrations/maybeAddModuleCache.js"
import { createNodeishFsWithAbsolutePaths } from "../createNodeishFsWithAbsolutePaths.js"
import { maybeCreateFirstProjectId } from "../migrations/maybeCreateFirstProjectId.js"
import { loadSettings } from "./settings.js"
import type { InlangProject2 } from "./types/project.js"
import { MessageBundle, type LintReport, type Message } from "./types/index.js"

import { createRxDatabase, type RxCollection } from "rxdb"
import { getRxStorageMemory } from "rxdb/plugins/storage-memory"
import { BehaviorSubject } from "rxjs"
import { resolveModules } from "./resolveModules2.js"
import { createLintWorker } from "./lint/host.js"
import {
	createMessageBundleSlotAdapter,
	startReplication,
} from "./createMessageBundleSlotAdapter.js"
import createSlotStorageWriter from "../persistence/slotfiles/createSlotWriter.js"

/**
 *
 * Lifecycle of load Project:
 *
 * init - the async function has not yet returned
 * installing dependencies -
 *
 *
 * @param projectPath - Absolute path to the inlang settings file.
 * @param repo - An instance of a lix repo as returned by `openRepository`.
 * @param _import - Use `_import` to pass a custom import function for testing,
 *   and supporting legacy resolvedModules such as CJS.
 * @param appId - The app id to use for telemetry e.g "app.inlang.badge"
 *
 */
export async function loadProject(args: {
	projectPath: string
	repo: Repository
	appId?: string
	_import?: ImportFunction
}): Promise<InlangProject2> {
	// TODO SDK2 check if we need to use the new normalize path here
	const projectPath = normalizePath(args.projectPath)
	const messageBundlesPath = projectPath + "/messagebundles/"
	const messagesPath = projectPath + "/messages/"
	const settingsFilePath = projectPath + "/settings.json"
	const projectIdPath = projectPath + "/project_id"

	// -- validation --------------------------------------------------------
	// the only place where throwing is acceptable because the project
	// won't even be loaded. do not throw anywhere else. otherwise, apps
	// can't handle errors gracefully.
	assertValidProjectPath(projectPath)

	const nodeishFs = createNodeishFsWithAbsolutePaths({
		projectPath,
		nodeishFs: args.repo.nodeishFs,
	})

	await maybeAddModuleCache({ projectPath, repo: args.repo })
	await maybeCreateFirstProjectId({ projectPath, repo: args.repo })

	// no need to catch since we created the project ID with "maybeCreateFirstProjectId" earlier
	const projectId = await nodeishFs.readFile(projectIdPath, { encoding: "utf-8" })

	const projectSettings = await loadSettings({ settingsFilePath, nodeishFs })

	// @ts-ignore
	projectSettings.languageTags = projectSettings.locales
	// @ts-ignore
	projectSettings.sourceLanguageTag = projectSettings.baseLocale

	const projectSettings$ = new BehaviorSubject(projectSettings)

	const modules = await resolveModules({
		settings: projectSettings,
		nodeishFs,
		_import: args._import,
		projectPath,
	})
	const modules$ = new BehaviorSubject(modules)

	// rxdb with memory storage configured
	const database = await createRxDatabase<{
		messageBundles: RxCollection<MessageBundle>
	}>({
		name: "messageSdkDb",
		storage: getRxStorageMemory(),
		// deactivate inter browser tab optimization
		multiInstance: true,
		ignoreDuplicate: true,
	})

	// add the hero collection
	await database.addCollections({
		messageBundles: {
			schema: MessageBundle as any as typeof MessageBundle &
				Readonly<{ version: number; primaryKey: string; additionalProperties: false | undefined }>,
		},
	})

	const bundleStorage = await createSlotStorageWriter<MessageBundle>({
		fileNameCharacters: 3,
		slotsPerFile: 16 * 16 * 16 * 16,
		fs: nodeishFs,
		path: messageBundlesPath,
		watch: true,
	})

	const messageStorage = await createSlotStorageWriter<Message>({
		fileNameCharacters: 3,
		slotsPerFile: 16 * 16 * 16 * 16,
		fs: nodeishFs,
		path: messagesPath,
		watch: true,
	})

	const linter = await createLintWorker(projectPath, projectSettings.modules, nodeishFs)

	const lintReports$ = new BehaviorSubject<LintReport[]>([])
	const adapter = createMessageBundleSlotAdapter(
		bundleStorage,
		messageStorage,
		async (source, bundle) => {
			if (source === "adapter") {
				const lintresults = await linter.lint(projectSettings)
				lintReports$.next(lintresults)
				console.log(lintresults)
			}
		}
	)
	await startReplication(database.collections.messageBundles, adapter).awaitInitialReplication()

	// // linter.lint(projectSettings)

	// adapter.pullStream$.subscribe({
	// 	next: async () => {

	// 		console.log(lintresults)
	// 	},
	// })

	return {
		id: projectId,
		settings: projectSettings$,
		messageBundleCollection: database.collections.messageBundles,
		installed: {
			lintRules: [],
			plugins: [],
		},
		lintReports$,
		internal: {
			bundleStorage,
			messageStorage,
		},
	}
}
