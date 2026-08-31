import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { describe, expect, it, vi } from "vitest";
import { streamOpenAICompletions } from "../src/providers/openai-completions.js";
import { processResponsesStream } from "../src/providers/openai-responses-shared.js";
import type { AssistantMessage, Context, Model, SimpleStreamOptions } from "../src/types.js";
import { AssistantMessageEventStream } from "../src/utils/event-stream.js";

const mockState = vi.hoisted(() => ({
	chunks: [] as unknown[],
}));

vi.mock("openai", () => {
	async function* generate(): AsyncGenerator<unknown> {
		for (const chunk of mockState.chunks) {
			yield chunk;
		}
	}

	return {
		default: class FakeOpenAI {
			chat = {
				completions: {
					create: () => ({
						withResponse: async () => ({ data: generate(), response: { status: 200, headers: {} } }),
					}),
				},
			};
		},
	};
});

const emptyUsage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function buildModel<TApi extends "openai-completions" | "openai-responses">(api: TApi): Model<TApi> {
	return {
		id: "gpt-test",
		name: "GPT Test",
		api,
		provider: "openai",
		baseUrl: "https://api.openai.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	} as Model<TApi>;
}

function buildContext(): Context {
	return {
		messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
	};
}

async function collect(result: AssistantMessageEventStream): Promise<AssistantMessage> {
	for await (const _event of result) {
		// drain
	}
	return await result.result();
}

describe("openai-responses truncation detection", () => {
	const model = buildModel("openai-responses");

	async function* events(withCompleted: boolean): AsyncIterable<ResponseStreamEvent> {
		yield { type: "response.created", response: { id: "resp_1" } } as ResponseStreamEvent;
		yield {
			type: "response.output_item.added",
			item: { type: "reasoning", id: "rs_1" },
		} as ResponseStreamEvent;
		yield { type: "response.reasoning_text.delta", delta: "hmm" } as ResponseStreamEvent;
		if (!withCompleted) return;
		yield {
			type: "response.output_item.done",
			item: { type: "reasoning", id: "rs_1" },
		} as ResponseStreamEvent;
		yield {
			type: "response.completed",
			response: {
				id: "resp_1",
				status: "completed",
				usage: {
					input_tokens: 10,
					output_tokens: 5,
					input_tokens_details: { cached_tokens: 0 },
					total_tokens: 15,
				},
			},
		} as ResponseStreamEvent;
	}

	it("rejects a stream that ends before response.completed instead of reporting success", async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: emptyUsage,
			stopReason: "stop",
			timestamp: Date.now(),
		};
		await expect(
			processResponsesStream(events(false), output, new AssistantMessageEventStream(), model),
		).rejects.toThrow(/ended before response\.completed/);
	});

	it("accepts a stream terminated by response.completed", async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: emptyUsage,
			stopReason: "stop",
			timestamp: Date.now(),
		};
		await expect(
			processResponsesStream(events(true), output, new AssistantMessageEventStream(), model),
		).resolves.toBeUndefined();
		expect(output.usage.totalTokens).toBe(15);
	});
});

describe("openai-completions truncation detection", () => {
	const model = buildModel("openai-completions");
	const options: SimpleStreamOptions = { apiKey: "test-key" };

	it("reports an error when the chunk stream ends without finish_reason", async () => {
		mockState.chunks = [
			{ id: "c1", choices: [{ index: 0, delta: { content: "partial" }, finish_reason: null }] },
		] as unknown[];
		const response = streamOpenAICompletions(model, buildContext(), options);
		const msg = await collect(response);
		expect(msg.stopReason).toBe("error");
		expect(msg.errorMessage).toMatch(/ended before finish_reason/);
	});

	it("completes normally when finish_reason arrives", async () => {
		mockState.chunks = [
			{ id: "c1", choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }] },
			{ id: "c1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
		] as unknown[];
		const response = streamOpenAICompletions(model, buildContext(), options);
		const msg = await collect(response);
		expect(msg.stopReason).toBe("stop");
		expect(msg.errorMessage).toBeUndefined();
	});
});
