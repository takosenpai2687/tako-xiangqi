import type { ChessPiece, Position } from "./domain";
import { resourceUrl } from "./resource-source";

export type AiLevel = "easy" | "normal" | "hard";

export interface AiMove {
  from: Position;
  to: Position;
}

export interface AiScore {
  type: "cp" | "mate";
  value: number;
}

export interface AiSearchResult {
  move: AiMove | null;
  score: AiScore | null;
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

export function redWinRateFromScore(score: AiScore, scoreSide: number, redSide: number): number {
  const scoreSideWinRate = score.type === "mate"
    ? score.value > 0 ? 99 : 1
    : 100 / (1 + Math.exp(-Math.max(-1600, Math.min(1600, score.value)) / 400));
  return Math.round(scoreSide === redSide ? scoreSideWinRate : 100 - scoreSideWinRate);
}

// Runs Pikafish (WASM) inside a worker; the ~50 MB engine is only fetched on first use.
export class AiEngine {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private searchId = 0;
  private waiting = new Map<number, (result: AiSearchResult | null) => void>();

  load(onProgress?: (fraction: number) => void): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      // Version the worker entry: older deployments marked /engine/* immutable.
      const worker = new Worker(`${import.meta.env.BASE_URL}engine/pikafish-worker.js?v=3`);
      this.worker = worker;
      worker.onmessage = event => {
        const data = event.data;
        if (data.type === "progress") onProgress?.(data.value);
        else if (data.type === "ready") resolve();
        else if (data.type === "error") reject(new Error(data.message));
        else if (data.type === "bestmove") {
          const score = data.score;
          this.waiting.get(data.id)?.({
            move: typeof data.move === "string" ? parseMove(data.move) : null,
            score: score && (score.type === "cp" || score.type === "mate")
              && Number.isFinite(score.value)
              ? score
              : null,
          });
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

  search(fen: string, level: AiLevel): Promise<AiSearchResult | null> {
    return this.run(fen, LEVELS[level].go, LEVELS[level].options);
  }

  analyze(fen: string, moveTimeMs = 160): Promise<AiSearchResult | null> {
    const time = Math.max(50, Math.min(300, Math.floor(moveTimeMs)));
    return this.run(fen, `go movetime ${time}`);
  }

  private async run(
    fen: string,
    go: string,
    options: Record<string, string | number> = {},
  ): Promise<AiSearchResult | null> {
    await this.ready;
    const worker = this.worker;
    if (!worker) return null;
    const id = ++this.searchId;
    return new Promise<AiSearchResult | null>(resolve => {
      this.waiting.set(id, resolve);
      worker.postMessage({ type: "search", id, fen, options, go });
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    for (const resolve of this.waiting.values()) resolve(null);
    this.waiting.clear();
  }
}
