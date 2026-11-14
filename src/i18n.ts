export type Language = "zh" | "en";

const english = {
  "中国象棋": "Xiangqi",
  "中国象棋 · tako-xiangqi": "Xiangqi · tako-xiangqi",
  "tako-xiangqi · 3D 中国象棋": "tako-xiangqi · 3D Chinese chess",
  "本机对战 · tako-xiangqi": "Local game · tako-xiangqi",
  "人机对战 · tako-xiangqi": "Computer game · tako-xiangqi",
  "本机对战": "Local game",
  "人机对战": "Play computer",
  "执棋方": "Play as",
  "红方": "Red",
  "黑方": "Black",
  "画面设置": "Graphics",
  "资源线路": "Resource source",
  "自动": "Auto",
  "中国大陆 · 阿里云": "Mainland China · Aliyun",
  "海外 · Netlify": "Overseas · Netlify",
  "正在选择资源线路…": "Selecting a resource source…",
  "无法保存资源线路设置，请检查浏览器存储权限。":
    "Could not save the resource source. Please check your browser's storage permissions.",
  "简单": "Easy",
  "普通": "Normal",
  "困难": "Hard",
  "环境光遮蔽": "Ambient occlusion",
  "景深": "Depth of field",
  "抗锯齿": "Anti-aliasing",
  "体积光": "Volumetric light",
  "关": "Off",
  "低": "Low",
  "高": "High",
  "返回": "Back",
  "选择游戏模式": "Choose a game mode",
  "棋手加载失败，请重试": "Could not load the opponent. Please try again.",
  "返回主菜单": "Main menu",
  "恢复视角": "Reset view",
  "当前回合": "Current turn",
  "红方行棋": "Red to move",
  "黑方行棋": "Black to move",
  "红方等待": "Red waiting",
  "黑方等待": "Black waiting",
  "棋手": "Players",
  "胜率估计": "Win estimate",
  "红方胜率估计": "Red win estimate",
  "黑方胜率估计": "Black win estimate",
  "胜率计算中": "Estimating win rates",
  "胜率暂不可用": "Win estimate unavailable",
  "悔棋": "Undo",
  "提示": "Hint",
  "提示等级": "Hint level",
  "正在计算提示…": "Calculating a hint…",
  "提示计算失败，请重试": "Could not calculate a hint. Please try again.",
  "重开": "Restart",
  "红方获胜": "Red wins",
  "黑方获胜": "Black wins",
  "再来一局": "Play again",
  "页面资源加载进度": "Loading progress",
  "棋局正在展开…": "Preparing the game…",
  "正在打磨棋盘纹理…": "Loading board textures…",
  "棋子正在入阵…": "Loading pieces…",
  "茶香渐渐升起…": "Preparing the tea…",
  "正在布置棋室…": "Loading the room…",
  "还有 {count} 项棋室素材待完成…": "{count} room assets remaining…",
  "有些棋室素材暂时没有载入…": "Some room assets could not be loaded…",
  "部分素材未能载入，棋局仍可继续": "Some assets are missing. You can still play.",
  "棋局准备就绪": "Ready to play",
  "思考中…": "Thinking…",
  "{count} 个合法落点": "{count} legal moves",
  "无法启动 3D 棋盘。请使用支持 WebGL 的现代浏览器并重新载入页面。":
    "Could not start the 3D board. Please reload in a modern browser with WebGL support.",
  "棋盘启动失败": "Could not start the board",
} as const;

export type Message = keyof typeof english;
const STORAGE_KEY = "xiangqi.language";

function loadLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch (error) {
    console.warn("Could not read language preference:", error);
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export let language = loadLanguage();

export function t(message: Message, count?: number): string {
  return (language === "en" ? english[message] : message)
    .replace("{count}", String(count ?? ""));
}

export function setLanguage(next: Language): void {
  language = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch (error) {
    console.warn("Could not save language preference:", error);
  }
  applyTranslations();
}

export function applyTranslations(): void {
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n as Message);
  }
  for (const attribute of ["aria-label", "title"] as const) {
    for (const element of document.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
      const original = element.getAttribute(attribute);
      if (original && Object.hasOwn(english, original) && !element.hasAttribute(`data-i18n-${attribute}`)) {
        element.setAttribute(`data-i18n-${attribute}`, original);
      }
    }
    for (const element of document.querySelectorAll<HTMLElement>(`[data-i18n-${attribute}]`)) {
      element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`) as Message));
    }
  }
}
