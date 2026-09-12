'use client';

import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { getSmoothPath, getBounds, getOutlineYAtX } from '@/lib/geometry-utils';
import { ZoomIn, ZoomOut, Maximize, MousePointer2, Move, RotateCcw, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CurvePoint, ArchCurves } from '@/lib/api';
import {
    effectiveCurvesForSettings,
    metatarsalFairingPoints,
    pointsToPath,
    shapePreservingPath,
} from '@/lib/arch-geometry';

// --- Constants ---
// T1 (transverse Ray1 point) and MB1 (medial's last point) are one shared point, matching
// ArchPad Lab's spec. They sit on M7's longitudinal line: that is what makes the MF5 notch
// come out cleanly.
const T1_MB1_HEEL_OFFSET_PCT = 0;

// T3 sits heelward of M7 by this much. It is what gives the T1 -> T2 -> T3 arc its roundness
// without pushing T2 further toe-ward than M7, which the practitioner wants kept close in.
// Measured on a real design: 2% gives a 5.75mm arc, 4% gives 8.61mm, 6% gives 11.07mm.
const T3_HEEL_OFFSET_PCT = 4;

// T2 and T3 are placed as a fraction of the span from Ray1 to whichever line carries T4 -
// Ray5 for the 2/3/4 width pattern, the 2/3 line for the narrow one. Solving both patterns
// on the real 8-point closed Catmull-Rom gives the same pair of fractions, so one rule covers
// the default shape and both width buttons.
//
// The limit is the ray LINE, which moves with x - not T4's single y value. Measured against
// the line, T3 can sit at 0.875 before the T3-T4 span becomes the worst offender; below that
// the residual ~0.1mm excursion is on the T4-T5 span instead, which T3 cannot fix.
// T2 at 0.63 then makes the part of the region lying toe-ward of the M7 line fold
// symmetrically about the horizontal midline of the chord the M7 line cuts through it.
const T3_BAND_FRACTION = 0.875;
const T2_BAND_FRACTION = 0.63;

const COLORS = {
    outline_stroke: 'var(--border)',
    outline_fill: 'rgba(20, 184, 166, 0.05)',
    medial_stroke: '#14b8a6',    // Primary Teal
    medial_fill: 'rgba(20, 184, 166, 0.1)',
    lateral_stroke: '#0ea5e9',   // Sky Blue
    lateral_fill: 'rgba(14, 165, 233, 0.1)',
    transverse_stroke: '#2dd4bf', // Emerald
    transverse_fill: 'rgba(45, 212, 191, 0.2)',
    point_base: 'var(--background)',
    point_active: '#14b8a6',
    point_fixed: '#e2e8f0',
    grid: 'var(--border)',
    guide: '#94a3b8',
    landmark_guide: '#cbd5e1',
    bridge_stroke: '#94a3b8',    // Muted gray for bridge lines
};

const LM_LABELS: Record<string, string> = {
    'arch_start': '起始',
    'lateral_arch_start': '外起始',
    'subtalar': '距骨',
    'navicular': '舟状',
    'cuboid': '立方',
    'medial_cuneiform': '楔状',
    'metatarsal_base_1': 'MB1',
    'metatarsal': 'M7'
};

// Control point labels per curve type
const CP_LABELS: Record<string, string[]> = {
    // The last medial point is the shared T1/MB1 point; transverse[1] carries its label
    // so the three stored copies do not print three labels on the same pixel.
    medial: ['M0:Start', 'M1', 'M2:Sub', 'M3:Nav', 'M4:Cun', 'M5', ''],
    medialFlat: ['mF0', 'mF1', 'mF2', 'mF3', 'mF4', 'mF5'],
    lateral: ['L0:Start', 'L1', 'L2:Peak', 'L3', 'L4:End'],
    lateralFlat: ['lF0', 'lF1', 'lF2', 'lF3', 'lF4'],
    transverse: ['T0:Ray1', 'T1/MB1', 'T2:Meta', 'T3:Ray5', 'T4:Ray5', 'T5', 'T6:Mid', 'T7'],
    heelBridge: ['M0:Start', 'H1:Ray1', 'HC:Bow', 'H2:Ray5', 'L0:Start'],
    lateralBridge: ['L4:End', 'B1:Cub', 'T4:Ray5'],
    metatarsalBridge: ['T2:Meta', 'MB1:Ref', 'MF5:Pass', 'M7:Meta'],
};

export default function ArchRegionEditorCanvas() {
    const {
        outlinePoints,
        widthConfig,
        landmarkConfig,
        archCurves,
        setArchCurves,
        updateArchSettings,
        activeFootSide,
        archSettingsRight,
        archSettingsLeft,
    } = useStore();

    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Viewport
    const [transform, setTransform] = useState({ x: 50, y: 50, k: 1 });
    const [isPanning, setIsPanning] = useState(false);
    const [lastPanPos, setLastPanPos] = useState({ x: 0, y: 0 });
    const [showLabels, setShowLabels] = useState(false);

    // Interaction
    const [draggingCurve, setDraggingCurve] = useState<'medial' | 'lateral' | 'transverse' | 'medialFlat' | 'lateralFlat' | 'heelBridge' | 'lateralBridge' | 'metatarsalBridge' | null>(null);
    const [draggingPointIdx, setDraggingPointIdx] = useState<number | null>(null);
    const [isDraggingWholeCurve, setIsDraggingWholeCurve] = useState(false);
    const [localCurves, setLocalCurves] = useState<ArchCurves | null>(archCurves);

    const localCurvesRef = useRef<ArchCurves | null>(archCurves);
    const isDraggingRef = useRef(false);
    const archCurvesRef = useRef<ArchCurves | null>(archCurves);
    const draggingCurveRef = useRef<typeof draggingCurve>(null);
    const draggingPointIdxRef = useRef<number | null>(null);
    const isPronationH1DragRef = useRef(false);
    const pronationH1DragPointRef = useRef<CurvePoint | null>(null);
    const isDraggingWholeCurveRef = useRef(false);
    const isPanningRef = useRef(false);
    const lastPanPosRef = useRef({ x: 0, y: 0 });
    const transformRef = useRef(transform);

    const bounds = useMemo(() => getBounds(outlinePoints), [outlinePoints]);
    const activeArchSettings = activeFootSide === 'right' ? archSettingsRight : archSettingsLeft;
    const effectivePreviewCurves = useMemo(
        () => effectiveCurvesForSettings(
            localCurves,
            activeArchSettings,
            outlinePoints,
            landmarkConfig,
        ),
        [localCurves, activeArchSettings, outlinePoints, landmarkConfig],
    );

    useEffect(() => {
        archCurvesRef.current = archCurves;
    }, [archCurves]);

    useEffect(() => {
        transformRef.current = transform;
    }, [transform]);

    useEffect(() => {
        draggingCurveRef.current = draggingCurve;
    }, [draggingCurve]);

    useEffect(() => {
        draggingPointIdxRef.current = draggingPointIdx;
    }, [draggingPointIdx]);

    useEffect(() => {
        isDraggingWholeCurveRef.current = isDraggingWholeCurve;
    }, [isDraggingWholeCurve]);

    useEffect(() => {
        isPanningRef.current = isPanning;
    }, [isPanning]);

    useEffect(() => {
        lastPanPosRef.current = lastPanPos;
    }, [lastPanPos]);

    useEffect(() => {
        if (!isDraggingRef.current) {
            setLocalCurves(archCurves);
            localCurvesRef.current = archCurves;
        }
    }, [archCurves]);

    // Sync arch curve positions to archSettings (medial_end + transverse_start/peak/end)
    const syncArchSettings = React.useCallback((curves: { medial?: CurvePoint[], transverse?: CurvePoint[] }) => {
        if (bounds.width <= 0) return;
        const updates: Record<string, number> = {};

        if (curves.transverse && curves.transverse.length >= 2) {
            const xs = curves.transverse.map(p => p.x);
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const centroidX = xs.reduce((s, v) => s + v, 0) / xs.length;
            updates.transverse_start = Math.max(0, Math.min(100, ((minX - bounds.minX) / bounds.width) * 100));
            updates.transverse_peak  = Math.max(0, Math.min(100, ((centroidX - bounds.minX) / bounds.width) * 100));
            updates.transverse_end   = Math.max(0, Math.min(100, ((maxX - bounds.minX) / bounds.width) * 100));
        }
        if (curves.medial && curves.medial.length > 0) {
            const lastPt = curves.medial[curves.medial.length - 1];
            updates.medial_end = Math.max(0, Math.min(100, ((lastPt.x - bounds.minX) / bounds.width) * 100));
        }
        if (Object.keys(updates).length > 0) {
            // X軸方向の範囲（足の長さ方向）は左右共通なので両足に適用する
            updateArchSettings('right', updates);
            updateArchSettings('left', updates);
        }
    }, [bounds, updateArchSettings]);

    // Convenience wrappers (same reference count in deps)
    const syncTransverseToArchSettings = React.useCallback(
        (points: CurvePoint[]) => syncArchSettings({ transverse: points }),
        [syncArchSettings]
    );

    // Helper to generate Flat curves (moved outside to fix ReferenceError)
    const createFlatCurve = React.useCallback((sourcePoints: CurvePoint[], direction: 1 | -1, isClosed = false) => {
        if (sourcePoints.length < 2) return [];

        if (isClosed) {
            // Simple shrinking for closed polygon (Transverse)
            const cx = sourcePoints.reduce((sum, p) => sum + p.x, 0) / sourcePoints.length;
            const cy = sourcePoints.reduce((sum, p) => sum + p.y, 0) / sourcePoints.length;
            const scale = 0.6; // 60% scale for transverse

            return sourcePoints.map(p => ({
                x: cx + (p.x - cx) * scale,
                y: cy + (p.y - cy) * scale
            }));
        }

        const startP = sourcePoints[0];
        const endP = sourcePoints[sourcePoints.length - 1];
        const startX = startP.x;
        const endX = endP.x;
        const totalLen = endX - startX;
        const padding = totalLen * 0.05; // Keep 5% X-padding

        const flatStartX = startX + padding;
        const flatEndX = endX - padding;

        return sourcePoints.map((p, i) => {
            let newX;
            if (i === 0) newX = flatStartX;
            else if (i === sourcePoints.length - 1) newX = flatEndX;
            else {
                const t = (p.x - startX) / totalLen;
                newX = flatStartX + t * (flatEndX - flatStartX);
            }

            const yBounds = getOutlineYAtX(outlinePoints, newX);
            if (yBounds) {
                const t_chord = (p.x - startX) / totalLen;
                const chordY = startP.y + (endP.y - startP.y) * t_chord;
                const bulge = p.y - chordY;
                const newBulge = bulge * 0.6; // 60% bulge

                let startSnapY = startP.y;
                let endSnapY = endP.y;
                const startB = getOutlineYAtX(outlinePoints, flatStartX);
                const endB = getOutlineYAtX(outlinePoints, flatEndX);

                if (startB) startSnapY = direction === -1 ? startB.min : startB.max;
                if (endB) endSnapY = direction === -1 ? endB.min : endB.max;

                if (i === 0) return { x: newX, y: startSnapY };
                if (i === sourcePoints.length - 1) return { x: newX, y: endSnapY };

                const t_new = (newX - flatStartX) / (flatEndX - flatStartX);
                const newChordY = startSnapY + (endSnapY - startSnapY) * t_new;

                return { x: newX, y: newChordY + newBulge };
            }
            return { x: newX, y: p.y };
        });
    }, [outlinePoints]);

    // Custom 6-point medialFlat ending at model-7 MF5, heelward of shared MB1/T1.
    const generateMedialFlatCustom = React.useCallback((medialPoints?: CurvePoint[]): CurvePoint[] => {
        const r1Pct = widthConfig['ray1_boundary'] ?? 65;
        const cuneiformPct = landmarkConfig['medial_cuneiform'] ?? 55;
        const metatarsalPct = landmarkConfig['metatarsal'] ?? 70;
        const mb1Pct = metatarsalPct - T1_MB1_HEEL_OFFSET_PCT;
        const midCunMB1 = (cuneiformPct + mb1Pct) / 2; // M5 default X%

        // mF4 X: follows M5's actual X (index 5 in 7-point medial arch), else default
        const mf4X = (medialPoints && medialPoints.length >= 6)
            ? medialPoints[5].x
            : bounds.minX + bounds.width * (midCunMB1 / 100);

        // Compute actual M7 and MB1 world coordinates for mF5
        const m7X = bounds.minX + bounds.width * (metatarsalPct / 100);
        const mb1X = bounds.minX + bounds.width * (mb1Pct / 100);
        const m7YBounds = getOutlineYAtX(outlinePoints, m7X);
        const mb1YBounds = getOutlineYAtX(outlinePoints, mb1X);
        const m7Y = m7YBounds ? m7YBounds.min : 0;
        const mb1Y = mb1YBounds
            ? mb1YBounds.max - (mb1YBounds.max - mb1YBounds.min) * ((r1Pct + 3) / 100)
            : 0;

        const mf5: CurvePoint = {
            x: m7X - bounds.width * 0.0211426,
            y: mb1Y + (m7Y - mb1Y) * 0.57,
        };

        const basePercents = [
            landmarkConfig['arch_start'] ?? 15,   // mF0
            landmarkConfig['subtalar'] ?? 30,       // mF1
            landmarkConfig['navicular'] ?? 43,      // mF2
            cuneiformPct,                           // mF3
        ];
        const pts = basePercents.map((pct, i) => {
            const x = bounds.minX + bounds.width * (pct / 100);
            const yBounds = getOutlineYAtX(outlinePoints, x);
            if (!yBounds) return { x, y: 0 };
            const outlineY = yBounds.min;
            const ray1Y = yBounds.max - (yBounds.max - yBounds.min) * (r1Pct / 100);
            if (i === 0) return { x, y: outlineY };                        // mF0: at outline (arch start)
            if (i >= 2) return { x, y: ray1Y };                       // mF2, mF3: exactly on Ray1
            return { x, y: outlineY + (ray1Y - outlineY) * 0.8 };         // mF1: flat plateau ~80% toward ray1
        });

        // mF4: X follows M5's actual position, Y = linear interpolation on mF3→mF5 line + 10% toward Ray5
        const mf3 = pts[3];
        const mf4XBounds = getOutlineYAtX(outlinePoints, mf4X);
        const mf4Ray1Y = mf4XBounds ? mf4XBounds.max - (mf4XBounds.max - mf4XBounds.min) * (r1Pct / 100) : 0;
        const mf4Ray5Y = mf4XBounds ? mf4XBounds.max - (mf4XBounds.max - mf4XBounds.min) * ((widthConfig['ray5_boundary'] ?? 25) / 100) : 0;
        let mf4Y: number;
        if (mf5.x > mf3.x) {
            const t = Math.max(0, Math.min(1, (mf4X - mf3.x) / (mf5.x - mf3.x)));
            mf4Y = mf3.y + t * (mf5.y - mf3.y) + (mf4Ray5Y - mf4Ray1Y) * 0.10;
        } else {
            mf4Y = mf3.y + (mf4Ray5Y - mf4Ray1Y) * 0.10;
        }
        pts.push({ x: mf4X, y: mf4Y });

        pts.push(mf5); // mF5: midpoint of M7→MB1 segment
        return pts;
    }, [bounds, widthConfig, landmarkConfig, outlinePoints]);

    // --- Initialization ---
    useEffect(() => {
        if (isDraggingRef.current) return;
        if (outlinePoints.length > 0) {
            let medialPoints = (archCurves && archCurves.medial.length > 0) ? archCurves.medial : generateInitialCurve('medial');
            const lateralPoints = (archCurves && archCurves.lateral.length > 0) ? archCurves.lateral : generateInitialCurve('lateral');
            const transversePoints = (archCurves && archCurves.transverse.length > 0) ? archCurves.transverse : generateInitialCurve('transverse');
            const sharedT1 = transversePoints[1];
            const oldMb1 = medialPoints.at(-1);
            const needsSyncMb1 = Boolean(sharedT1 && oldMb1 && Math.hypot(oldMb1.x - sharedT1.x, oldMb1.y - sharedT1.y) > 1e-6);
            if (sharedT1 && medialPoints.length) {
                medialPoints = medialPoints.map((point, index, points) =>
                    index === points.length - 1 ? { ...sharedT1 } : point
                );
            }

            let medialFlatPoints = archCurves?.medialFlat;
            let lateralFlatPoints = archCurves?.lateralFlat;
            let transverseFlatPoints = archCurves?.transverseFlat;
            // Check if regeneration is needed
            const needsRegenMedial = !medialFlatPoints || medialFlatPoints.length !== 6;
            const needsRegenLateral = !lateralFlatPoints || lateralFlatPoints.length === 0 || Math.abs(lateralFlatPoints[0].x - lateralPoints[0].x) < 0.1;
            const needsRegenTransverse = !transverseFlatPoints || transverseFlatPoints.length === 0;

            if (needsRegenMedial) {
                medialFlatPoints = generateMedialFlatCustom(medialPoints);
            }
            if (needsRegenLateral) {
                lateralFlatPoints = createFlatCurve(lateralPoints, 1);
            }
            if (needsRegenTransverse) {
                transverseFlatPoints = createFlatCurve(transversePoints, 1, true);  // isClosed=true for polygon
            }
            // Generate bridge curves
            let heelBridgePoints = archCurves?.heelBridge;
            let lateralBridgePoints = archCurves?.lateralBridge;
            const needsRegenHeelBridge = !heelBridgePoints || heelBridgePoints.length < 4;
            const needsAddHeelCenter = heelBridgePoints?.length === 4;
            const needsRegenLateralBridge = !lateralBridgePoints || lateralBridgePoints.length === 0;

            if (needsRegenHeelBridge) {
                heelBridgePoints = generateInitialCurve('heelBridge', { medial: medialPoints, lateral: lateralPoints });
            } else if (needsAddHeelCenter && heelBridgePoints) {
                const [m0, h1, h2, l0] = heelBridgePoints;
                heelBridgePoints = [
                    m0,
                    h1,
                    { x: Math.max(h1.x, h2.x) + bounds.width * (0.02 * 2 / 3), y: (h1.y + h2.y) / 2 },
                    h2,
                    l0,
                ];
            }
            if (needsRegenLateralBridge) {
                lateralBridgePoints = generateInitialCurve('lateralBridge', { lateral: lateralPoints, transverse: transversePoints });
            }

            let metatarsalBridgePoints = archCurves?.metatarsalBridge;
            const needsRegenMetatarsalBridge = !metatarsalBridgePoints || metatarsalBridgePoints.length !== 4;
            if (needsRegenMetatarsalBridge) {
                metatarsalBridgePoints = generateInitialCurve('metatarsalBridge', { medial: medialPoints, transverse: transversePoints });
            }
            const needsSyncBridgeMb1 = Boolean(
                sharedT1
                && metatarsalBridgePoints?.length === 4
                && Math.hypot(metatarsalBridgePoints[1].x - sharedT1.x, metatarsalBridgePoints[1].y - sharedT1.y) > 1e-6
            );
            if (sharedT1 && metatarsalBridgePoints?.length === 4) {
                metatarsalBridgePoints = metatarsalBridgePoints.map((point, index) =>
                    index === 1 ? { ...sharedT1 } : point
                );
            }
            if (metatarsalBridgePoints?.length === 4 && medialFlatPoints?.length) {
                medialFlatPoints = medialFlatPoints.map((point, index) =>
                    index === medialFlatPoints!.length - 1 ? { ...metatarsalBridgePoints![2] } : point
                );
            }

            if (needsRegenMedial || needsRegenLateral || needsRegenTransverse || needsRegenHeelBridge || needsAddHeelCenter || needsRegenLateralBridge || needsRegenMetatarsalBridge || needsSyncMb1 || needsSyncBridgeMb1 || !archCurves) {
                const initialCurves: ArchCurves = {
                    schemaVersion: 9,
                    medial: medialPoints,
                    medialFlat: medialFlatPoints,
                    lateral: lateralPoints,
                    lateralFlat: lateralFlatPoints,
                    transverse: transversePoints,
                    transverseFlat: transverseFlatPoints,
                    heelBridge: heelBridgePoints,
                    lateralBridge: lateralBridgePoints,
                    metatarsalBridge: metatarsalBridgePoints,
                };
                setArchCurves(initialCurves);
                setLocalCurves(initialCurves);
                localCurvesRef.current = initialCurves;
                // Sync arch settings on initial generation
                syncArchSettings({ transverse: transversePoints, medial: medialPoints });
            }
        }
    }, [outlinePoints, widthConfig, landmarkConfig, createFlatCurve, syncArchSettings]);

    const generateInitialCurve = (type: 'medial' | 'lateral' | 'transverse' | 'heelBridge' | 'lateralBridge' | 'metatarsalBridge', refCurves?: { medial?: CurvePoint[], lateral?: CurvePoint[], transverse?: CurvePoint[] }): CurvePoint[] => {
        if (type === 'heelBridge') {
            // Bridge from medial[0] (M0) to lateral[0] (L0)
            const medialPts = refCurves?.medial;
            const lateralPts = refCurves?.lateral;
            if (!medialPts || !lateralPts || medialPts.length === 0 || lateralPts.length === 0) return [];

            const p0 = medialPts[0]; // M0
            const p3 = lateralPts[0]; // L0

            // Intermediate points at M1 X (midpoint of arch_start and subtalar), snapped to Ray1 and Ray5 Y
            const archStartPct = landmarkConfig['arch_start'] ?? 15;
            const subtalarPct = landmarkConfig['subtalar'] ?? 30;
            const m1Pct = (archStartPct + subtalarPct) / 2;
            const m1X = bounds.minX + bounds.width * (m1Pct / 100);
            const yBounds = getOutlineYAtX(outlinePoints, m1X);
            if (!yBounds) return [p0, p3];

            const r1Pct = widthConfig['ray1_boundary'] ?? 65;
            const r5Pct = widthConfig['ray5_boundary'] ?? 25;
            const ray1Y = yBounds.max - (yBounds.max - yBounds.min) * (r1Pct / 100);
            const ray5Y = yBounds.max - (yBounds.max - yBounds.min) * (r5Pct / 100);

            const p1 = { x: m1X, y: ray1Y }; // Ray1 control point at M1 X
            const p2 = { x: m1X, y: ray5Y }; // Ray5 control point at M1 X

            const hc = {
                x: Math.max(p1.x, p2.x) + bounds.width * (0.02 * 2 / 3),
                y: (p1.y + p2.y) / 2,
            };
            return [p0, p1, hc, p2, p3];
        }

        if (type === 'lateralBridge') {
            // Bridge from lateral[last] (L4) to transverse[4] (T4)
            const lateralPts = refCurves?.lateral;
            const transversePts = refCurves?.transverse;
            if (!lateralPts || !transversePts || lateralPts.length === 0 || transversePts.length < 5) return [];

            const p0 = lateralPts[lateralPts.length - 1]; // L4 (last point)
            const p2 = transversePts[4]; // T4 (Ray5)

            // Intermediate point at midpoint between navicular and medial_cuneiform X, midway between L4 and T4 Y
            const navicularPct = landmarkConfig['navicular'] ?? 43;
            const cuneiformPct = landmarkConfig['medial_cuneiform'] ?? 55;
            const midPct = (navicularPct + cuneiformPct) / 2;
            const midX = bounds.minX + bounds.width * (midPct / 100);
            const yBoundsB = getOutlineYAtX(outlinePoints, midX);
            const r5PctB = widthConfig['ray5_boundary'] ?? 25;
            let b1Y: number;
            if (yBoundsB) {
                const ray5Y = yBoundsB.max - (yBoundsB.max - yBoundsB.min) * (r5PctB / 100);
                // 10% outside toward Bionicsol's lateral outline (MaxY).
                b1Y = ray5Y + (yBoundsB.max - ray5Y) * 0.10;
            } else {
                b1Y = (p0.y + p2.y) / 2;
            }

            const p1 = { x: midX, y: b1Y }; // Ray5 + 5% outward, between navicular and cuneiform

            return [p0, p1, p2];
        }

        if (type === 'metatarsalBridge') {
            // Bridge: T2 → MB1(reference) → MF5(pass-through) → M7(outline corner)
            const medialPts = refCurves?.medial;
            const transversePts = refCurves?.transverse;
            if (!medialPts || !transversePts || medialPts.length < 7 || transversePts.length < 4) return [];

            const p0 = transversePts[2]; // T2 (start, fixed)
            const p1 = transversePts[1]; // MB1 and T1 are the same shared point

            // M7: true metatarsal-landmark outline position. Independent of MB1/T1, which
            // now default to sitting T1_MB1_HEEL_OFFSET_PCT heelward of it.
            const metatarsalPct = landmarkConfig['metatarsal'] ?? 70;
            const m7X = bounds.minX + bounds.width * (metatarsalPct / 100);
            const m7YBounds = getOutlineYAtX(outlinePoints, m7X);
            const p3 = { x: m7X, y: m7YBounds ? m7YBounds.min : p1.y }; // M7 (end, fixed)
            const p2 = {
                x: m7X - bounds.width * 0.0211426,
                y: p1.y + (p3.y - p1.y) * 0.57,
            }; // MF5 model-7 proportion

            return [p0, p1, p2, p3];
        }

        if (type === 'transverse') {
            // Generate Ellipse with 8 control points aligned to landmarks
            // 1. Get X boundaries
            const navicularPct = landmarkConfig['navicular'] ?? 43;
            const metatarsalPct = landmarkConfig['metatarsal'] ?? 70;

            const navicularX = bounds.minX + bounds.width * (navicularPct / 100);
            const metatarsalX = bounds.minX + bounds.width * (metatarsalPct / 100);
            const centerX = (navicularX + metatarsalX) / 2;

            // 2. Get Y boundaries (at center X)
            const getRayY = (x: number, rayType: 'ray1' | 'ray5') => {
                const yBounds = getOutlineYAtX(outlinePoints, x);
                if (!yBounds) return 0;
                const r1Pct = widthConfig['ray1_boundary'] ?? 65;
                const r5Pct = widthConfig['ray5_boundary'] ?? 25;
                if (rayType === 'ray1') return yBounds.max - (yBounds.max - yBounds.min) * (r1Pct / 100);
                return yBounds.max - (yBounds.max - yBounds.min) * (r5Pct / 100);
            };

            const ray1Y = getRayY(centerX, 'ray1');
            const ray5Y = getRayY(centerX, 'ray5');

            // 3. Define 4 Cardinal Points
            const pTop = { x: centerX, y: ray1Y };          // Ray 1
            const m7X = metatarsalX;
            const t2X = m7X + bounds.width * 0.0098732;
            const m7Ray1Y = getRayY(m7X, 'ray1');
            const m7Ray5Y = getRayY(m7X, 'ray5');
            const pRight = { x: t2X, y: m7Ray1Y + (m7Ray5Y - m7Ray1Y) * T2_BAND_FRACTION };
            const pBottom = { x: centerX, y: ray5Y };       // Ray 5
            // T6: midpoint between Ray1 and Ray5 at navicularX
            const navRay1Y = getRayY(navicularX, 'ray1');
            const navRay5Y = getRayY(navicularX, 'ray5');
            const pLeft = { x: navicularX, y: (navRay1Y + navRay5Y) / 2 };

            // 4. Define 4 Intermediate Points
            const a = (metatarsalX - navicularX) / 2;
            const cos45 = 0.707;
            const rightMidX = centerX + a * cos45;
            const leftMidX = centerX - a * cos45;

            // T1 sits on M7's longitudinal line (it also doubles as MB1, medial's last point).
            const t1X = m7X - bounds.width * (T1_MB1_HEEL_OFFSET_PCT / 100);
            const pTR = { x: t1X, y: getRayY(t1X, 'ray1') };

            // T3 sits heelward of T1 and medial of Ray5, so it both rounds out the
            // T1 -> T2 -> T3 arc and leaves T4 as the most lateral point of the region.
            const t3X = m7X - bounds.width * (T3_HEEL_OFFSET_PCT / 100);
            const t3Ray1Y = getRayY(t3X, 'ray1');
            const t3Ray5Y = getRayY(t3X, 'ray5');
            const pBR = { x: t3X, y: t3Ray1Y + (t3Ray5Y - t3Ray1Y) * T3_BAND_FRACTION };

            // P5/P7 (Left side): Near Ray 5 and Ray 1 (20% inward from edge)
            const leftRay5Y = getRayY(leftMidX, 'ray5');
            const leftRay1Y = getRayY(leftMidX, 'ray1');
            const leftCenterY = (leftRay1Y + leftRay5Y) / 2;
            const pBL_smooth = {
                x: leftMidX,
                y: leftRay5Y + (leftCenterY - leftRay5Y) * 0.20  // 5列から中心へ20%
            };
            const pTL_smooth = {
                x: leftMidX,
                y: leftRay1Y + (leftCenterY - leftRay1Y) * 0.20  // 1列から中心へ20%
            };

            return [
                pTop,   // 0: Ray 1
                pTR,    // 1: Ray 1 (Snap)
                pRight, // 2: Metatarsal
                pBR,    // 3: Ray 5 (Snap)
                pBottom,// 4: Ray 5
                pBL_smooth,    // 5
                pLeft,  // 6: Navicular
                pTL_smooth     // 7
            ];
        }

        const points: CurvePoint[] = [];
        const numPoints = type === 'medial' ? 7 : 5;

        let startPercent = type === 'medial' ? (landmarkConfig['arch_start'] ?? 15) : (landmarkConfig['lateral_arch_start'] ?? 20);
        let endPercent = type === 'medial' ? (landmarkConfig['metatarsal'] ?? 70) : (landmarkConfig['cuboid'] ?? 45);

        const startX = bounds.minX + bounds.width * (startPercent / 100);
        const endX = bounds.minX + bounds.width * (endPercent / 100);

        const startYBounds = getOutlineYAtX(outlinePoints, startX);
        const endYBounds = getOutlineYAtX(outlinePoints, endX);

        if (!startYBounds || !endYBounds) return [];

        const startP = { x: startX, y: type === 'medial' ? startYBounds.min : startYBounds.max };
        const endP = { x: endX, y: type === 'medial' ? endYBounds.min : endYBounds.max };

        const r1Pct = widthConfig['ray1_boundary'] ?? 65;

        // Medial Logic Variables
        const subtalarPct = landmarkConfig['subtalar'] ?? 30;
        const navicularPct = landmarkConfig['navicular'] ?? 43;
        const cuneiformPct = landmarkConfig['medial_cuneiform'] ?? 55;
        const metatarsalPct = landmarkConfig['metatarsal'] ?? 70;
        // MB1 is exactly transverse T1, which sits T1_MB1_HEEL_OFFSET_PCT heelward of M7.
        const mb1Pct = metatarsalPct - T1_MB1_HEEL_OFFSET_PCT;
        const midCunMB1 = (cuneiformPct + mb1Pct) / 2;

        // Medial X Points (M0→MB1, 7 points, M6 removed)
        const medialXPercents = [
            (landmarkConfig['arch_start'] ?? 15),
            ((landmarkConfig['arch_start'] ?? 15) + subtalarPct) / 2,
            subtalarPct,
            navicularPct,
            cuneiformPct,
            midCunMB1,
            mb1Pct  // MB1: metatarsal level × ray1 intersection
        ];

        if (type === 'medial') {
            const r5Pct = widthConfig['ray5_boundary'] ?? 25;
            // Ray1/Ray4 fractions (0=medial outline, 1=lateral outline), evenly spaced
            // across rays 1-5 between the Ray1 and Ray5 boundaries. M3/M4 sit near Ray4
            // now, rather than near the outline's centerline (~50%); M1/M2 ramp up toward
            // it too so M0->M1->M2->M3/M4 forms a smooth arch instead of a sudden jump.
            const ray1Frac = 1 - r1Pct / 100;
            const ray4Frac = ray1Frac + 0.75 * ((1 - r5Pct / 100) - ray1Frac);

            return medialXPercents.map((pct, i) => {
                const x = bounds.minX + bounds.width * (pct / 100);
                const yBounds = getOutlineYAtX(outlinePoints, x);
                if (!yBounds) return { x, y: (startP.y + endP.y) / 2 };

                const outlineY = yBounds.min; // medial outline edge
                const ray1Y = yBounds.max - (yBounds.max - yBounds.min) * (r1Pct / 100);
                const ray5Y = yBounds.max - (yBounds.max - yBounds.min) * (r5Pct / 100);

                switch (i) {
                    case 0: // M0: Start (fixed)
                        return { x, y: outlineY };
                    case 1: // M1: sits on Ray1
                        return { x, y: yBounds.min + (yBounds.max - yBounds.min) * ray1Frac };
                    case 2: { // M2: continues the ramp toward Ray4, ~55% of the way there
                        const targetFrac = ray1Frac + (ray4Frac - ray1Frac) * 0.55;
                        return { x, y: yBounds.min + (yBounds.max - yBounds.min) * targetFrac };
                    }
                    case 3: // M3: extended toward Ray4, instead of sitting near the outline centerline
                        return { x, y: yBounds.min + (yBounds.max - yBounds.min) * ray4Frac };
                    case 4: // M4: mirrors M3, held slightly toward Ray1 of the Ray4 line
                        return { x, y: yBounds.min + (yBounds.max - yBounds.min) * (ray4Frac - 0.02) };
                    case 5: { // M5: natural midpoint between M4 and MB1
                        const m4X = bounds.minX + bounds.width * (cuneiformPct / 100);
                        const mb1X = bounds.minX + bounds.width * (mb1Pct / 100);
                        const m4YB = getOutlineYAtX(outlinePoints, m4X);
                        const mb1YB = getOutlineYAtX(outlinePoints, mb1X);
                        const m4R1 = m4YB ? m4YB.max - (m4YB.max - m4YB.min) * (r1Pct / 100) : ray1Y;
                        const m4R5 = m4YB ? m4YB.max - (m4YB.max - m4YB.min) * (r5Pct / 100) : ray5Y;
                        const m4Y = m4YB
                            ? m4YB.min + (m4YB.max - m4YB.min) * (ray4Frac - 0.02)
                            : m4R1 + (m4R5 - m4R1) * 0.35;
                        const mb1R1 = mb1YB ? mb1YB.max - (mb1YB.max - mb1YB.min) * (r1Pct / 100) : ray1Y;
                        const mb1Y = mb1R1 - (mb1YB ? mb1YB.max - mb1YB.min : yBounds.max - yBounds.min) * 0.03;
                        return { x, y: (m4Y + mb1Y) / 2 + (ray5Y - ray1Y) * 0.10 };
                    }
                    case 6: // MB1: End - 3% medial offset from Ray 1
                        return { x, y: ray1Y - (yBounds.max - yBounds.min) * 0.03 };
                    default:
                        return { x, y: outlineY };
                }
            });
        }

        // Lateral Arch Logic (5 points: L0=start, L1, L2, L3, L4=end)
        const r1PctL = widthConfig['ray1_boundary'] ?? 65;
        const r5PctL = widthConfig['ray5_boundary'] ?? 25;
        const stepX = (endX - startX) / (numPoints - 1);

        const lateralXRatios = [0.15, 0.50, 0.85]; // L1, L2, L3 as fraction of startX→endX

        points.push(startP); // L0: outer outline edge
        for (let i = 1; i < numPoints - 1; i++) {
            const x = startX + (endX - startX) * lateralXRatios[i - 1];
            const yB = getOutlineYAtX(outlinePoints, x);
            if (!yB) { points.push({ x, y: (startP.y + endP.y) / 2 }); continue; }

            const ray1YL = yB.max - (yB.max - yB.min) * (r1PctL / 100);
            const ray5YL = yB.max - (yB.max - yB.min) * (r5PctL / 100);

            let y: number;
            if (i === 1 || i === 3) {
                // L1, L3: move 5% of local width inward from Ray5
                y = ray5YL - (yB.max - yB.min) * 0.05;
            } else {
                // L2: retain its crown and move the whole lateral arch 5% inward
                y = ray5YL + (ray1YL - ray5YL) * 0.20 - (yB.max - yB.min) * 0.05;
            }
            points.push({ x, y });
        }
        points.push(endP); // L4: outer outline edge
        return points;
    };

    const resetTransverse = () => {
        const currentCurves = localCurvesRef.current ?? archCurvesRef.current;
        if (!currentCurves) return;
        const newTransverse = generateInitialCurve('transverse');
        const nextCurves: ArchCurves = {
            ...currentCurves,
            transverse: newTransverse,
            transverseFlat: createFlatCurve(newTransverse, 1, true),
        };
        if ((nextCurves.lateralBridge?.length ?? 0) >= 3) {
            const lateralBridge = nextCurves.lateralBridge!;
            nextCurves.lateralBridge = lateralBridge.map((point, index) =>
                index === lateralBridge.length - 1 ? { ...newTransverse[4] } : point
            );
        }
        if (nextCurves.metatarsalBridge?.length === 4) {
            // Only the points this reset genuinely owns: T2 and MB1(=T1). M7 and MF5 are
            // hand-placed and stay put - resetting the transverse arch must not move them.
            nextCurves.metatarsalBridge = nextCurves.metatarsalBridge.map((point, index) =>
                index === 0
                    ? { ...newTransverse[2] }
                    : index === 1
                        ? { ...newTransverse[1] }
                        : point
            );
        }
        if (nextCurves.medial.length) {
            nextCurves.medial = nextCurves.medial.map((point, index) =>
                index === nextCurves.medial.length - 1 ? { ...newTransverse[1] } : point
            );
        }
        setLocalCurves(nextCurves);
        localCurvesRef.current = nextCurves;
        setArchCurves(nextCurves);
        syncTransverseToArchSettings(newTransverse);
    };

    const activeTransverseWidthPattern = useMemo<'rays23' | 'rays234'>(() => {
        const t4 = localCurves?.transverse?.[4];
        if (!t4) return 'rays234';
        const local = getOutlineYAtX(outlinePoints, t4.x);
        if (!local) return 'rays234';
        const r1Pct = widthConfig['ray1_boundary'] ?? 65;
        const r5Pct = widthConfig['ray5_boundary'] ?? 25;
        const ray1 = local.max - (local.max - local.min) * (r1Pct / 100);
        const ray5 = local.max - (local.max - local.min) * (r5Pct / 100);
        const ray4 = ray1 + (ray5 - ray1) * (2 / 3);
        return Math.abs(t4.y - ray4) < Math.abs(t4.y - ray5) ? 'rays23' : 'rays234';
    }, [localCurves, outlinePoints, widthConfig]);

    const applyTransverseWidthPattern = (pattern: 'rays23' | 'rays234') => {
        const current = localCurvesRef.current ?? archCurvesRef.current;
        if (!current?.transverse || current.transverse.length < 8) return;
        const r1Pct = widthConfig['ray1_boundary'] ?? 65;
        const r5Pct = widthConfig['ray5_boundary'] ?? 25;
        const bandAt = (x: number) => {
            const local = getOutlineYAtX(outlinePoints, x);
            if (!local) return null;
            const ray1 = local.max - (local.max - local.min) * (r1Pct / 100);
            const ray5 = local.max - (local.max - local.min) * (r5Pct / 100);
            const lower = pattern === 'rays234' ? ray5 : ray1 + (ray5 - ray1) * (2 / 3);
            return { ray1, lower, middle: (ray1 + lower) / 2 };
        };
        const transverse = current.transverse.map((point) => ({ ...point }));
        const t4YBefore = transverse[4].y;
        const t2Band = bandAt(transverse[2].x);
        const t3Band = bandAt(transverse[3].x);
        const t4Band = bandAt(transverse[4].x);
        const t5Band = bandAt(transverse[5].x);
        const t6Band = bandAt(transverse[6].x);
        const t7Band = bandAt(transverse[7].x);
        // T2 and T3 use the same fractions as the initial shape, so switching width pattern
        // keeps T4 the most lateral point and keeps the toe-ward cap symmetric. Putting T3
        // straight onto the outer line (as this used to) makes the T3-T4 span bulge past it.
        if (t2Band) transverse[2].y = t2Band.ray1 + (t2Band.lower - t2Band.ray1) * T2_BAND_FRACTION;
        if (t3Band) transverse[3].y = t3Band.ray1 + (t3Band.lower - t3Band.ray1) * T3_BAND_FRACTION;
        if (t4Band) transverse[4].y = t4Band.lower;
        if (t5Band) transverse[5].y = t5Band.lower + (t5Band.middle - t5Band.lower) * 0.2;
        if (t6Band) transverse[6].y = t6Band.middle;
        if (t7Band) transverse[7].y = t7Band.ray1 + (t7Band.middle - t7Band.ray1) * 0.2;
        const t4Delta = transverse[4].y - t4YBefore;

        const next: ArchCurves = {
            ...current,
            transverse,
            transverseFlat: createFlatCurve(transverse, 1, true),
        };
        if (next.lateralBridge?.length) {
            // B1 (index 1) shifts by half of what T4 just moved, rather than staying
            // fixed while its neighbor T4 moves out from under it.
            next.lateralBridge = next.lateralBridge.map((point, index, points) => {
                if (index === points.length - 1) return { ...transverse[4] };
                if (index === 1) return { ...point, y: point.y + t4Delta * 0.5 };
                return point;
            });
        }
        if (next.metatarsalBridge?.length === 4) {
            next.metatarsalBridge = next.metatarsalBridge.map((point, index) =>
                index === 0 ? { ...transverse[2] } : point
            );
        }
        setLocalCurves(next);
        localCurvesRef.current = next;
        setArchCurves(next);
        syncTransverseToArchSettings(transverse);
    };

    // --- Auto-fit ---
    const fitView = () => {
        if (!containerRef.current || outlinePoints.length === 0) return;
        const containerWidth = containerRef.current.clientWidth;
        const containerHeight = containerRef.current.clientHeight;
        const padding = 60;

        const k = Math.min((containerWidth - padding * 2) / bounds.width, (containerHeight - padding * 2) / bounds.height);
        const x = (containerWidth - bounds.width * k) / 2 - bounds.minX * k;
        const y = (containerHeight - bounds.height * k) / 2 - bounds.minY * k;

        setTransform({ x, y, k });
    };

    useEffect(() => {
        const timer = setTimeout(fitView, 100);
        return () => clearTimeout(timer);
    }, [outlinePoints.length]);

    // --- Interaction ---
    const getLogicalPos = (e: React.MouseEvent | MouseEvent) => {
        if (!svgRef.current) return { x: 0, y: 0 };
        const CTM = svgRef.current.getScreenCTM();
        if (!CTM) return { x: 0, y: 0 };
        const rawX = (e.clientX - CTM.e) / CTM.a;
        const rawY = (e.clientY - CTM.f) / CTM.d;
        const currentTransform = transformRef.current;
        return {
            x: (rawX - currentTransform.x) / currentTransform.k,
            y: (rawY - currentTransform.y) / currentTransform.k
        };
    };

    const handleMouseDownPoint = (e: React.MouseEvent, type: 'medial' | 'lateral' | 'transverse' | 'medialFlat' | 'lateralFlat' | 'heelBridge' | 'lateralBridge' | 'metatarsalBridge', idx: number) => {
        e.stopPropagation();
        const currentCurves = localCurvesRef.current ?? archCurvesRef.current;
        if (!currentCurves) return;

        // Transverse/TransverseFlat: All points movable
        // MedialFlat/LateralFlat: All points movable (Endpoints will be snapped to outline)
        // Medial/Lateral (Solid): Endpoints fixed to maintain anatomical start/end
        // Bridge curves: Endpoints fixed, middle control points draggable

        const isSolidArch = type === 'medial' || type === 'lateral';
        const isBridge = type === 'heelBridge' || type === 'lateralBridge' || type === 'metatarsalBridge';

        if (isSolidArch || isBridge) {
            // @ts-ignore
            const len = currentCurves[type]?.length || 0;
            // medial: M0(start) fixed, MB1(end) draggable
            // lateralBridge: the end rendered over T4 is that same shared point
            // metatarsalBridge: M7(end) is hand-placed, so it is draggable
            // everything else: both endpoints fixed
            const isSharedEnd = (type === 'lateralBridge' || type === 'metatarsalBridge') && idx === len - 1;
            if (type === 'medial') {
                if (idx === 0) return;
            } else if (!isSharedEnd) {
                if (idx === 0 || idx === len - 1) return;
            }
        }

        setDraggingCurve(type);
        setDraggingPointIdx(idx);
        setIsDraggingWholeCurve(false);
        draggingCurveRef.current = type;
        draggingPointIdxRef.current = idx;
        isDraggingWholeCurveRef.current = false;
        isDraggingRef.current = true;
        localCurvesRef.current = currentCurves;
    };

    const handleMouseDownPronationH1 = (e: React.MouseEvent, point: CurvePoint) => {
        e.stopPropagation();
        isPronationH1DragRef.current = true;
        pronationH1DragPointRef.current = { ...point };
    };

    const handleMouseDownCurve = (e: React.MouseEvent, type: 'medial' | 'lateral' | 'transverse' | 'medialFlat' | 'lateralFlat' | 'heelBridge' | 'lateralBridge' | 'metatarsalBridge') => {
        // Only allow whole drag for transverse
        if (type === 'transverse') {
            const currentCurves = localCurvesRef.current ?? archCurvesRef.current;
            if (!currentCurves) return;
            e.stopPropagation();
            setDraggingCurve(type);
            setDraggingPointIdx(null);
            setIsDraggingWholeCurve(true);
            draggingCurveRef.current = type;
            draggingPointIdxRef.current = null;
            isDraggingWholeCurveRef.current = true;
            isDraggingRef.current = true;
            localCurvesRef.current = currentCurves;
        }
    };

    const handlePanStart = (e: React.MouseEvent) => {
        if (isDraggingRef.current) return;
        isPanningRef.current = true;
        setIsPanning(true);
        const nextPanPos = { x: e.clientX, y: e.clientY };
        lastPanPosRef.current = nextPanPos;
        setLastPanPos(nextPanPos);
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isPronationH1DragRef.current && pronationH1DragPointRef.current) {
                const current = pronationH1DragPointRef.current;
                const next = {
                    x: current.x + e.movementX / transformRef.current.k,
                    y: current.y + e.movementY / transformRef.current.k,
                };
                pronationH1DragPointRef.current = next;
                updateArchSettings(activeFootSide, { pronation_h1: next });
                return;
            }
            const currentDraggingCurve = draggingCurveRef.current;
            const currentDraggingIdx = draggingPointIdxRef.current;
            const isWhole = isDraggingWholeCurveRef.current;
            const curCurves = localCurvesRef.current;
            const curTransform = transformRef.current;

            if (currentDraggingCurve && curCurves) {
                const newCurves = { ...curCurves };
                // @ts-ignore
                const points = [...newCurves[currentDraggingCurve]];

                // Delta-based movement: use movementX/Y (browser-computed, always accurate)
                const dx = e.movementX / curTransform.k;
                const dy = e.movementY / curTransform.k;

                if (isWhole) {
                    for (let i = 0; i < points.length; i++) {
                        points[i] = { x: points[i].x + dx, y: points[i].y + dy };
                    }
                    // @ts-ignore
                    newCurves[currentDraggingCurve] = points;

                    if (currentDraggingCurve === 'transverse') {
                        if (newCurves.transverseFlat) {
                            newCurves.transverseFlat = newCurves.transverseFlat.map((point) => ({
                                x: point.x + dx,
                                y: point.y + dy,
                            }));
                        }
                        if (newCurves.lateralBridge && newCurves.lateralBridge.length >= 3 && points.length >= 5) {
                            const bridgePoints = [...newCurves.lateralBridge];
                            bridgePoints[bridgePoints.length - 1] = { ...points[4] };
                            newCurves.lateralBridge = bridgePoints;
                        }
                        if (newCurves.metatarsalBridge && newCurves.metatarsalBridge.length >= 3 && points.length >= 3) {
                            const mbPoints = [...newCurves.metatarsalBridge];
                            // Only the vertices the transverse curve actually shares (T2, T1/MB1).
                            // M7 stays put.
                            mbPoints[0] = { ...points[2] };
                            mbPoints[1] = { ...points[1] };
                            newCurves.metatarsalBridge = mbPoints;
                        }
                        if (newCurves.medial.length) {
                            const medial = [...newCurves.medial];
                            medial[medial.length - 1] = { ...points[1] };
                            newCurves.medial = medial;
                        }
                    }

                    localCurvesRef.current = newCurves;
                    setLocalCurves(newCurves);
                } else if (currentDraggingIdx !== null) {
                    // Compute new absolute position from current point + delta
                    let newX = points[currentDraggingIdx].x + dx;
                    let newY = points[currentDraggingIdx].y + dy;

                    // Apply constraints using computed absolute position
                    const isMedialFlatStart = currentDraggingCurve === 'medialFlat' && currentDraggingIdx === 0;
                    const isMedialFlatEnd = currentDraggingCurve === 'medialFlat' && currentDraggingIdx === points.length - 1;
                    const isLateralFlatEnd = currentDraggingCurve === 'lateralFlat' && (currentDraggingIdx === 0 || currentDraggingIdx === points.length - 1);
                    if (isMedialFlatStart) {
                        const yBounds = getOutlineYAtX(outlinePoints, newX);
                        if (yBounds) newY = yBounds.min;
                    } else if (isMedialFlatEnd) {
                        // MF5 is a free pass-through point and may sit heelward of
                        // MB1. Keep it only within the patient's outline.
                        newX = Math.max(bounds.minX, Math.min(bounds.maxX, newX));
                        const yBounds = getOutlineYAtX(outlinePoints, newX);
                        if (yBounds) newY = Math.max(yBounds.min, Math.min(yBounds.max, newY));
                    } else if (isLateralFlatEnd) {
                        const yBounds = getOutlineYAtX(outlinePoints, newX);
                        if (yBounds) newY = yBounds.max;
                    }

                    points[currentDraggingIdx] = { x: newX, y: newY };
                    // @ts-ignore
                    newCurves[currentDraggingCurve] = points;

                    if (currentDraggingCurve === 'medial') {
                        // MB1 (medial's last point) and T1 (transverse[1]) are one shared
                        // point (ArchPad Lab spec) - keep them merged. T3 and M7 no longer
                        // follow along, so they stay independent.
                        if (currentDraggingIdx === points.length - 1 && newCurves.transverse.length >= 2) {
                            const transverse = [...newCurves.transverse];
                            transverse[1] = { ...points[points.length - 1] };
                            newCurves.transverse = transverse;
                            if (newCurves.metatarsalBridge?.length === 4) {
                                const bridge = [...newCurves.metatarsalBridge];
                                bridge[1] = { ...transverse[1] };
                                newCurves.metatarsalBridge = bridge;
                            }
                        }
                        if (currentDraggingIdx === 0 && newCurves.heelBridge?.length) {
                            const heel = [...newCurves.heelBridge];
                            heel[0] = { ...points[0] };
                            newCurves.heelBridge = heel;
                        }
                    } else if (currentDraggingCurve === 'lateral') {
                        if (currentDraggingIdx === 0 && newCurves.heelBridge?.length) {
                            const heel = [...newCurves.heelBridge];
                            heel[heel.length - 1] = { ...points[0] };
                            newCurves.heelBridge = heel;
                        }
                        if (currentDraggingIdx === points.length - 1 && newCurves.lateralBridge?.length) {
                            const bridge = [...newCurves.lateralBridge];
                            bridge[0] = { ...points[points.length - 1] };
                            newCurves.lateralBridge = bridge;
                        }
                    } else if (currentDraggingCurve === 'medialFlat' && isMedialFlatEnd) {
                        if (newCurves.metatarsalBridge?.length === 4) {
                            const mbPoints = [...newCurves.metatarsalBridge];
                            mbPoints[2] = { x: newX, y: newY };
                            newCurves.metatarsalBridge = mbPoints;
                        }
                    } else if (currentDraggingCurve === 'transverse') {
                        // Only vertices this curve genuinely shares with another curve follow
                        // along: T2/T4 (bridge endpoints) and T1 (merged with MB1, ArchPad Lab
                        // spec). The dashed companion, T3 and M7 are all left alone.
                        if (newCurves.lateralBridge && newCurves.lateralBridge.length >= 3 && points.length >= 5) {
                            const bridgePoints = [...newCurves.lateralBridge];
                            bridgePoints[bridgePoints.length - 1] = { ...points[4] };
                            newCurves.lateralBridge = bridgePoints;
                        }
                        if (newCurves.metatarsalBridge && newCurves.metatarsalBridge.length >= 3 && points.length >= 3) {
                            const mbPoints = [...newCurves.metatarsalBridge];
                            if (currentDraggingIdx === 2) mbPoints[0] = { ...points[2] };
                            if (currentDraggingIdx === 1) {
                                mbPoints[1] = { ...points[1] };
                            }
                            newCurves.metatarsalBridge = mbPoints;
                        }
                        if (currentDraggingIdx === 1 && newCurves.medial.length) {
                            const medial = [...newCurves.medial];
                            medial[medial.length - 1] = { ...points[1] };
                            newCurves.medial = medial;
                        }
                    } else if (currentDraggingCurve === 'metatarsalBridge' && currentDraggingIdx === 1 && points.length === 4) {
                        // This copy is no longer given a handle, but if it ever regains one
                        // it must carry the medial curve along too. It used to sync only
                        // transverse[1], which detached the medial curve from the shared point.
                        const transverse = [...newCurves.transverse];
                        transverse[1] = { ...points[1] };
                        newCurves.transverse = transverse;
                        newCurves.metatarsalBridge = points;
                        if (newCurves.medial.length) {
                            const medial = [...newCurves.medial];
                            medial[medial.length - 1] = { ...points[1] };
                            newCurves.medial = medial;
                        }
                    } else if (currentDraggingCurve === 'lateralBridge' && currentDraggingIdx === points.length - 1) {
                        // The bridge endpoint rendered over T4 is the same shared point.
                        if (newCurves.transverse.length >= 5) {
                            const transverse = [...newCurves.transverse];
                            transverse[4] = { x: newX, y: newY };
                            newCurves.transverse = transverse;
                        }
                    }

                    localCurvesRef.current = newCurves;
                    setLocalCurves(newCurves);
                }
            } else if (isPanningRef.current) {
                setTransform(t => ({
                    ...t,
                    x: t.x + (e.clientX - lastPanPosRef.current.x),
                    y: t.y + (e.clientY - lastPanPosRef.current.y)
                }));
                const nextPanPos = { x: e.clientX, y: e.clientY };
                lastPanPosRef.current = nextPanPos;
                setLastPanPos(nextPanPos);
            }
        };

        const handleMouseUp = () => {
            isPronationH1DragRef.current = false;
            pronationH1DragPointRef.current = null;
            const currentDraggingCurve = draggingCurveRef.current;
            const committedCurves = localCurvesRef.current;
            if (isDraggingRef.current && committedCurves) {
                setArchCurves(committedCurves);
                if (currentDraggingCurve === 'transverse' || currentDraggingCurve === 'medial') {
                    syncArchSettings({
                        transverse: committedCurves.transverse,
                        medial: committedCurves.medial,
                    });
                }
            }
            draggingCurveRef.current = null;
            draggingPointIdxRef.current = null;
            isDraggingWholeCurveRef.current = false;
            isDraggingRef.current = false;
            isPanningRef.current = false;
            setDraggingCurve(null);
            setDraggingPointIdx(null);
            setIsDraggingWholeCurve(false);
            setIsPanning(false);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [activeFootSide, createFlatCurve, generateMedialFlatCustom, outlinePoints, setArchCurves, syncArchSettings, updateArchSettings]);

    // --- Rendering ---
    const outlineD = useMemo(() => getSmoothPath(outlinePoints, true), [outlinePoints]);

    // Curves draw in two passes: every shape first, then every control point on top, so a
    // filled region (the transverse arch) can never swallow clicks meant for a point under it.
    const renderCurve = (points: CurvePoint[], color: string, fillColor: string, type: 'medial' | 'lateral' | 'transverse' | 'medialFlat' | 'lateralFlat' | 'heelBridge' | 'lateralBridge' | 'metatarsalBridge', isDashed = false, layer: 'shape' | 'points' = 'shape') => {
        if (!points || points.length < 2) return null;

        const isClosed = type === 'transverse';
        const isBridge = type === 'heelBridge' || type === 'lateralBridge' || type === 'metatarsalBridge';
        const isLongitudinal = type === 'medial' || type === 'medialFlat' || type === 'lateral' || type === 'lateralFlat';
        const d = isLongitudinal
            ? shapePreservingPath(points, type === 'medial')
            : getSmoothPath(points, isClosed);

        if (layer === 'shape') {
            return (
                <g>
                    {/* Region fill (Transverse only). Inert: clicking inside the region must
                        not move anything - only the outline itself is a drag handle. */}
                    {isClosed && (
                        <path
                            d={d}
                            fill={fillColor}
                            stroke="none"
                            className="pointer-events-none"
                        />
                    )}

                    {/* Curve Line */}
                    <path
                        d={d}
                        fill="none"
                        stroke={color}
                        strokeWidth={isDashed ? 2 / transform.k : (isBridge ? 1.5 / transform.k : 3 / transform.k)}
                        strokeLinecap="round"
                        strokeDasharray={isDashed ? `${4 / transform.k},${4 / transform.k}` : 'none'}
                        className="pointer-events-none"
                        opacity={isBridge ? 0.7 : 1}
                    />

                    {/* Widened invisible copy of the outline, so grabbing the line to move the
                        whole region does not demand pixel-perfect aim. */}
                    {isClosed && (
                        <path
                            d={d}
                            fill="none"
                            stroke="transparent"
                            strokeWidth={12 / transform.k}
                            strokeLinecap="round"
                            className="cursor-move"
                            onMouseDown={(e) => handleMouseDownCurve(e, type)}
                        />
                    )}
                </g>
            );
        }

        return (
            <g>
                {/* Control Points */}
                {points.map((p, i) => {
                    // T1, medial's last point and metatarsalBridge[1] are ONE anatomical
                    // point stored three times. Drawing all three stacks three handles and
                    // three labels on the same pixel, and the user cannot tell which one
                    // they grabbed - dragging the metatarsalBridge copy used to leave the
                    // medial curve behind. transverse[1] is the one handle that keeps every
                    // copy in step, so the bridge's copy is drawn as an inert marker and
                    // medial's copy carries no label of its own.
                    if (type === 'metatarsalBridge' && i === 1) return null;
                    // medial: M0 fixed, MB1(last) draggable
                    // lateral/bridges: both endpoints fixed
                    const isSolidArch = type === 'medial' || type === 'lateral';
                    const isSharedT4 = type === 'lateralBridge' && i === points.length - 1;
                    const isFixed = type === 'medial'
                        ? i === 0
                        : (isSolidArch || isBridge) && (i === 0 || i === points.length - 1) && !isSharedT4;
                    const isPointActive = draggingCurve === type && draggingPointIdx === i;
                    const labels = CP_LABELS[type];
                    let label = labels ? labels[i] : undefined;
                    if (type === 'transverse' && activeTransverseWidthPattern === 'rays23' && (i === 3 || i === 4)) {
                        label = label?.replace('Ray5', 'Ray4');
                    }
                    if (type === 'lateralBridge' && activeTransverseWidthPattern === 'rays23' && i === points.length - 1) {
                        label = label?.replace('Ray5', 'Ray4');
                    }

                    return (
                        <g key={i}>
                            <circle
                                cx={p.x} cy={p.y}
                                r={isFixed ? 3 / transform.k : (isPointActive ? 6 / transform.k : 4 / transform.k)}
                                fill={isFixed ? COLORS.point_fixed : (isPointActive ? COLORS.point_active : COLORS.point_base)}
                                stroke={isFixed ? 'none' : color}
                                strokeWidth={2 / transform.k}
                                className={isFixed ? "cursor-not-allowed" : "cursor-move"}
                                onMouseDown={(e) => handleMouseDownPoint(e, type, i)}
                            />
                            {showLabels && label && (
                                <text
                                    x={p.x}
                                    y={p.y - 10 / transform.k}
                                    fontSize={11 / transform.k}
                                    fill={color}
                                    textAnchor="middle"
                                    opacity={0.9}
                                    className="select-none pointer-events-none"
                                    fontWeight={600}
                                >{label}</text>
                            )}
                        </g>
                    );
                })}

            </g>
        );
    };

    // Guidelines
    const guides = useMemo(() => {
        if (outlinePoints.length === 0) return null;
        const r1Pct = widthConfig['ray1_boundary'] ?? 65;
        const r5Pct = widthConfig['ray5_boundary'] ?? 25;
        const endPct = landmarkConfig['metatarsal'] ?? 70;
        const endX = bounds.minX + bounds.width * (endPct / 100);
        const r1Points: { x: number, y: number }[] = [];
        const r5Points: { x: number, y: number }[] = [];
        const numSteps = 20;
        const step = (endX - bounds.minX) / numSteps;
        for (let x = bounds.minX; x <= endX + 0.1; x += step) {
            const yBounds = getOutlineYAtX(outlinePoints, x);
            if (yBounds) {
                const r1Y = yBounds.max - (yBounds.max - yBounds.min) * (r1Pct / 100);
                const r5Y = yBounds.max - (yBounds.max - yBounds.min) * (r5Pct / 100);
                r1Points.push({ x, y: r1Y });
                r5Points.push({ x, y: r5Y });
            }
        }
        return { r1: getSmoothPath(r1Points, false), r5: getSmoothPath(r5Points, false) };
    }, [outlinePoints, widthConfig, landmarkConfig, bounds]);

    // Outline-following paths: M0→M7 (medial edge) and L0→L4 (lateral edge)
    const outlineEdgePaths = useMemo(() => {
        if (!localCurves || outlinePoints.length === 0) return null;
        const medial = localCurves.medial;
        const lateral = localCurves.lateral;
        if (!medial || medial.length < 7 || !lateral || lateral.length < 5) return null;

        const numSteps = 30;

        // M0→M7: sample outline MinY (medial edge), M7 is standalone at metatarsal landmark
        const m0x = medial[0].x;
        const metatarsalPctEdge = landmarkConfig['metatarsal'] ?? 70;
        const m7x = bounds.minX + bounds.width * (metatarsalPctEdge / 100);
        const medialEdge: CurvePoint[] = [];
        for (let i = 0; i <= numSteps; i++) {
            const x = m0x + (m7x - m0x) * (i / numSteps);
            const yBounds = getOutlineYAtX(outlinePoints, x);
            if (yBounds) medialEdge.push({ x, y: yBounds.min });
        }

        // L0→L4: sample outline MaxY (lateral edge)
        const l0x = lateral[0].x;
        const l4x = lateral[4].x;
        const lateralEdge: CurvePoint[] = [];
        for (let i = 0; i <= numSteps; i++) {
            const x = l0x + (l4x - l0x) * (i / numSteps);
            const yBounds = getOutlineYAtX(outlinePoints, x);
            if (yBounds) lateralEdge.push({ x, y: yBounds.max });
        }

        return {
            medial: getSmoothPath(medialEdge, false),
            lateral: getSmoothPath(lateralEdge, false),
        };
    }, [bounds.minX, bounds.width, landmarkConfig, localCurves, outlinePoints]);

    const lmGuides = useMemo(() => {
        if (outlinePoints.length === 0) return [];
        const r5Pct = widthConfig['ray5_boundary'] ?? 25;
        return Object.entries(landmarkConfig).map(([key, pct]) => {
            const x = bounds.minX + bounds.width * (pct / 100);
            const yBounds = getOutlineYAtX(outlinePoints, x);
            if (!yBounds) return null;
            const r5Y = yBounds.max - (yBounds.max - yBounds.min) * (r5Pct / 100);
            const isLateral = key === 'lateral_arch_start' || key === 'cuboid';
            return { id: key, label: LM_LABELS[key] || key, x, yStart: isLateral ? yBounds.max : yBounds.min, yEnd: r5Y, isLateral };
        }).filter(g => g !== null) as { id: string, label: string, x: number, yStart: number, yEnd: number, isLateral: boolean }[];
    }, [outlinePoints, landmarkConfig, widthConfig, bounds]);

    // Prevent browser pinch-zoom on the canvas area
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const prevent = (e: WheelEvent) => e.preventDefault();
        el.addEventListener('wheel', prevent, { passive: false });
        return () => el.removeEventListener('wheel', prevent);
    }, []);

    return (
        <div ref={containerRef} className="relative w-full h-full bg-background overflow-hidden flex flex-col border border-border/50 rounded-xl">
            <div className="absolute top-4 left-4 z-10 flex gap-2 rounded-xl border border-white/10 bg-card/80 p-2 backdrop-blur-md">
                <Button
                    size="sm"
                    variant={activeTransverseWidthPattern === 'rays23' ? 'default' : 'ghost'}
                    onClick={() => applyTransverseWidthPattern('rays23')}
                >
                    横アーチ 2・3列
                </Button>
                <Button
                    size="sm"
                    variant={activeTransverseWidthPattern === 'rays234' ? 'default' : 'ghost'}
                    onClick={() => applyTransverseWidthPattern('rays234')}
                >
                    横アーチ 2・3・4列
                </Button>
            </div>
            {/* Toolbar */}
            <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 bg-card/80 backdrop-blur-md p-2 rounded-xl border border-white/10">
                <Button variant="ghost" size="icon" className="text-white hover:text-primary" onClick={() => setTransform(t => ({ ...t, k: t.k * 1.2 }))}><ZoomIn className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="text-white hover:text-primary" onClick={() => setTransform(t => ({ ...t, k: t.k / 1.2 }))}><ZoomOut className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="text-white hover:text-primary" onClick={fitView}><Maximize className="h-4 w-4" /></Button>
                <div className="h-px bg-white/10 my-1" />
                <Button variant="ghost" size="icon" onClick={resetTransverse} title="横アーチリセット" className="text-white hover:text-primary"><RotateCcw className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => setShowLabels(v => !v)} title="ラベル表示切替" className={showLabels ? "text-primary bg-primary/10" : "text-white hover:text-primary"}><Tag className="h-4 w-4" /></Button>
            </div>

            {/* Canvas */}
            <div className="flex-1 relative cursor-default" onMouseDown={handlePanStart} onWheel={(e) => {
                const factor = e.deltaY < 0 ? 1.1 : 0.9;
                setTransform(t => ({ ...t, k: Math.max(0.2, Math.min(10, t.k * factor)) }));
            }}>
                <svg ref={svgRef} className={`w-full h-full block touch-none bg-transparent transition-colors ${isPanning ? 'opacity-80' : ''}`}>
                    <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
                        <defs><pattern id="grid-arch" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke={COLORS.grid} strokeWidth={0.5 / transform.k} /></pattern></defs>
                        <rect x={-5000} y={-5000} width={10000} height={10000} fill="url(#grid-arch)" />

                        <path d={outlineD} fill={COLORS.outline_fill} stroke={COLORS.outline_stroke} strokeWidth={2 / transform.k} vectorEffect="non-scaling-stroke" />

                        {lmGuides.map((lm) => (
                            <g key={lm.id} opacity={0.8}>
                                <line x1={lm.x} y1={lm.yStart} x2={lm.x} y2={lm.yEnd} stroke={COLORS.landmark_guide} strokeWidth={1 / transform.k} strokeDasharray={`${3 / transform.k},${3 / transform.k}`} />
                                <text x={lm.x} y={lm.isLateral ? lm.yStart + 15 : lm.yStart - 10} fontSize={8 / transform.k} fontWeight="black" fill={COLORS.point_fixed} textAnchor="middle" className="select-none uppercase tracking-tighter">{lm.label}</text>
                            </g>
                        ))}
                        {guides && (
                            <g opacity={0.3}>
                                <path d={guides.r1} fill="none" stroke={COLORS.medial_stroke} strokeWidth={1 / transform.k} strokeDasharray={`${4 / transform.k},${4 / transform.k}`} />
                                <path d={guides.r5} fill="none" stroke={COLORS.lateral_stroke} strokeWidth={1 / transform.k} strokeDasharray={`${4 / transform.k},${4 / transform.k}`} />
                            </g>
                        )}

                        {localCurves && (
                            <>
                                {/* Pass 1: shapes only */}
                                {renderCurve(localCurves.medial, COLORS.medial_stroke, COLORS.medial_fill, 'medial', false, 'shape')}
                                {localCurves.medialFlat && renderCurve(localCurves.medialFlat, COLORS.medial_stroke, 'none', 'medialFlat', true, 'shape')}

                                {renderCurve(localCurves.lateral, COLORS.lateral_stroke, COLORS.lateral_fill, 'lateral', false, 'shape')}
                                {localCurves.lateralFlat && renderCurve(localCurves.lateralFlat, COLORS.lateral_stroke, 'none', 'lateralFlat', true, 'shape')}

                                {renderCurve(localCurves.transverse, COLORS.transverse_stroke, COLORS.transverse_fill, 'transverse', false, 'shape')}

                                {localCurves.heelBridge && renderCurve(localCurves.heelBridge, COLORS.bridge_stroke, 'none', 'heelBridge', false, 'shape')}
                                {localCurves.lateralBridge && renderCurve(localCurves.lateralBridge, COLORS.bridge_stroke, 'none', 'lateralBridge', false, 'shape')}

                                {/* Pass 2: control points, above every shape so clicks always reach them */}
                                {renderCurve(localCurves.medial, COLORS.medial_stroke, COLORS.medial_fill, 'medial', false, 'points')}
                                {localCurves.medialFlat && renderCurve(localCurves.medialFlat, COLORS.medial_stroke, 'none', 'medialFlat', true, 'points')}

                                {renderCurve(localCurves.lateral, COLORS.lateral_stroke, COLORS.lateral_fill, 'lateral', false, 'points')}
                                {localCurves.lateralFlat && renderCurve(localCurves.lateralFlat, COLORS.lateral_stroke, 'none', 'lateralFlat', true, 'points')}

                                {renderCurve(localCurves.transverse, COLORS.transverse_stroke, COLORS.transverse_fill, 'transverse', false, 'points')}

                                {localCurves.heelBridge && renderCurve(localCurves.heelBridge, COLORS.bridge_stroke, 'none', 'heelBridge', false, 'points')}
                                {localCurves.lateralBridge && renderCurve(localCurves.lateralBridge, COLORS.bridge_stroke, 'none', 'lateralBridge', false, 'points')}
                                {/* metatarsalBridge: render M7 (bridge[3]) as fixed reference point */}
                                {localCurves.metatarsalBridge && localCurves.metatarsalBridge.length >= 4 && (() => {
                                    const mb = localCurves.metatarsalBridge;
                                    const labels = CP_LABELS['metatarsalBridge'];
                                    // M7 (bridge[3]): standalone arch pad outline point, fixed
                                    const m7p = mb[3];
                                    return (
                                        <g>
                                            <circle
                                                cx={m7p.x} cy={m7p.y}
                                                r={(draggingCurve === 'metatarsalBridge' && draggingPointIdx === 3 ? 6 : 4) / transform.k}
                                                fill={draggingCurve === 'metatarsalBridge' && draggingPointIdx === 3
                                                    ? COLORS.point_active : COLORS.point_base}
                                                stroke={COLORS.bridge_stroke}
                                                strokeWidth={2 / transform.k}
                                                className="cursor-move"
                                                onMouseDown={(e) => handleMouseDownPoint(e, 'metatarsalBridge', 3)}
                                            />
                                            {showLabels && labels && labels[3] && (
                                                <text x={m7p.x} y={m7p.y - 10 / transform.k} fontSize={11 / transform.k} fill={COLORS.bridge_stroke} textAnchor="middle" opacity={0.9} className="select-none pointer-events-none" fontWeight={600}>{labels[3]}</text>
                                            )}
                                        </g>
                                    );
                                })()}

                                {/* T4→T3→T2→MB1→MF5→M7 combined smooth line */}
                                {localCurves.transverse && localCurves.transverse.length >= 5 && localCurves.metatarsalBridge && localCurves.metatarsalBridge.length >= 4 && (() => {
                                    const fairing = metatarsalFairingPoints(
                                        localCurves.transverse,
                                        localCurves.metatarsalBridge,
                                    );
                                    const pts = [
                                        localCurves.transverse[4],
                                        localCurves.transverse[3],
                                        ...fairing,
                                    ];
                                    const d = pointsToPath(pts);
                                    return <path d={d} fill="none" stroke={COLORS.bridge_stroke} strokeWidth={1.5 / transform.k} strokeLinecap="round" opacity={0.7} className="pointer-events-none" />;
                                })()}

                                {/* Outline edge paths: M0→M7, L0→L4 */}
                                {outlineEdgePaths && (
                                    <g opacity={0.5} className="pointer-events-none">
                                        <path d={outlineEdgePaths.medial} fill="none" stroke={COLORS.bridge_stroke} strokeWidth={1.5 / transform.k} strokeLinecap="round" />
                                        <path d={outlineEdgePaths.lateral} fill="none" stroke={COLORS.bridge_stroke} strokeWidth={1.5 / transform.k} strokeLinecap="round" />
                                    </g>
                                )}
                            </>
                        )}
                        {activeArchSettings.subtalar_pattern === 'pronation'
                            && effectivePreviewCurves?.heelBridge?.length
                            && effectivePreviewCurves.medial.length > 1
                            && (() => {
                                const h1 = effectivePreviewCurves.heelBridge![1];
                                return (
                                    <g>
                                        <path
                                            d={shapePreservingPath(effectivePreviewCurves.medial, true)}
                                            fill="none"
                                            stroke="#f59e0b"
                                            strokeWidth={3 / transform.k}
                                            strokeLinecap="round"
                                            className="pointer-events-none"
                                        />
                                        {effectivePreviewCurves.medialFlat && (
                                            <path
                                                d={shapePreservingPath(effectivePreviewCurves.medialFlat)}
                                                fill="none"
                                                stroke="#f59e0b"
                                                strokeWidth={2 / transform.k}
                                                strokeDasharray={`${4 / transform.k},${4 / transform.k}`}
                                                className="pointer-events-none"
                                            />
                                        )}
                                        <path
                                            d={getSmoothPath(effectivePreviewCurves.heelBridge!, false)}
                                            fill="none"
                                            stroke="#f59e0b"
                                            strokeWidth={2.5 / transform.k}
                                            strokeLinecap="round"
                                            className="pointer-events-none"
                                        />
                                        <circle
                                            cx={h1.x}
                                            cy={h1.y}
                                            r={5 / transform.k}
                                            fill="var(--background)"
                                            stroke="#f59e0b"
                                            strokeWidth={2 / transform.k}
                                            className="cursor-move"
                                            onMouseDown={(event) => handleMouseDownPronationH1(event, h1)}
                                        />
                                        {showLabels && (
                                            <text
                                                x={h1.x}
                                                y={h1.y - 12 / transform.k}
                                                fontSize={11 / transform.k}
                                                fill="#f59e0b"
                                                textAnchor="middle"
                                                className="select-none pointer-events-none"
                                                fontWeight={700}
                                            >回内 H1</text>
                                        )}
                                    </g>
                                );
                            })()}
                    </g>
                </svg>
            </div>

            <div className="absolute bottom-6 left-6 right-24 bg-card/80 backdrop-blur-md p-5 rounded-2xl border border-border flex flex-wrap items-center gap-8">
                <div className="flex items-center gap-3">
                    <span className="block w-5 h-1.5 rounded-full bg-[#14b8a6]"></span>
                    <span className="font-black text-[10px] text-foreground uppercase tracking-widest">Medial Arch</span>
                </div>
                <div className="flex items-center gap-3">
                    <span className="block w-5 h-1.5 rounded-full bg-[#0ea5e9]"></span>
                    <span className="font-black text-[10px] text-foreground uppercase tracking-widest">Lateral Arch</span>
                </div>
                <div className="flex items-center gap-3">
                    <span className="block w-5 h-5 rounded-lg bg-[#2dd4bf]/20 border border-[#2dd4bf]"></span>
                    <span className="font-black text-[10px] text-foreground uppercase tracking-widest">Transverse (Free)</span>
                </div>
                <div className="flex items-center gap-3 pl-6 border-l border-border">
                    <MousePointer2 className="h-4 w-4 text-primary" />
                    <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-tight">Drag points to refine the arch influence region.</span>
                </div>
            </div>
        </div>
    );
}
