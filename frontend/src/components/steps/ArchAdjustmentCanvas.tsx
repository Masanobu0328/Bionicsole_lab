'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { densifyClosedPolygon, densifyOpenCurve } from '@/lib/geometry-utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Info } from 'lucide-react';
import MedialDetailHeightEditor from '@/components/steps/MedialDetailHeightEditor';

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
        medialWallHeight, medialWallPeakX,
        lateralWallHeight, lateralWallPeakX,
        archSettingsRight, archSettingsLeft,
        activeFootSide,
        updateArchSettings,
        landmarkConfig,
        archCurves,
        outlinePoints,
    } = useStore();

    // Select settings based on active side
    const archSettings = activeFootSide === 'right' ? archSettingsRight : archSettingsLeft;
    const isRightFoot = activeFootSide === 'right';

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

        // 各ランドマーク位置でのベルカーブ高さを再計算して詳細設定に反映
        const sub    = landmarkConfig['subtalar'] ?? 30;
        const nav    = landmarkConfig['navicular'] ?? 43;
        const cun    = landmarkConfig['medial_cuneiform'] ?? 55;
        const mb1Pct = (landmarkConfig['metatarsal'] ?? 70) + 1;
        const m5Pct  = (cun + mb1Pct) / 2;
        const newH = [sub, nav, cun, m5Pct].map(x =>
            Math.round(bellCurveH(x, currStart, currPeak, currEnd, currH) * 10) / 10
        );
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

        // 横アーチ詳細スプライン評価（バックエンドと同じ制御点・Catmull-Rom近似）
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
            let i = 0;
            for (; i < xs.length - 2; i++) { if (x <= xs[i + 1]) break; }
            const dx = xs[i + 1] - xs[i];
            if (dx <= 0) return ys[i];
            const t = (x - xs[i]) / dx;
            const m1 = i > 0 ? ((ys[i+1] - ys[i-1]) / (xs[i+1] - xs[i-1])) * dx : 0;
            const m2 = i < xs.length - 2 ? ((ys[i+2] - ys[i]) / (xs[i+2] - xs[i])) * dx : 0;
            const h00 = 2*t*t*t - 3*t*t + 1;
            const h10 = t*t*t - 2*t*t + t;
            const h01 = -2*t*t*t + 3*t*t;
            const h11 = t*t*t - t*t;
            return Math.max(0, h00*ys[i] + h10*m1 + h01*ys[i+1] + h11*m2);
        };

        // 詳細設定スプライン評価（バックエンド _build_detail_spline と同じ制御点・Catmull-Rom近似）
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
            let i = 0;
            for (; i < xs.length - 2; i++) { if (x <= xs[i + 1]) break; }
            const dx = xs[i + 1] - xs[i];
            if (dx <= 0) return ys[i];
            const t = (x - xs[i]) / dx;
            // Catmull-Rom 接線（両端クランプ = 0）
            const m1 = i > 0 ? ((ys[i+1] - ys[i-1]) / (xs[i+1] - xs[i-1])) * dx : 0;
            const m2 = i < xs.length - 2 ? ((ys[i+2] - ys[i]) / (xs[i+2] - xs[i])) * dx : 0;
            const h00 = 2*t*t*t - 3*t*t + 1;
            const h10 = t*t*t - 2*t*t + t;
            const h01 = -2*t*t*t + 3*t*t;
            const h11 = t*t*t - t*t;
            return Math.max(0, h00*ys[i] + h10*m1 + h01*ys[i+1] + h11*m2);
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
        const medialSolidY = archCurves?.medial ? getYAtX(archCurves.medial, currentX) : null;
        const medialFlatY = archCurves?.medialFlat ? getYAtX(archCurves.medialFlat, currentX) : null;
        const lateralSolidY = archCurves?.lateral ? getYAtX(archCurves.lateral, currentX) : null;
        const lateralFlatY = archCurves?.lateralFlat ? getYAtX(archCurves.lateralFlat, currentX) : null;

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
            const smoothMeta = densifyOpenCurve(archCurves.metatarsalBridge);
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

        // Mirror Y coordinate for left foot
        const mirrorY = (y: number | null): number | null => {
            if (y === null) return null;
            if (!isRightFoot) {
                return currentYMin + currentYMax - y;
            }
            return y;
        };

        // Apply mirroring to curve Y values for left foot
        const medialSolidYMirrored = mirrorY(medialSolidY);
        const medialFlatYMirrored = mirrorY(medialFlatY);
        const lateralSolidYMirrored = mirrorY(lateralSolidY);
        const lateralFlatYMirrored = mirrorY(lateralFlatY);

        // Mirror transverse ranges for left foot
        const transverseRangeMirrored = transverseRange && !isRightFoot
            ? { min: currentYMin + currentYMax - transverseRange.max, max: currentYMin + currentYMax - transverseRange.min }
            : transverseRange;
        // Dynamic heel cup region (same as backend)
        for (let i = 0; i <= resolution; i++) {
            const yPct = (i / resolution) * 100;
            const yRatio = yPct / 100;
            const currentY = currentYMin + yRatio * currentWidth;

            // arch_y_ratio: Backend uses this for left/right foot handling
            // FIX: Right Foot Baseline (MinY=Medial)
            // Right: yRatio=0 (MinY) -> archYRatio=1 (Inner)
            // Left: yRatio=0 (MinY) -> archYRatio=0 (Outer, Lateral)
            const archYRatio = isRightFoot ? (1.0 - yRatio) : yRatio;

            // Dynamic heel cup region based on Y position (same as backend)
            const heelCupRegion = lateralStart * (1 - archYRatio) + medialStart * archYRatio;

            // Calculate arch height based on Y position (NEW LOGIC)
            let longitudinalArchHeight = 0;
            let transverseArchHeight = 0;

            // Edge Definition (Right Foot Priority)
            // Right Foot: Medial Edge is MinY.
            // Left Foot: Medial Edge is MaxY.
            const medialEdge = isRightFoot ? currentYMin : currentYMax;
            const lateralEdge = isRightFoot ? currentYMax : currentYMin;

            // 1. Medial Arch
            if (medialSolidYMirrored !== null && medialFlatYMirrored !== null) {
                const flatMin = Math.min(medialFlatYMirrored, medialEdge);
                const flatMax = Math.max(medialFlatYMirrored, medialEdge);

                if (currentY >= flatMin && currentY <= flatMax) {
                    longitudinalArchHeight = Math.max(longitudinalArchHeight, archInner);
                } else {
                    const denom = medialFlatYMirrored - medialSolidYMirrored;
                    if (Math.abs(denom) > 0.01) {
                        const t = (currentY - medialSolidYMirrored) / denom;
                        if (t >= 0 && t <= 1) {
                            longitudinalArchHeight = Math.max(longitudinalArchHeight, archInner * smoothstep(t));
                        }
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
                        longitudinalArchHeight = Math.max(longitudinalArchHeight, archInner * innerFactor);
                    } else {
                        longitudinalArchHeight = Math.max(longitudinalArchHeight, archInner);
                    }
                }
            }

            // 2. Lateral Arch
            if (lateralSolidYMirrored !== null && lateralFlatYMirrored !== null) {
                const flatMin = Math.min(lateralFlatYMirrored, lateralEdge);
                const flatMax = Math.max(lateralFlatYMirrored, lateralEdge);

                if (currentY >= flatMin && currentY <= flatMax) {
                    longitudinalArchHeight = Math.max(longitudinalArchHeight, archOuter);
                } else {
                    const denom = lateralFlatYMirrored - lateralSolidYMirrored;
                    if (Math.abs(denom) > 0.01) {
                        const t = (currentY - lateralSolidYMirrored) / denom;
                        if (t >= 0 && t <= 1) {
                            longitudinalArchHeight = Math.max(longitudinalArchHeight, archOuter * smoothstep(t));
                        }
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
                        longitudinalArchHeight = Math.max(longitudinalArchHeight, archOuter * outerFactor);
                    } else {
                        longitudinalArchHeight = Math.max(longitudinalArchHeight, archOuter);
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
                        const f = Math.pow(Math.max(0, 1.0 - Math.abs(currentY - center) / half), 0.6);
                        // Y方向プラトー拡大 + ダブルスムースステップ
                        transverseArchHeight = archTransverse * smoothstep(smoothstep(f));
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
                        let transverseFactor = Math.pow(Math.max(0, 1.0 - (centerDist / halfRange)), 0.6);
                        // Y方向プラトー拡大 + ダブルスムースステップ
                        transverseFactor = smoothstep(smoothstep(transverseFactor));
                        transverseArchHeight = archTransverse * transverseFactor;
                    }
                }
            }

            let archH = Math.max(longitudinalArchHeight, transverseArchHeight);

            // Micro-height floor for arch pad area (prevents dip to 0mm between arches)
            if (archPadYRange && currentY >= archPadYRange.min && currentY <= archPadYRange.max) {
                const microHeightX = Math.max(archInner, archOuter, archTransverse);
                if (microHeightX > 0) {
                    const maxArchH = Math.max(archSettings.medial_height, archSettings.lateral_height, 0.01);
                    const normalized = Math.min(1.0, microHeightX / maxArchH);
                    let microH = 0.4 * normalized;

                    const distToEdge = Math.min(currentY - archPadYRange.min, archPadYRange.max - currentY);
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
            const transitionDistance = 10.0;
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
                yBlend = smoothstep(rawT);
            }

            // X-blend calculation (heel cup region)
            let xBlend = 1.0;
            const xTransition = 10.0;
            if (xPercent <= heelCupRegion && distHeel < xTransition) {
                if (distHeel < transitionOffset) {
                    xBlend = 0.0;
                } else {
                    const rawT = Math.min(1, Math.max(0, (distHeel - transitionOffset) / (xTransition - transitionOffset)));
                    xBlend = smoothstep(rawT);
                }
            }

            // Final blend
            const blend = Math.min(yBlend, xBlend);

            // Add heel cup to wall height
            if (xPercent <= heelCupRegion) {
                const xFactor = 1.0 - (xPercent / heelCupRegion);
                wallH += heelCupProfile * xFactor;
            }

            const blendedHeight = wallH * (1 - blend) + archH * blend;
            let totalH = baseThickness + blendedHeight;
            if (totalH < baseThickness) totalH = baseThickness;

            points.push({ yPct, h: totalH });
        }
        return points;
    }, [xPercent, baseThickness, heelCupHeight, medialWallHeight, medialWallPeakX, lateralWallHeight, lateralWallPeakX, archSettings, landmarkConfig, isRightFoot, archCurves, outlinePoints]);

    const pathD = `M ${pctToPx(0)} ${mmToPx(profileData[0].h)} ` + profileData.map(p => `L ${pctToPx(p.yPct)} ${mmToPx(p.h)}`).join(' ');

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
                        <path d={`${pathD} L ${pctToPx(100)} ${mmToPx(0)} L ${pctToPx(0)} ${mmToPx(0)} Z`} fill="hsl(var(--primary))" fillOpacity="0.1" />
                        <path d={pathD} fill="none" stroke="hsl(var(--primary))" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        <text x={PADDING} y={VIEW_HEIGHT - 10} className="text-[9px] font-bold fill-muted-foreground uppercase tracking-wider">{isRightFoot ? 'Medial' : 'Lateral'}</text>
                        <text x={VIEW_WIDTH - PADDING} y={VIEW_HEIGHT - 10} textAnchor="end" className="text-[9px] font-bold fill-muted-foreground uppercase tracking-wider">{isRightFoot ? 'Lateral' : 'Medial'}</text>
                    </svg>
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
                                onChange={(h) => updateArchSettings(activeFootSide, { medial_detail_heights: h })}
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
