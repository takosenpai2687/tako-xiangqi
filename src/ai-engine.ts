import type { ChessPiece, Position } from "./domain";
import { resourceUrl } from "./resource-source";

export type AiLevel = "easy" | "normal" | "hard";

export interface AiMove {
  from: Position;
  to: Position;
}

// Kept deliberately light so phones stay responsive: shallow depth plus a hard time cap.
const LEVELS: Record<AiLevel, { options: Record<string, string | number>; go: string }> = {
  easy: {
    options: {},
    go: "go depth 1",
  },
  normal: {
    options: {},
    go: "go depth 5 movetime 400",
  },
  hard: {
    options: {},
    go: "go depth 10 movetime 900",
  },
};

const FEN_LETTERS = ["k", "a", "b", "n", "r", "c", "p"];

export function toFen(
  state: Array<Array<ChessPiece | null>>,
  sideToMove: "red" | "black",
  redSide: number,
): string {
  const rows = state.map(row => {
    let text = "";
    let empty = 0;
    for (const piece of row) {
      if (!piece) {
        empty++;
        continue;
      }
      if (empty) text += empty;
      empty = 0;
      const letter = FEN_LETTERS[piece.type];
      text += piece.side === redSide ? letter.toUpperCase() : letter;
    }
    return text + (empty || "");
  });
  return `${rows.join("/")} ${sideToMove === "red" ? "w" : "b"} - - 0 1`;
}

export function parseMove(text: string): AiMove | null {
  const match = /^([a-i])(\d)([a-i])(\d)/.exec(text);
  if (!match) return null;
  const col = (letter: string) => letter.charCodeAt(0) - 97;
  return {
    from: { row: 9 - Number(match[2]), col: col(match[1]) },
    to: { row: 9 - Number(match[4]), col: col(match[3]) },
  };
}

// Runs Pikafish (WASM) inside a worker; the ~50 MB engine is only fetched on first use.
export class AiEngine {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private searchId = 0;
  private waiting = new Map<number, (move: string | null) => void>();

  load(onProgress?: (fraction: number) => void): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      // Version the worker entry: older deployments marked /engine/* immutable.
      const worker = new Worker(`${import.meta.env.BASE_URL}engine/pikafish-worker.js?v=2`);
      this.worker = worker;
      worker.onmessage = event => {
        const data = event.data;
        if (data.type === "progress") onProgress?.(data.value);
        else if (data.type === "ready") resolve();
        else if (data.type === "error") reject(new Error(data.message));
        else if (data.type === "bestmove") {
          this.waiting.get(data.id)?.(data.move);
          this.waiting.delete(data.id);
        }
      };
      worker.onerror = event => reject(new Error(event.message || "engine failed"));
      worker.postMessage({
        type: "init",
        dataUrl: resourceUrl("engine/pikafish.data"),
        wasmUrl: resourceUrl("engine/pikafish.wasm"),
      });
    });
    this.ready.catch(() => this.dispose());
    return this.ready;
  }

  async search(fen: string, level: AiLevel): Promise<AiMove | null> {
    await this.ready;
    const worker = this.worker;
    if (!worker) return null;
    const id = ++this.searchId;
    const text = await new Promise<string | null>(resolve => {
      this.waiting.set(id, resolve);
      worker.postMessage({ type: "search", id, fen, ...LEVELS[level] });
    });
    return text ? parseMove(text) : null;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    for (const resolve of this.waiting.values()) resolve(null);
    this.waiting.clear();
  }
}
