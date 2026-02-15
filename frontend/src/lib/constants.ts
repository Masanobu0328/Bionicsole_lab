export type ArchGridCell = {
    id: string;
    x_start_landmark: string;
    x_end_landmark: string;
    y_start_percent: number;
    y_end_percent: number;
    default_height: number;
    arch_type: 'medial' | 'lateral' | 'transverse';
    name_ja: string;
};

export const DEFAULT_ARCH_GRID: Record<string, ArchGridCell> = {
    // Medial longitudinal arch (4 cells)
    'medial_1': {
        id: 'medial_1',
        x_start_landmark: 'arch_start',
        x_end_landmark: 'subtalar',
        y_start_percent: 65.0,
        y_end_percent: 100.0,
        default_height: 0.8,
        arch_type: 'medial',
        name_ja: '内側1: アーチ起始〜距骨下'
    },
    'medial_2': {
        id: 'medial_2',
        x_start_landmark: 'subtalar',
        x_end_landmark: 'navicular',
        y_start_percent: 65.0,
        y_end_percent: 100.0,
        default_height: 1.0,
        arch_type: 'medial',
        name_ja: '内側2: 距骨下〜舟状骨'
    },
    'medial_3': {
        id: 'medial_3',
        x_start_landmark: 'navicular',
        x_end_landmark: 'medial_cuneiform',
        y_start_percent: 65.0,
        y_end_percent: 100.0,
        default_height: 0.9,
        arch_type: 'medial',
        name_ja: '内側3: 舟状骨〜内側楔状骨'
    },
    'medial_4': {
        id: 'medial_4',
        x_start_landmark: 'medial_cuneiform',
        x_end_landmark: 'metatarsal',
        y_start_percent: 65.0,
        y_end_percent: 100.0,
        default_height: 0.5,
        arch_type: 'medial',
        name_ja: '内側4: 内側楔状骨〜中足骨'
    },

    // Lateral longitudinal arch (1 cell)
    'lateral_1': {
        id: 'lateral_1',
        x_start_landmark: 'lateral_arch_start',
        x_end_landmark: 'cuboid',
        y_start_percent: 0.0,
        y_end_percent: 25.0,
        default_height: 0.5,
        arch_type: 'lateral',
        name_ja: '外側: 外側アーチ起始〜立方骨'
    },

    // Transverse arch (3 cells)
    'transverse_1': {
        id: 'transverse_1',
        x_start_landmark: 'subtalar',
        x_end_landmark: 'navicular',
        y_start_percent: 20.0,
        y_end_percent: 70.0,
        default_height: 0.3,
        arch_type: 'transverse',
        name_ja: '横1: 距骨下〜舟状骨'
    },
    'transverse_2': {
        id: 'transverse_2',
        x_start_landmark: 'navicular',
        x_end_landmark: 'cuboid',
        y_start_percent: 20.0,
        y_end_percent: 70.0,
        default_height: 0.5,
        arch_type: 'transverse',
        name_ja: '横2: 舟状骨〜立方骨'
    },
    'transverse_3': {
        id: 'transverse_3',
        x_start_landmark: 'cuboid',
        x_end_landmark: 'medial_cuneiform',
        y_start_percent: 20.0,
        y_end_percent: 70.0,
        default_height: 0.5,
        arch_type: 'transverse',
        name_ja: '横3: 立方骨〜内側楔状骨'
    },
};
