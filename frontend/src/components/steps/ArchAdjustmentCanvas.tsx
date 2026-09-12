'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { densifyClosedPolygon, densifyOpenCurve } from '@/lib/geometry-utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Info } from 'lucide-react';
import MedialDetailHeightEditor from '@/components/steps/MedialDetailHeightEditor';
import {
    clinicalMedialHeights,
    effectiveCurvesForSettings,
    metatarsalFairingPoints,
    pchipValue,
    shapePreservingPoints,
} from '@/lib/arch-geometry';

// --- Cross Section Viewer Component ---

const VIEW_HEIGHT = 200;
const VIEW_WIDTH = 600;
const PADDING = 30;
const MAX_HEIGHT = 20;

// Landmark labels map
const LM_LABELS: Record<string, string> = {
    'arch_start': '起始',
    'lateral_arch_start': '外起始',
    'subtalar': '距骨',
    'navicular': '舟状',
    'cuboid': '立方',
    'medial_cuneiform': '楔状',
    'metatarsal': '中足'
};

function CrossSectionViewer() {
    const {
        baseThickness,
        heelCupHeight,
        bottomRounding,
        medialWallHeight, medialWallPeakX,
        lateralWallHeight, lateralWallPeakX,
        archSettingsRight, archSettingsLeft,
        activeFootSide,
        updateArchSettings,
        landmarkConfig,
        archCurves: storedArchCurves,
        outlinePoints,
        bottomOutlinePoints,
        wallDishReach,
        medialBandDropBias,
        lateralBandDropBias,
        wallFirstStageDeg,
    } = useStore();

    // Select settings based on active side
    const archSettings = activeFootSide === 'right' ? archSettingsRight : archSettingsLeft;
    const isRightFoot = activeFootSide === 'right';
    const archCurves = useMemo(
        () => effectiveCurvesForSettings(storedArchCurves, archSettings, outlinePoints, landmarkConfig),
        [storedArchCurves, archSettings, outlinePoints, landmarkConfig],
    );

    // アーチX軸位置（開始・ピーク・終了）は左右共通なので、マウント時に右足の値を左足に同期する
    const archSettingsRightRef = React.useRef(archSettingsRight);
    React.useEffect(() => {
        const r = archSettingsRightRef.current;
        updateArchSettings('left', {
            medial_start: r.medial_start, medial_peak: r.medial_peak, medial_end: r.medial_end,
            lateral_start: r.lateral_start, lateral_peak: r.lateral_peak, lateral_end: r.lateral_end,
            transverse_start: r.transverse_start, transverse_peak: r.transverse_peak, transverse_end: r.transverse_end,
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const [xPercent, setXPercent] = useState(50);

    // ベルカーブ計算（詳細設定初期化・自動更新用）
    const bellCurveH = (x: number, start: number, peak: number, end: number, maxH: number) => {
        if (x <= start || x >= end) return 0;
        const ss = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
        if (x <= peak) return maxH * ss((x - start) / (peak - start));
        return maxH * (1 - ss((x - peak) / (end - peak)));
    };

    // 内側アーチのパラメータ変化時に詳細高さをベルカーブから自動再計算
    const prevDetailStateRef = useRef({
        height: archSettings.medial_height,
        start:  archSettings.medial_start,
        peak:   archSettings.medial_peak,
        end:    archSettings.medial_end,
        side:   activeFootSide,
    });
    useEffect(() => {
        const prev = prevDetailStateRef.current;
        const currH     = archSettings.medial_height;
        const currStart = archSettings.medial_start;
        const currPeak  = archSettings.medial_peak;
        const currEnd   = archSettings.medial_end;
        const currSide  = activeFootSide;
        prevDetailStateRef.current = { height: currH, start: currStart, peak: currPeak, end: currEnd, side: currSide };

        // 足の切り替え時はスキップ
        if (prev.side !== currSide) return;
        // 詳細設定がOFFならスキップ
        if (!archSettings.medial_detail_enabled) return;
        // パラメータ変化なしならスキップ
        if (prev.height === currH && prev.start === currStart && prev.peak === currPeak && prev.end === currEnd) return;

        const hasClinicalPattern =
            (archSettings.subtalar_pattern && archSettings.subtalar_pattern !== 'custom')
            || (archSettings.first_ray_pattern && archSettings.first_ray_pattern !== 'custom');
        const newH = hasClinicalPattern
            ? clinicalMedialHeights(
                currH,
                archSettings,
                landmarkConfig,
                archSettings.subtalar_pattern,
                archSettings.first_ray_pattern,
            )
            : (() => {
                const sub = landmarkConfig['subtalar'] ?? 30;
                const nav = landmarkConfig['navicular'] ?? 43;
                const cun = landmarkConfig['medial_cuneiform'] ?? 55;
                const mb1Pct = (landmarkConfig['metatarsal'] ?? 70) + 1;
                const m5Pct = (cun + mb1Pct) / 2;
                return [sub, nav, cun, m5Pct].map(x =>
                    Math.round(bellCurveH(x, currStart, currPeak, currEnd, currH) * 10) / 10
                );
            })();
        updateArchSettings(currSide, { medial_detail_heights: newH });
    }, [archSettings.medial_height, archSettings.medial_start, archSettings.medial_peak, archSettings.medial_end, activeFootSide]); // eslint-disable-line react-hooks/exhaustive-deps

    // 横アーチのパラメータ変化時に詳細高さをベルカーブから自動再計算
    const prevTransverseDetailRef = useRef({
        height: archSettings.transverse_height,
        start:  archSettings.transverse_start,
        peak:   archSettings.transverse_peak,
        end:    archSettings.transverse_end,
        side:   activeFootSide,
    });
    useEffect(() => {
        const prev = prevTransverseDetailRef.current;
        const currH     = archSettings.transverse_height;
        const currStart = archSettings.transverse_start;
        const currPeak  = archSettings.transverse_peak;
        const currEnd   = archSettings.transverse_end;
        const currSide  = activeFootSide;
        prevTransverseDetailRef.current = { height: currH, start: currStart, peak: currPeak, end: currEnd, side: currSide };

        if (prev.side !== currSide) return;
        if (!archSettings.transverse_detail_enabled) return;
        if (prev.height === currH && prev.start === currStart && prev.peak === currPeak && prev.end === currEnd) return;

        const nav = landmarkConfig['navicular'] ?? 43;
        const cun = landmarkConfig['medial_cuneiform'] ?? 55;
        const met = landmarkConfig['metatarsal'] ?? 70;
        const mt  = (cun + met) / 2;
        const newH = [nav, cun, mt, met].map(x =>
            Math.round(bellCurveH(x, currStart, currPeak, currEnd, currH) * 10) / 10
        );
        updateArchSettings(currSide, { transverse_detail_heights: newH });
    }, [archSettings.transverse_height, archSettings.transverse_start, archSettings.transverse_peak, archSettings.transverse_end, activeFootSide]); // eslint-disable-line react-hooks/exhaustive-deps

    // 詳細設定トグルハンドラ：初回ONでベルカーブから初期化
    const handleDetailToggle = (enabled: boolean) => {
        if (!enabled) {
            updateArchSettings(activeFootSide, { medial_detail_enabled: false });
            return;
        }
        const currentHeights = archSettings.medial_detail_heights ?? [0, 0, 0, 0];
        const allZero = currentHeights.every(h => h === 0);
        if (allZero) {
            const sub = landmarkConfig['subtalar'] ?? 30;
            const nav = landmarkConfig['navicular'] ?? 43;
            const cun = landmarkConfig['medial_cuneiform'] ?? 55;
            const mb1Pct = (landmarkConfig['metatarsal'] ?? 70) + 1;
            const m5Pct = (cun + mb1Pct) / 2;
            const { medial_start, medial_peak, medial_end, medial_height } = archSettings;
            const initH = [sub, nav, cun, m5Pct].map(x =>
                Math.round(bellCurveH(x, medial_start, medial_peak, medial_end, medial_height) * 10) / 10
            );
            updateArchSettings(activeFootSide, { medial_detail_enabled: true, medial_detail_heights: initH });
        } else {
            updateArchSettings(activeFootSide, { medial_detail_enabled: true });
        }
    };

    // 横アーチ詳細設定トグルハンドラ
    const handleTransverseDetailToggle = (enabled: boolean) => {
        if (!enabled) {
            updateArchSettings(activeFootSide, { transverse_detail_enabled: false });
            return;
        }
        const currentHeights = archSettings.transverse_detail_heights ?? [0, 0, 0, 0];
        const allZero = currentHeights.every(h => h === 0);
        if (allZero) {
            const nav = landmarkConfig['navicular'] ?? 43;
            const cun = landmarkConfig['medial_cuneiform'] ?? 55;
            const met = landmarkConfig['metatarsal'] ?? 70;
            const mt  = (cun + met) / 2;
            const { transverse_start, transverse_peak, transverse_end, transverse_height } = archSettings;
            const initH = [nav, cun, mt, met].map(x =>
                Math.round(bellCurveH(x, transverse_start, transverse_peak, transverse_end, transverse_height) * 10) / 10
            );
            updateArchSettings(activeFootSide, { transverse_detail_enabled: true, transverse_detail_heights: initH });
        } else {
            updateArchSettings(activeFootSide, { transverse_detail_enabled: true });
        }
    };

    const applyClinicalPattern = (
        axis: 'subtalar' | 'firstRay',
        value: 'pronation' | 'supination' | 'plantarflexion' | 'dorsiflexion',
    ) => {
        const subtalar = axis === 'subtalar'
            ? value as 'pronation' | 'supination'
            : archSettings.subtalar_pattern;
        const firstRay = axis === 'firstRay'
            ? value as 'plantarflexion' | 'dorsiflexion'
            : archSettings.first_ray_pattern;
        updateArchSettings(activeFootSide, {
            medial_detail_enabled: true,
            subtalar_pattern: subtalar,
            first_ray_pattern: firstRay,
            medial_detail_heights: clinicalMedialHeights(
                archSettings.medial_height,
                archSettings,
                landmarkConfig,
                subtalar,
                firstRay,
            ),
        });
    };

    const svgRef = React.useRef<SVGSVGElement>(null);

    // Coordinate helpers
    const mmToPx = (mm: number) => VIEW_HEIGHT - PADDING - (Math.max(0, Math.min(MAX_HEIGHT, mm)) / MAX_HEIGHT) * (VIEW_HEIGHT - 2 * PADDING);
    const pctToPx = (pct: number) => PADDING + (pct / 100) * (VIEW_WIDTH - 2 * PADDING);

    // Helper: Linear Interpolation for Y at X on a curve
    const getYAtX = (points: { x: number, y: number }[], targetX: number) => {
        if (!points || points.length < 2) return null;
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            if ((p1.x <= targetX && p2.x >= targetX) || (p1.x >= targetX && p2.x <= targetX)) {
                if (Math.abs(p2.x - p1.x) < 0.001) return p1.y;
                const t = (targetX - p1.x) / (p2.x - p1.x);
                return p1.y + (p2.y - p1.y) * t;
            }
        }
        return null;
    };

    // Helper: Get Y Range (min, max) at X for a closed polygon (Transverse)
    const getYRangeAtX = (points: { x: number, y: number }[], targetX: number) => {
        if (!points || points.length < 2) return null;
        const intersections: number[] = [];
        for (let i = 0; i < points.length; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];
            if ((p1.x <= targetX && p2.x > targetX) || (p1.x >= targetX && p2.x < targetX)) {
                const t = (targetX - p1.x) / (p2.x - p1.x);
                intersections.push(p1.y + (p2.y - p1.y) * t);
            }
        }
        if (intersections.length < 2) return null;
        intersections.sort((a, b) => a - b);
        return { min: intersections[0], max: intersections[intersections.length - 1] };
    };

    // Helper: Get Outline Y bounds at X
    const getOutlineBoundsAtX = (targetX: number) => {
        return getYRangeAtX(outlinePoints, targetX);
    };

    // --- Simulation Logic (Aligned with Backend geometry_v4.py) ---
    const profileData = useMemo(() => {
        const points: { yPct: number, h: number }[] = [];
        const resolution = 200;

        // Smoothstep function (same as backend)
        const smoothstep = (t: number) => {
            const clamped = Math.max(0, Math.min(1, t));
            return clamped * clamped * (3 - 2 * clamped);
        };

        // Cosine interpolation for wall descent (same as backend)
        const cosineInterp = (t: number) => {
            const clamped = Math.max(0, Math.min(1, t));
            return 0.5 * (1.0 + Math.cos(clamped * Math.PI));
        };

        // Wall height calculation (matching backend generate_wall_profile)
        const getWallHeight = (targetX: number, peakX: number, maxH: number, startX: number, endX: number) => {
            const heelHeight = heelCupHeight + baseThickness * 0.5; // Approximate heel base
            if (targetX <= startX) return heelHeight;
            if (targetX <= peakX) {
                if (peakX > startX) {
                    const t = (targetX - startX) / (peakX - startX);
                    return heelHeight + (maxH - heelHeight) * smoothstep(t);
                }
                return maxH;
            }
            if (targetX <= endX) {
                if (endX > peakX) {
                    const t = (targetX - peakX) / (endX - peakX);
                    return maxH * cosineInterp(t);
                }
                return 0;
            }
            return 0;
        };

        // Arch height calculation (same as backend _calculate_arch_height)
        const getArchHAtX = (targetX: number, start: number, peak: number, end: number, maxH: number) => {
            if (targetX <= start || targetX >= end) return 0;
            if (targetX <= peak) {
                const t = (targetX - start) / (peak - start);
                return maxH * smoothstep(t);
            } else {
                const t = (targetX - peak) / (end - peak);
                return maxH * (1 - smoothstep(t));
            }
        };

        // 横アーチ詳細スプライン評価（STLと同じPCHIP）
        const evaluateTransverseDetail = (x: number): number => {
            const heights = archSettings.transverse_detail_heights ?? [0, 0, 0, 0];
            const { transverse_start, transverse_end } = archSettings;
            const tr = Math.max(1, transverse_end - transverse_start);
            const cl = (v: number) => Math.max(transverse_start + 0.5, Math.min(transverse_end - 0.5, v));
            const nav = cl(landmarkConfig['navicular'] ?? (transverse_start + tr * 0.15));
            const cun = cl(landmarkConfig['medial_cuneiform'] ?? (transverse_start + tr * 0.45));
            const metRaw = landmarkConfig['metatarsal'] ?? (transverse_start + tr * 0.85);
            const mt  = cl((cun + cl(metRaw)) / 2);
            const met = cl(metRaw);
            const xs = [transverse_start, nav, cun, mt, met, transverse_end];
            const ys = [0, heights[0], heights[1], heights[2], heights[3], 0];
            if (x <= transverse_start || x >= transverse_end) return 0;
            if (!xs.every((value, index) => index === 0 || value > xs[index - 1])) return 0;
            return Math.max(0, pchipValue(xs, ys, x));
        };

        // 詳細設定スプライン評価（バックエンド _build_detail_spline と同じPCHIP）
        const evaluateDetailArch = (x: number): number => {
            const heights = archSettings.medial_detail_heights ?? [0, 0, 0, 0];
            const { medial_start, medial_end } = archSettings;
            const sub = landmarkConfig['subtalar'] ?? 30;
            const nav = landmarkConfig['navicular'] ?? 43;
            const cun = landmarkConfig['medial_cuneiform'] ?? 55;
            const m5  = (cun + ((landmarkConfig['metatarsal'] ?? 70) + 1)) / 2;
            const xs = [medial_start, sub, nav, cun, m5, medial_end];
            const ys = [0, heights[0], heights[1], heights[2], heights[3], 0];
            if (x <= medial_start || x >= medial_end) return 0;
            if (!xs.every((value, index) => index === 0 || value > xs[index - 1])) return 0;
            return Math.max(0, pchipValue(xs, ys, x));
        };

        // Get landmark positions
        const medialStart = landmarkConfig['arch_start'] || 15;
        const lateralStart = landmarkConfig['lateral_arch_start'] || 20;
        const metatarsal = landmarkConfig['metatarsal'] || 70;
        const cuboid = landmarkConfig['cuboid'] || 45;

        // Calculate wall heights at current X position
        const innerWallH = getWallHeight(xPercent, medialWallPeakX, medialWallHeight, medialStart, metatarsal);
        const outerWallH = getWallHeight(xPercent, lateralWallPeakX, lateralWallHeight, lateralStart, cuboid);

        // Calculate arch heights at current X position
        // 詳細設定ONのときはスプライン評価値を使用（断面プロファイルをSTLと一致させる）
        const archInner = archSettings.medial_detail_enabled
            ? evaluateDetailArch(xPercent)
            : getArchHAtX(xPercent, archSettings.medial_start, archSettings.medial_peak, archSettings.medial_end, archSettings.medial_height);
        const archOuter = getArchHAtX(xPercent, archSettings.lateral_start, archSettings.lateral_peak, archSettings.lateral_end, archSettings.lateral_height);
        const archTransverseRaw = archSettings.transverse_detail_enabled
            ? evaluateTransverseDetail(xPercent)
            : getArchHAtX(xPercent, archSettings.transverse_start, archSettings.transverse_peak, archSettings.transverse_end, archSettings.transverse_height);
        // 横アーチX方向: プラトー拡大（高い範囲を広くする）
        const maxTransH = archSettings.transverse_height;
        const archTransverse = (archTransverseRaw > 0 && maxTransH > 0)
            ? maxTransH * Math.pow(archTransverseRaw / maxTransH, 0.6)
            : archTransverseRaw;

        // Heel cup profile (simplified)
        const heelCupProfile = xPercent <= 20 ? heelCupHeight * (1 - xPercent / 40) : 0;

        // Current real X in mm (approximate, based on bounds)
        let minX = 0, maxX = 260, minY = 0, maxY = 80;
        if (outlinePoints && outlinePoints.length > 0) {
            const xs = outlinePoints.map(p => p.x);
            const ys = outlinePoints.map(p => p.y);
            minX = Math.min(...xs);
            maxX = Math.max(...xs);
            minY = Math.min(...ys);
            maxY = Math.max(...ys);
        }
        const currentX = minX + (maxX - minX) * (xPercent / 100);

        // Get Curve Intersections at current X
        const medialSolidY = archCurves?.medial
            ? getYAtX(shapePreservingPoints(archCurves.medial, true), currentX)
            : null;
        const medialFlatY = archCurves?.medialFlat
            ? getYAtX(shapePreservingPoints(archCurves.medialFlat), currentX)
            : null;
        const lateralSolidY = archCurves?.lateral
            ? getYAtX(shapePreservingPoints(archCurves.lateral), currentX)
            : null;
        const lateralFlatY = archCurves?.lateralFlat
            ? getYAtX(shapePreservingPoints(archCurves.lateralFlat), currentX)
            : null;

        // Densify transverse polygon for smooth computation (8 ctrl pts → 64 pts via Catmull-Rom)
        const transverseDense = archCurves?.transverse ? densifyClosedPolygon(archCurves.transverse) : null;
        const transverseRange = transverseDense ? getYRangeAtX(transverseDense, currentX) : null;

        // Outline bounds at current X
        const outlineBounds = getOutlineBoundsAtX(currentX);
        const currentYMin = outlineBounds ? outlineBounds.min : minY;
        const currentYMax = outlineBounds ? outlineBounds.max : maxY;
        const currentWidth = currentYMax - currentYMin;
        const widthMm = currentWidth || 80; // Fallback width
        const distHeel = (xPercent / 100) * (maxX - minX); // Fallback length logic

        // Build arch pad polygon Y range at current X for micro-height
        let archPadYRange: { min: number, max: number } | null = null;
        if (archCurves?.heelBridge && archCurves?.lateralBridge && archCurves?.metatarsalBridge &&
            archCurves.heelBridge.length >= 2 && archCurves.lateralBridge.length >= 2 && archCurves.metatarsalBridge.length >= 2) {
            const padPoly: { x: number, y: number }[] = [];
            const smoothHeel = densifyOpenCurve(archCurves.heelBridge);
            const smoothLateral = densifyOpenCurve(archCurves.lateralBridge);
            const smoothMeta = metatarsalFairingPoints(
                archCurves.transverse,
                archCurves.metatarsalBridge,
            );
            padPoly.push(...smoothHeel);
            const outerStartX = smoothHeel[smoothHeel.length - 1].x;
            const outerEndX = smoothLateral[0].x;
            if (Math.abs(outerEndX - outerStartX) > 0.1) {
                for (let s = 1; s <= 20; s++) {
                    const sx = outerStartX + (outerEndX - outerStartX) * s / 21;
                    const b = getOutlineBoundsAtX(sx);
                    if (b) padPoly.push({ x: sx, y: b.max });
                }
            }
            padPoly.push(...smoothLateral);
            padPoly.push(...smoothMeta);
            const innerStartX = smoothMeta[smoothMeta.length - 1].x;
            const innerEndX = smoothHeel[0].x;
            if (Math.abs(innerEndX - innerStartX) > 0.1) {
                for (let s = 1; s <= 20; s++) {
                    const sx = innerStartX + (innerEndX - innerStartX) * s / 21;
                    const b = getOutlineBoundsAtX(sx);
                    if (b) padPoly.push({ x: sx, y: b.min });
                }
            }
            archPadYRange = getYRangeAtX(padPoly, currentX);
        }

        // Saved data is the Bionicsol right-foot reference: MinY=medial, MaxY=lateral.
        // Only the completed left-foot preview is mirrored, matching the final STL.
        const mirrorY = (y: number | null): number | null => {
            if (y === null) return null;
            if (!isRightFoot) {
                return currentYMin + currentYMax - y;
            }
            return y;
        };

        // Apply the display-only final-foot mirror without mutating saved curve data.
        const medialSolidYMirrored = mirrorY(medialSolidY);
        const medialFlatYMirrored = mirrorY(medialFlatY);
        const lateralSolidYMirrored = mirrorY(lateralSolidY);
        const lateralFlatYMirrored = mirrorY(lateralFlatY);

        const transverseRangeMirrored = transverseRange && !isRightFoot
            ? { min: currentYMin + currentYMax - transverseRange.max, max: currentYMin + currentYMax - transverseRange.min }
            : transverseRange;
        const archPadYRangeMirrored = archPadYRange && !isRightFoot
            ? { min: currentYMin + currentYMax - archPadYRange.max, max: currentYMin + currentYMax - archPadYRange.min }
            : archPadYRange;
        // Dynamic heel cup region (same as backend)
        for (let i = 0; i <= resolution; i++) {
            const yPct = (i / resolution) * 100;
            const yRatio = yPct / 100;
            const currentY = currentYMin + yRatio * currentWidth;

            // Right final mesh is mirrored: MinY=medial. Left remains canonical: MaxY=medial.
            const archYRatio = isRightFoot ? (1.0 - yRatio) : yRatio;

            // Dynamic heel cup region based on Y position (same as backend)
            const heelCupRegion = lateralStart * (1 - archYRatio) + medialStart * archYRatio;

            // Calculate arch height based on Y position (NEW LOGIC)
            let medialArchHeight = 0;
            let lateralArchHeight = 0;
            let transverseArchHeight = 0;

            const medialEdge = isRightFoot ? currentYMin : currentYMax;
            const lateralEdge = isRightFoot ? currentYMax : currentYMin;
            // Mirrors _band_profile_height in geometry_v4_frontend.py. The bias moves
            // where the band does its falling: 1.0 drops hardest at the solid boundary,
            // higher values drop just inside the dashed one and land tangentially on
            // the solid one. Medial and lateral carry their own value. Keep this in
            // step with the engine.
            const bandProfile = (t: number, maxHeight: number, dropBias: number) => {
                if (t <= 0) return 0;
                const drop = 0.15;
                const bias = Math.min(Math.max(dropBias, 1), 4);
                const biased = bias === 1 ? t : Math.pow(t, bias);
                const capped = Math.min(biased, 6);
                return maxHeight * (1 - Math.pow(drop, capped)) / (1 - Math.pow(drop, 6));
            };

            // 1. Medial Arch
            if (medialSolidYMirrored !== null && medialFlatYMirrored !== null) {
                const flatMin = Math.min(medialFlatYMirrored, medialEdge);
                const flatMax = Math.max(medialFlatYMirrored, medialEdge);

                if (currentY >= flatMin && currentY <= flatMax) {
                    const denom = medialFlatYMirrored - medialSolidYMirrored;
                    medialArchHeight = Math.abs(denom) > 0.01
                        ? bandProfile((currentY - medialSolidYMirrored) / denom, archInner, medialBandDropBias)
                        : 0;
                } else {
                    const denom = medialFlatYMirrored - medialSolidYMirrored;
                    if (Math.abs(denom) > 0.01) {
                        const t = (currentY - medialSolidYMirrored) / denom;
                        medialArchHeight = bandProfile(t, archInner, medialBandDropBias);
                    }
                }
            } else {
                // Fallback Logic
                const medialYStart = archSettings.medial_y_start / 100;
                const medialYEnd = archSettings.medial_y_end / 100;
                if (archYRatio >= medialYStart) {
                    const yRange = medialYEnd - medialYStart;
                    if (yRange > 0) {
                        const innerFactor = Math.min(1.0, (archYRatio - medialYStart) / yRange);
                        medialArchHeight = archInner * innerFactor;
                    } else {
                        medialArchHeight = archInner;
                    }
                }
            }

            // 2. Lateral Arch
            if (lateralSolidYMirrored !== null && lateralFlatYMirrored !== null) {
                const flatMin = Math.min(lateralFlatYMirrored, lateralEdge);
                const flatMax = Math.max(lateralFlatYMirrored, lateralEdge);

                if (currentY >= flatMin && currentY <= flatMax) {
                    const denom = lateralFlatYMirrored - lateralSolidYMirrored;
                    lateralArchHeight = Math.abs(denom) > 0.01
                        ? bandProfile((currentY - lateralSolidYMirrored) / denom, archOuter, lateralBandDropBias)
                        : 0;
                } else {
                    const denom = lateralFlatYMirrored - lateralSolidYMirrored;
                    if (Math.abs(denom) > 0.01) {
                        const t = (currentY - lateralSolidYMirrored) / denom;
                        lateralArchHeight = bandProfile(t, archOuter, lateralBandDropBias);
                    }
                }
            } else {
                // Fallback Logic
                const lateralYStart = archSettings.lateral_y_start / 100;
                const lateralYEnd = archSettings.lateral_y_end / 100;
                if (archYRatio <= lateralYEnd) {
                    const yRange = lateralYEnd - lateralYStart;
                    if (yRange > 0) {
                        const outerFactor = Math.max(0, 1.0 - ((archYRatio - lateralYStart) / yRange));
                        lateralArchHeight = archOuter * outerFactor;
                    } else {
                        lateralArchHeight = archOuter;
                    }
                }
            }

            // 3. Transverse Arch
            if (transverseRangeMirrored) {
                // ポリゴン内: 中心からのS-curveフォールオフ（バックエンドと同期）
                if (currentY >= transverseRangeMirrored.min && currentY <= transverseRangeMirrored.max) {
                    const center = (transverseRangeMirrored.min + transverseRangeMirrored.max) / 2;
                    const half = (transverseRangeMirrored.max - transverseRangeMirrored.min) / 2;
                    if (half > 0) {
                        const f = Math.max(0, 1.0 - Math.abs(currentY - center) / half);
                        transverseArchHeight = archTransverse * smoothstep(f);
                    }
                }
            } else {
                // Fallback Logic
                const transverseYStart = archSettings.transverse_y_start / 100;
                const transverseYEnd = archSettings.transverse_y_end / 100;
                if (archTransverse > 0 && archYRatio >= transverseYStart && archYRatio <= transverseYEnd) {
                    const center = (transverseYStart + transverseYEnd) / 2;
                    const halfRange = (transverseYEnd - transverseYStart) / 2;
                    if (halfRange > 0) {
                        const centerDist = Math.abs(archYRatio - center);
                        const transverseFactor = smoothstep(Math.max(0, 1.0 - (centerDist / halfRange)));
                        transverseArchHeight = archTransverse * transverseFactor;
                    }
                }
            }

            const smoothUnion = (a: number, b: number) => Math.pow(Math.pow(Math.max(0, a), 6) + Math.pow(Math.max(0, b), 6), 1 / 6);
            const longitudinalArchHeight = smoothUnion(medialArchHeight, lateralArchHeight);
            let archH = smoothUnion(longitudinalArchHeight, transverseArchHeight);

            // Micro-height floor for arch pad area (prevents dip to 0mm between arches)
            if (archPadYRangeMirrored && currentY >= archPadYRangeMirrored.min && currentY <= archPadYRangeMirrored.max) {
                const microHeightX = Math.max(archInner, archOuter, archTransverse);
                if (microHeightX > 0) {
                    const maxArchH = Math.max(archSettings.medial_height, archSettings.lateral_height, 0.01);
                    const normalized = Math.min(1.0, microHeightX / maxArchH);
                    let microH = 0.4 * normalized;

                    const distToEdge = Math.min(currentY - archPadYRangeMirrored.min, archPadYRangeMirrored.max - currentY);
                    const falloffDist = 3.0;
                    if (distToEdge > 0 && distToEdge < falloffDist) {
                        microH *= smoothstep(distToEdge / falloffDist);
                    } else if (distToEdge <= 0) {
                        microH = 0;
                    }

                    archH = Math.max(archH, microH);
                }
            }

            // Wall height interpolated by Y position (same as backend line 691)
            let wallH = outerWallH * (1 - archYRatio) + innerWallH * archYRatio;

            // Y-direction transition distance (バックエンドと同期: 10mm)
            // Reach and power are coupled so the entry angle at the rim stays
            // fixed while the tail lengthens. The falloff runs over
            // (reach - offset), so the exponent scales with that, not reach.
            const WALL_DISH_REACH_MM = wallDishReach;
            const WALL_FALLOFF_POWER = (2.0 / 9.5) * (WALL_DISH_REACH_MM - 0.5);
            const transitionDistance = WALL_DISH_REACH_MM;
            const transitionOffset = 0.5;

            // Distance from edges in mm
            const distFromOuter = Math.abs(currentY - lateralEdge);
            const distFromInner = Math.abs(currentY - medialEdge);

            // Y-blend calculation: 0-0.5mm垂直、0.5-10mmでsmoothstep
            let yBlend = 1.0;
            const distFromEdge = Math.min(distFromInner, distFromOuter);
            if (distFromEdge < transitionOffset) {
                yBlend = 0.0;
            } else if (distFromEdge < transitionDistance) {
                const rawT = Math.min(1, Math.max(0, (distFromEdge - transitionOffset) / (transitionDistance - transitionOffset)));
                yBlend = 1 - Math.pow(1 - rawT, WALL_FALLOFF_POWER);
            }

            // X-blend calculation (heel cup region)
            let xBlend = 1.0;
            const xTransition = WALL_DISH_REACH_MM;
            if (xPercent <= heelCupRegion && distHeel < xTransition) {
                if (distHeel < transitionOffset) {
                    xBlend = 0.0;
                } else {
                    const rawT = Math.min(1, Math.max(0, (distHeel - transitionOffset) / (xTransition - transitionOffset)));
                    xBlend = 1 - Math.pow(1 - rawT, WALL_FALLOFF_POWER);
                }
            }

            // Final blend
            const blend = Math.min(yBlend, xBlend);

            // Add heel cup to wall height
            if (xPercent <= heelCupRegion) {
                const xFactor = 1.0 - (xPercent / heelCupRegion);
                wallH += heelCupProfile * xFactor;
            }

            // p-norm smooth max, matching the engine: the wall term fades with
            // blend but the arch is no longer crossfaded away against it.
            const wallTerm = Math.max(0, wallH * (1 - blend));
            const blendedHeight = Math.pow(
                Math.pow(wallTerm, 6) + Math.pow(Math.max(0, archH), 6), 1 / 6);
            let totalH = baseThickness + blendedHeight;
            if (totalH < baseThickness) totalH = baseThickness;

            points.push({ yPct, h: totalH });
        }
        return points;
    }, [xPercent, baseThickness, heelCupHeight, medialWallHeight, medialWallPeakX, lateralWallHeight, lateralWallPeakX, archSettings, landmarkConfig, isRightFoot, archCurves, outlinePoints, wallDishReach, medialBandDropBias, lateralBandDropBias, wallFirstStageDeg]);

    // --- Underside of the section --------------------------------------
    // Mirrors core/geometry_v4_frontend.py: the bottom outline is pulled inside
    // the top one for shoe clearance, the side wall takes a two-stage path
    // wherever that offset is wide, and the bottom corner carries a fillet that
    // fades out over the same offset (there is no 90 degree corner to round on
    // a shallow ramp).
    const ss = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
    const ROUND_WALL_FULL_MM = 1.5;
    const ROUND_MAX_FRACTION = 0.7;
    const WALL_POWER_MIN = 3.0;
    const WALL_POWER_MAX = 14.0;
    const WALL_RAMP_MIX_MAX = 0.7;
const WALL_STAGE_BLEND_POWER = 6;
// Most of the climb the straight first stage may claim, so a steep setting cannot
// swallow the second stage and leave a flat shelf. Mirrors the engine.
const WALL_FIRST_STAGE_MAX_SHARE = 0.8;
const WALL_STRAIGHT_BLEND_MM = 12.0;

    const edgeRadiusMm = (h: number, offsetMm: number) => {
        if (bottomRounding <= 0) return 0;
        const wall = Math.max(0, h - baseThickness);
        return Math.min(bottomRounding * ss(wall / ROUND_WALL_FULL_MM), h * ROUND_MAX_FRACTION);
    };
    // The arc turns through the LOCAL wall angle, so a shallow clearance ramp
    // gets a small break instead of a quarter circle standing the rim up.
    const wallStartAngle = (offsetMm: number, rimZ: number) => {
        const rise = Math.max(0, rimZ);
        const firstSlope = Math.min(
            Math.tan((Math.max(0, wallFirstStageDeg) * Math.PI) / 180),
            (WALL_FIRST_STAGE_MAX_SHARE * rise) / Math.max(offsetMm, 1e-9),
        );
        return Math.max(
            Math.atan2(rise * (1 - rampMix(offsetMm)), Math.max(offsetMm, 1e-9)),
            Math.atan(firstSlope),
        );
    };

    // Mirrors _wall_z in core/geometry_v4_frontend.py. Two stages combined with a
    // smooth maximum: a straight climb out of the floor at wallFirstStageDeg, and
    // the eased curve that lands on the top rim. A single curve cannot be steep at
    // the bottom - the rise is fixed and the run is whatever the clearance gives -
    // so where the clearance opens the eased curve alone fell to about 5 degrees.
    // Keep this in step with the engine.
    const rampMix = (offsetMm: number) =>
        WALL_RAMP_MIX_MAX * ss(offsetMm / WALL_STRAIGHT_BLEND_MM);
    const wallZ = (
        q: number, baseZ: number, rimZ: number, power: number, mix: number,
        offsetMm: number,
    ) => {
        const rise = Math.max(0, rimZ - baseZ);
        const qq = Math.max(0, q);
        const eased = rise * ((1 - mix) * qq + mix * Math.pow(qq, power));
        const deg = Math.max(0, wallFirstStageDeg);
        if (deg <= 0) return baseZ + eased;
        const slope = Math.min(
            Math.tan((deg * Math.PI) / 180),
            (WALL_FIRST_STAGE_MAX_SHARE * rise) / Math.max(offsetMm, 1e-9),
        );
        const first = Math.min(rise, slope * offsetMm * qq);
        const n = WALL_STAGE_BLEND_POWER;
        const blended = Math.pow(
            Math.pow(Math.max(0, first), n) + Math.pow(Math.max(0, eased), n), 1 / n);
        return baseZ + Math.min(rise, blended);
    };

    const outlineXs = outlinePoints.length > 0 ? outlinePoints.map(pt => pt.x) : [0, 260];
    const sectionX = Math.min(...outlineXs)
        + (Math.max(...outlineXs) - Math.min(...outlineXs)) * (xPercent / 100);
    const sectionBounds = getOutlineBoundsAtX(sectionX);
    const sectionWidthMm = sectionBounds ? (sectionBounds.max - sectionBounds.min) : 80;
    const mmToPct = (mm: number) => (sectionWidthMm > 0 ? (mm / sectionWidthMm) * 100 : 0);

    // Bottom outline position at this X, expressed in the view's 0..100 scale.
    const bottomBounds = bottomOutlinePoints.length > 2
        ? getYRangeAtX(bottomOutlinePoints, sectionX) : null;
    const toViewPct = (y: number) => {
        if (!sectionBounds || sectionWidthMm <= 0) return 0;
        const pct = ((y - sectionBounds.min) / sectionWidthMm) * 100;
        return isRightFoot ? pct : 100 - pct;
    };
    let bottomLeftPct = 0;
    let bottomRightPct = 100;
    if (bottomBounds && sectionBounds) {
        const a = toViewPct(bottomBounds.min);
        const b = toViewPct(bottomBounds.max);
        bottomLeftPct = Math.max(0, Math.min(a, b));
        bottomRightPct = Math.min(100, Math.max(a, b));
    }
    const offsetLeftMm = (bottomLeftPct / 100) * sectionWidthMm;
    const offsetRightMm = ((100 - bottomRightPct) / 100) * sectionWidthMm;

    const hLeft = profileData[0].h;
    const hRight = profileData[profileData.length - 1].h;
    const rLeftMm = edgeRadiusMm(hLeft, offsetLeftMm);
    const rRightMm = edgeRadiusMm(hRight, offsetRightMm);

    // Top surface height at a given view pct, for the clearance clamp below.
    const topAtPct = (pct: number) => {
        const t = Math.max(0, Math.min(1, pct / 100)) * (profileData.length - 1);
        const i = Math.min(profileData.length - 2, Math.floor(t));
        const f = t - i;
        return profileData[i].h * (1 - f) + profileData[i + 1].h * f;
    };
    // Mirrors MIN_WALL_CLEARANCE_MM / WALL_CLEARANCE_RAMP_MM: the wall is kept
    // clear of the top surface, ramped in from the rim so the edge tapers
    // instead of ending in a clearance-tall vertical lip.
    const MIN_WALL_CLEARANCE_MM = 2.0;
    const WALL_CLEARANCE_RAMP_MM = 1.5;

    // Exponent that keeps the wall under the top surface, mirroring
    // _wall_power_from_ceiling: q**p <= (ceiling - base)/(rim - base).
    const WALL_STEPS = 14;
    const wallPower = (fromPct: number, toPct: number, offsetMm: number,
                       baseZ: number, rimZ: number) => {
        const rise = Math.max(1e-6, rimZ - baseZ);
        let p = WALL_POWER_MIN;
        for (let k = 1; k < WALL_STEPS; k++) {
            const q = k / WALL_STEPS;
            const pct = fromPct + (toPct - fromPct) * q;
            const depth = (1 - q) * offsetMm;
            const clearance = MIN_WALL_CLEARANCE_MM * ss(depth / WALL_CLEARANCE_RAMP_MM);
            const ratio = Math.min(1, Math.max(1e-6, (topAtPct(pct) - clearance - baseZ) / rise));
            const mix = rampMix(offsetMm);
            const headroom = ratio - (1 - mix) * q;
            p = Math.max(p, headroom > 0
                ? Math.log(Math.min(1, Math.max(1e-6, headroom / Math.max(mix, 1e-6)))) / Math.log(q)
                : WALL_POWER_MAX);
        }
        return Math.min(WALL_POWER_MAX, p);
    };

    const wallPoints = (fromPct: number, toPct: number, offsetMm: number,
                        baseZ: number, rimZ: number) => {
        const power = wallPower(fromPct, toPct, offsetMm, baseZ, rimZ);
        const out: { pct: number; z: number }[] = [];
        for (let k = 1; k <= WALL_STEPS; k++) {
            const q = k / WALL_STEPS;
            out.push({
                pct: fromPct + (toPct - fromPct) * q,
                z: wallZ(q, baseZ, rimZ, power, rampMix(offsetMm), offsetMm),
            });
        }
        return out;
    };

    const aLeft = wallStartAngle(offsetLeftMm, hLeft);
    const aRight = wallStartAngle(offsetRightMm, hRight);
    // Horizontal reach of the arc and how far it lifts the rim.
    const runLeftMm = rLeftMm * Math.sin(aLeft);
    const runRightMm = rRightMm * Math.sin(aRight);
    const liftLeftMm = rLeftMm * (1 - Math.cos(aLeft));
    const liftRightMm = rRightMm * (1 - Math.cos(aRight));
    const rLeftPct = mmToPct(runLeftMm);
    const rRightPct = mmToPct(runRightMm);
    const arcRx = (pct: number) => Math.abs(pctToPx(pct) - pctToPx(0));
    const arcRy = (mm: number) => Math.abs(mmToPx(0) - mmToPx(mm));

    const lineTo = (pts: { pct: number; z: number }[]) =>
        pts.map(q => `L ${pctToPx(q.pct)} ${mmToPx(q.z)}`).join(' ');

    // Left fillet, left wall up, top surface, right wall down, right fillet.
    const pathD =
        `M ${pctToPx(bottomLeftPct + rLeftPct)} ${mmToPx(0)} ` +
        (runLeftMm > 0.01
            ? `A ${arcRx(mmToPct(rLeftMm))} ${arcRy(rLeftMm)} 0 0 1 ${pctToPx(bottomLeftPct)} ${mmToPx(liftLeftMm)} `
            : `L ${pctToPx(bottomLeftPct)} ${mmToPx(0)} `) +
        lineTo(wallPoints(bottomLeftPct, 0, offsetLeftMm, liftLeftMm, hLeft)) + ' ' +
        profileData.map(p => `L ${pctToPx(p.yPct)} ${mmToPx(p.h)}`).join(' ') + ' ' +
        lineTo(
            wallPoints(bottomRightPct, 100, offsetRightMm, liftRightMm, hRight)
                .slice(0, -1).reverse()
        ) + ' ' +
        (runRightMm > 0.01
            ? `L ${pctToPx(bottomRightPct)} ${mmToPx(liftRightMm)} A ${arcRx(mmToPct(rRightMm))} ${arcRy(rRightMm)} 0 0 1 ${pctToPx(bottomRightPct - rRightPct)} ${mmToPx(0)}`
            : `L ${pctToPx(bottomRightPct)} ${mmToPx(0)}`);

    // Width-wise boundaries
    const yBoundaries = [
        { id: 'lat', x: archSettings.lateral_y_end, label: '外側境界' },
        { id: 'med', x: archSettings.medial_y_start, label: '内側境界' }
    ];

    // 横アーチ詳細設定用 X 座標（バックエンドと同じ計算）
    const detailTransStart   = archSettings.transverse_start;
    const detailTransEnd     = archSettings.transverse_end;
    const detailTransRange   = Math.max(1, detailTransEnd - detailTransStart);
    const clampTrans = (v: number) => Math.max(detailTransStart + 0.5, Math.min(detailTransEnd - 0.5, v));
    const detailTransNav  = clampTrans(landmarkConfig['navicular'] ?? (detailTransStart + detailTransRange * 0.15));
    const detailTransCun  = clampTrans(landmarkConfig['medial_cuneiform'] ?? (detailTransStart + detailTransRange * 0.45));
    const detailTransMetR = landmarkConfig['metatarsal'] ?? (detailTransStart + detailTransRange * 0.85);
    const detailTransMt   = clampTrans((detailTransCun + clampTrans(detailTransMetR)) / 2);
    const detailTransMet  = clampTrans(detailTransMetR);
    const detailTransXPcts = [detailTransNav, detailTransCun, detailTransMt, detailTransMet];

    // 内側縦アーチ詳細設定用のランドマーク位置（xPercents として渡す）
    const detailSub    = landmarkConfig['subtalar'] ?? 30;
    const detailNav    = landmarkConfig['navicular'] ?? 43;
    const detailCun    = landmarkConfig['medial_cuneiform'] ?? 55;
    const detailM5     = (detailCun + ((landmarkConfig['metatarsal'] ?? 70) + 1)) / 2;
    const detailXPcts  = [detailSub, detailNav, detailCun, detailM5];

    const sortedLandmarks = useMemo(() => {
        const list = Object.entries(landmarkConfig).map(([id, pct]) => ({
            id,
            pct,
            label: LM_LABELS[id] || id
        }));
        list.push({ id: 'peak_med', pct: archSettings.medial_peak, label: '▲内ピーク' });
        list.push({ id: 'peak_lat', pct: archSettings.lateral_peak, label: '▲外ピーク' });
        list.push({ id: 'peak_trn', pct: archSettings.transverse_peak, label: '▲横ピーク' });
        return list.sort((a, b) => a.pct - b.pct);
    }, [landmarkConfig, archSettings]);

    return (
        <>
        <Card className="mb-8 border-border shadow-none">
            <CardHeader className="pb-2">
                <div className="flex justify-between items-center">
                    <CardTitle className="flex items-center gap-2">
                        断面プロファイル
                        <span className={`text-xs px-2 py-0.5 rounded border ${isRightFoot ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-green-500/10 text-green-400 border-green-500/20'}`}>
                            {isRightFoot ? '右足 (Right)' : '左足 (Left)'}
                        </span>
                    </CardTitle>
                    <span className="text-sm font-mono bg-muted/50 px-2 py-1 rounded text-muted-foreground">X = {xPercent}%</span>
                </div>
                <CardDescription>サイドバーのスライダー調整がリアルタイムに反映されます。</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="mb-2">
                    <input
                        type="range"
                        min="0" max="100" step="1"
                        value={xPercent}
                        onChange={(e) => setXPercent(parseInt(e.target.value))}
                        className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    />

                    <div className="relative w-full h-8 mt-2 text-[9px] text-muted-foreground select-none">
                        {sortedLandmarks.map((lm, i) => {
                            const isPeak = lm.id.startsWith('peak');
                            const style = { left: `${lm.pct}%`, transform: 'translateX(-50%)' };
                            return (
                                <div key={i} className={`absolute flex flex-col items-center ${isPeak ? 'top-[-20px] z-10' : 'top-0'}`} style={style}>
                                    {!isPeak && <div className="h-1 w-px bg-border mb-0.5"></div>}
                                    <span className={`${isPeak ? 'text-primary font-bold bg-card px-1 border border-primary/20 rounded text-[8px]' : ''}`}>
                                        {lm.label}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="relative w-full h-[240px] border border-border rounded bg-card overflow-hidden mt-6">
                    <svg ref={svgRef} viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} className="w-full h-full select-none">
                        {[0, 5, 10, 15, 20].map(h => (
                            <g key={h}>
                                <line x1={PADDING} y1={mmToPx(h)} x2={VIEW_WIDTH - PADDING} y2={mmToPx(h)} stroke="hsl(var(--border))" strokeOpacity="0.3" />
                                <text x={PADDING - 5} y={mmToPx(h) + 3} textAnchor="end" className="text-[8px] fill-muted-foreground font-mono">{h}mm</text>
                            </g>
                        ))}
                        <rect x={PADDING} y={mmToPx(baseThickness)} width={VIEW_WIDTH - 2 * PADDING} height={mmToPx(0) - mmToPx(baseThickness)} fill="hsl(var(--muted))" fillOpacity="0.2" stroke="hsl(var(--border))" strokeDasharray="2 2" />
                        {yBoundaries.map(b => {
                            const screenX = pctToPx(isRightFoot ? (100 - b.x) : b.x);
                            return (
                                <g key={b.id}>
                                    <line x1={screenX} y1={PADDING} x2={screenX} y2={VIEW_HEIGHT - PADDING} stroke="hsl(var(--muted-foreground))" strokeOpacity="0.5" strokeWidth="1" strokeDasharray="4 2" />
                                    <text x={screenX} y={PADDING - 5} textAnchor="middle" className="text-[9px] fill-muted-foreground font-bold">{b.x.toFixed(1)}%</text>
                                    <text x={screenX} y={VIEW_HEIGHT - PADDING + 12} textAnchor="middle" className="text-[8px] fill-muted-foreground">{b.label}</text>
                                </g>
                            );
                        })}
                        <path d={`${pathD} L ${pctToPx(bottomLeftPct + rLeftPct)} ${mmToPx(0)} Z`} fill="hsl(var(--primary))" fillOpacity="0.1" />
                        <path d={pathD} fill="none" stroke="hsl(var(--primary))" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        <text x={PADDING} y={VIEW_HEIGHT - 10} className="text-[9px] font-bold fill-muted-foreground uppercase tracking-wider">{isRightFoot ? 'Medial' : 'Lateral'}</text>
                        <text x={VIEW_WIDTH - PADDING} y={VIEW_HEIGHT - 10} textAnchor="end" className="text-[9px] font-bold fill-muted-foreground uppercase tracking-wider">{isRightFoot ? 'Lateral' : 'Medial'}</text>
                    </svg>
                </div>
            </CardContent>
        </Card>

        <Card className="mt-4 border-border/50 shadow-none">
            <CardHeader className="pb-3">
                <CardTitle className="text-sm">内側縦アーチ 臨床パターン</CardTitle>
                <CardDescription>選択中の内側アーチ高に比例して、ランドマーク別の高さを自動設定します。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <div>
                    <Label className="text-xs text-muted-foreground">距骨下関節</Label>
                    <div className="mt-1 flex gap-2">
                        {(['pronation', 'supination'] as const).map((pattern) => (
                            <Button
                                key={pattern}
                                type="button"
                                size="sm"
                                variant={archSettings.subtalar_pattern === pattern ? 'default' : 'outline'}
                                onClick={() => applyClinicalPattern('subtalar', pattern)}
                            >
                                {pattern === 'pronation' ? '回内' : '回外'}
                            </Button>
                        ))}
                        {archSettings.subtalar_pattern === 'custom' && <span className="self-center text-xs text-muted-foreground">カスタム</span>}
                    </div>
                </div>
                <div>
                    <Label className="text-xs text-muted-foreground">第1列</Label>
                    <div className="mt-1 flex gap-2">
                        {(['plantarflexion', 'dorsiflexion'] as const).map((pattern) => (
                            <Button
                                key={pattern}
                                type="button"
                                size="sm"
                                variant={archSettings.first_ray_pattern === pattern ? 'default' : 'outline'}
                                onClick={() => applyClinicalPattern('firstRay', pattern)}
                            >
                                {pattern === 'plantarflexion' ? '底屈' : '背屈'}
                            </Button>
                        ))}
                        {archSettings.first_ray_pattern === 'custom' && <span className="self-center text-xs text-muted-foreground">カスタム</span>}
                    </div>
                </div>
            </CardContent>
        </Card>

        {/* 詳細設定 - 断面プロファイルの下 */}
        <div className="mt-4">
            <div className="flex items-center gap-3 mb-3">
                <Switch
                    id="medial-detail-toggle"
                    checked={archSettings.medial_detail_enabled ?? false}
                    onCheckedChange={handleDetailToggle}
                />
                <Label htmlFor="medial-detail-toggle" className="text-sm font-semibold cursor-pointer">
                    詳細設定（内側縦アーチ ランドマーク別高さ）
                </Label>
            </div>
            {archSettings.medial_detail_enabled && (
                    <Card className="border-border/50 shadow-none">
                        <CardContent className="pt-4 pb-3">
                            <p className="text-[10px] text-muted-foreground mb-3 uppercase tracking-wider font-bold">
                                各ランドマークの高さをドラッグして調整
                            </p>
                            <MedialDetailHeightEditor
                                heights={archSettings.medial_detail_heights ?? [0, 0, 0, 0]}
                                xPercents={detailXPcts}
                                startPct={archSettings.medial_start}
                                endPct={archSettings.medial_end}
                                maxH={Math.max(10, archSettings.medial_height + 2)}
                                onChange={(h) => updateArchSettings(activeFootSide, {
                                    medial_detail_heights: h,
                                    subtalar_pattern: 'custom',
                                    first_ray_pattern: 'custom',
                                })}
                            />
                        </CardContent>
                    </Card>
                )}
        </div>

        {/* 横アーチ詳細設定 */}
        <div className="mt-4">
            <div className="flex items-center gap-3 mb-3">
                <Switch
                    id="transverse-detail-toggle"
                    checked={archSettings.transverse_detail_enabled ?? false}
                    onCheckedChange={handleTransverseDetailToggle}
                />
                <Label htmlFor="transverse-detail-toggle" className="text-sm font-semibold cursor-pointer">
                    詳細設定（横アーチ ランドマーク別高さ）
                </Label>
            </div>
            {archSettings.transverse_detail_enabled && (
                <Card className="border-border/50 shadow-none">
                    <CardContent className="pt-4 pb-3">
                        <p className="text-[10px] text-muted-foreground mb-3 uppercase tracking-wider font-bold">
                            各ランドマークの高さをドラッグして調整
                        </p>
                        <MedialDetailHeightEditor
                            heights={archSettings.transverse_detail_heights ?? [0, 0, 0, 0]}
                            xPercents={detailTransXPcts}
                            startPct={archSettings.transverse_start}
                            endPct={archSettings.transverse_end}
                            maxH={Math.max(10, archSettings.transverse_height + 2)}
                            pointLabels={['Nav', 'Cun', 'MT', 'Met']}
                            onChange={(h) => updateArchSettings(activeFootSide, { transverse_detail_heights: h })}
                        />
                    </CardContent>
                </Card>
            )}
        </div>
        </>
    );
}

// --- Main Component ---
export default function ArchAdjustmentCanvas() {
    return (
        <div className="w-full h-full overflow-y-auto">
            <div className="p-6 max-w-3xl mx-auto pb-16">
                <CrossSectionViewer />
            </div>
        </div>
    );
}
