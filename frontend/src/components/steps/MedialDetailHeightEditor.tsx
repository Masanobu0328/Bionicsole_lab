'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';

const DEFAULT_POINT_LABELS = ['Sub', 'Nav', 'Cun', 'M5'];
// アーチ範囲内のデフォルト相対位置（xPercents未指定時）
const DEFAULT_X_RATIOS = [0.18, 0.45, 0.70, 0.83];

interface Props {
    heights: number[];
    xPercents?: number[];   // 各ランドマークの絶対%（例: [30, 43, 55, 62]）
    startPct?: number;      // アーチ開始%
    endPct?: number;        // アーチ終了%
    maxH?: number;
    pointLabels?: string[]; // ラベル（デフォルト: ['Sub', 'Nav', 'Cun', 'M5']）
    onChange: (heights: number[]) => void;
}

export default function MedialDetailHeightEditor({
    heights,
    xPercents,
    startPct = 20,
    endPct = 70,
    maxH = 10,
    pointLabels = DEFAULT_POINT_LABELS,
    onChange,
}: Props) {
    const svgRef = useRef<SVGSVGElement>(null);
    const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

    // Layout — 断面プロファイルと同じ比率
    const W = 520, H = 150;
    const PAD_L = 38, PAD_R = 14, PAD_T = 16, PAD_B = 26;
    const drawW = W - PAD_L - PAD_R;
    const drawH = H - PAD_T - PAD_B;
    const rangeX = endPct - startPct || 1;

    const xRatioToSvgX = (r: number) => PAD_L + r * drawW;
    const mmToSvgY = (mm: number) => PAD_T + drawH - (Math.max(0, Math.min(maxH, mm)) / maxH) * drawH;
    const svgYToMm = (svgY: number) => ((PAD_T + drawH - svgY) / drawH) * maxH;

    const getXRatio = (i: number) => {
        if (xPercents && xPercents.length > i) {
            return Math.max(0.02, Math.min(0.98, (xPercents[i] - startPct) / rangeX));
        }
        return DEFAULT_X_RATIOS[i] ?? (i + 1) / 5;
    };

    // 6点: [start(固定), Sub, Nav, Cun, M5, end(固定)]
    const allPoints = [
        { x: xRatioToSvgX(0), y: mmToSvgY(0), fixed: true },
        ...heights.map((h, i) => ({ x: xRatioToSvgX(getXRatio(i)), y: mmToSvgY(h), fixed: false })),
        { x: xRatioToSvgX(1), y: mmToSvgY(0), fixed: true },
    ];

    // Catmull-Rom パス生成
    const buildCurve = (close: boolean) => {
        const pts = allPoints;
        if (pts.length < 2) return '';
        let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
        for (let i = 1; i < pts.length; i++) {
            const p0 = pts[Math.max(0, i - 2)];
            const p1 = pts[i - 1];
            const p2 = pts[i];
            const p3 = pts[Math.min(pts.length - 1, i + 1)];
            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;
            d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)},${cp2x.toFixed(1)} ${cp2y.toFixed(1)},${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
        }
        if (close) {
            const base = PAD_T + drawH;
            d += ` L ${pts[pts.length - 1].x.toFixed(1)} ${base} L ${pts[0].x.toFixed(1)} ${base} Z`;
        }
        return d;
    };

    const getSvgY = useCallback((e: MouseEvent): number | null => {
        if (!svgRef.current) return null;
        const rect = svgRef.current.getBoundingClientRect();
        return (e.clientY - rect.top) * (H / rect.height);
    }, []);

    useEffect(() => {
        if (draggingIdx === null) return;
        const onMove = (e: MouseEvent) => {
            const svgY = getSvgY(e);
            if (svgY === null) return;
            const mm = Math.round(Math.max(0, Math.min(maxH, svgYToMm(svgY))) * 10) / 10;
            const newH = [...heights];
            newH[draggingIdx] = mm;
            onChange(newH);
        };
        const onUp = () => setDraggingIdx(null);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [draggingIdx, heights, onChange, getSvgY, maxH]);

    const gridYValues = Array.from(
        { length: Math.floor(maxH / 2) + 1 },
        (_, i) => i * 2
    ).filter(v => v <= maxH);

    return (
        <div className="relative w-full h-[185px] border border-border rounded bg-card overflow-hidden">
            <svg
                ref={svgRef}
                width="100%"
                height="100%"
                viewBox={`0 0 ${W} ${H}`}
                className="select-none block"
            >
                {/* Y グリッド + ラベル */}
                {gridYValues.map(v => {
                    const y = mmToSvgY(v);
                    return (
                        <g key={v}>
                            <line
                                x1={PAD_L} y1={y}
                                x2={PAD_L + drawW} y2={y}
                                stroke="hsl(var(--border))"
                                strokeOpacity={v === 0 ? 0.8 : 0.3}
                                strokeWidth={v === 0 ? 1 : 0.5}
                            />
                            <text
                                x={PAD_L - 5} y={y + 3.5}
                                fontSize={8}
                                textAnchor="end"
                                className="fill-muted-foreground font-mono"
                            >{v === 0 ? '0' : `${v}mm`}</text>
                        </g>
                    );
                })}

                {/* アーチ塗り */}
                <path
                    d={buildCurve(true)}
                    fill="hsl(var(--primary))"
                    fillOpacity="0.1"
                    stroke="none"
                />

                {/* アーチ線（断面プロファイルと同じスタイル） */}
                <path
                    d={buildCurve(false)}
                    fill="none"
                    stroke="hsl(var(--primary))"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />

                {/* 制御点の垂直ガイド */}
                {allPoints.map((pt, i) => (
                    <line
                        key={`vg-${i}`}
                        x1={pt.x} y1={PAD_T}
                        x2={pt.x} y2={PAD_T + drawH}
                        stroke="hsl(var(--border))"
                        strokeOpacity="0.15"
                        strokeWidth="0.5"
                        strokeDasharray="3,3"
                    />
                ))}

                {/* 制御点 + ラベル */}
                {allPoints.map((pt, i) => {
                    const label = pointLabels[i - 1];
                    const hVal = !pt.fixed ? heights[i - 1] : null;
                    const isActive = !pt.fixed && draggingIdx === i - 1;
                    return (
                        <g key={`pt-${i}`}>
                            {/* X軸ラベル（ArchRegionEditorCanvas と同じスタイル） */}
                            {label && (
                                <text
                                    x={pt.x} y={H - 6}
                                    fontSize={9}
                                    textAnchor="middle"
                                    fontWeight="600"
                                    className="fill-muted-foreground"
                                >{label}</text>
                            )}

                            {/* 制御点（ArchRegionEditorCanvas スタイル：idle=輪郭のみ、active=塗り） */}
                            {pt.fixed ? (
                                <circle
                                    cx={pt.x} cy={pt.y}
                                    r={3}
                                    fill="hsl(var(--muted-foreground))"
                                    fillOpacity="0.35"
                                    stroke="none"
                                />
                            ) : (
                                <circle
                                    cx={pt.x} cy={pt.y}
                                    r={isActive ? 6 : 4.5}
                                    fill={isActive ? 'hsl(var(--primary))' : 'hsl(var(--card))'}
                                    stroke="hsl(var(--primary))"
                                    strokeWidth="2"
                                    style={{ cursor: 'ns-resize' }}
                                    onMouseDown={(e) => {
                                        e.stopPropagation();
                                        setDraggingIdx(i - 1);
                                    }}
                                />
                            )}

                            {/* 高さ値ラベル（制御点の上） */}
                            {hVal !== null && (
                                <text
                                    x={pt.x} y={pt.y - 9}
                                    fontSize={9}
                                    textAnchor="middle"
                                    fontWeight="700"
                                    fill="hsl(var(--primary))"
                                >{hVal.toFixed(1)}</text>
                            )}
                        </g>
                    );
                })}

                {/* Y軸単位ラベル */}
                <text
                    x={10} y={PAD_T + drawH / 2}
                    fontSize={8}
                    textAnchor="middle"
                    className="fill-muted-foreground"
                    transform={`rotate(-90 10 ${PAD_T + drawH / 2})`}
                >mm</text>
            </svg>
        </div>
    );
}
