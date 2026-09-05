import { ProcessTerminal } from "@earendil-works/pi-tui";
import { appendRotatingLog, getClientErrorLogPath } from "../../config.js";
import { restoreStderr, takeOverStderr } from "../../core/output-guard.js";

const ANSI_ESCAPE_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const SUMMARY_MAX_LENGTH = 240;

export class InteractiveTerminal extends ProcessTerminal {
	private active = false;
	private pendingOutput = "";
	private notificationQueued = false;

	constructor(private readonly onUnexpectedOutput: (summary: string, logPath: string) => void) {
		super();
	}

	override start(onInput: (data: string) => void, onResize: () => void): void {
		super.start(onInput, onResize);
		this.active = true;
		takeOverStderr((text) => this.capture(text));
	}

	override stop(options: { preserveAltScreen?: boolean } = {}): void {
		this.active = false;
		restoreStderr();
		super.stop(options);
	}

	private capture(text: string): void {
		const logPath = getClientErrorLogPath();
		appendRotatingLog(logPath, `[${new Date().toISOString()}] interactive stderr: ${text.trimEnd()}`);
		this.pendingOutput += text;
		if (this.notificationQueued) return;

		this.notificationQueued = true;
		queueMicrotask(() => {
			this.notificationQueued = false;
			const output = this.pendingOutput;
			this.pendingOutput = "";
			if (!this.active) return;

			const firstLine = output
				.replace(ANSI_ESCAPE_PATTERN, "")
				.split(/\r?\n/)
				.map((line) => line.trim())
				.find((line) => line.length > 0);
			if (!firstLine) return;
			const summary =
				firstLine.length > SUMMARY_MAX_LENGTH ? `${firstLine.slice(0, SUMMARY_MAX_LENGTH - 1)}…` : firstLine;
			this.onUnexpectedOutput(summary, logPath);
		});
	}
}
