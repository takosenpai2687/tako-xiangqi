import type {
  BoardAction,
  ChessPiece,
  ChessboardModel,
  MoveRecord,
  Position,
} from "./domain";
import { BoardRenderer } from "./board-renderer";
import { GameAudio } from "./game-audio";

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
  capturedRed: number;
  capturedBlack: number;
  lastMove: MoveRecord | null;
}

export interface GameView {
  onStateChange(state: GameState): void;
  onWinner(winner: "red" | "black"): void;
}

export class GameController {
  private readonly rules = window.XiangqiRules.constants;
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

  constructor(renderer: BoardRenderer, view: GameView) {
    this.renderer = renderer;
    this.view = view;
    this.board = new window.XiangqiRules.Chessboard(1);
    this.history = [this.snapshot()];
    this.renderer.setActionHandler(action => this.handleBoardAction(action));
    this.render();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.renderer.setViewForTurn(this.turn);
    this.render();
  }

  undo(): void {
    if (!this.started || this.history.length < 2) return;
    this.audio.play("undo");
    this.history.pop();
    this.restore(this.history[this.history.length - 1]);
    this.moveCount = Math.max(0, this.moveCount - 1);
    this.turn = 1 - this.turn;
    this.selected = null;
    this.legalMoves = [];
    this.lastMove = null;
    this.winner = null;
    this.renderer.setViewForTurn(this.turn);
    this.render();
  }

  newGame(): void {
    this.board = new window.XiangqiRules.Chessboard(1);
    this.turn = this.rules.sides.red;
    this.selected = null;
    this.legalMoves = [];
    this.started = false;
    this.winner = null;
    this.moveCount = 0;
    this.lastMove = null;
    this.history = [this.snapshot()];
    this.render();
  }

  private handleBoardAction(action: BoardAction): void {
    if (!this.started || this.winner || !action.position) {
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
    this.audio.play("pickup");
    this.selected = piece;
    this.legalMoves = piece.getNextSteps(this.board.state);
    this.render();
  }

  private isLegalMove(position: Position): boolean {
    return this.legalMoves.some(
      move => move.row === position.row && move.col === position.col,
    );
  }

  private movePiece(position: Position): void {
    if (!this.selected) return;
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
    this.checkWinner();
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
    this.renderer.setViewForTurn(this.turn);
    this.notify();
  }

  private checkWinner(): void {
    const generals = this.board.state.flat().filter(
      piece => piece?.type === this.rules.types.general,
    );
    if (generals.length === 2) return;
    this.winner = generals[0]?.side === this.rules.sides.red ? "red" : "black";
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
      capturedRed: 16 - redPieces.length,
      capturedBlack: 16 - blackPieces.length,
      lastMove: this.lastMove,
    });
  }
}
