export type ResourcePreference = "auto" | "cn" | "global";

const OSS_BASE = "https://tako-threejs.oss-cn-shanghai.aliyuncs.com/tako-xiangqi/";
const STORAGE_KEY = "xiangqi.resource-source";
export const localResourcesOnly = import.meta.env.DEV
  || ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(window.location.hostname)
  || window.location.hostname.endsWith(".localhost");
let source: "cn" | "global" = "global";

export function getResourcePreference(): ResourcePreference {
  try {
    const preference = localStorage.getItem(STORAGE_KEY);
    if (preference === "cn" || preference === "global") return preference;
    if (preference !== null && preference !== "auto") {
      console.warn("Invalid resource source preference:", preference);
    }
  } catch (error) {
    console.warn("Could not read resource source preference:", error);
  }
  return "auto";
}

export function saveResourcePreference(preference: ResourcePreference): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
    return true;
  } catch (error) {
    console.warn("Could not save resource source preference:", error);
    return false;
  }
}

export async function initializeResourceSource(): Promise<void> {
  if (localResourcesOnly) {
    source = "global";
    return;
  }
  const preference = getResourcePreference();
  if (preference !== "auto") {
    source = preference;
    return;
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}api/region`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Region lookup HTTP ${response.status}`);
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("country" in data)
      || typeof data.country !== "string" || !/^[A-Z]{2}$/.test(data.country)) {
      throw new Error("Region lookup returned no valid country code");
    }
    source = data.country === "CN" ? "cn" : "global";
  } catch (error) {
    source = "global";
    console.warn("Region lookup failed; using same-origin resources. Choose a resource source in Graphics if needed.", error);
  } finally {
    window.clearTimeout(timeout);
  }
}

export function resourceUrl(path: string): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path)) return path;
  const relative = path.replace(/^(?:\.\/|\/)/, "");
  const isEngine = /^engine\/pikafish\.(?:wasm|data)$/.test(relative);
  if (source === "cn" && (/^(?:textures|audio)\//.test(relative) || isEngine)) {
    return new URL(isEngine ? relative.slice("engine/".length) : relative, OSS_BASE).href;
  }
  return new URL(relative, new URL(import.meta.env.BASE_URL, document.baseURI)).href;
}
