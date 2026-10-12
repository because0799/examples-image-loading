// «Валькирии доски» — the RPG mode's entry point for the app (src/main.js).
//
//   import { RpgController } from './rpg/index.js';
//   const rpg = new RpgController({ root: #ui, classicUi, renderer, fx, audio, native, settings, perf, opts });
//   ui.on('open-rpg', () => rpg.open());          // the menu tile «Валькирии доски»
//   back button: if (rpg.visible) return rpg.handleBack();
//
// Modules: battle (engine), ai (battle AI + worker), meta (profile, gacha, campaign, economy),
// render (BattleView), ui (RpgUI), assets / voice, controller (this integration).

export { RpgController, RpgAI, BATTLE_SAVE_KEY, AUTO_ANYWHERE, AI_PAUSE_MS } from './controller.js';
export { RPG_ASSETS } from './assets.js';
export { playVoice, configureVoice } from './voice.js';
