import type {
  BoardAction,
  ChessPiece,
  ChessboardModel,
  MoveRecord,
  Position,
} from "./domain";
import { BoardRenderer } from "./board-renderer";
import { GameAudio } from "./game-audio";
import { Chessboard, constants, getLegalMoves, getLegalSteps } from "./rules";
import {
  redWinRateFromScore,
  toFen,
  type AiEngine,
  type AiLevel,
  type AiScore,
  type AiSearchResult,
} from "./ai-engine";

interface PieceSnapshot {
  piece: ChessPiece;
  row: number;
  col: number;
}

export interface GameState {
  started: boolean;
  turn: number;
  selected: ChessPiece | null;
  legalMoveCount: number;
  moveCount: number;
  canUndo: boolean;
  capturedRed: number;
  capturedBlack: number;
  // Surviving piece counts indexed by piece type.
  aliveRed: number[];
  aliveBlack: number[];
  lastMove: MoveRecord | null;
  thinking: boolean;
  humanSide: number | null;
  canHint: boolean;
  hintThinking: boolean;
  hintError: boolean;
  hintLevel: AiLevel;
  winRateRed: number | null;
  evaluating: boolean;
  winRateError: boolean;
}

const TEA_SOUNDS = { lift: "cupLift", sip: "teaSip", place: "cupPlace" } as const;

function countByType(pieces: ChessPiece[]): number[] {
  const counts = new Array<number>(7).fill(0);
  for (const piece of pieces) counts[piece.type] += 1;
  return counts;
}

export interface GameView {
  onStateChange(state: GameState): void;
  onWinner(winner: "red" | "black"): void;
}

export class GameController {
  private readonly rules = constants;
  private board: ChessboardModel;
  private turn = this.rules.sides.red;
  private selected: ChessPiece | null = null;
  private legalMoves: Position[] = [];
  private started = false;
  private winner: "red" | "black" | null = null;
  private moveCount = 0;
  private history: PieceSnapshot[][] = [];
  private lastMove: MoveRecord | null = null;
  private readonly renderer: BoardRenderer;
  private readonly view: GameView;
  private readonly audio = new GameAudio();
  private ai: { engine: AiEngine; level: AiLevel; humanSide: number } | null = null;
  private aiSearch: Promise<AiSearchResult | null> | null = null;
  private aiToken = 0;
  private evaluationToken = 0;
  private thinking = false;
  private hintToken = 0;
  private hintThinking = false;
  private hintError = false;
  private hintLevel: AiLevel = "normal";
  private winRateRed: number | null = null;
  private evaluating = false;
  private winRateError = false;

  setAi(ai: { engine: AiEngine; level: AiLevel; humanSide: number } | null): void {
    this.ai = ai;
    this.cancelAi();
    this.hintLevel = ai?.level === "easy" ? "normal" : "hard";
    this.winRateRed = null;
    this.winRateError = false;
  }

  setHintLevel(level: AiLevel): void {
    if (level === this.hintLevel) return;
    this.hintLevel = level;
    this.clearHint();
    this.notify();
  }

  private get canHint(): boolean {
    return this.ai !== null && this.started && !this.winner
      && this.turn === this.ai.humanSide && !this.thinking && !this.hintThinking;
  }

  async requestHint(): Promise<void> {
    if (!this.canHint || !this.ai) return;
    this.clearHint();
    const token = this.hintToken;
    this.hintThinking = true;
    this.notify();
    try {
      const result = await this.searchPosition(
        this.ai.engine,
        this.hintLevel,
        () => token === this.hintToken,
      );
      if (token !== this.hintToken) return;
      const picked = this.resolveAiMove(result?.move ?? null, this.turn);
      if (!picked) throw new Error("The hint engine returned no legal move.");
      this.clearHint();
      this.selectPiece(picked.piece);
      this.renderer.setHint(picked.to);
    } catch (error) {
      if (token !== this.hintToken) return;
      console.error("Could not calculate a hint:", error);
      this.clearHint();
      this.hintError = true;
      this.notify();
    }
  }

  private clearHint(): void {
    this.hintToken++;
    this.hintThinking = false;
    this.hintError = false;
    this.renderer.setHint(null);
  }

  constructor(renderer: BoardRenderer, view: GameView) {
    this.renderer = renderer;
    this.view = view;
    this.board = new Chessboard();
    this.history = [this.snapshot()];
    this.renderer.setActionHandler(action => this.handleBoardAction(action));
    this.renderer.setTeaSoundHandler(sound => this.audio.play(TEA_SOUNDS[sound]));
    this.render();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.renderer.setViewForTurn(this.viewTurn(), true);
    this.render();
    this.queueAiMove();
    if (this.ai && this.turn === this.ai.humanSide) void this.evaluateWinRate();
  }

  // Locked views: local play snaps to the side to move; against the AI only the
  // player's side is ever locked, so the button returns to it instead of flipping.
  resetView(): void {
    this.renderer.setViewForTurn(this.viewTurn(), true);
  }

  private get aiSide(): number | null {
    return this.ai ? 1 - this.ai.humanSide : null;
  }

  private get canUndo(): boolean {
    const openingPlies = this.ai?.humanSide === this.rules.sides.black ? 1 : 0;
    return this.started && this.moveCount > openingPlies;
  }

  undo(): void {
    if (!this.canUndo) return;
    this.cancelAi();
    this.ai?.engine.reset();
    this.audio.play("undo");
    // Against the AI, undo rewinds to the player's previous turn (two plies).
    const plies = this.ai && this.history.length > 2 && this.turn === this.ai.humanSide ? 2 : 1;
    for (let i = 0; i < plies; i++) {
      this.history.pop();
      this.moveCount = Math.max(0, this.moveCount - 1);
      this.turn = 1 - this.turn;
    }
    this.restore(this.history[this.history.length - 1]);
    this.selected = null;
    this.legalMoves = [];
    this.lastMove = null;
    this.winner = null;
    this.winRateRed = null;
    this.winRateError = false;
    if (!this.ai) this.renderer.setViewForTurn(this.turn, true);
    this.render();
    if (this.ai && this.turn === this.ai.humanSide) void this.evaluateWinRate();
    this.queueAiMove();
  }

  newGame(): void {
    this.cancelAi();
    this.ai?.engine.reset();
    this.board = new Chessboard();
    this.turn = this.rules.sides.red;
    this.selected = null;
    this.legalMoves = [];
    this.started = false;
    this.winner = null;
    this.moveCount = 0;
    this.lastMove = null;
    this.winRateRed = null;
    this.evaluating = false;
    this.winRateError = false;
    this.history = [this.snapshot()];
    this.render();
  }

  private handleBoardAction(action: BoardAction): void {
    const aiTurn = this.turn === this.aiSide;
    if (!this.started || this.winner || !action.position || aiTurn) {
      if (action.dragged) this.render();
      return;
    }

    if (action.dragged) {
      if (action.piece?.side !== this.turn) {
        this.render();
        return;
      }
      this.selectPiece(action.piece);
      if (this.isLegalMove(action.position)) this.movePiece(action.position);
      else this.render();
      return;
    }

    if (this.selected) {
      if (action.piece === this.selected) {
        this.clearHint();
        this.selected = null;
        this.legalMoves = [];
        this.render();
        return;
      }
      if (action.piece?.side === this.turn) {
        this.selectPiece(action.piece);
        return;
      }
      if (this.isLegalMove(action.position)) {
        this.movePiece(action.position);
      }
      return;
    }

    if (action.piece?.side === this.turn) {
      this.selectPiece(action.piece);
    }
  }

  private selectPiece(piece: ChessPiece): void {
    if (piece !== this.selected) this.clearHint();
    this.audio.play("pickup");
    this.selected = piece;
    this.legalMoves = getLegalSteps(piece, this.board.state);
    this.render();
  }

  private isLegalMove(position: Position): boolean {
    return this.legalMoves.some(
      move => move.row === position.row && move.col === position.col,
    );
  }

  private movePiece(position: Position, score?: AiScore | null): void {
    if (!this.selected) return;
    this.clearHint();
    const piece = this.selected;
    const from = { row: piece.row, col: piece.col };
    const captured = this.board.state[position.row][position.col];
    this.board.moveChess(piece, position.row, position.col);
    this.turn = 1 - this.turn;
    this.moveCount++;
    this.selected = null;
    this.legalMoves = [];
    this.lastMove = {
      piece,
      captured,
      from,
      to: { row: position.row, col: position.col },
    };
    this.history.push(this.snapshot());
    if (this.ai && piece.side === this.aiSide) this.ai.engine.reset();
    this.checkWinner();
    if (this.ai && !this.winner) {
      if (piece.side === this.aiSide && score) {
        this.setWinRate(score, this.aiSide);
      } else {
        void this.evaluateWinRate();
      }
    }
    this.renderer.sync(this.board.state, null, [], this.lastMove, this.getTurnPieces());
    if (captured) {
      this.audio.playMoveAndCapture(
        piece.side === this.rules.sides.red ? "red" : "black",
      );
    } else {
      this.audio.play(
        piece.side === this.rules.sides.red ? "redMove" : "blackMove",
      );
    }
    if (!this.ai) this.renderer.setViewForTurn(this.turn, true);
    this.notify();
    this.queueAiMove();
  }

  private viewTurn(): number {
    return this.ai?.humanSide ?? this.turn;
  }

  private cancelAi(): void {
    this.aiToken++;
    this.evaluationToken++;
    this.evaluating = false;
    this.thinking = false;
    this.clearHint();
  }

  private searchPosition(
    engine: AiEngine,
    level: AiLevel,
    isCurrent: () => boolean,
    analysis = false,
  ): Promise<AiSearchResult | null> {
    const previous = this.aiSearch;
    // Opponent and hint searches share one worker and must never overlap.
    this.aiSearch = (async () => {
      if (previous) await previous;
      if (!isCurrent()) return null;
      const fen = toFen(
        this.board.state,
        this.turn === this.rules.sides.red ? "red" : "black",
        this.rules.sides.red,
      );
      return analysis ? engine.analyze(fen) : engine.search(fen, level);
    })().catch(error => {
      console.warn("AI search failed:", error);
      return null;
    });
    return this.aiSearch;
  }

  private async evaluateWinRate(): Promise<void> {
    if (!this.ai || !this.started || this.winner) return;
    const token = ++this.evaluationToken;
    const { engine, level } = this.ai;
    this.evaluating = true;
    this.winRateRed = null;
    this.winRateError = false;
    this.notify();
    const result = await this.searchPosition(engine, level, () => token === this.evaluationToken, true);
    if (token !== this.evaluationToken) return;
    this.evaluating = false;
    if (result?.score) this.setWinRate(result.score, this.turn);
    else {
      this.winRateError = true;
    }
    this.notify();
  }

  private setWinRate(score: AiScore, scoreSide: number | null): void {
    if (scoreSide === null) return;
    this.evaluationToken++;
    this.evaluating = false;
    this.winRateError = false;
    this.winRateRed = redWinRateFromScore(score, scoreSide, this.rules.sides.red);
  }

  private queueAiMove(): void {
    if (!this.ai || !this.started || this.winner || this.turn !== this.aiSide) return;
    const { engine, level } = this.ai;
    const token = ++this.aiToken;
    this.thinking = true;
    this.notify();
    void (async () => {
      const startedAt = performance.now();
      const result = await this.searchPosition(engine, level, () => token === this.aiToken);
      // A little pause so the reply never feels instantaneous.
      const wait = Math.max(0, 500 - (performance.now() - startedAt));
      await new Promise(resolve => window.setTimeout(resolve, wait));
      if (token !== this.aiToken) return;
      const picked = this.resolveAiMove(result?.move ?? null) ?? this.randomAiMove();
      if (!picked) {
        this.thinking = false;
        this.checkWinner();
        this.notify();
        return;
      }
      this.selectPiece(picked.piece);
      await new Promise(resolve => window.setTimeout(resolve, 450));
      if (token !== this.aiToken) return;
      this.thinking = false;
      this.movePiece(picked.to, result?.score);
    })();
  }

  private resolveAiMove(
    move: { from: Position; to: Position } | null,
    side: number | null = this.aiSide,
  ): { piece: ChessPiece; to: Position } | null {
    if (!move) return null;
    const piece = this.board.state[move.from.row]?.[move.from.col];
    if (!piece || piece.side !== side) return null;
    const legal = getLegalSteps(piece, this.board.state).some(
      step => step.row === move.to.row && step.col === move.to.col,
    );
    return legal ? { piece, to: move.to } : null;
  }

  private randomAiMove(): { piece: ChessPiece; to: Position } | null {
    const options = getLegalMoves(this.board.state, this.aiSide ?? -1);
    return options.length ? options[Math.floor(Math.random() * options.length)] : null;
  }

  private checkWinner(): void {
    const generals = this.board.state.flat().filter(
      piece => piece?.type === this.rules.types.general,
    );
    if (generals.length === 2 && getLegalMoves(this.board.state, this.turn).length > 0) return;
    const winnerSide = generals.length < 2
      ? generals[0]?.side ?? 1 - this.turn
      : 1 - this.turn;
    this.winner = winnerSide === this.rules.sides.red ? "red" : "black";
    this.evaluationToken++;
    this.evaluating = false;
    this.winRateError = false;
    this.winRateRed = this.winner === "red" ? 100 : 0;
    this.view.onWinner(this.winner);
  }

  private snapshot(): PieceSnapshot[] {
    return this.board.state.flatMap(row =>
      row.flatMap(piece =>
        piece ? [{ piece, row: piece.row, col: piece.col }] : [],
      ),
    );
  }

  private restore(snapshot: PieceSnapshot[]): void {
    this.board.state = Array.from({ length: 10 }, () =>
      Array<ChessPiece | null>(9).fill(null),
    );
    for (const entry of snapshot) {
      entry.piece.row = entry.row;
      entry.piece.col = entry.col;
      this.board.state[entry.row][entry.col] = entry.piece;
    }
    this.board.refreshChessPos();
  }

  private render(): void {
    this.renderer.sync(
      this.board.state,
      this.selected,
      this.legalMoves,
      undefined,
      this.getTurnPieces(),
    );
    this.notify();
  }

  private getTurnPieces(): ChessPiece[] {
    if (!this.started || this.winner) return [];
    return this.board.state.flat().filter(
      (piece): piece is ChessPiece => piece !== null && piece.side === this.turn,
    );
  }

  private notify(): void {
    // Only the side to move may touch its cup; the AI's cup stays idle.
    const playing = this.started && !this.winner &&
      this.turn !== this.aiSide;
    this.renderer.setTeaSide(
      playing ? (this.turn === this.rules.sides.red ? "red" : "black") : null,
    );
    const pieces = this.board.state.flat().filter(
      (piece): piece is ChessPiece => piece !== null,
    );
    const redPieces = pieces.filter(piece => piece.side === this.rules.sides.red);
    const blackPieces = pieces.filter(piece => piece.side === this.rules.sides.black);
    this.view.onStateChange({
      started: this.started,
      turn: this.turn,
      selected: this.selected,
      legalMoveCount: this.legalMoves.length,
      moveCount: this.moveCount,
      canUndo: this.canUndo,
      capturedRed: 16 - redPieces.length,
      capturedBlack: 16 - blackPieces.length,
      aliveRed: countByType(redPieces),
      aliveBlack: countByType(blackPieces),
      lastMove: this.lastMove,
      thinking: this.thinking,
      humanSide: this.ai?.humanSide ?? null,
      canHint: this.canHint,
      hintThinking: this.hintThinking,
      hintError: this.hintError,
      hintLevel: this.hintLevel,
      winRateRed: this.winRateRed,
      evaluating: this.evaluating,
      winRateError: this.winRateError,
    });
  }
}
