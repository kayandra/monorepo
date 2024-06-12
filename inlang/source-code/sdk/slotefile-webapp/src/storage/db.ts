import { createRxDatabase, addRxPlugin, RxReplicationPullStreamItem } from "rxdb"
import { RxDBQueryBuilderPlugin } from "rxdb/plugins/query-builder"
import { getRxStorageMemory } from "rxdb/plugins/storage-memory"
import { replicateRxCollection } from "rxdb/plugins/replication"
import createSlotStorage from "../../../src/persistence/slotfiles/createSlotStorage.js"
import { createNodeishMemoryFs } from "@lix-js/client"
import http from "isomorphic-git/http/web"
import { Subject } from "rxjs"

// NOTE: I use isomorphic git because i went crazy with cors :-/ was faster to spin up a iso proxy
import git, { pull, add, commit, push, statusMatrix } from "isomorphic-git"
const fs = createNodeishMemoryFs()

import { HeroDocType, HeroSchema, MyDatabaseCollections } from "./schema.js"

addRxPlugin(RxDBQueryBuilderPlugin)

// NOTE: All those properties are hardcoded for now - dont get crazy ;-) #POC
const gittoken = "YOUR_GITHUB_TOKEN_HERE"
const corsProxy = "http://localhost:9998" // cors Proxy expected to run - start it via pnpm run proxy
const repoUrl = "https://github.com/martin-lysk/db-records"
const dir = "/"

// path to the folder where the slotfiles for the collection will be stored
const collectionDir = dir + "slots3/"

const _create = async (fs: any) => {
	await git.clone({
		fs: fs,
		http,
		dir: dir,
		corsProxy: corsProxy,
		url: repoUrl,
		singleBranch: true,
		depth: 1,
	})

	// create a slot storage that informs rxdb via pullStream about changes in records
	const pullStream$ = new Subject<RxReplicationPullStreamItem<any, any>>()
	const storage = createSlotStorage<HeroDocType>(
		// use 65536 slots per slot file
		16 * 16 * 16 * 16,
		// delegate that allows to hook into change events in slot storage
		(eventType, upsertedSlotentries) => {
			// the event is invoked whenever the file storage detects changes on records (this can happen when the file change during pull or when a document is written)
			if (eventType === "records-change") {
				// whenever we have a change we put the documents into the pull stream
				pullStream$.next({
					// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- event api sucks atm - we know that we can expect slot entries in records-change event
					documents: upsertedSlotentries!.map((r) => r.data)!,
					// NOTE: we don't need to reconnect a collection at the moment - any checkpoint should work
					checkpoint: Date.now(),
				})
			}
		}
	)

	// connect the storage with the collection dir (will read all slot files and load all documents into memory)
	await storage.connect(fs, collectionDir)

	// rxdb with memory storage configured
	const database = await createRxDatabase<MyDatabaseCollections>({
		name: "rxdbdemo",
		storage: getRxStorageMemory(),
		password: "foooooobaaaaar",
		// deactivate inter browser tab optimization
		multiInstance: true,
		ignoreDuplicate: true,
	})

	// add the hero collection
	const collection = await database.addCollections({ heroes: { schema: HeroSchema } })

	// now setup the replication for the hero collection - i kept comments from https://rxdb.info/replication.html
	// important code sits in:
	// push - called when documents are updated in rxDb and upsers docs in slot storage
	// pull - only used initially to load all records from slots to rx db (this POC - does not implement the disconnect/reconnect state - may be usefull for branch switches)
	// streams$ - the observable we pipe changes within slotstorage to rxDB - when we pull and files change
	const replicationState = await replicateRxCollection({
		collection: collection.heroes,
		/**
		 * An id for the replication to identify it
		 * and so that RxDB is able to resume the replication on app reload.
		 * If you replicate with a remote server, it is recommended to put the
		 * server url into the replicationIdentifier.
		 */
		replicationIdentifier: "my-rest-replication-to-https://example.com/api/sync",
		/**
		 * By default it will do an ongoing realtime replication.
		 * By settings live: false the replication will run once until the local state
		 * is in sync with the remote state, then it will cancel itself.
		 * (optional), default is true.
		 */
		live: true,
		/**
		 * Time in milliseconds after when a failed backend request
		 * has to be retried.
		 * This time will be skipped if a offline->online switch is detected
		 * via navigator.onLine
		 * (optional), default is 5 seconds.
		 */
		retryTime: 5 * 1000,
		/**
		 * When multiInstance is true, like when you use RxDB in multiple browser tabs,
		 * the replication should always run in only one of the open browser tabs.
		 * If waitForLeadership is true, it will wait until the current instance is leader.
		 * If waitForLeadership is false, it will start replicating, even if it is not leader.
		 * [default=true]
		 */
		waitForLeadership: false,
		/**
		 * If this is set to false,
		 * the replication will not start automatically
		 * but will wait for replicationState.start() being called.
		 * (optional), default is true
		 */
		autoStart: true,

		/**
		 * Custom deleted field, the boolean property of the document data that
		 * marks a document as being deleted.
		 * If your backend uses a different fieldname then '_deleted', set the fieldname here.
		 * RxDB will still store the documents internally with '_deleted', setting this field
		 * only maps the data on the data layer.
		 *
		 * If a custom deleted field contains a non-boolean value, the deleted state
		 * of the documents depends on if the value is truthy or not. So instead of providing a boolean * * deleted value, you could also work with using a 'deletedAt' timestamp instead.
		 *
		 * [default='_deleted']
		 */
		deletedField: "deleted",

		/**
		 * Optional,
		 * only needed when you want to replicate local changes to the remote instance.
		 */
		push: {
			/**
			 * Push handler
			 */
			async handler(docs) {
				for (const doc of docs) {
					const upsertedDocument = doc.newDocumentState as unknown as HeroDocType
					const existingDocument = storage.findDocumentsById([upsertedDocument.id!])
					if (existingDocument.length === 0) {
						await storage.insert(upsertedDocument)
					} else {
						await storage.update(upsertedDocument)
					}
				}

				// for the Demo we commit on every document change
				await commitChanges()

				return []
			},
			/**
			 * Batch size, optional
			 * Defines how many documents will be given to the push handler at once.
			 */
			// batchSize: 5,
			/**
			 * Modifies all documents before they are given to the push handler.
			 * Can be used to swap out a custom deleted flag instead of the '_deleted' field.
			 * If the push modifier return null, the document will be skipped and not send to the remote.
			 * Notice that the modifier can be called multiple times and should not contain any side effects.
			 * (optional)
			 */
			modifier: (d) => d,
		},
		/**
		 * Optional,
		 * only needed when you want to replicate remote changes to the local state.
		 */
		pull: {
			/**
			 * Pull handler
			 */
			async handler(lastCheckpoint, batchSize) {
				let changedDocuments = [] as any[]
				if (!lastCheckpoint) {
					changedDocuments = storage.readAll()
				}

				const documentsToRespnse = changedDocuments.map((se) => se.data)
				// const minTimestamp = lastCheckpoint ? lastCheckpoint.updatedAt : 0
				// /**
				//  * In this example we replicate with a remote REST server
				//  */
				// const response = await fetch(
				// 	`https://example.com/api/sync/?minUpdatedAt=${minTimestamp}&limit=${batchSize}`
				// )
				// const documentsFromRemote = await response.json()
				return {
					/**
					 * Contains the pulled documents from the remote.
					 * Not that if documentsFromRemote.length < batchSize,
					 * then RxDB assumes that there are no more un-replicated documents
					 * on the backend, so the replication will switch to 'Event observation' mode.
					 */
					documents: documentsToRespnse,
					/**
					 * The last checkpoint of the returned documents.
					 * On the next call to the pull handler,
					 * this checkpoint will be passed as 'lastCheckpoint'
					 */
					checkpoint: Date.now(),
					/*documentsFromRemote.length === 0
							? lastCheckpoint
							: {
									id: lastOfArray(documentsFromRemote).id,
									updatedAt: lastOfArray(documentsFromRemote).updatedAt,
							  },*/
				}
			},
			// batchSize: 10,
			/**
			 * Modifies all documents after they have been pulled
			 * but before they are used by RxDB.
			 * Notice that the modifier can be called multiple times and should not contain any side effects.
			 * (optional)
			 */
			modifier: (d) => d,
			/**
			 * Stream of the backend document writes.
			 * See below.
			 * You only need a stream$ when you have set live=true
			 */
			stream$: pullStream$.asObservable(),
		},
	})

	const pullChangesAndReloadSlots = async () => {
		await pull({
			fs,
			http,
			dir: dir,
			author: {
				email: "user@user.de",
				name: "Meeee",
			},
		})
		await storage.loadSlotFilesFromWorkingCopy(true)
	}

	const pushChangesAndReloadSlots = async () => {
		console.log("pushing:")
		await push({
			fs,
			http,
			dir,
			onAuth: () => {
				return { username: gittoken }
			},
		})
		await storage.loadSlotFilesFromWorkingCopy(true)
	}

	const commitChanges = async () => {
		const FILE = 0,
			WORKDIR = 2,
			STAGE = 3
		const filenames = (
			await statusMatrix({
				dir: dir,
				fs: fs,
			})
		)
			.filter((row) => row[WORKDIR] !== row[STAGE])
			.map((row) => row[FILE])

		if (filenames.length == 0) {
			console.log("No files changed...")

			return
		}

		console.log("files adding:")
		console.log(filenames)
		await add({
			dir: dir,
			fs: fs,
			filepath: filenames,
		})

		try {
			console.log("commiting:")
			await commit({
				dir: dir,
				fs: fs,
				message: "db commit",
				author: {
					email: "test@test.te",
					name: "jojo",
				},
			})
		} catch (e) {
			console.log(e)
		}
	}

	return { database, fs, pullChangesAndReloadSlots, pushChangesAndReloadSlots }
}

export const storage = _create(fs)
