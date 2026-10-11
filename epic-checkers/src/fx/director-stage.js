// Stage — where the Director's screen texts go, so they never pile up and every one of them stays
// on screen long enough to be READ (EAD-01/02/03/15, the client's «не успеваешь прочитать текст»).
//
//   const stage = new Stage(director);
//   stage.setLanes({ top: { y, h } | null, bottom: { y, h } | null });  // free screen space (CSS px)
//                                         // between the HUD panels and the board frame
//   stage.request(side, kind, { h, maxWait, make(place) -> overlayPromise, duration, read })
//       -> Promise<{ overlay } | null>    // resolves when shown (null = dropped: waited too long /
//                                         // superseded); the overlay promise itself is wrapped so
//                                         // the request does not wait for the overlay to END
//   stage.claim(side, kind, handle, alive, read)  // register an overlay shown right now
//   stage.isFree(side, kind)              // nothing there that may not be cut yet
//   stage.whenFree(side, kind, { maxWait }) -> Promise  // a cinematic waits for its text slot:
//                                         // older texts are cut as soon as they were readable
//                                         // long enough (or after maxWait at the latest)
//   stage.tick()                          // once per frame (Director clock listener)
//   stage.place(side, kind)               // { y, maxH, lane } for an overlay shown right now
//   stage.busyUntil(side) / stage.clear()
//
// Sides: 'top' / 'bottom' (the lanes of the players drawn there) and 'center' (full-width bands and
// banners over the board: cut-ins, «ПРОБУЖДЕНИЕ», «ДА НАЧНЁТСЯ БИТВА!», game-over banners).
// Overlay kinds: 'banner' (turn banner), 'hype' («ЯРОСТЬ 100%»), 'caption' (speech bubble),
// 'combo' (counter), 'big' (centre band / banner).
// Each lane side has ONE lane:
//   - a real lane (≥ MIN_LANE px of free space, set by the controller): overlays are centred in it;
//     when it is tall enough for both, banners take the row next to the board and captions the
//     row next to the HUD panel (they may then be on screen together);
//   - otherwise the old placement at the board edge (one row: everything queues).
// READABILITY RULE: every overlay carries its readable time (`read`, prefs.readMs). A newer text
// may cut an older one only once the older one has been on screen for MIN_VISIBLE_SHARE (60 %) of
// its readable time — until then the newer one queues. Only the player's tap (Director.skip)
// cuts texts earlier. Banners / hype / centre requests cut eligible occupants; captions never cut
// anything (they wait); requests that cannot be shown within maxWait are dropped.

import { shorten } from './director-ui.js';
import { MIN_VISIBLE_SHARE } from './prefs.js';

export const MIN_LANE = 44;
/** kinds that may cut an older overlay (once it has been readable long enough) */
const CUTTERS = new Set(['banner', 'hype', 'big', 'wait']);

const now = (d) => (d && d._clock ? d._clock.realNow : 0);

export class Stage {
  constructor(director) {
    this.d = director;
    this.lanes = { top: null, bottom: null };
    this.items = [];
    this.queue = [];
    this.share = MIN_VISIBLE_SHARE;
  }

  /** lanes: { top: { y, h } | null, bottom: { y, h } | null } in screen CSS px. */
  setLanes(l) {
    const norm = (v) => {
      if (!v || !(v.h > 0) || !Number.isFinite(+v.y)) return null;
      return { y: +v.y, h: +v.h };
    };
    this.lanes = { top: norm(l && l.top), bottom: norm(l && l.bottom) };
  }

  /** The usable lane of a side ({ y, h }) or null (too small / unknown / the centre). */
  lane(side) {
    const l = side === 'top' || side === 'bottom' ? this.lanes[side] : null;
    return l && l.h >= MIN_LANE ? l : null;
  }

  _fx() {
    return this.d.fx;
  }

  /** Does the lane of `side` fit a banner and a caption side by side (two rows)? */
  _twoRows(side) {
    const l = this.lane(side);
    if (!l) return false;
    const H = this._heights();
    return l.h >= H.banner + H.caption1 + 6;
  }

  _heights() {
    const d = this.d;
    const ov = (kind, lines) => {
      try {
        const v = typeof d._overlayHeight === 'function' ? d._overlayHeight(kind, lines) : 0;
        return v > 0 ? v : 0;
      } catch (e) {
        return 0;
      }
    };
    return {
      banner: ov('banner') || 42,
      caption1: ov('caption', 1) || 60,
      caption2: ov('caption', 2) || 86,
    };
  }

  /** Row of an overlay kind in a lane: 'all' (one row), 'near' (next to the board) or 'far'. */
  _row(side, kind) {
    if (kind === 'combo' || side === 'center' || !this._twoRows(side)) return 'all';
    return kind === 'caption' ? 'far' : 'near';
  }

  _conflict(a, b) {
    return a.side === b.side && (a.row === 'all' || b.row === 'all' || a.row === b.row);
  }

  /** May `it` be cut now (it has been readable for ≥ 60 % of its readable time)? */
  canCut(it, t = now(this.d)) {
    if (!it || it.done) return true;
    if (!(it.read > 0)) return true;
    return t - it.born >= this.share * it.read;
  }

  /**
   * Where an overlay of `kind` goes on `side` right now: { y (centre), maxH, lane }.
   * y is undefined for the board-edge fallback (the overlay picks its classic spot).
   */
  place(side, kind) {
    const l = this.lane(side);
    if (!l) return { y: undefined, maxH: 0, lane: false };
    const row = this._row(side, kind);
    const nearBoard = side === 'top' ? 1 : -1; // the board is below the top lane, above the bottom one
    if (row === 'all') return { y: l.y + l.h / 2, maxH: l.h - 4, lane: true };
    const H = this._heights();
    const bh = H.banner;
    const ch = l.h - bh - 4;
    // 'near' row hugs the board, 'far' row hugs the HUD panel
    if (row === 'near') {
      const y = nearBoard > 0 ? l.y + l.h - bh / 2 - 1 : l.y + bh / 2 + 1;
      return { y, maxH: bh, lane: true };
    }
    const y = nearBoard > 0 ? l.y + ch / 2 + 1 : l.y + l.h - ch / 2 - 1;
    return { y, maxH: ch, lane: true };
  }

  _prune() {
    let w = 0;
    const list = this.items;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (!it.done && (!it.alive || it.alive())) list[w++] = it;
    }
    list.length = w;
  }

  /** Real time (ms) until which `side` shows something (0 when free). */
  busyUntil(side) {
    this._prune();
    let t = 0;
    for (const it of this.items) if (it.side === side) t = Math.max(t, it.until || now(this.d) + 1);
    return t;
  }

  /** Nothing on `side` (in the row of `kind`) that may not be cut yet? */
  isFree(side, kind) {
    this._prune();
    const probe = { side, row: this._row(side, kind) };
    const t = now(this.d);
    return !this.items.some((it) => this._conflict(probe, it) && !this.canCut(it, t));
  }

  /**
   * Show an overlay as soon as its row is free. o: { h, maxWait (ms), make(place) -> promise,
   * duration (ms, expected on-screen time), read (ms, readable time) }. Resolves with { overlay }
   * once it is shown, or null when dropped.
   */
  request(side, kind, o = {}) {
    return new Promise((resolve) => {
      try {
        const req = { side, kind, row: this._row(side, kind), o, at: now(this.d), resolve, maxWait: o.maxWait != null ? o.maxWait : 1200 };
        // a newer banner on the same side supersedes a queued older one
        if (kind === 'banner') {
          for (const q of this.queue.slice()) {
            if (q.side === side && q.kind === 'banner') this._drop(q);
          }
        }
        this.queue.push(req);
        this._pump();
      } catch (e) {
        console.error('[director] overlay request failed', e);
        resolve(null);
      }
    });
  }

  /**
   * Resolves when `side` (row of `kind`) is free: occupants are cut as soon as they have been
   * readable for 60 % of their time; after maxWait they are cut anyway (a cinematic never stalls).
   */
  whenFree(side, kind = 'big', { maxWait = 4000 } = {}) {
    if (this.isFree(side, kind) && !this.items.some((it) => this._conflict({ side, row: this._row(side, kind) }, it))) return Promise.resolve(true);
    return new Promise((resolve) => {
      const req = { side, kind: 'wait', row: this._row(side, kind), o: { make: null }, at: now(this.d), maxWait, waiter: true, resolve: () => resolve(true) };
      this.queue.push(req);
      this._pump();
    });
  }

  /** Register an overlay that is on screen right now (it cuts what may be cut in its row). */
  claim(side, kind, handle, alive = null, read = 0) {
    const row = this._row(side, kind);
    const t = now(this.d);
    const it = { side, kind, row, handle, born: t, alive, read, until: 0, done: false };
    for (const other of this.items) {
      if (other !== it && this._conflict(it, other) && this.canCut(other, t)) this._evict(other, 160);
    }
    this.items.push(it);
    if (handle && typeof handle.then === 'function') handle.then(() => (it.done = true), () => (it.done = true));
    return it;
  }

  _drop(q) {
    const i = this.queue.indexOf(q);
    if (i >= 0) this.queue.splice(i, 1);
    q.resolve(null);
  }

  _evict(it, ms) {
    if (it.done || it.shortened) return;
    it.shortened = true;
    if (it.kind === 'combo') {
      const fx = this._fx();
      if (fx && typeof fx.hideCombo === 'function') fx.hideCombo();
      return;
    }
    if (it.handle) shorten(it.handle, ms);
  }

  tick() {
    if (!this.queue.length) return;
    try {
      this._pump();
    } catch (e) {
      console.error('[director] overlay queue failed', e);
      this.clear();
    }
  }

  _pump() {
    this._prune();
    const t = now(this.d);
    for (const q of this.queue.slice()) {
      const blockers = this.items.filter((it) => this._conflict(q, it));
      if (!blockers.length) {
        if (q.waiter) {
          const i = this.queue.indexOf(q);
          if (i >= 0) this.queue.splice(i, 1);
          q.resolve();
        } else this._show(q);
        continue;
      }
      const late = t - q.at > q.maxWait;
      if (late && !q.waiter) {
        this._drop(q);
        continue;
      }
      if (CUTTERS.has(q.kind)) {
        // time-critical texts: an occupant goes as soon as it has been readable long enough (a
        // waiting cinematic cuts it anyway once maxWait has passed); the combo counter (the
        // running move) is waited for unless the cinematic itself needs the slot
        for (const b of blockers) {
          if (b.kind === 'combo' && !q.waiter) continue;
          if (late || this.canCut(b, t)) this._evict(b, b.kind === 'banner' ? 140 : 220);
        }
      }
    }
  }

  _show(q) {
    const i = this.queue.indexOf(q);
    if (i >= 0) this.queue.splice(i, 1);
    let handle = null;
    try {
      const pl = this.place(q.side, q.kind);
      handle = q.o.make ? q.o.make(pl) : null;
    } catch (e) {
      console.error('[director] overlay failed', e);
    }
    if (handle) {
      const t = now(this.d);
      const it = { side: q.side, kind: q.kind, row: q.row, handle, born: t, read: q.o.read || 0, until: t + (q.o.duration || 1000), done: false };
      this.items.push(it);
      if (typeof handle.then === 'function') handle.then(() => (it.done = true), () => (it.done = true));
    }
    q.resolve(handle ? { overlay: handle } : null);
  }

  /** Drop everything queued (the overlays already on screen are left to the FX runner). */
  clear() {
    for (const q of this.queue.slice()) {
      if (q.waiter) {
        const i = this.queue.indexOf(q);
        if (i >= 0) this.queue.splice(i, 1);
        q.resolve();
      } else this._drop(q);
    }
    this.items = [];
  }
}
