'use client';

import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { getSmoothPath } from '@/lib/geometry-utils';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Helper to get bounding box of outline
function getBounds(points: { x: number, y: number }[]) {
    if (points.length === 0) return { minX: 0, maxX: 100, minY: 0, maxY: 100, width: 100, height: 100 };
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

// Helper to get Y intersection bounds of polygon at X
function getOutlineYAtX(points: { x: number, y: number }[], targetX: number) {
    let intersections: number[] = [];
    for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        if ((p1.x <= targetX && p2.x > targetX) || (p2.x <= targetX && p1.x > targetX)) {
            const t = (targetX - p1.x) / (p2.x - p1.x);
            const y = p1.y + t * (p2.y - p1.y);
            intersections.push(y);
        }
    }
    if (intersections.length < 2) return null;
    return { min: Math.min(...intersections), max: Math.max(...intersections) };
}

// Unified Teal Theme
const COLORS = {
    outline_stroke: '#14b8a6', // Turquoise 500
    outline_fill: 'rgba(20, 184, 166, 0.1)',
    landmark_base: 'rgba(255, 255, 255, 0.3)',
    active: '#ffffff',
    text_muted: 'rgba(255, 255, 255, 0.4)',
    ray5: '#ffffff',
    ray1: '#ffffff',
};

const LANDMARK_DEFS: Record<string, { label: string, side: 'medial' | 'lateral' | 'full' }> = {
    'arch_start': { label: 'アーチ開始', side: 'medial' },
    'lateral_arch_start': { label: 'アーチ開始', side: 'lateral' },
    'subtalar': { label: '距骨下', side: 'medial' },
    'navicular': { label: '舟状骨', side: 'medial' },
    'cuboid': { label: '立方骨', side: 'lateral' },
    'medial_cuneiform': { label: '楔状骨', side: 'medial' },
    'metatarsal': { label: '中足骨', side: 'full' },
};

export default function LandmarkEditorCanvas() {
    const {
        outlineImage,
        outlineImageTransform,
        outlineImageSize,
        outlinePoints,
        landmarkConfig,
        widthConfig,
        updateLandmarkPos,
        updateWidthConfig,
        activeLandmarkId,
        setActiveLandmarkId
    } = useStore();

    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Viewport State
    const [transform, setTransform] = useState({ x: 50, y: 50, k: 1 });
    const [isPanning, setIsPanning] = useState(false);
    const [lastPanPos, setLastPanPos] = useState({ x: 0, y: 0 });
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [draggingType, setDraggingType] = useState<'landmark' | 'width' | null>(null);

    const bounds = getBounds(outlinePoints);

    // Auto-fit Logic
    const fitView = () => {
        if (!containerRef.current || outlinePoints.length === 0) return;
        const containerWidth = containerRef.current.clientWidth;
        const containerHeight = containerRef.current.clientHeight;
        const padding = 80;
        const contentWidth = bounds.width;
        const contentHeight = bounds.height;
        if (contentWidth === 0 || contentHeight === 0) return;

        const k = Math.min((containerWidth - padding * 2) / contentWidth, (containerHeight - padding * 2) / contentHeight);
        const x = (containerWidth - contentWidth * k) / 2 - bounds.minX * k;
        const y = (containerHeight - contentHeight * k) / 2 - bounds.minY * k;

        setTransform({ x, y, k });
    };

    useEffect(() => {
        const timer = setTimeout(fitView, 100);
        return () => clearTimeout(timer);
    }, [outlinePoints.length]);

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

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        setTransform(t => ({ ...t, k: Math.max(0.2, Math.min(10, t.k * factor)) }));
    };

    const handlePanStart = (e: React.MouseEvent) => {
        if (draggingId === null) {
            setIsPanning(true);
            setLastPanPos({ x: e.clientX, y: e.clientY });
        }
    };

    const refPoints = useMemo(() => {
        if (outlinePoints.length < 3) return null;
        const heelRefX = bounds.minX + bounds.width * 0.10;
        const heelBounds = getOutlineYAtX(outlinePoints, heelRefX);
        let maxWidth = -1, maxWidthX = bounds.minX, maxBounds = { min: 0, max: 0 };
        for (let i = 0; i <= 50; i++) {
            const tx = bounds.minX + (bounds.width * i) / 50;
            const b = getOutlineYAtX(outlinePoints, tx);
            if (b && (b.max - b.min) > maxWidth) { maxWidth = b.max - b.min; maxWidthX = tx; maxBounds = b; }
        }
        return { heel: { x: heelRefX, ...heelBounds }, max: { x: maxWidthX, ...maxBounds } };
    }, [outlinePoints, bounds]);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (draggingId) {
                const pos = getLogicalPos(e);
                if (draggingType === 'landmark') {
                    let percent = ((pos.x - bounds.minX) / bounds.width) * 100;
                    updateLandmarkPos(draggingId, Math.max(0, Math.min(100, percent)));
                } else if (draggingType === 'width') {
                    const localBounds = getOutlineYAtX(outlinePoints, pos.x);
                    if (localBounds) {
                        let percent = ((localBounds.max - pos.y) / (localBounds.max - localBounds.min)) * 100;
                        updateWidthConfig(draggingId, Math.max(0, Math.min(100, percent)));
                    }
                }
            } else if (isPanning) {
                setTransform(t => ({ ...t, x: t.x + (e.clientX - lastPanPos.x), y: t.y + (e.clientY - lastPanPos.y) }));
                setLastPanPos({ x: e.clientX, y: e.clientY });
            }
        };
        const handleMouseUp = () => { setDraggingId(null); setDraggingType(null); setIsPanning(false); };
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
    }, [draggingId, draggingType, bounds, isPanning, lastPanPos, transform, outlinePoints, updateLandmarkPos, updateWidthConfig]);

    const getGuidelineY = (id: string) => {
        if (!refPoints || !refPoints.heel || !refPoints.max) return (x: number) => 0;
        const percent = widthConfig[id] ?? (id === 'ray5_boundary' ? 25 : 65);
        const heel = refPoints.heel;
        const max = refPoints.max;
        if (heel.max === undefined || heel.min === undefined || max.max === undefined || max.min === undefined) return (x: number) => 0;
        const heelY = heel.max - (heel.max - heel.min) * (percent / 100);
        const maxY = max.max - (max.max - max.min) * (percent / 100);
        const slope = (maxY - heelY) / (max.x - heel.x);
        const intercept = heelY - slope * heel.x;
        return (x: number) => slope * x + intercept;
    };

    const ray5Func = getGuidelineY('ray5_boundary');
    const pathD = getSmoothPath(outlinePoints, true);

    return (
        <div ref={containerRef} className="relative w-full h-full bg-background overflow-hidden flex flex-col border border-border/50 rounded-lg font-sans">
            {/* Toolbar */}
            <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 bg-card/80 backdrop-blur-md p-2 rounded-xl border border-white/10">
                <Button variant="ghost" size="icon" className="text-white hover:text-primary" onClick={() => setTransform(t => ({ ...t, k: t.k * 1.2 }))}><ZoomIn className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="text-white hover:text-primary" onClick={() => setTransform(t => ({ ...t, k: t.k / 1.2 }))}><ZoomOut className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="text-white hover:text-primary" onClick={fitView}><Maximize className="h-4 w-4" /></Button>
            </div>

            <div className="flex-1 relative cursor-default" onMouseDown={handlePanStart} onWheel={handleWheel}>
                <svg ref={svgRef} className={`w-full h-full block touch-none bg-transparent ${isPanning ? 'cursor-grabbing' : 'cursor-default'}`}>
                    <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
                        {/* Grid */}
                        <defs>
                            <pattern id="grid-lm" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="#ffffff" strokeWidth="0.2" opacity="0.1" /></pattern>
                            <pattern id="grid-large-lm" width="50" height="50" patternUnits="userSpaceOnUse">
                                <rect width="50" height="50" fill="url(#grid-lm)" />
                                <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#14b8a6" strokeWidth="0.5" opacity="0.2" />
                            </pattern>
                        </defs>
                        <rect x={-1000} y={-1000} width={3000} height={3000} fill="url(#grid-large-lm)" />

                        {/* Ruler Labels */}
                        {Array.from({ length: 15 }).map((_, i) => {
                            const val = i * 50;
                            return <g key={`x-${val}`}><text x={val + 2} y={10} fontSize="5" fontWeight="bold" fill="#ffffff" opacity="0.4" className="font-sans">{val}</text><line x1={val} y1={-100} x2={val} y2={500} stroke="#14b8a6" strokeWidth="0.3" strokeDasharray="2 2" opacity="0.2" /></g>
                        })}

                        {/* Direction Labels */}
                        <g pointerEvents="none" className="select-none font-sans font-black text-white/30 uppercase tracking-widest">
                            <text x={bounds.maxX + 40} y={(bounds.minY + bounds.maxY) / 2} textAnchor="start" fontSize="6">Toe →</text>
                            <text x={bounds.minX - 40} y={(bounds.minY + bounds.maxY) / 2} textAnchor="end" fontSize="6">← Heel</text>
                            <text x={(bounds.minX + bounds.maxX) / 2} y={bounds.minY - 40} textAnchor="middle" fontSize="6">Medial (Inside)</text>
                            <text x={(bounds.minX + bounds.maxX) / 2} y={bounds.maxY + 40} textAnchor="middle" fontSize="6">Lateral (Outside)</text>
                        </g>

                        {/* Background Image (Read-only) */}
                        {outlineImage && (
                            <g transform={`translate(${outlineImageTransform.x}, ${outlineImageTransform.y}) scale(${outlineImageTransform.scale}) rotate(${outlineImageTransform.rotation}, ${outlineImageSize.width / 2}, ${outlineImageSize.height / 2})`}>
                                <g style={{ transformOrigin: 'center', transformBox: 'fill-box', transform: `scale(${outlineImageTransform.flipX ? -1 : 1}, ${outlineImageTransform.flipY ? -1 : 1})` }}>
                                    <image
                                        href={outlineImage}
                                        x={0} y={0}
                                        width={outlineImageSize.width} height={outlineImageSize.height}
                                        opacity={outlineImageTransform.opacity * 0.3}
                                    />
                                </g>
                            </g>
                        )}

                        {/* Smooth Outline */}
                        <path d={pathD} fill={COLORS.outline_fill} stroke={COLORS.outline_stroke} strokeWidth={1.5 / transform.k} vectorEffect="non-scaling-stroke" opacity="0.8" />

                        {/* Width Guidelines */}
                        {Object.entries(widthConfig).map(([id, percent]) => {
                            const func = getGuidelineY(id);
                            const yStart = func(bounds.minX - 50), yEnd = func(bounds.maxX + 50);
                            const isDragging = draggingId === id;
                            const color = id === 'ray5_boundary' ? COLORS.ray5 : COLORS.ray1;

                            // Label position near Heel (X ~ 10)
                            const labelX = bounds.minX + 10;
                            const labelY = func(labelX);

                            return (
                                <g key={id} className="cursor-ns-resize" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setDraggingId(id); setDraggingType('width'); }}>
                                    <line x1={bounds.minX - 50} x2={bounds.maxX + 50} y1={yStart} y2={yEnd} stroke="transparent" strokeWidth="15" />
                                    <line x1={bounds.minX - 50} x2={bounds.maxX + 50} y1={yStart} y2={yEnd} stroke={color} strokeWidth={(isDragging ? 2.5 : 2) / transform.k} strokeDasharray="5 3" opacity={isDragging ? 1 : 0.6} />
                                    {/* Pill Label */}
                                    <g transform={`translate(${labelX}, ${labelY})`}>
                                        {(() => {
                                            const text = `${id === 'ray5_boundary' ? 'Ray5' : 'Ray1'} (${percent.toFixed(0)}%)`;
                                            const width = text.length * 3 + 6;
                                            return (
                                                <>
                                                    <rect
                                                        x={-width / 2} y="-5" width={width} height="10" rx="4"
                                                        fill="#0f172a" stroke={color} strokeWidth={1 / transform.k}
                                                    />
                                                    <text
                                                        y="1.5"
                                                        fontSize="4" fill="white" fontWeight="bold"
                                                        textAnchor="middle" className="select-none font-sans"
                                                    >
                                                        {text}
                                                    </text>
                                                </>
                                            );
                                        })()}
                                    </g>
                                </g>
                            );
                        })}

                        {/* Landmark Lines */}
                        {Object.entries(landmarkConfig).map(([id, percent], index) => {
                            const def = LANDMARK_DEFS[id] || { label: id, side: 'full' };
                            const xPos = bounds.minX + (bounds.width * percent / 100);
                            const isActive = activeLandmarkId === id, isDragging = draggingId === id;
                            const displayColor = (isActive || isDragging) ? COLORS.active : COLORS.landmark_base;

                            let yS = bounds.minY, yE = bounds.maxY;
                            if (def.side === 'medial') yE = ray5Func(xPos); else if (def.side === 'lateral') yS = ray5Func(xPos);

                            // Constant offset (No Staggering)
                            const labelY = def.side === 'lateral' ? yE + 15 : yS - 15;

                            return (
                                <g key={id} className="cursor-ew-resize" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setActiveLandmarkId(id); setDraggingId(id); setDraggingType('landmark'); }}>
                                    <line x1={xPos} x2={xPos} y1={yS} y2={yE} stroke="transparent" strokeWidth="15" />
                                    <line
                                        x1={xPos} x2={xPos} y1={yS} y2={yE}
                                        stroke={displayColor}
                                        strokeWidth={(isActive || isDragging ? 2.5 : 2) / transform.k}
                                        strokeDasharray="4 2"
                                        opacity={isActive || isDragging ? 1 : 0.6}
                                    />

                                    {/* Pill Label */}
                                    <g transform={`translate(${xPos}, ${labelY})`}>
                                        {(() => {
                                            const width = def.label.length * 5 + 6;
                                            return (
                                                <>
                                                    <rect
                                                        x={-width / 2} y="-6" width={width} height="12" rx="4"
                                                        fill={isActive || isDragging ? "#14b8a6" : "#0f172a"}
                                                        stroke={displayColor} strokeWidth={1 / transform.k}
                                                        className="transition-colors"
                                                    />
                                                    <text
                                                        y="2"
                                                        textAnchor="middle"
                                                        fontSize="4.5"
                                                        fill={isActive || isDragging ? "#0f172a" : "white"}
                                                        fontWeight="bold"
                                                        className="select-none font-sans"
                                                    >
                                                        {def.label}
                                                    </text>
                                                </>
                                            );
                                        })()}
                                    </g>

                                    {(isActive || isDragging) && (
                                        <text
                                            x={xPos}
                                            y={def.side === 'lateral' ? labelY + 15 : labelY - 15}
                                            textAnchor="middle"
                                            fontSize="4"
                                            fontWeight="bold"
                                            fill="#14b8a6"
                                            className="font-sans"
                                        >
                                            {percent.toFixed(1)}%
                                        </text>
                                    )}
                                </g>
                            );
                        })}
                    </g>
                </svg>
            </div>
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-card/80 backdrop-blur-md px-6 py-3 rounded-2xl text-[10px] text-white/70 font-bold pointer-events-none border border-white/10">
                <div className="flex items-center gap-6">
                    <span className="flex items-center gap-2 uppercase tracking-widest"><span className="w-2 h-2 rounded-full bg-primary" /> ラインをドラッグして調整</span>
                    <span className="flex items-center gap-2 uppercase tracking-widest"><span className="w-2 h-2 rounded-full bg-primary/40" /> ホイール: 拡大縮小</span>
                    <span className="flex items-center gap-2 uppercase tracking-widest"><span className="w-2 h-2 rounded-full bg-primary/40" /> 背景ドラッグ: 視点移動</span>
                </div>
            </div>
        </div>
    );
}
