/** Injected on load, so the fork leaves upstream's styles.css alone. */
export const GARDEN_CSS = `
.garden-queue { display: flex; flex-direction: column; gap: 8px; }
.garden-queue-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.garden-queue-status { font-size: var(--font-ui-small); color: var(--text-muted); }
.garden-queue-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.garden-queue-card {
  display: flex; gap: 8px; padding: 8px; border-radius: 8px; cursor: grab; user-select: none;
  background: var(--card-fill); color: #1e1e1e; border: 1px solid rgba(0,0,0,.08); touch-action: none;
}
.garden-queue-card:focus-visible { outline: 2px solid var(--interactive-accent); }
.garden-queue-card.is-placing { opacity: .4; cursor: progress; }
.garden-queue-card img { width: 56px; height: 56px; object-fit: cover; border-radius: 4px; flex: none; }
.garden-queue-body { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.garden-queue-name { font-weight: 600; overflow-wrap: anywhere; }
.garden-queue-meta, .garden-queue-host { font-size: var(--font-ui-smaller); opacity: .75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.garden-queue-card button { align-self: flex-start; color: inherit; }
.garden-shelf-item {
  display: flex; flex-direction: column; gap: 4px; padding: 6px; border-radius: 8px; cursor: grab; user-select: none;
  border: 1px dashed var(--background-modifier-border); background: var(--background-primary); touch-action: none;
}
.garden-shelf-item.is-placing { opacity: .4; cursor: progress; }
.garden-shelf-item:focus-visible { outline: 2px solid var(--interactive-accent); }
.garden-shelf-preview svg { display: block; width: 100%; height: auto; max-height: 140px; }
.garden-queue-drop-hint { display: none; }
.garden-queue.is-drop-target { outline: 2px dashed var(--interactive-accent); outline-offset: -6px; border-radius: 8px; }
.garden-queue.is-drop-target .garden-queue-drop-hint {
  display: block; text-align: center; padding: 12px; color: var(--interactive-accent); font-weight: 600;
}
.garden-queue-ghost { position: fixed; z-index: 1000; pointer-events: none; opacity: .85; box-shadow: 0 8px 24px rgba(0,0,0,.25); }
`;
