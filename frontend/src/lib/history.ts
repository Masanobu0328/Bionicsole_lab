import { create } from 'zustand';
import { useStore } from '@/lib/store';

/**
 * Undo/redo for the design edits.
 *
 * Implemented as a subscriber rather than a store middleware so the existing
 * setters stay untouched: every one of them already writes through useStore, and
 * they are called from a dozen canvases.
 *
 * Only the fields a practitioner edits are tracked. Navigation (currentStep),
 * generation status and the patient list are deliberately left out - stepping
 * between screens or watching a job finish is not something to undo.
 */
const TRACKED = [
    'flipOrientation', 'baseThickness', 'wallHeightOffset', 'heelCupHeight',
    'bottomRounding', 'wallDishReach', 'medialBandDropBias', 'lateralBandDropBias',
    'medialWallHeight', 'medialWallPeakX', 'lateralWallHeight', 'lateralWallPeakX',
    'archScale', 'enableLattice', 'latticeCellSize', 'strutRadius',
    'archSettingsRight', 'archSettingsLeft', 'useGridCells', 'gridCellHeights',
    'archCurves', 'outlineImageTransform', 'outlineImageSize', 'outlinePoints',
    'outlineScale', 'outlineTargetLengthMm', 'bottomOutlinePoints',
    'useBottomOutline', 'landmarkConfig', 'widthConfig',
] as const;

type Snapshot = Record<string, unknown>;

// A drag fires a setter on every mousemove. Without coalescing, one drag would
// bury the history under a few hundred entries and undo would crawl back pixel by
// pixel. Entries are cut when the edits stop for this long instead.
const SETTLE_MS = 400;
const MAX_ENTRIES = 100;

const take = (state: Record<string, unknown>): Snapshot => {
    const out: Snapshot = {};
    for (const key of TRACKED) out[key] = state[key];
    return out;
};

const same = (a: Snapshot, b: Snapshot) =>
    TRACKED.every((k) => Object.is(a[k], b[k]) || JSON.stringify(a[k]) === JSON.stringify(b[k]));

type HistoryState = { canUndo: boolean; canRedo: boolean };
export const useHistoryStore = create<HistoryState>(() => ({ canUndo: false, canRedo: false }));

let past: Snapshot[] = [];
let future: Snapshot[] = [];
let current: Snapshot = take(useStore.getState() as unknown as Record<string, unknown>);
let applying = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let scope = `${useStore.getState().patientId}:${useStore.getState().footSide}`;

const publish = () =>
    useHistoryStore.setState({ canUndo: past.length > 0, canRedo: future.length > 0 });

/** Drop the history - a different patient or foot is a different document. */
export const resetHistory = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    past = [];
    future = [];
    current = take(useStore.getState() as unknown as Record<string, unknown>);
    publish();
};

const commit = () => {
    timer = null;
    const next = take(useStore.getState() as unknown as Record<string, unknown>);
    if (same(next, current)) return;
    past.push(current);
    if (past.length > MAX_ENTRIES) past.shift();
    future = [];
    current = next;
    publish();
};

useStore.subscribe((state) => {
    const nextScope = `${state.patientId}:${state.footSide}`;
    if (nextScope !== scope) {
        scope = nextScope;
        resetHistory();
        return;
    }
    if (applying) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(commit, SETTLE_MS);
});

const apply = (snapshot: Snapshot) => {
    applying = true;
    // Flush any pending entry first, otherwise the settle timer would fire after
    // the restore and record the undo itself as a fresh edit.
    if (timer) { clearTimeout(timer); timer = null; }
    useStore.setState(snapshot as never);
    current = snapshot;
    // Release on the next tick: setState notifies subscribers synchronously, but a
    // canvas may write a derived value back in an effect right after.
    setTimeout(() => { applying = false; }, 0);
    publish();
};

export const undo = () => {
    if (timer) commit();
    const previous = past.pop();
    if (!previous) return;
    future.push(current);
    apply(previous);
};

export const redo = () => {
    if (timer) commit();
    const next = future.pop();
    if (!next) return;
    past.push(current);
    apply(next);
};
