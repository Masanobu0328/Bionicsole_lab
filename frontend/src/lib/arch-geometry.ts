import type { ArchCurves, ArchSettings, CurvePoint } from './api';

export const ARCH_CURVE_SCHEMA_VERSION = 9 as const;

type OutlineBounds = { min: number; max: number };

export function pchipValue(xs: number[], ys: number[], x: number): number {
    const count = xs.length;
    if (count === 2) return ys[0] + (x - xs[0]) / (xs[1] - xs[0]) * (ys[1] - ys[0]);
    const h = xs.slice(0, -1).map((value, index) => xs[index + 1] - value);
    const delta = h.map((width, index) => (ys[index + 1] - ys[index]) / width);
    const slopes = Array(count).fill(0);
    for (let index = 1; index < count - 1; index += 1) {
        if (delta[index - 1] * delta[index] <= 0) continue;
        const w1 = 2 * h[index] + h[index - 1];
        const w2 = h[index] + 2 * h[index - 1];
        slopes[index] = (w1 + w2) / (w1 / delta[index - 1] + w2 / delta[index]);
    }
    const endpointSlope = (d0: number, d1: number, h0: number, h1: number) => {
        const slope = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
        if (slope * d0 <= 0) return 0;
        if (d0 * d1 <= 0 && Math.abs(slope) > Math.abs(3 * d0)) return 3 * d0;
        return slope;
    };
    slopes[0] = endpointSlope(delta[0], delta[1], h[0], h[1]);
    slopes[count - 1] = endpointSlope(delta.at(-1)!, delta.at(-2)!, h.at(-1)!, h.at(-2)!);
    let interval = 0;
    while (interval < count - 2 && x > xs[interval + 1]) interval += 1;
    const width = h[interval];
    const t = (x - xs[interval]) / width;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2*t3 - 3*t2 + 1) * ys[interval]
        + (t3 - 2*t2 + t) * width * slopes[interval]
        + (-2*t3 + 3*t2) * ys[interval + 1]
        + (t3 - t2) * width * slopes[interval + 1];
}

export function shapePreservingPoints(points: CurvePoint[], medialApex = false): CurvePoint[] {
    let controls = points.map((point) => ({ ...point }));
    if (medialApex && controls.length >= 5 && controls[4].x > controls[3].x) {
        controls = [
            ...controls.slice(0, 4),
            // Bionicsol's normalized right-foot coordinates use increasing Y
            // toward the lateral side.  The fairing point must therefore move
            // in +Y; using -Y made the curve reverse briefly between M3/M4.
            { x: (controls[3].x + controls[4].x) / 2, y: (controls[3].y + controls[4].y) / 2 + 0.75 },
            ...controls.slice(4),
        ];
    }
    controls = controls.filter((point, index) => index === 0 || point.x > controls[index - 1].x + 1e-8);
    if (controls.length < 2) return controls;
    const xs = controls.map((point) => point.x);
    const ys = controls.map((point) => point.y);
    const dense: CurvePoint[] = [];
    for (let index = 0; index < controls.length - 1; index += 1) {
        for (let step = 0; step < 16; step += 1) {
            const x = controls[index].x + (controls[index + 1].x - controls[index].x) * step / 16;
            dense.push({ x, y: pchipValue(xs, ys, x) });
        }
    }
    dense.push(controls.at(-1)!);
    return dense;
}

export function pointsToPath(points: CurvePoint[]): string {
    return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
}

export function shapePreservingPath(points: CurvePoint[], medialApex = false): string {
    return pointsToPath(shapePreservingPoints(points, medialApex));
}

type Vector = [number, number];

const toVector = (point: CurvePoint): Vector => [point.x, point.y];
const add = (a: Vector, b: Vector): Vector => [a[0] + b[0], a[1] + b[1]];
const subtract = (a: Vector, b: Vector): Vector => [a[0] - b[0], a[1] - b[1]];
const scale = (value: number, vector: Vector): Vector => [value * vector[0], value * vector[1]];

function hermitePosition(p0: Vector, p1: Vector, m0: Vector, m1: Vector, t: number): Vector {
    const t2 = t * t;
    const t3 = t2 * t;
    return add(
        add(scale(2*t3 - 3*t2 + 1, p0), scale(t3 - 2*t2 + t, m0)),
        add(scale(-2*t3 + 3*t2, p1), scale(t3 - t2, m1)),
    );
}

function hermiteDerivative(p0: Vector, p1: Vector, m0: Vector, m1: Vector, t: number): Vector {
    return add(
        add(scale(6*t*t - 6*t, p0), scale(3*t*t - 4*t + 1, m0)),
        add(scale(-6*t*t + 6*t, p1), scale(3*t*t - 2*t, m1)),
    );
}

/**
 * The same T2 -> T1 -> MF5 -> M7 fairing used by the STL generator
 * (geometry_v4_frontend.py `_metatarsal_fairing`). Keep the two in step: when this
 * preview and the engine disagree, the cross-section lies about the part.
 *
 * T1 is read from the transverse curve, never from bridge[1]. They are one shared
 * anatomical point stored twice (bridge[1] is labelled MB1:Ref), and reading the copy
 * is what lets the two drift apart.
 */
export function metatarsalFairingPoints(
    transverse: CurvePoint[],
    bridge: CurvePoint[],
    subdivisions = 12,
): CurvePoint[] {
    if (transverse.length < 4 || bridge.length < 3) return bridge.map((point) => ({ ...point }));
    const t0 = toVector(transverse[0]);
    const t3 = toVector(transverse[3]);
    const t2 = toVector(bridge[0]);
    const mb1 = toVector(transverse[1]);
    const mf5 = toVector(bridge[bridge.length - 2]);
    const m7 = toVector(bridge[bridge.length - 1]);
    const ellipseT2Tangent = scale(0.5, subtract(mb1, t3));
    const ellipseMb1Tangent = scale(0.5, subtract(t0, t2));
    const fraction = 0.525;
    const departure = hermitePosition(t2, mb1, ellipseT2Tangent, ellipseMb1Tangent, fraction);
    const t2DepartureTangent = scale(fraction, ellipseT2Tangent);
    const departureTangent = scale(
        fraction,
        hermiteDerivative(t2, mb1, ellipseT2Tangent, ellipseMb1Tangent, fraction),
    );
    // The rim passes through T1 exactly. It used to be pulled 14% toward MF5 to round
    // that corner off, but the drawn chain turns only 12.2deg there, and the shift moved
    // the rim 1.09mm off the point the user placed. The real corner is at T2 (63.7deg),
    // and `departure` is what eases that one.
    const blend = mb1;
    const m7Tangent = scale(0.5, subtract(m7, mf5));
    const firstRhs = subtract(scale(6, subtract(mf5, departure)), scale(2, departureTangent));
    const secondRhs = subtract(scale(6, subtract(m7, blend)), scale(2, m7Tangent));
    const blendTangent = scale(1 / 60, subtract(scale(8, firstRhs), scale(2, secondRhs)));
    const mf5Tangent = scale(1 / 60, add(scale(-2, firstRhs), scale(8, secondRhs)));
    const spans: Array<[Vector, Vector, Vector, Vector]> = [
        [t2, departure, t2DepartureTangent, departureTangent],
        [departure, blend, departureTangent, blendTangent],
        [blend, mf5, blendTangent, mf5Tangent],
        [mf5, m7, mf5Tangent, m7Tangent],
    ];
    const dense: CurvePoint[] = [];
    for (const [start, end, startTangent, endTangent] of spans) {
        for (let step = 0; step < subdivisions; step += 1) {
            const point = hermitePosition(start, end, startTangent, endTangent, step / subdivisions);
            dense.push({ x: point[0], y: point[1] });
        }
    }
    dense.push({ x: m7[0], y: m7[1] });
    return dense;
}

function yBoundsAtX(outline: CurvePoint[], x: number): OutlineBounds | null {
    if (outline.length < 2) return null;
    const intersections: number[] = [];
    for (let index = 0; index < outline.length; index += 1) {
        const a = outline[index];
        const b = outline[(index + 1) % outline.length];
        if ((a.x <= x && x < b.x) || (b.x <= x && x < a.x)) {
            if (Math.abs(b.x - a.x) > 1e-9) {
                intersections.push(a.y + (x - a.x) / (b.x - a.x) * (b.y - a.y));
            }
        }
    }
    if (intersections.length < 2) return null;
    return { min: Math.min(...intersections), max: Math.max(...intersections) };
}

function cloneCurves(curves: ArchCurves): ArchCurves {
    return {
        ...curves,
        medial: curves.medial.map((point) => ({ ...point })),
        medialFlat: curves.medialFlat?.map((point) => ({ ...point })),
        lateral: curves.lateral.map((point) => ({ ...point })),
        lateralFlat: curves.lateralFlat?.map((point) => ({ ...point })),
        transverse: curves.transverse.map((point) => ({ ...point })),
        transverseFlat: curves.transverseFlat?.map((point) => ({ ...point })),
        heelBridge: curves.heelBridge?.map((point) => ({ ...point })),
        lateralBridge: curves.lateralBridge?.map((point) => ({ ...point })),
        metatarsalBridge: curves.metatarsalBridge?.map((point) => ({ ...point })),
    };
}

const curveKeys: Array<Exclude<keyof ArchCurves, 'schemaVersion'>> = [
    'medial', 'medialFlat', 'lateral', 'lateralFlat', 'transverse',
    'transverseFlat', 'heelBridge', 'lateralBridge', 'metatarsalBridge',
];

function reflectCurves(curves: ArchCurves, outline: CurvePoint[]): ArchCurves {
    const reflected = cloneCurves(curves);
    for (const key of curveKeys) {
        const points = reflected[key];
        if (!points) continue;
        reflected[key] = points.map((point) => {
            const bounds = yBoundsAtX(outline, point.x);
            return bounds ? { x: point.x, y: bounds.min + bounds.max - point.y } : point;
        });
    }
    return reflected;
}

function orientationScore(curves: ArchCurves, outline: CurvePoint[]): number {
    let score = 0;
    let count = 0;
    const scoreCurve = (points: CurvePoint[] | undefined, target: 'min' | 'max') => {
        for (const point of points ?? []) {
            const bounds = yBoundsAtX(outline, point.x);
            if (!bounds || bounds.max - bounds.min < 1e-6) continue;
            const normalized = (point.y - bounds.min) / (bounds.max - bounds.min);
            score += target === 'max' ? 1 - normalized : normalized;
            count += 1;
        }
    };
    // Bionicsol's editable reference is a right foot: MinY=medial, MaxY=lateral.
    scoreCurve(curves.medial, 'min');
    scoreCurve(curves.medialFlat, 'min');
    scoreCurve(curves.lateral, 'max');
    scoreCurve(curves.lateralFlat, 'max');
    return count ? score / count : Number.POSITIVE_INFINITY;
}

function model7Mf5(curves: ArchCurves, outline: CurvePoint[]): CurvePoint {
    const bridge = curves.metatarsalBridge ?? [];
    // T1 first: bridge[1] is a copy of it, and the copy is what drifts.
    const mb1 = curves.transverse?.[1] ?? bridge[1] ?? curves.medial.at(-1) ?? { x: 0, y: 0 };
    const m7 = bridge.at(-1) ?? mb1;
    const savedMf5 = curves.medialFlat?.at(-1);
    if (savedMf5) return { ...savedMf5 };
    // Model 7 places MF5 at 67.886% when the metatarsal landmark is 70%.
    // transversely. Clamp it to the local outline so narrow patient outlines remain valid.
    const outlineXs = outline.map((point) => point.x);
    const footLength = outlineXs.length ? Math.max(...outlineXs) - Math.min(...outlineXs) : 0;
    const candidate = {
        x: m7.x - footLength * 0.0211426,
        y: mb1.y + (m7.y - mb1.y) * 0.57,
    };
    const bounds = yBoundsAtX(outline, candidate.x);
    return bounds
        ? { x: candidate.x, y: Math.max(bounds.min, Math.min(bounds.max, candidate.y)) }
        : candidate;
}

export function migrateArchCurves(
    source: ArchCurves | null,
    outline: CurvePoint[],
): { curves: ArchCurves | null; changed: boolean } {
    if (!source) return { curves: null, changed: false };
    const sourceT1 = source.transverse?.[1];
    const sourceBridge = source.metatarsalBridge;
    const sourceSharedMb1 = Boolean(
        sourceT1
        && sourceBridge?.length === 4
        && Math.hypot(sourceBridge[1].x - sourceT1.x, sourceBridge[1].y - sourceT1.y) < 1e-6
        && source.medial.length > 0
        && Math.hypot(source.medial.at(-1)!.x - sourceT1.x, source.medial.at(-1)!.y - sourceT1.y) < 1e-6
    );
    const sourceOrderIsValid = Boolean(
        sourceBridge?.length === 4
        && sourceBridge[2].x < sourceBridge[1].x
        && Math.abs(sourceBridge[1].x - sourceBridge[3].x) < 1e-6
    );
    if (source.schemaVersion === ARCH_CURVE_SCHEMA_VERSION && sourceSharedMb1 && sourceOrderIsValid) {
        return { curves: source, changed: false };
    }

    const current = cloneCurves(source);
    const reflected = reflectCurves(current, outline);
    let migrated = orientationScore(reflected, outline) + 0.02 < orientationScore(current, outline)
        ? reflected
        : current;

    if ((source.schemaVersion ?? 0) < 6) {
        // Model-7 anatomical placement measured across each local foot width.
        // MinY is medial and MaxY is lateral in normalized Bionicsol space.
        const placeAtLateralFraction = (point: CurvePoint, fraction: number): CurvePoint => {
            const local = yBoundsAtX(outline, point.x);
            if (!local) return { ...point };
            return { ...point, y: local.min + (local.max - local.min) * fraction };
        };
        const solidFractions: Record<number, number> = {
            2: 0.39, // M2
            3: 0.51, // M3
            4: 0.49, // M4
        };
        migrated.medial = migrated.medial.map((point, index) =>
            index in solidFractions ? placeAtLateralFraction(point, solidFractions[index]) : point,
        );
        if (migrated.medialFlat) {
            migrated.medialFlat = migrated.medialFlat.map((point, index) =>
                index === 2 || index === 3 ? placeAtLateralFraction(point, 0.35) : point,
            );
        }
    }

    if ((source.schemaVersion ?? 0) < 8 && migrated.transverse?.length >= 4) {
        const outlineXs = outline.map((point) => point.x);
        const footLength = outlineXs.length ? Math.max(...outlineXs) - Math.min(...outlineXs) : 0;
        const existingM7 = (migrated.metatarsalBridge?.length ?? 0) >= 3
            ? migrated.metatarsalBridge!.at(-1)!
            : migrated.transverse[1];
        // Schemas 5-7 temporarily placed M7 1.28% toe-side of its landmark.
        // Restore it to the actual metatarsal landmark; older schemas already
        // stored M7 directly on that landmark.
        const m7X = (source.schemaVersion ?? 0) >= 5
            ? existingM7.x - footLength * 0.0128
            : existingM7.x;
        const t2X = m7X - footLength * 0.008;
        migrated.transverse = migrated.transverse.map((point, index) => {
            if (index === 1 || index === 3) return { ...point, x: m7X };
            if (index === 2) return { ...point, x: t2X };
            return point;
        });
        if (migrated.transverseFlat?.length === migrated.transverse.length) {
            const centerX = migrated.transverse.reduce((sum, point) => sum + point.x, 0) / migrated.transverse.length;
            const centerY = migrated.transverse.reduce((sum, point) => sum + point.y, 0) / migrated.transverse.length;
            migrated.transverseFlat = migrated.transverse.map((point) => ({
                x: centerX + (point.x - centerX) * 0.6,
                y: centerY + (point.y - centerY) * 0.6,
            }));
        }
    }

    if ((source.schemaVersion ?? 0) < 9 && migrated.transverse?.length >= 4 && migrated.metatarsalBridge?.length === 4) {
        const outlineXs = outline.map((point) => point.x);
        const footLength = outlineXs.length ? Math.max(...outlineXs) - Math.min(...outlineXs) : 0;
        const m7X = migrated.metatarsalBridge[3].x;
        migrated.transverse = migrated.transverse.map((point, index) => {
            if (index === 1 || index === 3) return { ...point, x: m7X };
            if (index === 2) return { ...point, x: m7X + footLength * 0.0098732 };
            return point;
        });
        if (migrated.transverseFlat?.length === migrated.transverse.length) {
            const centerX = migrated.transverse.reduce((sum, point) => sum + point.x, 0) / migrated.transverse.length;
            const centerY = migrated.transverse.reduce((sum, point) => sum + point.y, 0) / migrated.transverse.length;
            migrated.transverseFlat = migrated.transverse.map((point) => ({
                x: centerX + (point.x - centerX) * 0.6,
                y: centerY + (point.y - centerY) * 0.6,
            }));
        }
    }

    let bridge = migrated.metatarsalBridge ?? [];
    // A short-lived v4 generator accidentally inserted an HC-like point here.
    // Recover the intended T2 -> MB1 -> MF5 -> M7 four-point bridge.
    if (bridge.length === 5) {
        migrated.metatarsalBridge = [
            { ...bridge[0] },
            { ...bridge[1] },
            { ...bridge[3] },
            { ...bridge[4] },
        ];
        bridge = migrated.metatarsalBridge;
    }
    if (bridge.length === 3) {
        migrated.metatarsalBridge = [
            { ...bridge[0] },
            { ...bridge[1] },
            model7Mf5(migrated, outline),
            { ...bridge[2] },
        ];
    }

    if ((source.schemaVersion ?? 0) < 4) {
        // Match the final ArchPad model-7 placement once for pre-v4 designs.
        // In Bionicsol right-foot coordinates, MaxY is lateral and MinY is medial.
        const moveAcrossWidth = (point: CurvePoint, fraction: number): CurvePoint => {
            const bounds = yBoundsAtX(outline, point.x);
            if (!bounds) return { ...point };
            return {
                ...point,
                y: Math.max(bounds.min, Math.min(bounds.max, point.y + (bounds.max - bounds.min) * fraction)),
            };
        };
        // Medial curves are normalized above using the measured model-7
        // fractions; only the legacy lateral curves still need this shift.
        migrated.lateral = migrated.lateral.map((point, index, points) =>
            index > 0 && index < points.length - 1 ? moveAcrossWidth(point, -0.05) : point,
        );
        if (migrated.lateralFlat) {
            migrated.lateralFlat = migrated.lateralFlat.map((point, index, points) =>
                index > 0 && index < points.length - 1 ? moveAcrossWidth(point, -0.05) : point,
            );
        }
    }

    // T1 and MB1 are one shared anatomical point, so MB1 always follows T1.
    // M7 and MF5 are NOT derived: they are hand-placed points and must survive a
    // reload untouched. Snapping M7 onto T1's longitudinal line is a pre-v9 rule -
    // running it on current designs silently moved M7 every time one was opened.
    const migratedT1 = migrated.transverse?.[1];
    const migratedBridge = migrated.metatarsalBridge;
    if (migratedT1 && migratedBridge?.length === 4) {
        const mb1 = { ...migratedT1 };
        migrated.medial = migrated.medial.map((point, index, points) =>
            index === points.length - 1 ? { ...mb1 } : point,
        );

        if ((source.schemaVersion ?? 0) < 9) {
            const mf5 = migratedBridge[2];
            const outlineXs = outline.map((point) => point.x);
            const footLength = outlineXs.length ? Math.max(...outlineXs) - Math.min(...outlineXs) : 0;
            const m7X = migratedT1.x;
            const t2 = { ...(migrated.transverse?.[2] ?? migratedBridge[0]), x: m7X + footLength * 0.0098732 };
            if (migrated.transverse?.length >= 4) {
                migrated.transverse = migrated.transverse.map((point, index) => index === 2 ? { ...t2 } : point);
            }
            const m7Bounds = yBoundsAtX(outline, m7X);
            const m7 = {
                ...migratedBridge[3],
                x: m7X,
                y: m7Bounds ? m7Bounds.min : migratedBridge[3].y,
            };
            const nextMf5 = {
                ...mf5,
                x: m7X - footLength * 0.0211426,
                y: mb1.y + (m7.y - mb1.y) * 0.57,
            };
            migrated.metatarsalBridge = [{ ...t2 }, mb1, nextMf5, m7];
            if (migrated.medialFlat?.length) {
                migrated.medialFlat = migrated.medialFlat.map((point, index, points) =>
                    index === points.length - 1 ? { ...nextMf5 } : point,
                );
            }
        } else {
            migrated.metatarsalBridge = migratedBridge.map((point, index) =>
                index === 1 ? mb1 : point,
            );
        }
    }

    // HC is the toe-side crown of the M0 -> L0 heel arc. It must never collapse
    // onto the straight H1-H2 cross-line.
    if (migrated.heelBridge?.length === 4 || ((source.schemaVersion ?? 0) < 8 && migrated.heelBridge?.length === 5)) {
        const heel = migrated.heelBridge;
        const [m0, h1] = heel;
        const h2 = heel.length === 4 ? heel[2] : heel[3];
        const l0 = heel.at(-1)!;
        const outlineXs = outline.map((point) => point.x);
        const footLength = outlineXs.length ? Math.max(...outlineXs) - Math.min(...outlineXs) : 0;
        migrated.heelBridge = [
            { ...m0 },
            { ...h1 },
            { x: Math.max(h1.x, h2.x) + footLength * (0.02 * 2 / 3), y: (h1.y + h2.y) / 2 },
            { ...h2 },
            { ...l0 },
        ];
    }
    migrated = { ...migrated, schemaVersion: ARCH_CURVE_SCHEMA_VERSION };
    return { curves: migrated, changed: true };
}

const roundHeight = (value: number) => Math.round(Math.max(0, value) * 10) / 10;

export function clinicalMedialHeights(
    height: number,
    settings: ArchSettings,
    landmarks: Record<string, number>,
    subtalar: ArchSettings['subtalar_pattern'],
    firstRay: ArchSettings['first_ray_pattern'],
): number[] {
    const cun = landmarks.medial_cuneiform ?? 55;
    const end = settings.medial_end;
    const m5 = (cun + (landmarks.metatarsal ?? 70)) / 2;
    const lineRatio = end <= cun ? 0 : Math.max(0, Math.min(1, (end - m5) / (end - cun)));
    const lineHeight = height * lineRatio;
    const current = settings.medial_detail_heights ?? [0, 0, 0, 0];
    const subHeight = subtalar === 'pronation'
        ? 0
        : subtalar === 'supination'
            ? height * 0.65
            : current[0] ?? 0;
    const m5Height = firstRay === 'plantarflexion'
        ? lineHeight * 0.9
        : firstRay === 'dorsiflexion'
            ? Math.min(height, lineHeight + height * 0.3)
            : current[3] ?? 0;
    return [roundHeight(subHeight), roundHeight(height), roundHeight(height), roundHeight(m5Height)];
}

export function effectiveCurvesForSettings(
    source: ArchCurves | null,
    settings: ArchSettings,
    outline: CurvePoint[],
    landmarks: Record<string, number>,
): ArchCurves | null {
    if (!source) return null;
    const curves = cloneCurves(source);
    if (settings.subtalar_pattern !== 'pronation') return curves;
    if (curves.medial.length < 4 || !curves.medialFlat?.length || !curves.heelBridge?.length) return curves;
    const xs = outline.map((point) => point.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const subX = minX + (maxX - minX) * ((landmarks.subtalar ?? 30) / 100);
    const bounds = yBoundsAtX(outline, subX);
    if (!bounds) return curves;
    const anchor = { x: subX, y: bounds.min };

    curves.medial = [anchor, ...curves.medial.slice(3).map((point) => ({ ...point }))];
    curves.medialFlat = [anchor, ...curves.medialFlat.slice(2).map((point) => ({ ...point }))];
    const heel = curves.heelBridge.map((point) => ({ ...point }));
    const h2Index = Math.max(2, heel.length - 2);
    const h2 = heel[h2Index];
    const override = settings.pronation_h1;
    const h1 = override ?? {
        x: anchor.x + (h2.x - anchor.x) * 0.5,
        y: anchor.y + (h2.y - anchor.y) * 0.5,
    };
    heel[0] = anchor;
    heel[1] = { ...h1 };
    curves.heelBridge = heel;
    return curves;
}
