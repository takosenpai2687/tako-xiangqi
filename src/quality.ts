export interface QualitySettings {
  ssao: 0 | 1 | 2;
  dof: boolean;
  antialias: boolean;
  volumetric: boolean;
}

const STORAGE_KEY = "xiangqi.quality";
const DEFAULTS: QualitySettings = { ssao: 2, dof: true, antialias: true, volumetric: true };

export function loadQuality(): QualitySettings {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    const quality = { ...DEFAULTS };
    if (stored.ssao === 0 || stored.ssao === 1 || stored.ssao === 2) quality.ssao = stored.ssao;
    for (const key of ["dof", "antialias", "volumetric"] as const) {
      if (typeof stored[key] === "boolean") quality[key] = stored[key];
    }
    return quality;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveQuality(quality: QualitySettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(quality));
  } catch {
    // Storage may be unavailable (private mode); the setting just won't persist.
  }
}
