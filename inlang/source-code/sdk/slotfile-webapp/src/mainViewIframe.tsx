import { useEffect, useState } from "react"
import { pluralBundle } from "../../src/v2/mocks/index.js"
import { randomHumanId } from "../../src/storage/human-id/human-readable-id.js"
import { createMessage, createMessageBundle } from "../../src/v2/helper.js"
import { MessageBundleList } from "./messageBundleListReact.js"
import { type InlangProject2, MessageBundle, getFs, loadProject } from "../../dist/v2/index.js"
import { SettingsView } from "./settingsView.js"
import * as Comlink from "comlink"

export const isInIframe = window.self !== window.top
const fs = getFs(Comlink.windowEndpoint(window.parent))
const repo = {
	nodeishFs: fs,
	getFirstCommitHash: () => "dummy_first_hash",
} as any

export function MainViewIframe({ projectPath }: { projectPath: string }) {
	const [currentProject, setCurrentProject] = useState<InlangProject2 | undefined>(undefined)

	useEffect(() => {
		loadProject({
			projectPath,
			repo: repo,
		}).then((project) => {
			setCurrentProject(project)
		})
	}, [])

	const [currentView, setCurrentView] = useState<"overview" | "messageList" | "settings">(
		"settings"
	)

	const insertNMessageBundles = async (project: InlangProject2, n: number) => {
		const messagesToAdd = [] as MessageBundle[]
		for (let i = 0; i < n; i++) {
			const newMessage = createMessage({
				locale: "de",
				text: "new",
			})

			const messageBundle = createMessageBundle({
				alias: {},
				messages: [newMessage],
			})
			messagesToAdd.push(messageBundle)
		}

		const messageBundles = project.messageBundleCollection
		if (n === 1) {
			const temp = structuredClone(pluralBundle)
			temp.id = randomHumanId()
			temp.messages[0].id = randomHumanId()
			temp.messages[1].id = randomHumanId()

			await messageBundles.insert(temp as any)
			return
		}

		console.time("inserting " + n + " messageBundles")

		await project.messageBundleCollection.bulkInsert(messagesToAdd)
		console.timeEnd("inserting " + n + " messageBundles")
	}

	return (
		<div>
			<h3>{isInIframe ? "inIframe" : "Fink 2"}</h3>
			<div>
				{currentProject && (
					<>
						<br />
						<h2>Actions</h2>
						Add Message Bundles
						<button
							style={{ marginLeft: 10 }}
							id="btnAdd1"
							onClick={() => {
								insertNMessageBundles(currentProject, 1)
							}}
						>
							+ 1{" "}
						</button>
						<button
							id="btnAdd100"
							onClick={() => {
								insertNMessageBundles(currentProject, 100)
							}}
						>
							+ 100{" "}
						</button>
						<button
							id="btnAdd1000"
							onClick={() => {
								insertNMessageBundles(currentProject, 1000)
							}}
						>
							+ 1000{" "}
						</button>
						<br />
						<div className="tab-container">
							<div
								className={`tab ${currentView === "overview" ? "active" : ""}`}
								onClick={() => setCurrentView("overview")}
							>
								Overview
							</div>
							<div
								className={`tab ${currentView === "messageList" ? "active" : ""}`}
								onClick={() => setCurrentView("messageList")}
							>
								MessageList
							</div>
							<div
								className={`tab ${currentView === "settings" ? "active" : ""}`}
								onClick={() => setCurrentView("settings")}
							>
								Settings
							</div>
						</div>
						{currentView === "settings" && (
							<SettingsView
								project={{
									projectPath: projectPath,
									inlangProject: currentProject,
								}}
							></SettingsView>
						)}
						{currentView === "messageList" && (
							<MessageBundleList project={currentProject}></MessageBundleList>
						)}
					</>
				)}
			</div>
		</div>
	)
}
