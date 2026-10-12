// «Валькирии доски» — the abort token thrown through choreography when a cinematic is skipped
// (its own module so every file of the view can import it without an import cycle).

export const ABORT = Symbol('rpg-render-abort');
