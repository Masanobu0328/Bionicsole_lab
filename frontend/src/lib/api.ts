import { supabase } from './supabase';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api/v1';

type Point = { x: number; y: number };

type DbPatientRow = {
    id: string;
    patient_code: string;
    display_label: string | null;
};

type DbDesignVersionRow = {
    version: number;
};

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
    medial_detail_enabled: boolean;
    medial_detail_heights: number[];
    transverse_detail_enabled: boolean;
    transverse_detail_heights: number[];
};

export type CurvePoint = { x: number; y: number };

export type ArchCurves = {
    medial: CurvePoint[];
    medialFlat?: CurvePoint[];
    lateral: CurvePoint[];
    lateralFlat?: CurvePoint[];
    transverse: CurvePoint[];
    transverseFlat?: CurvePoint[];
    heelBridge?: CurvePoint[];
    lateralBridge?: CurvePoint[];
    metatarsalBridge?: CurvePoint[];
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
    outline_points?: Point[];
    landmark_config?: Record<string, number>;
    arch_curves?: ArchCurves;
    bottom_outline_points?: Point[];
};

export type GenerateResponse = {
    task_id: string;
};

export type TaskStatus = {
    status: 'pending' | 'processing' | 'completed' | 'failed';
    progress: number;
    message: string;
    result?: {
        download_url: string;
        stl_url?: string;
        lattice_info?: unknown;
    };
};

export type DesignRecord = {
    id: string;
    patient_id: string;
    foot_side: 'left' | 'right';
    version: number;
    flip_orientation?: boolean | null;
    base_thickness?: number | null;
    wall_height_offset?: number | null;
    wall_height_offset_mm?: number | null;
    heel_cup_height?: number | null;
    medial_wall_height?: number | null;
    medial_wall_peak_x?: number | null;
    lateral_wall_height?: number | null;
    lateral_wall_peak_x?: number | null;
    arch_scale?: number | null;
    enable_lattice?: boolean | null;
    lattice_cell_size?: number | null;
    strut_radius?: number | null;
    arch_settings?: ArchSettings | null;
    landmark_config?: Record<string, number> | null;
    width_config?: Record<string, number> | null;
    arch_curves?: ArchCurves | null;
};

export type OutlineRecord = {
    outline_points: Point[] | null;
    bottom_outline_points: Point[] | null;
};

export type DesignSaveParams = {
    flip_orientation: boolean;
    base_thickness: number;
    wall_height_offset: number;
    heel_cup_height: number;
    medial_wall_height: number;
    medial_wall_peak_x: number;
    lateral_wall_height: number;
    lateral_wall_peak_x: number;
    arch_scale: number;
    enable_lattice: boolean;
    lattice_cell_size: number;
    strut_radius: number;
    arch_settings: ArchSettings;
    landmark_config: Record<string, number>;
    width_config: Record<string, number>;
    arch_curves: ArchCurves | null;
};

function mapPatientRow(row: DbPatientRow): Patient {
    return {
        id: row.patient_code,
        name: row.display_label?.trim() || row.patient_code,
    };
}

async function getAuthHeaders(): Promise<HeadersInit> {
    const { data: { session } } = await supabase.auth.getSession();
    return {
        'Content-Type': 'application/json',
        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    };
}

async function findPatientRecordByCode(patientCode: string): Promise<DbPatientRow | null> {
    const { data, error } = await supabase
        .from('patients')
        .select('id, patient_code, display_label')
        .eq('patient_code', patientCode)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data ? data as DbPatientRow : null;
}

async function resolvePatientRecord(patientCode: string): Promise<DbPatientRow> {
    const patient = await findPatientRecordByCode(patientCode);
    if (!patient) {
        throw new Error(`Patient "${patientCode}" was not found in Supabase.`);
    }
    return patient;
}

export function resolveApiUrl(path: string): string {
    if (!path) return API_BASE_URL;
    if (path.startsWith('http://') || path.startsWith('https://')) {
        return path;
    }
    const base = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${base}${suffix}`;
}

export async function fetchPatientsFromDB(): Promise<Patient[]> {
    const { data, error } = await supabase
        .from('patients')
        .select('id, patient_code, display_label')
        .order('patient_code');

    if (error) {
        throw error;
    }

    return ((data ?? []) as DbPatientRow[]).map(mapPatientRow);
}

export async function createPatient(patientCode: string, displayLabel: string): Promise<Patient> {
    const normalizedCode = patientCode.trim();
    const normalizedLabel = displayLabel.trim() || normalizedCode;

    const { data: { session } } = await supabase.auth.getSession();
    const practitionerId = session?.user?.id;

    const { data, error } = await supabase
        .from('patients')
        .insert({
            patient_code: normalizedCode,
            display_label: normalizedLabel,
            practitioner_id: practitionerId,
        })
        .select('id, patient_code, display_label')
        .single();

    if (error) {
        throw error;
    }

    return mapPatientRow(data as DbPatientRow);
}

export async function saveDesignToDB(
    patientCode: string,
    footSide: 'left' | 'right',
    params: DesignSaveParams,
): Promise<DesignRecord> {
    const patient = await resolvePatientRecord(patientCode);

    const { data: existingVersions, error: versionError } = await supabase
        .from('insole_designs')
        .select('version')
        .eq('patient_id', patient.id)
        .eq('foot_side', footSide)
        .order('version', { ascending: false })
        .limit(1);

    if (versionError) {
        throw versionError;
    }

    const latestVersion = ((existingVersions ?? []) as DbDesignVersionRow[])[0]?.version ?? 0;
    const nextVersion = latestVersion + 1;

    const { data, error } = await supabase
        .from('insole_designs')
        .insert({
            patient_id: patient.id,
            foot_side: footSide,
            version: nextVersion,
            ...params,
        })
        .select('*')
        .single();

    if (error) {
        throw error;
    }

    return data as DesignRecord;
}

export async function loadLatestDesignFromDB(
    patientCode: string,
    footSide: 'left' | 'right',
): Promise<DesignRecord | null> {
    const patient = await findPatientRecordByCode(patientCode);
    if (!patient) {
        return null;
    }

    const { data, error } = await supabase
        .from('insole_designs')
        .select('*')
        .eq('patient_id', patient.id)
        .eq('foot_side', footSide)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data ? data as DesignRecord : null;
}

export async function saveOutlineToDB(
    patientCode: string,
    footSide: 'left' | 'right',
    outlinePoints: Point[],
    bottomPoints?: Point[],
): Promise<OutlineRecord> {
    const patient = await resolvePatientRecord(patientCode);

    const { data, error } = await supabase
        .from('foot_outlines')
        .upsert(
            {
                patient_id: patient.id,
                foot_side: footSide,
                outline_points: outlinePoints,
                bottom_outline_points: bottomPoints ?? null,
            },
            { onConflict: 'patient_id,foot_side' },
        )
        .select('outline_points, bottom_outline_points')
        .single();

    if (error) {
        throw error;
    }

    return data as OutlineRecord;
}

export async function loadOutlineFromDB(
    patientCode: string,
    footSide: 'left' | 'right',
): Promise<OutlineRecord | null> {
    const patient = await findPatientRecordByCode(patientCode);
    if (!patient) {
        return null;
    }

    const { data, error } = await supabase
        .from('foot_outlines')
        .select('outline_points, bottom_outline_points')
        .eq('patient_id', patient.id)
        .eq('foot_side', footSide)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data ? data as OutlineRecord : null;
}

export async function getPatients(): Promise<Patient[]> {
    try {
        const response = await fetch(resolveApiUrl('/patients'), {
            headers: await getAuthHeaders(),
        });
        if (!response.ok) {
            throw new Error('Failed to fetch patients');
        }
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Response is not JSON');
        }
        return response.json() as Promise<Patient[]>;
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
        headers: await getAuthHeaders(),
        body: JSON.stringify(params),
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to generate insole');
    }

    return response.json() as Promise<GenerateResponse>;
}

export async function getTaskStatus(taskId: string): Promise<TaskStatus> {
    const response = await fetch(resolveApiUrl(`/tasks/${taskId}`), {
        headers: await getAuthHeaders(),
    });
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
    return response.json() as Promise<TaskStatus>;
}

export function getDownloadUrl(filename: string): string {
    return resolveApiUrl(`/exports/${filename}`);
}
