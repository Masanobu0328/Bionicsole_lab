const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api/v1';

export function resolveApiUrl(path: string): string {
    if (!path) return API_BASE_URL;
    if (path.startsWith('http://') || path.startsWith('https://')) {
        return path;
    }
    const base = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${base}${suffix}`;
}

export type Patient = {
    id: string;
    name: string;
};

export type ArchSettings = {
    medial_start: number;
    medial_peak: number;
    medial_end: number;
    medial_height: number;
    lateral_start: number;
    lateral_peak: number;
    lateral_end: number;
    lateral_height: number;
    transverse_start: number;
    transverse_peak: number;
    transverse_end: number;
    transverse_height: number;
    medial_y_start: number;
    medial_y_end: number;
    lateral_y_start: number;
    lateral_y_end: number;
    transverse_y_start: number;
    transverse_y_end: number;
};

export type InsoleParams = {
    patient_id: string;
    foot_side: 'left' | 'right';
    flip_orientation: boolean;
    base_thickness: number;
    wall_height_offset_mm: number;
    heel_cup_height: number;
    medial_wall_height: number;
    medial_wall_peak_x: number;
    lateral_wall_height: number;
    lateral_wall_peak_x: number;
    arch_scale: number;
    arch_settings: ArchSettings;
    enable_lattice: boolean;
    lattice_cell_size: number;
    strut_radius: number;

    // New fields for custom design
    outline_points?: { x: number; y: number }[];
    landmark_config?: Record<string, number>;
    arch_curves?: ArchCurves;
};

export type CurvePoint = { x: number; y: number };

export type ArchCurves = {
    medial: CurvePoint[];
    medialFlat?: CurvePoint[];
    lateral: CurvePoint[];
    lateralFlat?: CurvePoint[];
    transverse: CurvePoint[];
    transverseFlat?: CurvePoint[];
    heelBridge?: CurvePoint[];    // [M0, CP_ray1, CP_ray5, L0] = 4 points
    lateralBridge?: CurvePoint[]; // [L4, CP_cuboid, T4] = 3 points
    metatarsalBridge?: CurvePoint[]; // [T2, CP_mid, M7] = 3 points
};

export type GenerateResponse = {
    task_id: string; // Changed to match new API
};

export type TaskStatus = {
    status: 'pending' | 'processing' | 'completed' | 'failed';
    progress: number;
    message: string;
    result?: {
        download_url: string;
        stl_url?: string;
        lattice_info?: any;
    };
};

export async function getPatients(): Promise<Patient[]> {
    try {
        const response = await fetch(resolveApiUrl('/patients'));
        if (!response.ok) {
            throw new Error('Failed to fetch patients');
        }
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Response is not JSON');
        }
        return response.json();
    } catch (error) {
        console.warn('Backend API not reachable, using demo data:', error);
        return [
            { id: '0001', name: 'テスト①' },
            { id: '0002', name: 'テスト②' },
            { id: '0003', name: 'テスト③' },
        ];
    }
}

export async function generateInsole(params: InsoleParams): Promise<GenerateResponse> {
    const response = await fetch(resolveApiUrl('/generate-insole'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to generate insole');
    }

    return response.json();
}

export async function getTaskStatus(taskId: string): Promise<TaskStatus> {
    const response = await fetch(resolveApiUrl(`/tasks/${taskId}`));
    if (!response.ok) {
        let detail = '';
        try {
            const errorData = await response.json();
            detail = errorData?.detail || '';
        } catch {
            try {
                detail = await response.text();
            } catch {
                detail = '';
            }
        }
        const suffix = detail ? `: ${detail}` : '';
        throw new Error(`Failed to get task status (${response.status})${suffix}`);
    }
    return response.json();
}

export function getDownloadUrl(filename: string): string {
    return resolveApiUrl(`/exports/${filename}`);
}
