'use client';

import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { getSmoothPath, getBounds, getOutlineYAtX } from '@/lib/geometry-utils';
import { ZoomIn, ZoomOut, Maximize, MousePointer2, Move, RotateCcw, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CurvePoint, ArchCurves } from '@/lib/api';

// --- Constants ---
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
    'metatarsal': '中足'
};

// Control point labels per curve type
const CP_LABELS: Record<string, string[]> = {
    medial: ['M0:Start', 'M1', 'M2:Sub', 'M3:Nav', 'M4:Cun', 'M5', 'M6', 'M7:Meta'],
    medialFlat: ['mF0', 'mF1', 'mF2', 'mF3', 'mF4', 'mF5', 'mF6', 'mF7'],
    lateral: ['L0:Start', 'L1', 'L2:Peak', 'L3', 'L4:End'],
    lateralFlat: ['lF0', 'lF1', 'lF2', 'lF3', 'lF4'],
    transverse: ['T0:Ray1', 'T1:Ray1', 'T2:Meta', 'T3:Ray5', 'T4:Ray5', 'T5', 'T6:Mid', 'T7'],
    heelBridge: ['M0:Start', 'H1:Ray1', 'H2:Ray5', 'L0:Start'],
    lateralBridge: ['L4:End', 'B1:Cub', 'T4:Ray5'],
    metatarsalBridge: ['T2:Meta', 'MB1', 'M7:Meta'],
};

export default function ArchRegionEditorCanvas() {
    const {
        outlinePoints,
        widthConfig,
        landmarkConfig,
        archCurves,
        setArchCurves,
        updateArchSettings,
        activeFootSide
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

    const bounds = useMemo(() => getBounds(outlinePoints), [outlinePoints]);

    // Sync transverse polygon X-range to archSettings (transverse_start/peak/end)
    const syncTransverseToArchSettings = React.useCallback((points: CurvePoint[]) => {
        if (!points || points.length < 2 || bounds.width <= 0) return;
        const xs = points.map(p => p.x);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const centroidX = xs.reduce((s, v) => s + v, 0) / xs.length;

        const transverse_start = ((minX - bounds.minX) / bounds.width) * 100;
        const transverse_end = ((maxX - bounds.minX) / bounds.width) * 100;
        const transverse_peak = ((centroidX - bounds.minX) / bounds.width) * 100;

        updateArchSettings(activeFootSide, {
            transverse_start: Math.max(0, Math.min(100, transverse_start)),
            transverse_peak: Math.max(0, Math.min(100, transverse_peak)),
            transverse_end: Math.max(0, Math.min(100, transverse_end)),
        });
    }, [bounds, updateArchSettings, activeFootSide]);

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

    // --- Initialization ---
    useEffect(() => {
        if (outlinePoints.length > 0) {
            const medialPoints = (archCurves && archCurves.medial.length > 0) ? archCurves.medial : generateInitialCurve('medial');
            const lateralPoints = (archCurves && archCurves.lateral.length > 0) ? archCurves.lateral : generateInitialCurve('lateral');
            const transversePoints = (archCurves && archCurves.transverse.length > 0) ? archCurves.transverse : generateInitialCurve('transverse');

            let medialFlatPoints = archCurves?.medialFlat;
            let lateralFlatPoints = archCurves?.lateralFlat;
            let transverseFlatPoints = archCurves?.transverseFlat;
            // Check if regeneration is needed
            const needsRegenMedial = !medialFlatPoints || medialFlatPoints.length === 0 || Math.abs(medialFlatPoints[0].x - medialPoints[0].x) < 0.1;
            const needsRegenLateral = !lateralFlatPoints || lateralFlatPoints.length === 0 || Math.abs(lateralFlatPoints[0].x - lateralPoints[0].x) < 0.1;
            const needsRegenTransverse = !transverseFlatPoints || transverseFlatPoints.length === 0;

            if (needsRegenMedial) {
                medialFlatPoints = createFlatCurve(medialPoints, -1);
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
            const needsRegenHeelBridge = !heelBridgePoints || heelBridgePoints.length === 0;
            const needsRegenLateralBridge = !lateralBridgePoints || lateralBridgePoints.length === 0;

            if (needsRegenHeelBridge) {
                heelBridgePoints = generateInitialCurve('heelBridge', { medial: medialPoints, lateral: lateralPoints });
            }
            if (needsRegenLateralBridge) {
                lateralBridgePoints = generateInitialCurve('lateralBridge', { lateral: lateralPoints, transverse: transversePoints });
            }

            let metatarsalBridgePoints = archCurves?.metatarsalBridge;
            const needsRegenMetatarsalBridge = !metatarsalBridgePoints || metatarsalBridgePoints.length === 0;
            if (needsRegenMetatarsalBridge) {
                metatarsalBridgePoints = generateInitialCurve('metatarsalBridge', { medial: medialPoints, transverse: transversePoints });
            }

            if (needsRegenMedial || needsRegenLateral || needsRegenTransverse || needsRegenHeelBridge || needsRegenLateralBridge || needsRegenMetatarsalBridge || !archCurves) {
                const initialCurves: ArchCurves = {
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
                // Sync transverse polygon X-range to archSettings on initial generation
                syncTransverseToArchSettings(transversePoints);
            }
        }
    }, [outlinePoints, widthConfig, landmarkConfig, createFlatCurve, syncTransverseToArchSettings]);

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
            const ray1Y = yBounds.min + (yBounds.max - yBounds.min) * (1 - r1Pct / 100);
            const ray5Y = yBounds.min + (yBounds.max - yBounds.min) * (1 - r5Pct / 100);

            const p1 = { x: m1X, y: ray1Y }; // Ray1 control point at M1 X
            const p2 = { x: m1X, y: ray5Y }; // Ray5 control point at M1 X

            return [p0, p1, p2, p3];
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
                const ray5Y = yBoundsB.min + (yBoundsB.max - yBoundsB.min) * (1 - r5PctB / 100);
                // 5% outside (toward outline max) from Ray5 line
                b1Y = ray5Y + (yBoundsB.max - ray5Y) * 0.10;
            } else {
                b1Y = (p0.y + p2.y) / 2;
            }

            const p1 = { x: midX, y: b1Y }; // Ray5 + 5% outward, between navicular and cuneiform

            return [p0, p1, p2];
        }

        if (type === 'metatarsalBridge') {
            // Bridge from transverse[2] (T2) to medial[7] (M7)
            // Control point follows T3→T2 direction for smooth curve
            const medialPts = refCurves?.medial;
            const transversePts = refCurves?.transverse;
            if (!medialPts || !transversePts || medialPts.length < 8 || transversePts.length < 4) return [];

            const t3 = transversePts[3]; // T3 (used for direction)
            const p0 = transversePts[2]; // T2
            const p2 = medialPts[7];     // M7

            // Direction vector from T3 to T2
            const dirX = p0.x - t3.x;
            const dirY = p0.y - t3.y;
            const dist = Math.sqrt(dirX * dirX + dirY * dirY);
            const extensionLen = dist * 0.6;

            // Control point: X = metatarsal + 1%, Y from T3→T2 direction blended toward M7
            const metatarsalPct = landmarkConfig['metatarsal'] ?? 70;
            const mb1X = bounds.minX + bounds.width * (metatarsalPct / 100) + bounds.width * 0.01;
            const extY = p0.y + (dirY / dist) * extensionLen;
            const p1 = {
                x: mb1X,
                y: extY * 0.5 + p2.y * 0.5
            };

            return [p0, p1, p2];
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
                if (rayType === 'ray1') return yBounds.min + (yBounds.max - yBounds.min) * (1 - r1Pct / 100);
                return yBounds.min + (yBounds.max - yBounds.min) * (1 - r5Pct / 100);
            };

            const ray1Y = getRayY(centerX, 'ray1');
            const ray5Y = getRayY(centerX, 'ray5');
            const centerY = (ray1Y + ray5Y) / 2;

            // 3. Define 4 Cardinal Points
            const pTop = { x: centerX, y: ray1Y };          // Ray 1
            const metaPlus5X = metatarsalX + bounds.width * 0.03; // Metatarsal + 3% toward toe
            const pRight = { x: metaPlus5X, y: centerY };   // Metatarsal + 5%
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

            // P1 (Top-Right): Snap to Ray 1 line at metatarsal - 1% (heel side)
            const metaMinus1X = metatarsalX - bounds.width * 0.01;
            const metaRay1Y = getRayY(metaMinus1X, 'ray1');
            const metaRay5Y = getRayY(metaMinus1X, 'ray5');
            const pTR = { x: metaMinus1X, y: metaRay1Y };
            // P3 (Bottom-Right): Snap to Ray 5 line at metatarsal - 1% (heel side)
            const pBR = { x: metaMinus1X, y: metaRay5Y };

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
        const numPoints = type === 'medial' ? 8 : 5;

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
        const midCunMeta = (cuneiformPct + metatarsalPct) / 2;

        // Medial X Points
        const medialXPercents = [
            (landmarkConfig['arch_start'] ?? 15),
            ((landmarkConfig['arch_start'] ?? 15) + subtalarPct) / 2,
            subtalarPct,
            navicularPct,
            cuneiformPct,
            midCunMeta,
            (midCunMeta + metatarsalPct) / 2,
            metatarsalPct
        ];

        if (type === 'medial') {
            const r5Pct = widthConfig['ray5_boundary'] ?? 25;

            return medialXPercents.map((pct, i) => {
                const x = bounds.minX + bounds.width * (pct / 100);
                const yBounds = getOutlineYAtX(outlinePoints, x);
                if (!yBounds) return { x, y: (startP.y + endP.y) / 2 };

                const outlineY = yBounds.min; // medial outline edge
                const ray1Y = yBounds.min + (yBounds.max - yBounds.min) * (1 - r1Pct / 100);
                const ray5Y = yBounds.min + (yBounds.max - yBounds.min) * (1 - r5Pct / 100);

                switch (i) {
                    case 0: // M0: Start (fixed)
                        return { x, y: outlineY };
                    case 1: // M1: Ramp up toward arch - 60% from outline to Ray1
                        return { x, y: outlineY + (ray1Y - outlineY) * 0.60 };
                    case 2: // M2: Subtalar - snap to Ray 1
                        return { x, y: ray1Y };
                    case 3: // M3: Navicular (peak) - 10% from Ray1 toward Ray5
                        return { x, y: ray1Y + (ray5Y - ray1Y) * 0.10 };
                    case 4: // M4: Cuneiform - snap to Ray 1
                        return { x, y: ray1Y };
                    case 5: // M5: Descent from cuneiform - 70% from outline to Ray1
                        return { x, y: outlineY + (ray1Y - outlineY) * 0.70 };
                    case 6: // M6: Further descent - 40% from outline to Ray1
                        return { x, y: outlineY + (ray1Y - outlineY) * 0.40 };
                    case 7: // M7: End (fixed)
                        return { x, y: outlineY };
                    default:
                        return { x, y: outlineY };
                }
            });
        }

        // Lateral Arch Logic (unchanged 5 points)
        points.push(startP);
        const stepX = (endX - startX) / (numPoints - 1);
        const peakPct = widthConfig['ray5_boundary'] ?? 25;

        for (let i = 1; i < numPoints - 1; i++) {
            const x = startX + i * stepX;
            const yBounds = getOutlineYAtX(outlinePoints, x);

            if (yBounds) {
                const t = i / (numPoints - 1);
                const arcFactor = Math.sin(t * Math.PI);
                const baseY = startP.y + (endP.y - startP.y) * t;
                const guideY = yBounds.min + (yBounds.max - yBounds.min) * (1 - peakPct / 100);
                const y = baseY + (guideY - baseY) * arcFactor;
                points.push({ x, y });
            } else {
                points.push({ x, y: (startP.y + endP.y) / 2 });
            }
        }

        points.push(endP);
        return points;
    };

    const resetTransverse = () => {
        if (!archCurves) return;
        const newTransverse = generateInitialCurve('transverse');
        setArchCurves({
            ...archCurves,
            transverse: newTransverse
        });
        syncTransverseToArchSettings(newTransverse);
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
        return {
            x: (rawX - transform.x) / transform.k,
            y: (rawY - transform.y) / transform.k
        };
    };

    const handleMouseDownPoint = (e: React.MouseEvent, type: 'medial' | 'lateral' | 'transverse' | 'medialFlat' | 'lateralFlat' | 'heelBridge' | 'lateralBridge' | 'metatarsalBridge', idx: number) => {
        e.stopPropagation();
        if (!archCurves) return;

        // Transverse/TransverseFlat: All points movable
        // MedialFlat/LateralFlat: All points movable (Endpoints will be snapped to outline)
        // Medial/Lateral (Solid): Endpoints fixed to maintain anatomical start/end
        // Bridge curves: Endpoints fixed, middle control points draggable

        const isSolidArch = type === 'medial' || type === 'lateral';
        const isBridge = type === 'heelBridge' || type === 'lateralBridge' || type === 'metatarsalBridge';

        if (isSolidArch || isBridge) {
            // @ts-ignore
            const len = archCurves[type]?.length || 0;
            if (idx === 0 || idx === len - 1) return;
        }

        setDraggingCurve(type);
        setDraggingPointIdx(idx);
        setIsDraggingWholeCurve(false);
    };

    const handleMouseDownCurve = (e: React.MouseEvent, type: 'medial' | 'lateral' | 'transverse' | 'medialFlat' | 'lateralFlat' | 'heelBridge' | 'lateralBridge' | 'metatarsalBridge') => {
        // Only allow whole drag for transverse
        if (type === 'transverse') {
            e.stopPropagation();
            setDraggingCurve(type);
            setDraggingPointIdx(null);
            setIsDraggingWholeCurve(true);
        }
    };

    const handlePanStart = (e: React.MouseEvent) => {
        if (draggingCurve) return;
        setIsPanning(true);
        setLastPanPos({ x: e.clientX, y: e.clientY });
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            const pos = getLogicalPos(e);

            if (draggingCurve && archCurves) {
                const newCurves = { ...archCurves };
                // @ts-ignore
                const points = [...newCurves[draggingCurve]];

                if (isDraggingWholeCurve) {
                    // Move all points
                    const dx = e.movementX / transform.k;
                    const dy = e.movementY / transform.k;

                    for (let i = 0; i < points.length; i++) {
                        points[i] = { x: points[i].x + dx, y: points[i].y + dy };
                    }
                    // @ts-ignore
                    newCurves[draggingCurve] = points;

                    // Sync bridges when whole-dragging transverse
                    if (draggingCurve === 'transverse') {
                        if (newCurves.lateralBridge && newCurves.lateralBridge.length >= 3 && points.length >= 5) {
                            const bridgePoints = [...newCurves.lateralBridge];
                            bridgePoints[bridgePoints.length - 1] = { ...points[4] };
                            newCurves.lateralBridge = bridgePoints;
                        }
                        if (newCurves.metatarsalBridge && newCurves.metatarsalBridge.length >= 3 && points.length >= 3) {
                            const mbPoints = [...newCurves.metatarsalBridge];
                            mbPoints[0] = { ...points[2] };
                            newCurves.metatarsalBridge = mbPoints;
                        }
                    }

                    setArchCurves(newCurves);

                } else if (draggingPointIdx !== null) {
                    // Move single point

                    // Constrain Flat Endpoints to Outline
                    if ((draggingCurve === 'medialFlat' || draggingCurve === 'lateralFlat') && (draggingPointIdx === 0 || draggingPointIdx === points.length - 1)) {
                        const yBounds = getOutlineYAtX(outlinePoints, pos.x);
                        if (yBounds) {
                            if (draggingCurve === 'medialFlat') pos.y = yBounds.min;
                            if (draggingCurve === 'lateralFlat') pos.y = yBounds.max;
                        }
                    }

                    points[draggingPointIdx] = { x: pos.x, y: pos.y };
                    // @ts-ignore
                    newCurves[draggingCurve] = points;

                    // If dragging solid curve (medial/lateral/transverse), auto-update the corresponding flat curve
                    if (draggingCurve === 'medial') {
                        newCurves.medialFlat = createFlatCurve(points, -1);
                        // Sync metatarsalBridge endpoint to medial[7]
                        if (newCurves.metatarsalBridge && newCurves.metatarsalBridge.length >= 3 && points.length >= 8) {
                            const mbPoints = [...newCurves.metatarsalBridge];
                            mbPoints[mbPoints.length - 1] = { ...points[7] };
                            newCurves.metatarsalBridge = mbPoints;
                        }
                    } else if (draggingCurve === 'lateral') {
                        newCurves.lateralFlat = createFlatCurve(points, 1);
                    } else if (draggingCurve === 'transverse') {
                        newCurves.transverseFlat = createFlatCurve(points, 1, true);  // isClosed=true for polygon
                        // Sync lateralBridge endpoint to transverse[4]
                        if (newCurves.lateralBridge && newCurves.lateralBridge.length >= 3 && points.length >= 5) {
                            const bridgePoints = [...newCurves.lateralBridge];
                            bridgePoints[bridgePoints.length - 1] = { ...points[4] };
                            newCurves.lateralBridge = bridgePoints;
                        }
                        // Sync metatarsalBridge start to transverse[2]
                        if (newCurves.metatarsalBridge && newCurves.metatarsalBridge.length >= 3 && points.length >= 3) {
                            const mbPoints = [...newCurves.metatarsalBridge];
                            mbPoints[0] = { ...points[2] };
                            newCurves.metatarsalBridge = mbPoints;
                        }
                    }

                    setArchCurves(newCurves);
                }
            } else if (isPanning) {
                setTransform(t => ({
                    ...t,
                    x: t.x + (e.clientX - lastPanPos.x),
                    y: t.y + (e.clientY - lastPanPos.y)
                }));
                setLastPanPos({ x: e.clientX, y: e.clientY });
            }
        };
        const handleMouseUp = () => {
            // Sync transverse polygon to archSettings when drag ends
            if (draggingCurve === 'transverse' && archCurves?.transverse) {
                syncTransverseToArchSettings(archCurves.transverse);
            }
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
    }, [draggingCurve, draggingPointIdx, isDraggingWholeCurve, isPanning, lastPanPos, transform, archCurves, syncTransverseToArchSettings]);

    // --- Rendering ---
    const outlineD = useMemo(() => getSmoothPath(outlinePoints, true), [outlinePoints]);

    const renderCurve = (points: CurvePoint[], color: string, fillColor: string, type: 'medial' | 'lateral' | 'transverse' | 'medialFlat' | 'lateralFlat' | 'heelBridge' | 'lateralBridge' | 'metatarsalBridge', isDashed = false) => {
        if (!points || points.length < 2) return null;

        const isClosed = type === 'transverse';
        const isBridge = type === 'heelBridge' || type === 'lateralBridge' || type === 'metatarsalBridge';
        const d = getSmoothPath(points, isClosed);

        return (
            <g>
                {/* Fill for hit testing (Transverse only) */}
                {isClosed && (
                    <path
                        d={d}
                        fill={fillColor}
                        stroke="none"
                        className="cursor-move hover:opacity-80"
                        onMouseDown={(e) => handleMouseDownCurve(e, type)}
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

                {/* Control Points */}
                {points.map((p, i) => {
                    // Medial/Lateral (Solid) and Bridge endpoints are fixed
                    const isSolidArch = type === 'medial' || type === 'lateral';
                    const isFixed = (isSolidArch || isBridge) && (i === 0 || i === points.length - 1);
                    const isPointActive = draggingCurve === type && draggingPointIdx === i;
                    const labels = CP_LABELS[type];
                    const label = labels ? labels[i] : undefined;

                    return (
                        <g key={i}>
                            <circle
                                cx={p.x} cy={p.y}
                                r={isFixed ? 3 / transform.k : (isPointActive ? 6 / transform.k : 4 / transform.k)}
                                fill={isFixed ? COLORS.point_fixed : (isPointActive ? COLORS.point_active : COLORS.point_base)}
                                stroke={isFixed ? 'none' : color}
                                strokeWidth={2 / transform.k}
                                className={isFixed ? "cursor-not-allowed" : "cursor-move hover:scale-125 transition-transform"}
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
                const r1Y = yBounds.min + (yBounds.max - yBounds.min) * (1 - r1Pct / 100);
                const r5Y = yBounds.min + (yBounds.max - yBounds.min) * (1 - r5Pct / 100);
                r1Points.push({ x, y: r1Y });
                r5Points.push({ x, y: r5Y });
            }
        }
        return { r1: getSmoothPath(r1Points, false), r5: getSmoothPath(r5Points, false) };
    }, [outlinePoints, widthConfig, landmarkConfig, bounds]);

    // Outline-following paths: M0→M7 (medial edge) and L0→L4 (lateral edge)
    const outlineEdgePaths = useMemo(() => {
        if (!archCurves || outlinePoints.length === 0) return null;
        const medial = archCurves.medial;
        const lateral = archCurves.lateral;
        if (!medial || medial.length < 8 || !lateral || lateral.length < 5) return null;

        const numSteps = 30;

        // M0→M7: sample outline min Y (medial edge)
        const m0x = medial[0].x;
        const m7x = medial[7].x;
        const medialEdge: CurvePoint[] = [];
        for (let i = 0; i <= numSteps; i++) {
            const x = m0x + (m7x - m0x) * (i / numSteps);
            const yBounds = getOutlineYAtX(outlinePoints, x);
            if (yBounds) medialEdge.push({ x, y: yBounds.min });
        }

        // L0→L4: sample outline max Y (lateral edge)
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
    }, [archCurves, outlinePoints]);

    const lmGuides = useMemo(() => {
        if (outlinePoints.length === 0) return [];
        const r5Pct = widthConfig['ray5_boundary'] ?? 25;
        return Object.entries(landmarkConfig).map(([key, pct]) => {
            const x = bounds.minX + bounds.width * (pct / 100);
            const yBounds = getOutlineYAtX(outlinePoints, x);
            if (!yBounds) return null;
            const r5Y = yBounds.min + (yBounds.max - yBounds.min) * (1 - r5Pct / 100);
            const isLateral = key === 'lateral_arch_start' || key === 'cuboid';
            return { id: key, label: LM_LABELS[key] || key, x, yStart: isLateral ? yBounds.max : yBounds.min, yEnd: r5Y, isLateral };
        }).filter(g => g !== null) as { id: string, label: string, x: number, yStart: number, yEnd: number, isLateral: boolean }[];
    }, [outlinePoints, landmarkConfig, widthConfig, bounds]);

    return (
        <div ref={containerRef} className="relative w-full h-full bg-background overflow-hidden flex flex-col border border-border/50 rounded-xl">
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

                        {archCurves && (
                            <>
                                {renderCurve(archCurves.medial, COLORS.medial_stroke, COLORS.medial_fill, 'medial')}
                                {archCurves.medialFlat && renderCurve(archCurves.medialFlat, COLORS.medial_stroke, 'none', 'medialFlat', true)}

                                {renderCurve(archCurves.lateral, COLORS.lateral_stroke, COLORS.lateral_fill, 'lateral')}
                                {archCurves.lateralFlat && renderCurve(archCurves.lateralFlat, COLORS.lateral_stroke, 'none', 'lateralFlat', true)}

                                {renderCurve(archCurves.transverse, COLORS.transverse_stroke, COLORS.transverse_fill, 'transverse')}

                                {archCurves.heelBridge && renderCurve(archCurves.heelBridge, COLORS.bridge_stroke, 'none', 'heelBridge')}
                                {archCurves.lateralBridge && renderCurve(archCurves.lateralBridge, COLORS.bridge_stroke, 'none', 'lateralBridge')}
                                {/* metatarsalBridge control points only (line is drawn in combined path above) */}
                                {archCurves.metatarsalBridge && archCurves.metatarsalBridge.length >= 3 && (() => {
                                    const mb = archCurves.metatarsalBridge;
                                    const labels = CP_LABELS['metatarsalBridge'];
                                    // Only render the draggable middle point MB1
                                    const p = mb[1];
                                    const isActive = draggingCurve === 'metatarsalBridge' && draggingPointIdx === 1;
                                    return (
                                        <g>
                                            <circle
                                                cx={p.x} cy={p.y}
                                                r={isActive ? 6 / transform.k : 4 / transform.k}
                                                fill={isActive ? COLORS.point_active : COLORS.point_base}
                                                stroke={COLORS.bridge_stroke}
                                                strokeWidth={2 / transform.k}
                                                className="cursor-move hover:scale-125 transition-transform"
                                                onMouseDown={(e) => handleMouseDownPoint(e, 'metatarsalBridge', 1)}
                                            />
                                            {showLabels && labels && labels[1] && (
                                                <text x={p.x} y={p.y - 10 / transform.k} fontSize={11 / transform.k} fill={COLORS.bridge_stroke} textAnchor="middle" opacity={0.9} className="select-none pointer-events-none" fontWeight={600}>{labels[1]}</text>
                                            )}
                                        </g>
                                    );
                                })()}

                                {/* T4→T3→T2→MB1→M7 combined smooth line */}
                                {archCurves.transverse && archCurves.transverse.length >= 5 && archCurves.metatarsalBridge && archCurves.metatarsalBridge.length >= 3 && (() => {
                                    const pts = [
                                        archCurves.transverse[4],
                                        archCurves.transverse[3],
                                        archCurves.transverse[2],
                                        archCurves.metatarsalBridge[1], // MB1
                                        archCurves.metatarsalBridge[2], // M7
                                    ];
                                    const d = getSmoothPath(pts, false);
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