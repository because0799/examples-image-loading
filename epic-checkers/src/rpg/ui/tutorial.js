// «Валькирии доски» — first-battle help: stage tutorial cards (the stage's `tutorial` id: basics,
// reactions, chains, taunt, awakening, portals) and the «Как играть» rules sheet (pause menu).
//
//   await openTutorialCard(ui, id)   sheet with the card's paragraphs + «Понятно!»; resolves on close
//   openHowTo(ui)                    the rules summary (tut.basics)
//   TUTORIAL_IDS                     ids that have a card
// The coach bubble of the first battle lives in the HUD (hud.coach); the controller decides the steps.

import { h, rvButton } from './components.js';
import { rt, rtList } from './i18n.js';

export const TUTORIAL_IDS = ['basics', 'reactions', 'chains', 'taunt', 'awakening', 'portals'];

const KANJI = { basics: '教', reactions: '反', chains: '連', taunt: '盾', awakening: '冠', portals: '門' };

function cardBody(id) {
  return h('ol.rv-tut__list', ...rtList(`tut.${id}.lines`).map((t) => h('li.rv-tut__item', t)));
}

/** A stage tutorial card; resolves (true) when it is closed in any way. */
export function openTutorialCard(ui, id) {
  if (!TUTORIAL_IDS.includes(id)) return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(true);
    };
    ui.openSheet(
      (close) =>
        h(
          'div.rv-tut',
          cardBody(id),
          rvButton(ui, {
            label: rt('tut.gotIt'),
            icon: 'check',
            kind: 'gold',
            size: 'md',
            cls: 'rv-btn--center rv-tut__ok',
            onClick: () => close(),
          }),
        ),
      { title: rt(`tut.${id}.title`), kanji: KANJI[id] || '教', cls: 'rv-sheet--tut', onClose: finish },
    );
  });
}

/** «Как играть»: the battle rules in five lines. */
export function openHowTo(ui) {
  return openTutorialCard(ui, 'basics');
}
