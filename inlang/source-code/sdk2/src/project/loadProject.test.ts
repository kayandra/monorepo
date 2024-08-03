import { expect, test } from "vitest"
import { newProject } from "./newProject.js"
import { loadProjectInMemory } from "./loadProjectInMemory.js"
import { generateBundleId } from "../bundle-id/bundle-id.js"
import { uuidv4 } from "@lix-js/sdk"

test("it should persist changes of bundles, messages, and variants to lix ", async () => {
	const file1 = await newProject()
	const project1 = await loadProjectInMemory({ blob: file1 })
	const bundle = await project1.db
		.insertInto("bundle")
		.values({
			id: generateBundleId(),
			// @ts-expect-error - manual stringification
			alias: JSON.stringify({ default: "bundle1" }),
		})
		.returning("id")
		.executeTakeFirstOrThrow()

	const message = await project1.db
		.insertInto("message")
		.values({
			id: uuidv4(),
			bundle_id: bundle.id,
			locale: "en",
			// @ts-expect-error - manual stringification
			declarations: "[]",
			// @ts-expect-error - manual stringification
			selectors: "[]",
		})
		.returning("id")
		.executeTakeFirstOrThrow()

	await project1.db
		.insertInto("variant")
		.values({
			id: uuidv4(),
			message_id: message.id,
			match: "exact",
			// @ts-expect-error - manual stringification
			pattern: "[]",
		})
		.execute()

	const file1AfterUpdates = await project1.toBlob()
	await project1.close()

	const project2 = await loadProjectInMemory({ blob: file1AfterUpdates })
	const bundles = await project2.db.selectFrom("bundle").select("id").execute()
	const messages = await project2.db.selectFrom("message").select("id").execute()
	const variants = await project2.db.selectFrom("variant").select("id").execute()
	expect(bundles.length).toBe(1)
	expect(messages.length).toBe(1)
	expect(variants.length).toBe(1)
})

test("get and set settings", async () => {
	const project = await loadProjectInMemory({ blob: await newProject() })
	const settings = project.settings.get()

	expect(settings["plugin.key"]).toBeUndefined()

	const copied = structuredClone(settings)
	copied["plugin.key"] = { test: "value" }
	await project.settings.set(copied)

	const updatedSettings = project.settings.get()
	expect(updatedSettings["plugin.key"]).toEqual({ test: "value" })
})
