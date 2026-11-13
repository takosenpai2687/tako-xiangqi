import type { XiangqiRules } from "./domain";

declare global {
  interface Window {
    XiangqiRules: XiangqiRules;
  }
}

export {};
