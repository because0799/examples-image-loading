// Shader warm-up for the battle view (playtest 1.2.0).
//
// Pixi compiles a GL program the first time something draws with it. The particle container, the
// FX full-screen filters (shockwave, zoom blur, RGB split, bloom, god-rays, colour matrix), the
// tiling sprite and the mesh shader were all first drawn in the middle of a battle — typically
// inside an Ultimate — and the compile + link stalled that one frame for 0.6–1 s (SwiftShader;
// 50–300 ms on a low-end phone GPU). warmShaders() draws each of them once into a tiny offscreen
// render texture, one per timer slice, while the player is still on a menu screen.
//
//   const stop = warmShaders(renderer /* Pixi renderer */, { kinds, slice: 40, onDone })
//   stop()  // cancel the remaining slices

import { Container, Sprite, Texture, RenderTexture, ParticleContainer, Particle, TilingSprite, MeshSimple } from 'pixi.js';
import { FILTER_FACTORIES } from '../../fx/filters.js';

/** Steps (functions drawing one thing into `rt`) for the given filter kinds. */
function buildSteps(renderer, rt, kinds) {
  const draw = (node) => {
    const root = new Container();
    root.addChild(node);
    renderer.render({ container: root, target: rt, clear: true });
    root.destroy({ children: true });
  };
  const steps = [];
  steps.push(() => {
    const pc = new ParticleContainer({
      texture: Texture.WHITE,
      dynamicProperties: { vertex: true, position: true, rotation: true, uvs: true, color: true },
    });
    pc.addParticle(new Particle({ texture: Texture.WHITE, x: 2, y: 2 }));
    draw(pc);
  });
  steps.push(() => draw(new TilingSprite({ texture: Texture.WHITE, width: 8, height: 8 })));
  steps.push(() =>
    draw(
      new MeshSimple({
        texture: Texture.WHITE,
        vertices: new Float32Array([0, 0, 8, 0, 8, 8, 0, 8]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      }),
    ),
  );
  for (const kind of kinds) {
    const make = FILTER_FACTORIES[kind];
    if (typeof make !== 'function') continue;
    steps.push(() => {
      const f = make();
      const s = new Sprite(Texture.WHITE);
      s.width = 8;
      s.height = 8;
      s.filters = [f];
      draw(s);
      try {
        f.destroy();
      } catch (e) {
        /* ignore */
      }
    });
  }
  return steps;
}

/**
 * Compiles the battle shaders ahead of time, one per `slice` ms. Never throws; returns a cancel
 * function. `kinds` = the FX filter kinds the current quality can use (default: all).
 */
export function warmShaders(renderer, { kinds = Object.keys(FILTER_FACTORIES), slice = 40, onDone = null } = {}) {
  let cancelled = false;
  let timer = 0;
  if (!renderer || typeof renderer.render !== 'function') {
    if (onDone) onDone(false);
    return () => {};
  }
  let rt = null;
  try {
    rt = RenderTexture.create({ width: 8, height: 8 });
  } catch (e) {
    if (onDone) onDone(false);
    return () => {};
  }
  const steps = buildSteps(renderer, rt, kinds);
  let i = 0;
  const finish = (ok) => {
    try {
      rt.destroy(true);
    } catch (e) {
      /* ignore */
    }
    if (onDone) onDone(ok);
  };
  const next = () => {
    if (cancelled) return;
    if (i >= steps.length) {
      finish(true);
      return;
    }
    try {
      steps[i++]();
    } catch (e) {
      // a filter that cannot run here (no WebGL2 feature…) is simply skipped
    }
    timer = setTimeout(next, slice);
  };
  timer = setTimeout(next, slice);
  return () => {
    if (cancelled) return;
    cancelled = true;
    clearTimeout(timer);
    finish(false);
  };
}
