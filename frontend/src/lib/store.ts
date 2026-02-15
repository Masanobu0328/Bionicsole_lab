import { create } from 'zustand';
import { InsoleParams, ArchSettings, ArchCurves, Patient } from './api';
import { DEFAULT_ARCH_GRID } from '@/lib/constants';

type State = {
    // Parameters
    patients: Patient[];
    patientId: string | null;
    footSide: 'left' | 'right';
    flipOrientation: boolean;
    baseThickness: number;
    wallHeightOffset: number;
    heelCupHeight: number;
    medialWallHeight: number;
    medialWallPeakX: number;
    lateralWallHeight: number;
    lateralWallPeakX: number;
    archScale: number;
    enableLattice: boolean;
    latticeCellSize: number;
    strutRadius: number;

    // Arch Settings (Split Left/Right for Step 6)
    activeFootSide: 'left' | 'right'; // For UI toggle in Step 6
    archSettingsRight: ArchSettings;
    archSettingsLeft: ArchSettings;

    useGridCells: boolean;
    gridCellHeights: Record<string, number>;

    // Arch Curves (Step 5)
    archCurves: ArchCurves | null;

    // UI State
    currentStep: number;
    isGenerating: boolean;
    currentModelUrl: string | null;
    stlUrl: string | null;
    progress: number;
    progressMessage: string;

    // Outline Editor State
    outlineImage: string | null;
    outlineImageTransform: { x: number; y: number; scale: number; rotation: number; opacity: number; flipX: boolean; flipY: boolean };
    outlineImageSize: { width: number; height: number };
    outlinePoints: { x: number; y: number }[];
    outlineScale: number; // Pixels per mm or similar reference

    // Landmarks State (Percentages along X-axis 0-100)
    landmarkConfig: Record<string, number>;
    // Width Guidelines State (Percentages along Y-axis 0=Lateral, 100=Medial)
    widthConfig: Record<string, number>;
    activeLandmarkId: string | null;

    // Actions
    setPatients: (patients: Patient[]) => void;
    setCurrentStep: (step: number) => void;
    setPatientId: (id: string) => void;
    setFootSide: (side: 'left' | 'right') => void;
    setFlipOrientation: (flip: boolean) => void;

    setOutlineImage: (img: string | null) => void;
    setOutlineImageTransform: (transform: Partial<{ x: number; y: number; scale: number; rotation: number; opacity: number; flipX: boolean; flipY: boolean }>) => void;
    setOutlineImageSize: (size: { width: number; height: number }) => void;
    setOutlinePoints: (points: { x: number; y: number }[]) => void;
    setOutlineScale: (scale: number) => void;
    setLandmarkConfig: (config: Record<string, number>) => void;
    updateLandmarkPos: (id: string, percent: number) => void;
    setWidthConfig: (config: Record<string, number>) => void;
    updateWidthConfig: (id: string, percent: number) => void;
    setActiveLandmarkId: (id: string | null) => void;

    setBaseThickness: (val: number) => void;
    setWallHeightOffset: (val: number) => void;
    setHeelCupHeight: (val: number) => void;
    setMedialWallHeight: (val: number) => void;
    setMedialWallPeakX: (val: number) => void;
    setLateralWallHeight: (val: number) => void;
    setLateralWallPeakX: (val: number) => void;
    setArchScale: (val: number) => void;
    setEnableLattice: (val: boolean) => void;
    setLatticeCellSize: (val: number) => void;
    setStrutRadius: (val: number) => void;

    // Updated Actions for Arch Settings
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
    setLatticeInfo: (info: any) => void;
    latticeInfo: any;
    savePatientPreset: (patientId?: string) => boolean;
    loadPatientPreset: (patientId?: string) => boolean;

    // Getter helper
    get selectedPatient(): Patient | undefined;
};

type PatientPreset = {
    version: 1;
    updatedAt: string;
    params: {
        flipOrientation: boolean;
        baseThickness: number;
        wallHeightOffset: number;
        heelCupHeight: number;
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
    };
};

const PRESET_KEY_PREFIX = 'masacad:preset:patient:';

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
};

// Initialize grid cell heights from constants
const INITIAL_GRID_HEIGHTS: Record<string, number> = {};
Object.values(DEFAULT_ARCH_GRID).forEach(cell => {
    INITIAL_GRID_HEIGHTS[cell.id] = cell.default_height;
});

export const STEPS = {
    PATIENT: 0,
    OUTLINE: 1,
    LANDMARKS: 2,
    SHAPE: 3,
    ARCH_REGION: 4, // Step 5: Region Editor (One curve for both)
    ARCH_HEIGHT: 5, // Step 6: Height Slider (Split Left/Right)
    PREVIEW: 6
} as const;

export const useStore = create<State>((set, get) => ({
    patients: [],
    patientId: null,
    footSide: 'left',
    flipOrientation: false,
    baseThickness: 3.0,
    wallHeightOffset: 0.0,
    heelCupHeight: 3.0,
    medialWallHeight: 6.0,
    medialWallPeakX: 43.0,
    lateralWallHeight: 3.0,
    lateralWallPeakX: 30.0,
    archScale: 1.0,
    enableLattice: false,
    latticeCellSize: 3.0,
    strutRadius: 0.2,

    activeFootSide: 'right', // Default to right for editing
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
    outlineImageTransform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 0.5, flipX: false, flipY: false },
    outlineImageSize: { width: 100, height: 100 },
    outlinePoints: [], // Will be initialized by the editor
    outlineScale: 1.0,
    // Default Landmarks from Streamlit app
    landmarkConfig: {
        'arch_start': 15.0,
        'lateral_arch_start': 20.0,
        'subtalar': 30.0,
        'navicular': 43.0,
        'cuboid': 45.0,
        'medial_cuneiform': 55.0,
        'metatarsal': 70.0
    },
    // Default Width Guidelines
    widthConfig: {
        'ray5_boundary': 25.0, // 25% from Lateral
        'ray1_boundary': 65.0  // 65% from Lateral
    },
    activeLandmarkId: null,

    get selectedPatient() {
        const { patients, patientId } = get();
        return patients.find(p => p.id === patientId);
    },

    setPatients: (list) => set({ patients: list }),
    setCurrentStep: (step) => set({ currentStep: step }),
    setPatientId: (id) => {
        set({ patientId: id });
        // Auto-load existing preset when patient changes.
        get().loadPatientPreset(id);
    },
    setFootSide: (side) => set({ footSide: side }),
    setFlipOrientation: (flip) => set({ flipOrientation: flip }),

    setOutlineImage: (img) => set({ outlineImage: img }),
    setOutlineImageTransform: (transform) => set((state) => ({
        outlineImageTransform: { ...state.outlineImageTransform, ...transform }
    })),
    setOutlineImageSize: (size) => set({ outlineImageSize: size }),
    setOutlinePoints: (points) => set({ outlinePoints: points }),
    setOutlineScale: (scale) => set({ outlineScale: scale }),
    setLandmarkConfig: (config) => set({ landmarkConfig: config }),
    updateLandmarkPos: (id, percent) => set((state) => ({
        landmarkConfig: { ...state.landmarkConfig, [id]: percent }
    })),
    setWidthConfig: (config) => set({ widthConfig: config }),
    updateWidthConfig: (id: string, percent: number) => set((state) => {
        const newWidthConfig = { ...state.widthConfig, [id]: percent };

        const ray1 = newWidthConfig['ray1_boundary'] ?? 65.0;
        const ray5 = newWidthConfig['ray5_boundary'] ?? 25.0;

        const newSettingsPartial = {
            medial_y_start: ray1 - 5.0,
            lateral_y_end: ray5 + 5.0,
            transverse_y_start: ray5 - 5.0,
            transverse_y_end: ray1 + 5.0
        };

        return {
            widthConfig: newWidthConfig,
            archSettingsRight: { ...state.archSettingsRight, ...newSettingsPartial },
            archSettingsLeft: { ...state.archSettingsLeft, ...newSettingsPartial }
        };
    }),
    setActiveLandmarkId: (id) => set({ activeLandmarkId: id }),

    setBaseThickness: (val) => set({ baseThickness: val }),
    setWallHeightOffset: (val) => set({ wallHeightOffset: val }),
    setHeelCupHeight: (val) => set({ heelCupHeight: val }),
    setMedialWallHeight: (val) => set({ medialWallHeight: val }),
    setMedialWallPeakX: (val) => set({ medialWallPeakX: val }),
    setLateralWallHeight: (val) => set({ lateralWallHeight: val }),
    setLateralWallPeakX: (val) => set({ lateralWallPeakX: val }),
    setArchScale: (val) => set({ archScale: val }),
    setEnableLattice: (val) => set({ enableLattice: val }),
    setLatticeCellSize: (val) => set({ latticeCellSize: val }),
    setStrutRadius: (val) => set({ strutRadius: val }),

    setActiveFootSide: (side) => set({ activeFootSide: side }),

    updateArchSettings: (side, settings) => set((state) => {
        if (side === 'right') {
            return { archSettingsRight: { ...state.archSettingsRight, ...settings } };
        } else {
            return { archSettingsLeft: { ...state.archSettingsLeft, ...settings } };
        }
    }),

    setUseGridCells: (val) => set({ useGridCells: val }),
    setGridCellHeight: (id, val) => set((state) => ({
        gridCellHeights: { ...state.gridCellHeights, [id]: val }
    })),
    setArchCurves: (curves) => set({ archCurves: curves }),

    setIsGenerating: (val) => set({ isGenerating: val }),
    setProgress: (val) => set({ progress: val }),
    setProgressMessage: (val) => set({ progressMessage: val }),
    setCurrentModelUrl: (url) => set({ currentModelUrl: url }),
    setStlUrl: (url: string | null) => set({ stlUrl: url }),
    setLatticeInfo: (info) => set({ latticeInfo: info }),
    savePatientPreset: (patientIdArg) => {
        if (typeof window === 'undefined') return false;
        const state = get();
        const pid = patientIdArg ?? state.patientId;
        if (!pid) return false;

        const preset: PatientPreset = {
            version: 1,
            updatedAt: new Date().toISOString(),
            params: {
                flipOrientation: state.flipOrientation,
                baseThickness: state.baseThickness,
                wallHeightOffset: state.wallHeightOffset,
                heelCupHeight: state.heelCupHeight,
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
            },
        };

        try {
            window.localStorage.setItem(`${PRESET_KEY_PREFIX}${pid}`, JSON.stringify(preset));
            return true;
        } catch {
            return false;
        }
    },
    loadPatientPreset: (patientIdArg) => {
        if (typeof window === 'undefined') return false;
        const state = get();
        const pid = patientIdArg ?? state.patientId;
        if (!pid) return false;

        try {
            const raw = window.localStorage.getItem(`${PRESET_KEY_PREFIX}${pid}`);
            if (!raw) return false;
            const parsed = JSON.parse(raw) as PatientPreset;
            if (!parsed?.params) return false;
            const p = parsed.params;
            set({
                flipOrientation: p.flipOrientation,
                baseThickness: p.baseThickness,
                wallHeightOffset: p.wallHeightOffset,
                heelCupHeight: p.heelCupHeight,
                medialWallHeight: p.medialWallHeight,
                medialWallPeakX: p.medialWallPeakX,
                lateralWallHeight: p.lateralWallHeight,
                lateralWallPeakX: p.lateralWallPeakX,
                archScale: p.archScale,
                archSettingsRight: p.archSettingsRight,
                archSettingsLeft: p.archSettingsLeft,
                useGridCells: p.useGridCells,
                gridCellHeights: p.gridCellHeights,
                landmarkConfig: p.landmarkConfig,
                widthConfig: p.widthConfig,
                archCurves: p.archCurves,
            });
            return true;
        } catch {
            return false;
        }
    },
}));
