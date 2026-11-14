import type { ChessPiece, Position } from "./domain";

export const constants: {
  types: Record<"general" | "advisor" | "elephant" | "horse" | "chariot" | "cannon" | "soldier", number>;
  sides: { black: number; red: number };
  states: { selecting: number; moving: number };
} = {
  types: {
    general: 0,
    advisor: 1,
    elephant: 2,
    horse: 3,
    chariot: 4,
    cannon: 5,
    soldier: 6,
  },
  sides: { black: 0, red: 1 },
  states: { selecting: 0, moving: 1 },
} as const;

type State = Array<Array<ChessPiece | null>>;

const ROWS = 10;
const COLS = 9;
const ORTHOGONAL = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;

export function isInCheck(state: State, side: number): boolean {
  const general = state.flat().find(
    piece => piece?.side === side && piece.type === constants.types.general,
  );
  if (!general) return true;

  const enemy = side === constants.sides.red ? constants.sides.black : constants.sides.red;
  const enemyGeneral = state.flat().find(
    piece => piece?.side === enemy && piece.type === constants.types.general,
  );
  if (enemyGeneral?.col === general.col) {
    const [top, bottom] = [Math.min(enemyGeneral.row, general.row), Math.max(enemyGeneral.row, general.row)];
    let blocked = false;
    for (let row = top + 1; row < bottom; row++) {
      if (state[row][general.col]) {
        blocked = true;
        break;
      }
    }
    if (!blocked) return true;
  }

  return state.flat().some(piece =>
    piece?.side === enemy
      && piece.getNextSteps(state).some(step => step.row === general.row && step.col === general.col),
  );
}

export function getLegalSteps(piece: ChessPiece, state: State): Position[] {
  if (!state.flat().some(
    candidate => candidate?.side === piece.side && candidate.type === constants.types.general,
  )) return [];

  const legal: Position[] = [];
  for (const step of piece.getNextSteps(state)) {
    const nextState = state.map(row => row.slice());
    const fromRow = piece.row;
    const fromCol = piece.col;
    const captured = nextState[step.row][step.col];
    nextState[fromRow][fromCol] = null;
    nextState[step.row][step.col] = piece;
    piece.row = step.row;
    piece.col = step.col;
    let safe = false;
    try {
      safe = !isInCheck(nextState, piece.side);
    } finally {
      piece.row = fromRow;
      piece.col = fromCol;
      nextState[fromRow][fromCol] = piece;
      nextState[step.row][step.col] = captured;
    }
    if (safe) legal.push(step);
  }
  return legal;
}

export function getLegalMoves(state: State, side: number): Array<{ piece: ChessPiece; to: Position }> {
  return state.flat().flatMap(piece =>
    piece?.side === side
      ? getLegalSteps(piece, state).map(to => ({ piece, to }))
      : [],
  );
}

const START_POSITIONS = {
  red: {
    general: [[9, 4]],
    advisor: [[9, 3], [9, 5]],
    elephant: [[9, 2], [9, 6]],
    horse: [[9, 1], [9, 7]],
    chariot: [[9, 0], [9, 8]],
    cannon: [[7, 1], [7, 7]],
    soldier: [[6, 0], [6, 2], [6, 4], [6, 6], [6, 8]],
  },
  black: {
    general: [[0, 4]],
    advisor: [[0, 3], [0, 5]],
    elephant: [[0, 2], [0, 6]],
    horse: [[0, 1], [0, 7]],
    chariot: [[0, 0], [0, 8]],
    cannon: [[2, 1], [2, 7]],
    soldier: [[3, 0], [3, 2], [3, 4], [3, 6], [3, 8]],
  },
} as const;

abstract class Chess implements ChessPiece {
  row: number;
  col: number;

  constructor(
    readonly side: number,
    position: { r: number; c: number },
    readonly type: number,
  ) {
    this.row = position.r;
    this.col = position.c;
  }

  abstract getNextSteps(state: State): Position[];

  protected isOpenFor(state: State, row: number, col: number): boolean {
    const occupant = state[row][col];
    return !occupant || occupant.side !== this.side;
  }

  private inPalace(p: Position): boolean {
    const [top, bottom] = this.side === constants.sides.red ? [7, 9] : [0, 2];
    return p.col >= 3 && p.col <= 5 && p.row >= top && p.row <= bottom;
  }

  protected palaceSteps(state: State, offsets: ReadonlyArray<readonly [number, number]>): Position[] {
    return offsets
      .map(([dr, dc]) => ({ row: this.row + dr, col: this.col + dc }))
      .filter(p => this.inPalace(p) && this.isOpenFor(state, p.row, p.col));
  }
}

class General extends Chess {
  getNextSteps(state: State): Position[] {
    return this.palaceSteps(state, ORTHOGONAL);
  }
}

class Advisor extends Chess {
  getNextSteps(state: State): Position[] {
    return this.palaceSteps(state, [[-1, -1], [-1, 1], [1, -1], [1, 1]]);
  }
}

class Elephant extends Chess {
  getNextSteps(state: State): Position[] {
    const [top, bottom] = this.side === constants.sides.red ? [5, 9] : [0, 4];
    return ([[-2, -2], [-2, 2], [2, -2], [2, 2]] as const)
      .map(([dr, dc]) => ({ row: this.row + dr, col: this.col + dc }))
      .filter(p => p.col >= 0 && p.col <= 8 && p.row >= top && p.row <= bottom
        && !state[(this.row + p.row) / 2][(this.col + p.col) / 2]
        && this.isOpenFor(state, p.row, p.col));
  }
}

class Horse extends Chess {
  getNextSteps(state: State): Position[] {
    const steps: Position[] = [];
    for (const [dr, dc] of [[2, 1], [2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2], [-2, 1], [-2, -1]]) {
      const row = this.row + dr;
      const col = this.col + dc;
      if (row < 0 || row >= ROWS || col < 0 || col >= COLS) continue;
      if (!this.isOpenFor(state, row, col)) continue;
      // The leg: one step toward the target along its long axis.
      const legRow = this.row + (Math.abs(dr) === 2 ? dr / 2 : 0);
      const legCol = this.col + (Math.abs(dc) === 2 ? dc / 2 : 0);
      if (state[legRow][legCol]) continue;
      steps.push({ row, col });
    }
    return steps;
  }
}

class Chariot extends Chess {
  getNextSteps(state: State): Position[] {
    const steps: Position[] = [];
    for (const [dr, dc] of ORTHOGONAL) {
      let row = this.row + dr;
      let col = this.col + dc;
      while (row >= 0 && row < ROWS && col >= 0 && col < COLS) {
        const occupant = state[row][col];
        if (occupant && occupant.side === this.side) break;
        steps.push({ row, col });
        if (occupant) break;
        row += dr;
        col += dc;
      }
    }
    return steps;
  }
}

class Cannon extends Chess {
  getNextSteps(state: State): Position[] {
    const steps: Position[] = [];
    for (const [dr, dc] of ORTHOGONAL) {
      let screened = false;
      let row = this.row + dr;
      let col = this.col + dc;
      while (row >= 0 && row < ROWS && col >= 0 && col < COLS) {
        const occupant = state[row][col];
        if (!screened) {
          if (occupant) screened = true;
          else steps.push({ row, col });
        } else if (occupant) {
          if (occupant.side !== this.side) steps.push({ row, col });
          break;
        }
        row += dr;
        col += dc;
      }
    }
    return steps;
  }
}

class Soldier extends Chess {
  getNextSteps(state: State): Position[] {
    const red = this.side === constants.sides.red;
    const forward = red ? -1 : 1;
    const crossedRiver = red ? this.row <= 4 : this.row >= 5;
    const candidates: Position[] = [{ row: this.row + forward, col: this.col }];
    if (crossedRiver) {
      candidates.push({ row: this.row, col: this.col - 1 }, { row: this.row, col: this.col + 1 });
    }
    return candidates.filter(p =>
      p.row >= 0 && p.row < ROWS && p.col >= 0 && p.col < COLS && this.isOpenFor(state, p.row, p.col));
  }
}

const PIECE_CLASSES = {
  general: General,
  advisor: Advisor,
  elephant: Elephant,
  horse: Horse,
  chariot: Chariot,
  cannon: Cannon,
  soldier: Soldier,
} as const;

export class Chessboard {
  state: State = Array.from({ length: ROWS }, () => Array<ChessPiece | null>(COLS).fill(null));

  constructor() {
    for (const [sideName, layout] of Object.entries(START_POSITIONS) as [
      "red" | "black",
      (typeof START_POSITIONS)["red"],
    ][]) {
      for (const [name, positions] of Object.entries(layout) as [keyof typeof PIECE_CLASSES, readonly (readonly [number, number])[]][]) {
        for (const [r, c] of positions) {
          this.putChess(new PIECE_CLASSES[name](constants.sides[sideName], { r, c }, constants.types[name]));
        }
      }
    }
  }

  // Places a piece at its current row and column.
  putChess(piece: ChessPiece): void {
    this.state[piece.row][piece.col] = piece;
  }

  // Assumes the move is already valid.
  moveChess(piece: ChessPiece, row: number, col: number): void {
    this.state[piece.row][piece.col] = null;
    piece.row = row;
    piece.col = col;
    this.putChess(piece);
  }

  refreshChessPos(): void {
    this.state.forEach((cells, row) => cells.forEach((piece, col) => {
      if (!piece) return;
      piece.row = row;
      piece.col = col;
    }));
  }
}
