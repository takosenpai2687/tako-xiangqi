export interface Position {
  row: number;
  col: number;
}

export interface ChessPiece extends Position {
  side: number;
  type: number;
  getNextSteps(state: Array<Array<ChessPiece | null>>): Position[];
}

export interface ChessboardModel {
  state: Array<Array<ChessPiece | null>>;
  moveChess(piece: ChessPiece, row: number, col: number): void;
  refreshChessPos(): void;
}

export interface XiangqiRules {
  Chessboard: new (unit: number) => ChessboardModel;
  constants: {
    sides: { black: number; red: number };
    types: {
      general: number;
      advisor: number;
      elephant: number;
      horse: number;
      chariot: number;
      cannon: number;
      soldier: number;
    };
    states: { selecting: number; moving: number };
  };
}

export interface BoardAction {
  position: Position | null;
  piece: ChessPiece | null;
  dragged: boolean;
}

export interface MoveRecord {
  piece: ChessPiece;
  captured: ChessPiece | null;
  from: Position;
  to: Position;
}

export const pieceTypeNames = [
  "general",
  "advisor",
  "elephant",
  "horse",
  "chariot",
  "cannon",
  "soldier",
] as const;
