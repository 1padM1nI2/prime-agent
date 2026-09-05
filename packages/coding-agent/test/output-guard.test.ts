import { afterEach, describe, expect, it, vi } from "vitest";
import { restoreStderr, takeOverStderr } from "../src/core/output-guard.js";

describe("stderr output guard", () => {
	afterEach(() => {
		restoreStderr();
	});

	it("captures writes without sending them to the terminal", () => {
		const originalWrite = process.stderr.write;
		const onWrite = vi.fn();
		const callback = vi.fn();

		takeOverStderr(onWrite);
		const result = process.stderr.write("background failure", callback);

		expect(result).toBe(true);
		expect(onWrite).toHaveBeenCalledWith("background failure");
		expect(callback).toHaveBeenCalledWith(null);
		restoreStderr();
		expect(process.stderr.write).toBe(originalWrite);
	});
});
