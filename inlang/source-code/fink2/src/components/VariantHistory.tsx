import { useAtom } from "jotai";
import { projectAtom } from "../state.ts";
import { useEffect, useState } from "react";
import { InlangProject } from "@inlang/sdk2";
import { jsonObjectFrom } from "kysely/helpers/sqlite";
import { timeAgo } from "../routes/changes/Page.tsx";

const VariantHistory = (props: { variantId: string }) => {
	const [project] = useAtom(projectAtom);
	const [latestCommit, setLatestCommit] = useState<any>(undefined);

	useEffect(() => {
		if (!project) return;
		queryLatestCommit(project, props.variantId).then((result) =>
			setLatestCommit(result)
		);
		const interval = setInterval(async () => {
			const result = await queryLatestCommit(project, props.variantId);
			setLatestCommit(result);
		}, 1000);
		return () => clearInterval(interval);
	}, []);

	return (
		<div
			slot="pattern-editor"
			className="absolute right-4 h-full flex items-center text-zinc-400 text-sm!"
		>
			{latestCommit?.user_id && (
				<p>
					by {latestCommit?.user_id} | {timeAgo(latestCommit?.zoned_date_time)}
				</p>
			)}
		</div>
	);
};

export default VariantHistory;

const queryLatestCommit = async (project: InlangProject, variantId: string) => {
	const result = await project.lix.db
		.selectFrom("change")
		.selectAll()
		.where("change.type", "=", "variant")
		.where("change.commit_id", "!=", "null")
		.where((eb) => eb.ref("value", "->>").key("id"), "=", variantId)
		.innerJoin("commit", "commit.id", "change.commit_id")
		.orderBy("commit.user_id desc")
		.orderBy("commit.zoned_date_time desc")
		.executeTakeFirst();

	return result;
};
