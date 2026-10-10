// Stage — where the Director's screen overlays go, so they never pile up (EAD-01/02/03/15).
//
//   const stage = new Stage(director);
//   stage.setLanes({ top: { y, h } | null, bottom: { y, h } | null });  // free screen space (CSS px)
//                                         // between the HUD panels and the board frame
//   stage.request(side, kind, { h, maxWait, make(place) -> overlayPromise })
//       -> Promise<{ overlay } | null>    // resolves when shown (null = dropped: waited too long /
//                                         // superseded); the overlay promise itself is wrapped so
//                                         // the request does not wait for the overlay to END
//   stage.claim(side, kind, handle, alive) // register an overlay that cannot wait (combo counter)
//   stage.tick()                          // once per frame (Director clock listener)
//   stage.place(side, kind)               // { y, maxH, lane } for an overlay shown right now
//   stage.busyUntil(side) / stage.clear()
//
// Overlay kinds: 'banner' (turn banner, «ЯРОСТЬ 100%»), 'caption' (speech bubble), 'combo'.
// Each side ('top' = the player drawn at the top, 'bottom') has ONE lane:
//   - a real lane (≥ MIN_LANE px of free space, set by the controller): overlays are centred in it;
//     when it is tall enough for both, banners take the row next to the board and captions the
//     row next to the HUD panel (they may then be on screen together);
//   - otherwise the old placement at the board edge (one row: everything queues).
// Rules: never two overlays in the same row; a new banner replaces an older banner and asks a
// caption that has been readable for a while (≥ 700 ms) to exit early; captions never preempt;
// the combo counter takes the whole lane at once (it belongs to the running move); requests that
// cannot be shown within maxWait are dropped. Overlays must be real-time FX effects (caption /
// turnBanner from director-ui.js) — shorten() makes them exit gracefully.

import { shorten } from './director-ui.js';

export const MIN_LANE = 44;
const PREEMPT_AFTER = 700;

const now = (d) => (d && d._clock ? d._clock.realNow : 0);

export class Stage {
  constructor(director) {
    this.d = director;
    this.lanes = { top: null, bottom: null };
    this.items = [];
    this.queue = [];
  }

  /** lanes: { top: { y, h } | null, bottom: { y, h } | null } in screen CSS px. */
  setLanes(l) {
    const norm = (v) => {
      if (!v || !(v.h > 0) || !Number.isFinite(+v.y)) return null;
      return { y: +v.y, h: +v.h };
    };
    this.lanes = { top: norm(l && l.top), bottom: norm(l && l.bottom) };
  }

  /** The usable lane of a side ({ y, h }) or null (too small / unknown). */
  lane(side) {
    const l = this.lanes[side];
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
    if (kind === 'combo' || !this._twoRows(side)) return 'all';
    return kind === 'caption' ? 'far' : 'near';
  }

  _conflict(a, b) {
    return a.side === b.side && (a.row === 'all' || b.row === 'all' || a.row === b.row);
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
    this.items = this.items.filter((it) => !it.done && (!it.alive || it.alive()));
  }

  /** Real time (ms) until which `side` shows something (0 when free). */
  busyUntil(side) {
    this._prune();
    let t = 0;
    for (const it of this.items) if (it.side === side) t = Math.max(t, it.until || now(this.d) + 1);
    return t;
  }

  /**
   * Show an overlay as soon as its row is free. o: { h, maxWait (ms), make(place) -> promise,
   * duration (ms, expected) }. Resolves with { overlay } once it is shown, or null when dropped.
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

  /** Register an overlay that shows immediately (it clears its row first). */
  claim(side, kind, handle, alive = null) {
    const row = this._row(side, kind);
    const it = { side, kind, row, handle, born: now(this.d), alive, until: 0, done: false };
    for (const other of this.items) {
      if (other !== it && this._conflict(it, other)) this._evict(other, 160);
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
    if (it.done) return;
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
        this._show(q);
        continue;
      }
      if (t - q.at > q.maxWait) {
        this._drop(q);
        continue;
      }
      if (q.kind === 'banner') {
        // banners are time-critical: an older banner goes now; a caption that has been readable for
        // a while exits early; the combo counter (the running move) is waited for
        for (const b of blockers) {
          if (b.kind === 'banner') this._evict(b, 120);
          else if (b.kind === 'caption' && t - b.born >= PREEMPT_AFTER && !b.shortened) {
            b.shortened = true;
            this._evict(b, 200);
          }
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
      const it = { side: q.side, kind: q.kind, row: q.row, handle, born: now(this.d), until: now(this.d) + (q.o.duration || 1000), done: false };
      this.items.push(it);
      if (typeof handle.then === 'function') handle.then(() => (it.done = true), () => (it.done = true));
    }
    q.resolve(handle ? { overlay: handle } : null);
  }

  /** Drop everything queued (the overlays already on screen are left to the FX runner). */
  clear() {
    for (const q of this.queue.slice()) this._drop(q);
    this.items = [];
  }
}
