import { DefaultLoadingManager } from "three";
import { BoardRenderer } from "./board-renderer";
import { GameController, type GameState } from "./game-controller";
import { AiEngine, type AiLevel } from "./ai-engine";
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
const loadingScreen = requireElement<HTMLElement>("loading-screen");
const loadingMeter = requireElement<HTMLElement>("loading-meter");
const loadingMeterFill = requireElement<HTMLElement>("loading-meter-fill");
const loadingStatus = requireElement<HTMLElement>("loading-status");
const loadingPercent = requireElement<HTMLElement>("loading-percent");
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
const modeList = requireElement<HTMLElement>("btn-local").parentElement as HTMLElement;
const levelList = requireElement<HTMLElement>("level-list");
const engineLoading = requireElement<HTMLElement>("engine-loading");
const engineLoadingFill = requireElement<HTMLElement>("engine-loading-fill");
const engineLoadingPercent = requireElement<HTMLElement>("engine-loading-percent");
const engineError = requireElement<HTMLElement>("engine-error");
const sides = window.XiangqiRules.constants.sides;

const ROSTER_GLYPHS = {
  red: ["帅", "仕", "相", "傌", "俥", "炮", "兵"],
  black: ["将", "士", "象", "馬", "車", "砲", "卒"],
};
const ROSTER_TOTALS = [1, 2, 2, 2, 2, 2, 5];
const ROSTER_ORDER = [0, 4, 3, 5, 2, 1, 6];

function buildRoster(side: "red" | "black"): HTMLElement[] {
  const root = requireElement<HTMLElement>(`${side}-roster`);
  return ROSTER_ORDER.map(type => {
    const token = document.createElement("span");
    token.className = "roster-piece";
    token.textContent = ROSTER_GLYPHS[side][type];
    const count = document.createElement("i");
    count.className = "roster-count";
    token.append(count);
    root.append(token);
    return token;
  });
}

const rosterTokens = { red: buildRoster("red"), black: buildRoster("black") };

function updateRoster(side: "red" | "black", alive: number[]): void {
  ROSTER_ORDER.forEach((type, index) => {
    const token = rosterTokens[side][index];
    const count = alive[type];
    token.classList.toggle("is-lost", count === 0);
    token.classList.toggle("is-hurt", count > 0 && count < ROSTER_TOTALS[type]);
    const badge = token.lastElementChild as HTMLElement;
    badge.textContent = ROSTER_TOTALS[type] > 1 ? String(count) : "";
  });
}

let renderer: BoardRenderer | null = null;
let game: GameController | null = null;
let loadingErrors = 0;
let loadingFinished = false;
const loadingStartedAt = performance.now();

function setLoadingProgress(progress: number): void {
  const value = Math.max(0, Math.min(100, Math.floor(progress)));
  loadingMeter.setAttribute("aria-valuenow", String(value));
  loadingMeterFill.style.width = `${value}%`;
  loadingPercent.textContent = `${value}%`;
}

function loadingMessageFor(url: string): string {
  const asset = url.toLowerCase();
  if (asset.includes("board-walnut")) return "正在打磨棋盘纹理…";
  if (asset.includes("xiangqi-pieces")) return "棋子正在入阵…";
  if (asset.includes("tea")) return "茶香渐渐升起…";
  if (asset.includes("tatami") || asset.includes("shoji") || asset.includes("wall-plaster")) {
    return "正在布置棋室…";
  }
  return "棋局正在展开…";
}

function finishLoading(message: string): void {
  if (loadingFinished) return;
  loadingFinished = true;
  setLoadingProgress(100);
  loadingStatus.textContent = message;

  const minimumVisibleTime = loadingErrors > 0 ? 1200 : 520;
  const remainingTime = Math.max(
    200,
    minimumVisibleTime - (performance.now() - loadingStartedAt),
  );
  window.setTimeout(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        loadingScreen.classList.add("is-done");
        loadingScreen.setAttribute("aria-hidden", "true");
        window.setTimeout(() => {
          loadingScreen.hidden = true;
        }, 320);
      });
    });
  }, remainingTime);
}

DefaultLoadingManager.onStart = url => {
  if (!loadingFinished) loadingStatus.textContent = loadingMessageFor(url);
};
DefaultLoadingManager.onProgress = (url, loaded, total) => {
  if (loadingFinished) return;
  setLoadingProgress(total > 0 ? (loaded / total) * 100 : 0);
  loadingStatus.textContent = loadingErrors > 0
    ? `还有 ${Math.max(total - loaded, 0)} 项棋室素材待完成…`
    : loadingMessageFor(url);
};
DefaultLoadingManager.onError = () => {
  loadingErrors += 1;
  loadingStatus.textContent = "有些棋室素材暂时没有载入…";
};
DefaultLoadingManager.onLoad = () => {
  finishLoading(
    loadingErrors > 0 ? "部分素材未能载入，棋局仍可继续" : "棋局准备就绪",
  );
};

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
  updateRoster("red", state.aliveRed);
  updateRoster("black", state.aliveBlack);
  selectionNote.hidden = !state.selected && !state.thinking;
  selectionNote.textContent = state.thinking
    ? "思考中…"
    : state.selected
      ? `${state.legalMoveCount} 个合法落点`
      : "";
}

function startLocalGame(): void {
  game?.setAi(null);
  game?.newGame();
  game?.start();
  renderer?.setMenuMode(false);
  menuScreen.hidden = true;
  gameScreen.hidden = false;
}

const engine = new AiEngine();
let engineBusy = false;

function showLevels(visible: boolean): void {
  modeList.hidden = visible;
  levelList.hidden = !visible;
  engineError.hidden = true;
}

async function startAiGame(level: AiLevel): Promise<void> {
  if (engineBusy) return;
  engineBusy = true;
  engineError.hidden = true;
  levelList.hidden = true;
  engineLoading.hidden = false;
  try {
    await engine.load(fraction => {
      const value = Math.floor(fraction * 100);
      engineLoadingFill.style.width = `${value}%`;
      engineLoadingPercent.textContent = `${value}%`;
    });
    game?.setAi({ engine, level });
    game?.newGame();
    game?.start();
    renderer?.setMenuMode(false);
    menuScreen.hidden = true;
    gameScreen.hidden = false;
    showLevels(false);
  } catch (error) {
    console.error("AI 引擎加载失败:", error);
    engineError.hidden = false;
    levelList.hidden = false;
  } finally {
    engineLoading.hidden = true;
    engineBusy = false;
  }
}

function showMenu(): void {
  resultDialog.close();
  game?.newGame();
  showLevels(false);
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
  requireElement<HTMLButtonElement>("btn-ai").addEventListener("click", () => showLevels(true));
  requireElement<HTMLButtonElement>("btn-level-back").addEventListener("click", () => showLevels(false));
  for (const button of levelList.querySelectorAll<HTMLButtonElement>("[data-level]")) {
    button.addEventListener("click", () => void startAiGame(button.dataset.level as AiLevel));
  }
  requireElement<HTMLButtonElement>("btn-undo").addEventListener("click", () => {
    game?.undo();
  });
  requireElement<HTMLButtonElement>("btn-new-game").addEventListener("click", restartGame);
  requireElement<HTMLButtonElement>("btn-rematch").addEventListener("click", restartGame);
  requireElement<HTMLButtonElement>("btn-menu").addEventListener("click", showMenu);
  requireElement<HTMLButtonElement>("btn-view").addEventListener("click", () => {
    game?.resetView();
  });
} catch (error) {
  console.error("棋盘初始化失败:", error);
  rendererError.hidden = false;
  rendererError.textContent =
    "无法启动 3D 棋盘。请使用支持 WebGL 的现代浏览器并重新载入页面。";
  startButton.disabled = true;
  finishLoading("棋盘启动失败");
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => renderer?.dispose());
}
