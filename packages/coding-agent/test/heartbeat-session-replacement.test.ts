import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentCronJobStore } from "../src/core/cron-jobs.js";

describe("heartbeat session replacement", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("cancels user and RLM heartbeats without cancelling ordinary cron jobs", () => {
		const dir = mkdtempSync(join(tmpdir(), "prime-agent-heartbeat-replacement-"));
		tempDirs.push(dir);
		const store = new AgentCronJobStore(join(dir, "cron-jobs.json"));
		const input = {
			activeSessionId: "active-session",
			sessionId: "session",
			sessionFile: join(dir, "session.jsonl"),
			cwd: dir,
			scheduleText: "every 5m",
		};
		const userHeartbeat = store.createHeartbeat({ ...input, prompt: "check user work" });
		const rlmHeartbeat = store.createRlmHeartbeat({ ...input, prompt: "check agent work" });
		const cronJob = store.create({ ...input, prompt: "ordinary schedule" });

		const cancelled = store.cancelHeartbeatsForSession({ activeSessionId: input.activeSessionId });

		expect(cancelled.map((job) => job.id)).toEqual(expect.arrayContaining([userHeartbeat.id, rlmHeartbeat.id]));
		expect(store.list().find((job) => job.id === userHeartbeat.id)).toMatchObject({ status: "cancelled" });
		expect(store.list().find((job) => job.id === rlmHeartbeat.id)).toMatchObject({ status: "cancelled" });
		expect(store.list().find((job) => job.id === cronJob.id)).toMatchObject({ status: "active" });
	});
});
