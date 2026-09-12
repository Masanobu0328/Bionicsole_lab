import { create } from 'zustand';
import {
    ArchCurves,
    ArchSettings,
    DesignRecord,
    OutlineRecord,
    Patient,
    loadLatestDesignFromDB,
    loadOutlineFromDB,
    saveDesignToDB,
    saveOutlineToDB,
} from './api';
import { DEFAULT_ARCH_GRID } from '@/lib/constants';
import { migrateArchCurves } from '@/lib/arch-geometry';

type State = {
    patients: Patient[];
    patientId: string | null;
    footSide: 'left' | 'right';
    flipOrientation: boolean;
    baseThickness: number;
    wallHeightOffset: number;
    heelCupHeight: number;
    bottomRounding: number;
    wallDishReach: number;
    medialBandDropBias: number;
    lateralBandDropBias: number;
    wallFirstStageDeg: number;
    medialWallHeight: number;
    medialWallPeakX: number;
    lateralWallHeight: number;
    lateralWallPeakX: number;
    archScale: number;
    enableLattice: boolean;
    latticeCellSize: number;
    strutRadius: number;
    activeFootSide: 'left' | 'right';
    archSettingsRight: ArchSettings;
    archSettingsLeft: ArchSettings;
    useGridCells: boolean;
    gridCellHeights: Record<string, number>;
    archCurves: ArchCurves | null;
    currentStep: number;
    isGenerating: boolean;
    currentModelUrl: string | null;
    stlUrl: string | null;
    progress: number;
    progressMessage: string;
    outlineImage: string | null;
    outlineImageTransform: {
        x: number;
        y: number;
        scale: number;
        rotation: number;
        opacity: number;
        flipX: boolean;
        flipY: boolean;
    };
    outlineImageSize: { width: number; height: number };
    outlinePoints: { x: number; y: number }[];
    outlineScale: number;
    outlineTargetLengthMm: number;
    bottomOutlinePoints: { x: number; y: number }[];
    useBottomOutline: boolean;
    landmarkConfig: Record<string, number>;
    widthConfig: Record<string, number>;
    activeLandmarkId: string | null;
    setPatients: (patients: Patient[]) => void;
    setCurrentStep: (step: number) => void;
    setPatientId: (id: string) => void;
    setFootSide: (side: 'left' | 'right') => void;
    setFlipOrientation: (flip: boolean) => void;
    setOutlineImage: (img: string | null) => void;
    setOutlineImageTransform: (transform: Partial<State['outlineImageTransform']>) => void;
    setOutlineImageSize: (size: { width: number; height: number }) => void;
    setOutlinePoints: (points: { x: number; y: number }[]) => void;
    setOutlineScale: (scale: number) => void;
    setOutlineTargetLengthMm: (lengthMm: number) => void;
    setBottomOutlinePoints: (points: { x: number; y: number }[]) => void;
    setUseBottomOutline: (val: boolean) => void;
    setLandmarkConfig: (config: Record<string, number>) => void;
    updateLandmarkPos: (id: string, percent: number) => void;
    setWidthConfig: (config: Record<string, number>) => void;
    updateWidthConfig: (id: string, percent: number) => void;
    setActiveLandmarkId: (id: string | null) => void;
    setBaseThickness: (val: number) => void;
    setWallHeightOffset: (val: number) => void;
    setHeelCupHeight: (val: number) => void;
    setBottomRounding: (val: number) => void;
    setWallDishReach: (val: number) => void;
    setMedialBandDropBias: (val: number) => void;
    setLateralBandDropBias: (val: number) => void;
    setWallFirstStageDeg: (val: number) => void;
    setMedialWallHeight: (val: number) => void;
    setMedialWallPeakX: (val: number) => void;
    setLateralWallHeight: (val: number) => void;
    setLateralWallPeakX: (val: number) => void;
    setArchScale: (val: number) => void;
    setEnableLattice: (val: boolean) => void;
    setLatticeCellSize: (val: number) => void;
    setStrutRadius: (val: number) => void;
    setActiveFootSide: (side: 'left' | 'right') => void;
    updateArchSettings: (side: 'left' | 'right', settings: Partial<ArchSettings>) => void;
    setUseGridCells: (val: boolean) => void;
    setGridCellHeight: (id: string, val: number) => void;
    setArchCurves: (curves: ArchCurves | null) => void;
    setIsGenerating: (val: boolean) => void;
    setProgress: (val: number) => void;
    setProgressMessage: (val: string) => void;
    setCurrentModelUrl: (url: string | null) => void;
    setStlUrl: (url: string | null) => void;
    setLatticeInfo: (info: unknown) => void;
    latticeInfo: unknown;
    savePatientPreset: (patientId?: string) => Promise<boolean>;
    loadPatientPreset: (patientId?: string) => Promise<boolean>;
    get selectedPatient(): Patient | undefined;
};

type PatientPreset = {
    version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    updatedAt: string;
    params: {
        flipOrientation: boolean;
        baseThickness: number;
        wallHeightOffset: number;
        heelCupHeight: number;
        bottomRounding: number;
        wallDishReach: number;
        medialBandDropBias: number;
    lateralBandDropBias: number;
    wallFirstStageDeg: number;
        medialWallHeight: number;
        medialWallPeakX: number;
        lateralWallHeight: number;
        lateralWallPeakX: number;
        archScale: number;
        archSettingsRight: ArchSettings;
        archSettingsLeft: ArchSettings;
        useGridCells: boolean;
        gridCellHeights: Record<string, number>;
        landmarkConfig: Record<string, number>;
        widthConfig: Record<string, number>;
        archCurves: ArchCurves | null;
        outlinePoints: { x: number; y: number }[];
        outlineTargetLengthMm: number;
        outlineImageTransform: State['outlineImageTransform'];
        outlineImageSize: { width: number; height: number };
        outlineImage: string | null;
        bottomOutlinePoints: { x: number; y: number }[];
        useBottomOutline: boolean;
    };
};

const PRESET_KEY_PREFIX = 'masacad:preset:patient:';
const DEFAULT_OUTLINE_IMAGE_TRANSFORM: State['outlineImageTransform'] = {
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    opacity: 0.5,
    flipX: false,
    flipY: false,
};
const DEFAULT_OUTLINE_IMAGE_SIZE = { width: 100, height: 100 };

const DEFAULT_ARCH_SETTINGS: ArchSettings = {
    medial_start: 15.0,
    medial_peak: 43.0,
    medial_end: 70.0,
    medial_height: 0.0,
    lateral_start: 20.0,
    lateral_peak: 32.5,
    lateral_end: 45.0,
    lateral_height: 0.0,
    transverse_start: 43.0,
    transverse_peak: 59.0,
    transverse_end: 75.0,
    transverse_height: 0.0,
    medial_y_start: 65.0,
    medial_y_end: 100.0,
    lateral_y_start: 0.0,
    lateral_y_end: 25.0,
    transverse_y_start: 20.0,
    transverse_y_end: 70.0,
    medial_detail_enabled: false,
    medial_detail_heights: [0.0, 0.0, 0.0, 0.0],
    transverse_detail_enabled: false,
    transverse_detail_heights: [0.0, 0.0, 0.0, 0.0],
};

const INITIAL_GRID_HEIGHTS: Record<string, number> = {};
Object.values(DEFAULT_ARCH_GRID).forEach((cell) => {
    INITIAL_GRID_HEIGHTS[cell.id] = cell.default_height;
});

const DEFAULT_LANDMARK_CONFIG: Record<string, number> = {
    arch_start: 15.0,
    lateral_arch_start: 20.0,
    subtalar: 30.0,
    navicular: 43.0,
    cuboid: 45.0,
    medial_cuneiform: 55.0,
    metatarsal: 70.0,
};

// Some legacy/corrupted rows store landmark_config in a foreign shape (e.g. the
// old cm-based { medial: { start_cm, peak_cm, end_cm }, ... } preset format).
// Drop any non-numeric entries so a stale value never reaches the backend,
// which requires landmark_config to be Dict[str, float] and 422s otherwise.
function sanitizeLandmarkConfig(raw: unknown): Record<string, number> {
    const numericEntries = raw && typeof raw === 'object'
        ? Object.entries(raw as Record<string, unknown>).filter(
            (entry): entry is [string, number] => typeof entry[1] === 'number',
        )
        : [];
    return { ...DEFAULT_LANDMARK_CONFIG, ...Object.fromEntries(numericEntries) };
}

export const STEPS = {
    PATIENT: 0,
    OUTLINE: 1,
    LANDMARKS: 2,
    SHAPE: 3,
    ARCH_REGION: 4,
    ARCH_HEIGHT: 5,
    PREVIEW: 6,
} as const;

function buildPatientPreset(state: State): PatientPreset {
    return {
        version: 9,
        updatedAt: new Date().toISOString(),
        params: {
            flipOrientation: state.flipOrientation,
            baseThickness: state.baseThickness,
            wallHeightOffset: state.wallHeightOffset,
            heelCupHeight: state.heelCupHeight,
            bottomRounding: state.bottomRounding,
            wallDishReach: state.wallDishReach,
            medialBandDropBias: state.medialBandDropBias,
            lateralBandDropBias: state.lateralBandDropBias,
            wallFirstStageDeg: state.wallFirstStageDeg,
            medialWallHeight: state.medialWallHeight,
            medialWallPeakX: state.medialWallPeakX,
            lateralWallHeight: state.lateralWallHeight,
            lateralWallPeakX: state.lateralWallPeakX,
            archScale: state.archScale,
            archSettingsRight: state.archSettingsRight,
            archSettingsLeft: state.archSettingsLeft,
            useGridCells: state.useGridCells,
            gridCellHeights: state.gridCellHeights,
            landmarkConfig: state.landmarkConfig,
            widthConfig: state.widthConfig,
            archCurves: state.archCurves,
            outlinePoints: state.outlinePoints,
            outlineTargetLengthMm: state.outlineTargetLengthMm,
            outlineImageTransform: state.outlineImageTransform,
            outlineImageSize: state.outlineImageSize,
            outlineImage: state.outlineImage,
            bottomOutlinePoints: state.bottomOutlinePoints,
            useBottomOutline: state.useBottomOutline,
        },
    };
}

function savePresetToLocalStorage(patientId: string, preset: PatientPreset): boolean {
    try {
        window.localStorage.setItem(`${PRESET_KEY_PREFIX}${patientId}`, JSON.stringify(preset));
        return true;
    } catch {
        return false;
    }
}

function readPresetFromLocalStorage(patientId: string): PatientPreset | null {
    try {
        const raw = window.localStorage.getItem(`${PRESET_KEY_PREFIX}${patientId}`);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw) as PatientPreset;
        return parsed?.params ? parsed : null;
    } catch {
        return null;
    }
}

function applyPresetParams(set: (partial: Partial<State>) => void, params: PatientPreset['params']): void {
    set({
        flipOrientation: params.flipOrientation,
        baseThickness: params.baseThickness,
        wallHeightOffset: params.wallHeightOffset,
        heelCupHeight: params.heelCupHeight,
        bottomRounding: params.bottomRounding ?? 4.0,
        wallDishReach: params.wallDishReach ?? 10.0,
        medialBandDropBias: params.medialBandDropBias ?? 2.0,
        lateralBandDropBias: params.lateralBandDropBias ?? 1.0,
        wallFirstStageDeg: params.wallFirstStageDeg ?? 15.0,
        medialWallHeight: params.medialWallHeight,
        medialWallPeakX: params.medialWallPeakX,
        lateralWallHeight: params.lateralWallHeight,
        lateralWallPeakX: params.lateralWallPeakX,
        archScale: params.archScale,
        archSettingsRight: params.archSettingsRight,
        archSettingsLeft: params.archSettingsLeft,
        useGridCells: params.useGridCells,
        gridCellHeights: params.gridCellHeights,
        landmarkConfig: params.landmarkConfig,
        widthConfig: params.widthConfig,
        archCurves: params.archCurves,
        outlinePoints: params.outlinePoints ?? [],
        outlineTargetLengthMm: params.outlineTargetLengthMm ?? 260,
        outlineImageTransform: params.outlineImageTransform ?? DEFAULT_OUTLINE_IMAGE_TRANSFORM,
        outlineImageSize: params.outlineImageSize ?? DEFAULT_OUTLINE_IMAGE_SIZE,
        outlineImage: params.outlineImage ?? null,
        bottomOutlinePoints: params.bottomOutlinePoints ?? [],
        useBottomOutline: params.useBottomOutline ?? false,
    });
}

function buildDesignPayload(state: State, archSettings: ArchSettings) {
    return {
        flip_orientation: state.flipOrientation,
        base_thickness: state.baseThickness,
        wall_height_offset: state.wallHeightOffset,
        heel_cup_height: state.heelCupHeight,
        bottom_rounding_mm: state.bottomRounding,
        wall_dish_reach_mm: state.wallDishReach,
        medial_band_drop_bias: state.medialBandDropBias,
        lateral_band_drop_bias: state.lateralBandDropBias,
        wall_first_stage_deg: state.wallFirstStageDeg,
        medial_wall_height: state.medialWallHeight,
        medial_wall_peak_x: state.medialWallPeakX,
        lateral_wall_height: state.lateralWallHeight,
        lateral_wall_peak_x: state.lateralWallPeakX,
        arch_scale: state.archScale,
        enable_lattice: state.enableLattice,
        lattice_cell_size: state.latticeCellSize,
        strut_radius: state.strutRadius,
        arch_settings: archSettings,
        landmark_config: state.landmarkConfig,
        width_config: state.widthConfig,
        arch_curves: state.archCurves,
    };
}

function applyDesignToState(target: Partial<State>, design: DesignRecord | null): void {
    if (!design) {
        return;
    }

    if (design.flip_orientation !== undefined && design.flip_orientation !== null) {
        target.flipOrientation = design.flip_orientation;
    }
    if (design.base_thickness !== undefined && design.base_thickness !== null) {
        target.baseThickness = design.base_thickness;
    }

    const wallHeightOffset = design.wall_height_offset ?? design.wall_height_offset_mm;
    if (wallHeightOffset !== undefined && wallHeightOffset !== null) {
        target.wallHeightOffset = wallHeightOffset;
    }
    if (design.heel_cup_height !== undefined && design.heel_cup_height !== null) {
        target.heelCupHeight = design.heel_cup_height;
    }
    if (design.bottom_rounding_mm !== undefined && design.bottom_rounding_mm !== null) {
        target.bottomRounding = design.bottom_rounding_mm;
    }
    if (design.wall_dish_reach_mm !== undefined && design.wall_dish_reach_mm !== null) {
        target.wallDishReach = design.wall_dish_reach_mm;
    }
    if (design.medial_band_drop_bias !== undefined && design.medial_band_drop_bias !== null) {
        target.medialBandDropBias = design.medial_band_drop_bias;
    }
    if (design.lateral_band_drop_bias !== undefined && design.lateral_band_drop_bias !== null) {
        target.lateralBandDropBias = design.lateral_band_drop_bias;
    }
    if (design.wall_first_stage_deg !== undefined && design.wall_first_stage_deg !== null) {
        target.wallFirstStageDeg = design.wall_first_stage_deg;
    }
    if (design.medial_wall_height !== undefined && design.medial_wall_height !== null) {
        target.medialWallHeight = design.medial_wall_height;
    }
    if (design.medial_wall_peak_x !== undefined && design.medial_wall_peak_x !== null) {
        target.medialWallPeakX = design.medial_wall_peak_x;
    }
    if (design.lateral_wall_height !== undefined && design.lateral_wall_height !== null) {
        target.lateralWallHeight = design.lateral_wall_height;
    }
    if (design.lateral_wall_peak_x !== undefined && design.lateral_wall_peak_x !== null) {
        target.lateralWallPeakX = design.lateral_wall_peak_x;
    }
    if (design.arch_scale !== undefined && design.arch_scale !== null) {
        target.archScale = design.arch_scale;
    }
    if (design.enable_lattice !== undefined && design.enable_lattice !== null) {
        target.enableLattice = design.enable_lattice;
    }
    if (design.lattice_cell_size !== undefined && design.lattice_cell_size !== null) {
        target.latticeCellSize = design.lattice_cell_size;
    }
    if (design.strut_radius !== undefined && design.strut_radius !== null) {
        target.strutRadius = design.strut_radius;
    }
    if (design.landmark_config) {
        target.landmarkConfig = sanitizeLandmarkConfig(design.landmark_config);
    }
    if (design.width_config) {
        target.widthConfig = design.width_config;
    }
    if (design.arch_curves !== undefined) {
        target.archCurves = design.arch_curves;
    }
    if (design.arch_settings) {
        // Merge with defaults instead of replacing outright: some legacy/corrupted
        // rows store a foreign shape here (e.g. bone-landmark offsets), and a raw
        // replace would leave required fields like medial_height undefined,
        // crashing Step 6 (Sidebar's ARCH_HEIGHT case calls .toFixed() on them).
        const merged = { ...DEFAULT_ARCH_SETTINGS, ...design.arch_settings };
        if (design.foot_side === 'left') {
            target.archSettingsLeft = merged;
        } else {
            target.archSettingsRight = merged;
        }
    }
}

function applyOutlineToState(target: Partial<State>, outline: OutlineRecord | null): void {
    if (!outline) {
        return;
    }

    const outlinePoints = outline.outline_points ?? [];
    const bottomOutlinePoints = outline.bottom_outline_points ?? [];

    target.outlinePoints = outlinePoints;
    target.bottomOutlinePoints = bottomOutlinePoints;
    target.useBottomOutline = bottomOutlinePoints.length > 0;
}

export const useStore = create<State>((set, get) => ({
    patients: [],
    patientId: null,
    footSide: 'left',
    flipOrientation: false,
    baseThickness: 3.0,
    wallHeightOffset: 0.0,
    heelCupHeight: 3.0,
    bottomRounding: 4.0,
    wallDishReach: 10.0,
    medialBandDropBias: 2.0,
    lateralBandDropBias: 1.0,
    wallFirstStageDeg: 15.0,
    medialWallHeight: 6.0,
    medialWallPeakX: 43.0,
    lateralWallHeight: 3.0,
    lateralWallPeakX: 30.0,
    archScale: 1.0,
    enableLattice: false,
    latticeCellSize: 3.0,
    strutRadius: 0.2,
    activeFootSide: 'right',
    archSettingsRight: { ...DEFAULT_ARCH_SETTINGS },
    archSettingsLeft: { ...DEFAULT_ARCH_SETTINGS },
    useGridCells: false,
    gridCellHeights: INITIAL_GRID_HEIGHTS,
    archCurves: null,
    currentStep: STEPS.PATIENT,
    isGenerating: false,
    progress: 0,
    progressMessage: '待機中...',
    currentModelUrl: null,
    stlUrl: null,
    latticeInfo: null,
    outlineImage: null,
    outlineImageTransform: DEFAULT_OUTLINE_IMAGE_TRANSFORM,
    outlineImageSize: DEFAULT_OUTLINE_IMAGE_SIZE,
    outlinePoints: [],
    outlineScale: 1.0,
    outlineTargetLengthMm: 260,
    bottomOutlinePoints: [],
    useBottomOutline: true,
    landmarkConfig: { ...DEFAULT_LANDMARK_CONFIG },
    widthConfig: {
        ray5_boundary: 25.0,
        ray1_boundary: 65.0,
    },
    activeLandmarkId: null,

    get selectedPatient() {
        const { patients, patientId } = get();
        return patients.find((patient) => patient.id === patientId);
    },

    setPatients: (patients) => set({ patients }),
    setCurrentStep: (currentStep) => set({ currentStep }),
    setPatientId: (id) => {
        set({
            patientId: id,
            outlinePoints: [],
            outlineTargetLengthMm: 260,
            bottomOutlinePoints: [],
            useBottomOutline: true,
            archCurves: null,
            currentModelUrl: null,
            outlineImage: null,
            outlineImageTransform: DEFAULT_OUTLINE_IMAGE_TRANSFORM,
            outlineImageSize: DEFAULT_OUTLINE_IMAGE_SIZE,
        });
        void get().loadPatientPreset(id);
    },
    setFootSide: (footSide) => set({ footSide }),
    setFlipOrientation: (flipOrientation) => set({ flipOrientation }),
    setOutlineImage: (outlineImage) => set({ outlineImage }),
    setOutlineImageTransform: (transform) => set((state) => ({
        outlineImageTransform: { ...state.outlineImageTransform, ...transform },
    })),
    setOutlineImageSize: (outlineImageSize) => set({ outlineImageSize }),
    setOutlinePoints: (outlinePoints) => set({ outlinePoints, archCurves: null, currentModelUrl: null, stlUrl: null }),
    setOutlineScale: (outlineScale) => set({ outlineScale }),
    setOutlineTargetLengthMm: (outlineTargetLengthMm) => set({ outlineTargetLengthMm }),
    setBottomOutlinePoints: (bottomOutlinePoints) => set({ bottomOutlinePoints }),
    setUseBottomOutline: (useBottomOutline) => set({ useBottomOutline }),
    setLandmarkConfig: (landmarkConfig) => set({ landmarkConfig }),
    updateLandmarkPos: (id, percent) => set((state) => {
        const nextLandmarkConfig = { ...state.landmarkConfig, [id]: percent };

        // Arch-position landmarks → update archSettings start/end positions (Step 6 反映).
        // Also clear archCurves so Step 5 regenerates curves from new landmark positions.
        // Heights in archSettings are untouched.
        const archPatch: Partial<typeof state.archSettingsRight> = {};
        const archCurveIds = new Set(['arch_start', 'lateral_arch_start', 'metatarsal', 'cuboid', 'navicular', 'medial_cuneiform', 'subtalar']);

        if (id === 'arch_start')         archPatch.medial_start  = percent;
        if (id === 'lateral_arch_start') archPatch.lateral_start = percent;
        if (id === 'metatarsal')         archPatch.medial_end    = percent + 1;
        if (id === 'cuboid')             archPatch.lateral_end   = percent;

        const hasPatch = Object.keys(archPatch).length > 0;
        const resetCurves = archCurveIds.has(id);

        return {
            landmarkConfig: nextLandmarkConfig,
            ...(resetCurves && { archCurves: null }),
            ...(hasPatch && {
                archSettingsRight: { ...state.archSettingsRight, ...archPatch },
                archSettingsLeft:  { ...state.archSettingsLeft,  ...archPatch },
            }),
        };
    }),
    setWidthConfig: (widthConfig) => set({ widthConfig }),
    updateWidthConfig: (id, percent) => set((state) => {
        const nextWidthConfig = { ...state.widthConfig, [id]: percent };
        const ray1 = nextWidthConfig.ray1_boundary ?? 65.0;
        const ray5 = nextWidthConfig.ray5_boundary ?? 25.0;

        return {
            widthConfig: nextWidthConfig,
            archSettingsRight: {
                ...state.archSettingsRight,
                medial_y_start: ray1 - 5.0,
                lateral_y_end: ray5 + 5.0,
                transverse_y_start: ray5 - 5.0,
                transverse_y_end: ray1 + 5.0,
            },
            archSettingsLeft: {
                ...state.archSettingsLeft,
                medial_y_start: ray1 - 5.0,
                lateral_y_end: ray5 + 5.0,
                transverse_y_start: ray5 - 5.0,
                transverse_y_end: ray1 + 5.0,
            },
        };
    }),
    setActiveLandmarkId: (activeLandmarkId) => set({ activeLandmarkId }),
    setBaseThickness: (baseThickness) => set({ baseThickness }),
    setWallHeightOffset: (wallHeightOffset) => set({ wallHeightOffset }),
    setHeelCupHeight: (heelCupHeight) => set({ heelCupHeight }),
    setBottomRounding: (bottomRounding) => set({ bottomRounding }),
    setWallDishReach: (wallDishReach) => set({ wallDishReach }),
    setMedialBandDropBias: (medialBandDropBias) => set({ medialBandDropBias }),
    setLateralBandDropBias: (lateralBandDropBias) => set({ lateralBandDropBias }),
    setWallFirstStageDeg: (wallFirstStageDeg) => set({ wallFirstStageDeg }),
    setMedialWallHeight: (medialWallHeight) => set({ medialWallHeight }),
    setMedialWallPeakX: (medialWallPeakX) => set({ medialWallPeakX }),
    setLateralWallHeight: (lateralWallHeight) => set({ lateralWallHeight }),
    setLateralWallPeakX: (lateralWallPeakX) => set({ lateralWallPeakX }),
    setArchScale: (archScale) => set({ archScale }),
    setEnableLattice: (enableLattice) => set({ enableLattice }),
    setLatticeCellSize: (latticeCellSize) => set({ latticeCellSize }),
    setStrutRadius: (strutRadius) => set({ strutRadius }),
    setActiveFootSide: (activeFootSide) => set({ activeFootSide }),
    updateArchSettings: (side, settings) => set((state) => (
        side === 'right'
            ? { archSettingsRight: { ...state.archSettingsRight, ...settings } }
            : { archSettingsLeft: { ...state.archSettingsLeft, ...settings } }
    )),
    setUseGridCells: (useGridCells) => set({ useGridCells }),
    setGridCellHeight: (id, val) => set((state) => ({
        gridCellHeights: { ...state.gridCellHeights, [id]: val },
    })),
    setArchCurves: (archCurves) => set({ archCurves }),
    setIsGenerating: (isGenerating) => set({ isGenerating }),
    setProgress: (progress) => set({ progress }),
    setProgressMessage: (progressMessage) => set({ progressMessage }),
    setCurrentModelUrl: (currentModelUrl) => set({ currentModelUrl }),
    setStlUrl: (stlUrl) => set({ stlUrl }),
    setLatticeInfo: (latticeInfo) => set({ latticeInfo }),
    savePatientPreset: async (patientIdArg) => {
        if (typeof window === 'undefined') {
            return false;
        }

        const state = get();
        const patientId = patientIdArg ?? state.patientId;
        if (!patientId || !state.patients.some((patient) => patient.id === patientId)) {
            return false;
        }

        const preset = buildPatientPreset(state);

        try {
            await Promise.all([
                saveDesignToDB(patientId, 'right', buildDesignPayload(state, state.archSettingsRight)),
                saveDesignToDB(patientId, 'left', buildDesignPayload(state, state.archSettingsLeft)),
                saveOutlineToDB(patientId, 'right', state.outlinePoints, state.bottomOutlinePoints),
                saveOutlineToDB(patientId, 'left', state.outlinePoints, state.bottomOutlinePoints),
            ]);
            // Also save image and transform to localStorage since Supabase doesn't store them
            savePresetToLocalStorage(patientId, preset);
            return true;
        } catch (error) {
            console.warn('Failed to save design to Supabase. Falling back to localStorage.', error);
            return savePresetToLocalStorage(patientId, preset);
        }
    },
    loadPatientPreset: async (patientIdArg) => {
        if (typeof window === 'undefined') {
            return false;
        }

        const state = get();
        const patientId = patientIdArg ?? state.patientId;
        if (!patientId) {
            return false;
        }

        try {
            const [rightDesign, leftDesign, rightOutline, leftOutline] = await Promise.all([
                loadLatestDesignFromDB(patientId, 'right'),
                loadLatestDesignFromDB(patientId, 'left'),
                loadOutlineFromDB(patientId, 'right'),
                loadOutlineFromDB(patientId, 'left'),
            ]);

            const baseDesign = rightDesign ?? leftDesign;
            const outline = rightOutline ?? leftOutline;

            if (baseDesign || rightDesign || leftDesign || outline) {
                const nextState: Partial<State> = {};
                applyDesignToState(nextState, baseDesign);

                if (rightDesign?.arch_settings) {
                    nextState.archSettingsRight = { ...DEFAULT_ARCH_SETTINGS, ...rightDesign.arch_settings };
                }
                if (leftDesign?.arch_settings) {
                    nextState.archSettingsLeft = { ...DEFAULT_ARCH_SETTINGS, ...leftDesign.arch_settings };
                }

                applyOutlineToState(nextState, outline);

                const migration = migrateArchCurves(
                    nextState.archCurves ?? null,
                    nextState.outlinePoints ?? [],
                );
                if (migration.changed) {
                    nextState.archCurves = migration.curves;
                }

                // Supabase doesn't store image data — restore it from localStorage
                const localPreset = readPresetFromLocalStorage(patientId);
                if (localPreset?.params?.outlineImage) {
                    nextState.outlineImage = localPreset.params.outlineImage;
                    nextState.outlineImageTransform = localPreset.params.outlineImageTransform ?? DEFAULT_OUTLINE_IMAGE_TRANSFORM;
                    nextState.outlineImageSize = localPreset.params.outlineImageSize ?? DEFAULT_OUTLINE_IMAGE_SIZE;
                }

                set(nextState);
                if (migration.changed && migration.curves) {
                    const migratedState = get();
                    try {
                        await Promise.all([
                            saveDesignToDB(patientId, 'right', buildDesignPayload(migratedState, migratedState.archSettingsRight)),
                            saveDesignToDB(patientId, 'left', buildDesignPayload(migratedState, migratedState.archSettingsLeft)),
                        ]);
                    } catch (error) {
                        console.warn('Failed to persist migrated arch curves to Supabase.', error);
                    }
                    savePresetToLocalStorage(patientId, buildPatientPreset(migratedState));
                }
                return true;
            }
        } catch (error) {
            console.warn('Failed to load design from Supabase. Falling back to localStorage.', error);
        }

        const preset = readPresetFromLocalStorage(patientId);
        if (!preset?.params) {
            return false;
        }

        const migration = migrateArchCurves(
            preset.params.archCurves,
            preset.params.outlinePoints ?? [],
        );
        if (migration.changed) {
            preset.version = 5;
            preset.params.archCurves = migration.curves;
            savePresetToLocalStorage(patientId, preset);
        }
        applyPresetParams(set, preset.params);
        return true;
    },
}));
