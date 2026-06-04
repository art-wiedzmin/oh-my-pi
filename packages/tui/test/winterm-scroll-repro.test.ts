import { describe, expect, it } from "bun:test";
import { type Component, TERMINAL, TUI } from "@oh-my-pi/pi-tui";
import { VirtualTerminal } from "./virtual-terminal";

// Repro for the Windows Terminal scrollback regression after the win32 ConPTY
// probe removal (#1746). On native win32 the viewport position is permanently
// unknown, so every live transcript-growing render downgrades to a viewport
// repaint that pushes nothing into native scrollback:
//   1. `omp --resume` rebuilds the whole transcript after the initial welcome
//      paint -> only the bottom `rows` survive, earlier messages are lost.
//   2. Ctrl+O expands offscreen tool calls -> the grown rows above the viewport
//      never reach scrollback, so scrolling up shows stale pre-expansion rows.
// Both happen with the host pinned to the bottom (startup / a user keystroke),
// so committing to scrollback is safe; only background streaming must defer.

class LineList implements Component {
	#lines: string[];
	constructor(lines: string[]) {
		this.#lines = [...lines];
	}
	invalidate(): void {}
	render(width: number): string[] {
		return this.#lines.map(line => line.slice(0, width));
	}
	setLines(lines: string[]): void {
		this.#lines = [...lines];
	}
}

class ConptyHostTerminal extends VirtualTerminal {
	isNativeViewportAtBottom(): undefined {
		return undefined;
	}
}

async function settle(term: VirtualTerminal): Promise<void> {
	const nextTick = Promise.withResolvers<void>();
	process.nextTick(nextTick.resolve);
	await nextTick.promise;
	await Bun.sleep(20);
	await term.flush();
}

async function withPlatform<T>(platform: NodeJS.Platform, run: () => T | Promise<T>): Promise<T> {
	const original = process.platform;
	Object.defineProperty(process, "platform", { configurable: true, value: platform });
	try {
		return await run();
	} finally {
		Object.defineProperty(process, "platform", { configurable: true, value: original });
	}
}

const mutableTerminalInfo = TERMINAL as unknown as { eagerEraseScrollbackRisk: boolean };

describe("win32 ConPTY scrollback (resume + Ctrl+O)", () => {
	it("commits the full transcript to scrollback on a user-driven resume rebuild", async () => {
		await withPlatform("win32", async () => {
			const term = new ConptyHostTerminal(40, 6, 10_000);
			const tui = new TUI(term);
			const list = new LineList(["welcome-0", "welcome-1"]);
			tui.addChild(list);
			try {
				tui.start();
				await settle(term); // initial paint of the small welcome frame

				// Resume: the transcript is rebuilt after the initial paint.
				const transcript = Array.from({ length: 13 }, (_v, i) => `L${String(i).padStart(2, "0")}`);
				list.setLines(transcript);
				tui.requestRender(false, { commitNativeScrollback: true });
				await settle(term);

				const buffer = term.getScrollBuffer().filter(line => line.length > 0);
				// Every transcript row must be reachable (scrollback + viewport).
				for (const row of transcript) {
					expect(buffer).toContain(row);
				}
			} finally {
				tui.stop();
			}
		});
	});

	it("commits an offscreen Ctrl+O expansion to scrollback", async () => {
		await withPlatform("win32", async () => {
			const term = new ConptyHostTerminal(40, 6, 10_000);
			const tui = new TUI(term);
			const transcript = Array.from({ length: 12 }, (_v, i) => `L${String(i).padStart(2, "0")}`);
			const list = new LineList(transcript);
			tui.addChild(list);
			try {
				tui.start();
				await settle(term);

				// Ctrl+O expands an offscreen block: insert a row above the viewport.
				const expanded = [...transcript];
				expanded.splice(3, 0, "EXPANDED-3b");
				list.setLines(expanded);
				tui.requestRender(false, { commitNativeScrollback: true });
				await settle(term);

				const buffer = term.getScrollBuffer().filter(line => line.length > 0);
				expect(buffer).toContain("EXPANDED-3b");
				for (const row of expanded) {
					expect(buffer).toContain(row);
				}
			} finally {
				tui.stop();
			}
		});
	});

	it("does NOT commit on win32 for incidental input (soft flag only)", async () => {
		// Locks the distinction behind the fix: an ordinary keystroke
		// (allowUnknownViewportMutation, NO commitNativeScrollback) must keep
		// deferring on win32 so a scrolled reader is never yanked — mirrors the
		// render-regressions "unknown Windows viewport guard on ordinary focused
		// input" contract. The offscreen insert must stay out of scrollback.
		await withPlatform("win32", async () => {
			const term = new ConptyHostTerminal(40, 6, 10_000);
			const tui = new TUI(term);
			const transcript = Array.from({ length: 12 }, (_v, i) => `L${String(i).padStart(2, "0")}`);
			const list = new LineList(transcript);
			tui.addChild(list);
			try {
				tui.start();
				await settle(term);

				const expanded = [...transcript];
				expanded.splice(3, 0, "TYPED-3b");
				list.setLines(expanded);
				tui.requestRender(false, { allowUnknownViewportMutation: true });
				await settle(term);

				expect(term.getScrollBuffer().join("\n")).not.toContain("TYPED-3b");
			} finally {
				tui.stop();
			}
		});
	});

	it("still defers eager background streaming rebuilds (no scrollback erase)", async () => {
		// Guard: the #1746 anti-yank contract must survive the fix — a background
		// streaming mutation (no user keystroke) must NOT rebuild live on win32.
		const savedRisk = TERMINAL.eagerEraseScrollbackRisk;
		mutableTerminalInfo.eagerEraseScrollbackRisk = false;
		await withPlatform("win32", async () => {
			const term = new ConptyHostTerminal(40, 6, 10_000);
			const tui = new TUI(term);
			const transcript = Array.from({ length: 40 }, (_v, i) => `row-${i}`);
			const list = new LineList(transcript);
			tui.addChild(list);
			const writes: string[] = [];
			const realWrite = term.write.bind(term);
			(term as unknown as { write: (s: string) => void }).write = (data: string) => {
				writes.push(data);
				realWrite(data);
			};
			try {
				tui.start();
				await settle(term);
				term.scrollLines(-6);
				await settle(term);
				const scrolled = term.getBufferPosition();

				tui.setEagerNativeScrollbackRebuild(true);
				list.setLines(transcript.map((row, i) => (i === 18 ? "row-18 streamed" : row)));
				tui.requestRender();
				await settle(term);

				expect(writes.join("").match(/\x1b\[3J/g)?.length ?? 0).toBe(0);
				expect(term.getBufferPosition().viewportY).toBe(scrolled.viewportY);
			} finally {
				mutableTerminalInfo.eagerEraseScrollbackRisk = savedRisk;
				tui.stop();
			}
		});
	});
});
