// «Валькирии доски» — mode settings on the SHARED live settings object (ARCHITECTURE.md §6):
//
//   settings.rpgVoice     boolean, default true  — Japanese hero voices (src/rpg/voice.js reads it)
//   settings.voiceVolume  0..1,    default 0.9   — voice volume
//
// The classic storage (src/ui/storage.js sanitizeSettings) only persists the fields it knows, so the
// RPG fields are ALSO saved under their own key. On start, values missing on the live object are
// filled from that key (or the defaults); a value the live object already has wins (once the classic
// storage learns these fields, it becomes the source of truth and this key just mirrors it).

export const RPG_SETTINGS_KEY = 'epic-checkers.rpg-settings.v1';
export const RPG_SETTINGS_DEFAULTS = Object.freeze({ rpgVoice: true, voiceVolume: 0.9 });
export const RPG_SETTING_KEYS = Object.freeze(Object.keys(RPG_SETTINGS_DEFAULTS));

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** Validated copy of the RPG fields of `obj` (missing / invalid -> defaults). */
export function sanitizeRpgSettings(obj) {
  const s = isObj(obj) ? obj : {};
  const d = RPG_SETTINGS_DEFAULTS;
  const vol = typeof s.voiceVolume === 'number' && Number.isFinite(s.voiceVolume) ? Math.min(1, Math.max(0, Math.round(s.voiceVolume * 100) / 100)) : d.voiceVolume;
  return {
    rpgVoice: typeof s.rpgVoice === 'boolean' ? s.rpgVoice : d.rpgVoice,
    voiceVolume: vol,
  };
}

function storageOf(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage || null;
  } catch (e) {
    return null;
  }
}

export function loadRpgSettings(storage) {
  const st = storageOf(storage);
  if (!st) return { ...RPG_SETTINGS_DEFAULTS };
  try {
    const raw = st.getItem(RPG_SETTINGS_KEY);
    return sanitizeRpgSettings(raw ? JSON.parse(raw) : null);
  } catch (e) {
    return { ...RPG_SETTINGS_DEFAULTS };
  }
}

export function saveRpgSettings(settings, storage) {
  const st = storageOf(storage);
  if (!st) return false;
  try {
    st.setItem(RPG_SETTINGS_KEY, JSON.stringify({ v: 1, ...sanitizeRpgSettings(settings) }));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Makes sure the live settings object carries valid RPG fields (mutates it, keeps its identity).
 * Missing fields come from the RPG key (or defaults); present valid ones are kept.
 */
export function ensureRpgSettings(settings, storage) {
  if (!isObj(settings)) return settings;
  const stored = loadRpgSettings(storage);
  const has = (k) => k in settings && settings[k] !== undefined;
  const merged = sanitizeRpgSettings({
    rpgVoice: has('rpgVoice') ? settings.rpgVoice : stored.rpgVoice,
    voiceVolume: has('voiceVolume') ? settings.voiceVolume : stored.voiceVolume,
  });
  try {
    Object.assign(settings, merged);
  } catch (e) {
    /* frozen settings (tests): nothing to do */
  }
  return settings;
}

/** Applies a patch of RPG fields to the live settings object and persists them. */
export function updateRpgSettings(settings, patch, storage, { live = false } = {}) {
  if (!isObj(settings)) return settings;
  const next = sanitizeRpgSettings({ ...pickRpg(settings), ...pickRpg(patch) });
  Object.assign(settings, next);
  if (!live) saveRpgSettings(settings, storage);
  return settings;
}

function pickRpg(obj) {
  const out = {};
  if (!isObj(obj)) return out;
  for (const k of RPG_SETTING_KEYS) if (k in obj) out[k] = obj[k];
  return out;
}
