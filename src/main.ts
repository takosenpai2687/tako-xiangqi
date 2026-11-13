import { BoardRenderer } from "./board-renderer";
import { GameController, type GameState } from "./game-controller";
import "./styles.css";

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element: #${id}`);
  return element as T;
}

const canvas = requireElement<HTMLCanvasElement>("board-canvas");
const viewport = requireElement<HTMLElement>("board-viewport");
const rendererError = requireElement<HTMLElement>("renderer-error");
const menuScreen = requireElement<HTMLElement>("menu-screen");
const gameScreen = requireElement<HTMLElement>("game-screen");
const turnStatuses = requireElement<HTMLElement>("turn-statuses");
const redTurnState = requireElement<HTMLElement>("red-turn-state");
const blackTurnState = requireElement<HTMLElement>("black-turn-state");
const selectionNote = requireElement<HTMLElement>("selection-note");
const redPlayer = requireElement<HTMLElement>("red-player");
const blackPlayer = requireElement<HTMLElement>("black-player");
const undoButton = requireElement<HTMLButtonElement>("btn-undo");
const resultDialog = requireElement<HTMLDialogElement>("result-dialog");
const resultTitle = requireElement<HTMLElement>("result-title");
const resultEmblem = requireElement<HTMLElement>("result-emblem");
const startButton = requireElement<HTMLButtonElement>("btn-local");
const sides = window.XiangqiRules.constants.sides;

let renderer: BoardRenderer | null = null;
let game: GameController | null = null;

function describeState(state: GameState): void {
  const redTurn = state.turn === sides.red;
  turnStatuses.setAttribute("aria-label", redTurn ? "红方行棋" : "黑方行棋");
  redTurnState.classList.toggle("is-active", state.started && redTurn);
  blackTurnState.classList.toggle("is-active", state.started && !redTurn);
  redPlayer.classList.toggle("is-active", state.started && redTurn);
  blackPlayer.classList.toggle("is-active", state.started && !redTurn);
  redPlayer.setAttribute("aria-label", redTurn ? "红方行棋" : "红方等待");
  blackPlayer.setAttribute("aria-label", redTurn ? "黑方等待" : "黑方行棋");
  undoButton.disabled = state.moveCount === 0;
  selectionNote.hidden = !state.selected;
  selectionNote.textContent = state.selected
    ? `${state.legalMoveCount} 个合法落点`
    : "";
}

function startLocalGame(): void {
  game?.start();
  renderer?.setMenuMode(false);
  menuScreen.hidden = true;
  gameScreen.hidden = false;
}

function showMenu(): void {
  resultDialog.close();
  game?.newGame();
  gameScreen.hidden = true;
  menuScreen.hidden = false;
  renderer?.setMenuMode(true);
}

function restartGame(): void {
  resultDialog.close();
  game?.newGame();
  game?.start();
  renderer?.setMenuMode(false);
  menuScreen.hidden = true;
  gameScreen.hidden = false;
}

try {
  renderer = new BoardRenderer(viewport, canvas);
  renderer.setMenuMode(true);
  game = new GameController(renderer, {
    onStateChange: describeState,
    onWinner: winner => {
      resultTitle.textContent = winner === "red" ? "红方获胜" : "黑方获胜";
      resultEmblem.textContent = winner === "red" ? "帅" : "将";
      resultDialog.dataset.winner = winner;
      resultDialog.showModal();
    },
  });

  startButton.addEventListener("click", startLocalGame);
  requireElement<HTMLButtonElement>("btn-undo").addEventListener("click", () => {
    game?.undo();
  });
  requireElement<HTMLButtonElement>("btn-new-game").addEventListener("click", restartGame);
  requireElement<HTMLButtonElement>("btn-rematch").addEventListener("click", restartGame);
  requireElement<HTMLButtonElement>("btn-menu").addEventListener("click", showMenu);
  requireElement<HTMLButtonElement>("btn-view").addEventListener("click", () => {
    renderer?.rotateView();
  });
} catch (error) {
  console.error("棋盘初始化失败:", error);
  rendererError.hidden = false;
  rendererError.textContent =
    "无法启动 3D 棋盘。请使用支持 WebGL 的现代浏览器并重新载入页面。";
  startButton.disabled = true;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => renderer?.dispose());
}
