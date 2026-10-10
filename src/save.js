// Progress persistence (per-browser). Every access is guarded: storage can be
// unavailable in private windows or embedded previews.
const KEY = 'blockcity-spiderman-save-v1';

export function defaultSave() {
  return {
    missionIndex: 0,
    backpacks: [],
    suits: ['classic'],
    suit: 'classic',
    crimes: 0,
    started: false,
    finished: false,
    timeOfDay: 'day',
  };
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    return { ...defaultSave(), ...JSON.parse(raw) };
  } catch {
    return defaultSave();
  }
}

export function writeSave(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable: progress lasts for this session only */
  }
}

export function hasSave() {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}
