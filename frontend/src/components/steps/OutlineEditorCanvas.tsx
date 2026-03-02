import React, { useRef, useState, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { parseOutlineCsv, getSmoothPath } from '@/lib/geometry-utils';
import { DEMO_OUTLINE_CSV } from '@/lib/demo-data';
import { ZoomIn, ZoomOut, Maximize, Image as ImageIcon, FlipHorizontal, FlipVertical, Plus, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';

export default function OutlineEditorCanvas() {
    const {
        outlineImage,
        outlineImageTransform,
        outlineImageSize,
        setOutlineImageSize,
        setOutlineImageTransform,
        outlinePoints,
        setOutlinePoints
    } = useStore();

    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

    // Viewport State
    const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
    const [isPanning, setIsPanning] = useState(false);
    const [lastPanPos, setLastPanPos] = useState({ x: 0, y: 0 });

    // Modes
    const [isImageEditMode, setIsImageEditMode] = useState(false);
    const [isResizingImage, setIsResizingImage] = useState(false);
    const [isRotating, setIsRotating] = useState(false);
    const rotateStartRef = useRef<{ angle: number; initialRotation: number }>({ angle: 0, initialRotation: 0 });

    // Auto-fit Logic
    const fitView = () => {
        if (!containerRef.current || outlinePoints.length === 0) return;
        const containerWidth = containerRef.current.clientWidth;
        const containerHeight = containerRef.current.clientHeight;
        const b = getBounds();
        const padding = 40;
        const contentWidth = b.maxX - b.minX;
        const contentHeight = b.maxY - b.minY;
        if (contentWidth === 0 || contentHeight === 0) return;
        const k = Math.min((containerWidth - padding * 2) / contentWidth, (containerHeight - padding * 2) / contentHeight);
        const x = (containerWidth - contentWidth * k) / 2 - b.minX * k;
        const y = (containerHeight - contentHeight * k) / 2 - b.minY * k;
        setTransform({ x, y, k });
    };

    // Load Image Metadata
    useEffect(() => {
        if (outlineImage) {
            const img = new Image();
            img.onload = () => {
                setOutlineImageSize({ width: img.naturalWidth / 5, height: img.naturalHeight / 5 });
            };
            img.src = outlineImage;
        }
    }, [outlineImage]);

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

    // 画像の中心（SVGロジカル座標系）を返す
    const getImageCenter = () => ({
        x: outlineImageTransform.x + outlineImageSize.width / 2 * outlineImageTransform.scale,
        y: outlineImageTransform.y + outlineImageSize.height / 2 * outlineImageTransform.scale,
    });

    const handleMouseDown = (index: number, e: React.MouseEvent) => {
        if (isImageEditMode) return;
        e.preventDefault(); e.stopPropagation();
        setDraggingIndex(index);
    };

    const handleResizeStart = (e: React.MouseEvent) => {
        e.preventDefault(); e.stopPropagation();
        setIsResizingImage(true);
        setLastPanPos({ x: e.clientX, y: e.clientY });
    };

    const handleRotateStart = (e: React.MouseEvent) => {
        e.preventDefault(); e.stopPropagation();
        const pos = getLogicalPos(e);
        const center = getImageCenter();
        const startAngle = Math.atan2(pos.y - center.y, pos.x - center.x) * (180 / Math.PI);
        rotateStartRef.current = { angle: startAngle, initialRotation: outlineImageTransform.rotation };
        setIsRotating(true);
    };

    const handlePanStart = (e: React.MouseEvent) => {
        if (draggingIndex === null && !isRotating) {
            setIsPanning(true);
            setLastPanPos({ x: e.clientX, y: e.clientY });
        }
    };

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        if (isImageEditMode && outlineImage) {
            const factor = e.deltaY < 0 ? 1.02 : 0.98;
            setOutlineImageTransform({ scale: outlineImageTransform.scale * factor });
        } else {
            const factor = e.deltaY < 0 ? 1.1 : 0.9;
            setTransform(prev => ({ ...prev, k: Math.max(0.1, Math.min(10, prev.k * factor)) }));
        }
    };

    const toggleFlipX = () => setOutlineImageTransform({ flipX: !outlineImageTransform.flipX });
    const toggleFlipY = () => setOutlineImageTransform({ flipY: !outlineImageTransform.flipY });
    const scaleImage = (delta: number) => setOutlineImageTransform({ scale: outlineImageTransform.scale * delta });

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isRotating) {
                const pos = getLogicalPos(e);
                const center = getImageCenter();
                const currentAngle = Math.atan2(pos.y - center.y, pos.x - center.x) * (180 / Math.PI);
                const delta = currentAngle - rotateStartRef.current.angle;
                setOutlineImageTransform({ rotation: rotateStartRef.current.initialRotation + delta });
            } else if (isResizingImage) {
                const dx = e.clientX - lastPanPos.x;
                const factor = 1 + (dx / 500);
                setOutlineImageTransform({ scale: outlineImageTransform.scale * factor });
                setLastPanPos({ x: e.clientX, y: e.clientY });
            } else if (isPanning) {
                const dx = e.clientX - lastPanPos.x;
                const dy = e.clientY - lastPanPos.y;
                if (isImageEditMode && outlineImage) {
                    setOutlineImageTransform({
                        x: outlineImageTransform.x + dx / transform.k,
                        y: outlineImageTransform.y + dy / transform.k
                    });
                } else {
                    setTransform(t => ({ ...t, x: t.x + dx, y: t.y + dy }));
                }
                setLastPanPos({ x: e.clientX, y: e.clientY });
            } else if (draggingIndex !== null && !isImageEditMode) {
                const pos = getLogicalPos(e);
                const newPoints = [...outlinePoints];
                const dx = pos.x - newPoints[draggingIndex].x;
                const dy = pos.y - newPoints[draggingIndex].y;
                newPoints[draggingIndex] = pos;
                const neighbors = [
                    { offset: 1, factor: 0.35 },
                    { offset: 2, factor: 0.12 },
                ];
                for (const { offset, factor } of neighbors) {
                    const prevIdx = (draggingIndex - offset + newPoints.length) % newPoints.length;
                    const nextIdx = (draggingIndex + offset) % newPoints.length;
                    newPoints[prevIdx] = { x: newPoints[prevIdx].x + dx * factor, y: newPoints[prevIdx].y + dy * factor };
                    newPoints[nextIdx] = { x: newPoints[nextIdx].x + dx * factor, y: newPoints[nextIdx].y + dy * factor };
                }
                setOutlinePoints(newPoints);
            }
        };
        const handleMouseUp = () => {
            setDraggingIndex(null);
            setIsPanning(false);
            setIsResizingImage(false);
            setIsRotating(false);
        };
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
    }, [draggingIndex, outlinePoints, setOutlinePoints, isPanning, isResizingImage, isRotating, lastPanPos, transform, isImageEditMode, outlineImage, outlineImageTransform, outlineImageSize, setOutlineImageTransform]);

    // Initial Setup
    useEffect(() => {
        if (outlinePoints.length === 0) setOutlinePoints(parseOutlineCsv(DEMO_OUTLINE_CSV, 260, 50));
    }, []);

    useEffect(() => {
        const timer = setTimeout(fitView, 100);
        return () => clearTimeout(timer);
    }, [outlinePoints.length]);

    const getBounds = () => {
        if (outlinePoints.length === 0) return { minX: 0, maxX: 300, minY: 0, maxY: 150 };
        const xs = outlinePoints.map(p => p.x), ys = outlinePoints.map(p => p.y);
        return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    };

    const bounds = getBounds();
    const pathD = getSmoothPath(outlinePoints, true);

    // 回転ハンドルの位置（画像ローカル座標系、上中央の少し上）
    const handleOffsetY = -20;
    const rotHandleX = outlineImageSize.width / 2;
    const rotHandleY = handleOffsetY;

    const rotationDisplay = Math.round(outlineImageTransform.rotation);

    return (
        <div ref={containerRef} className="relative w-full h-full bg-background overflow-hidden flex flex-col border border-white/5 rounded-lg">
             {/* Toolbar */}
             <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 bg-card/80 backdrop-blur-md p-2 rounded-xl border border-white/10">
                <Button variant="ghost" size="icon" className="text-white hover:text-primary" onClick={() => setTransform(t => ({...t, k: t.k * 1.2}))} title="拡大"><ZoomIn className="h-4 w-4"/></Button>
                <Button variant="ghost" size="icon" className="text-white hover:text-primary" onClick={() => setTransform(t => ({...t, k: t.k / 1.2}))} title="縮小"><ZoomOut className="h-4 w-4"/></Button>
                <Button variant="ghost" size="icon" className="text-white hover:text-primary" onClick={fitView} title="全体表示"><Maximize className="h-4 w-4"/></Button>
                <div className="h-px bg-white/10 my-1" />
                <Toggle pressed={isImageEditMode} onPressedChange={setIsImageEditMode} className={isImageEditMode ? "bg-primary text-primary-foreground" : "text-white"} disabled={!outlineImage}>
                    <ImageIcon className="h-4 w-4" />
                </Toggle>
                {isImageEditMode && (
                    <div className="flex flex-col gap-1 mt-1 border-t border-white/10 pt-1">
                        <Button variant="ghost" size="icon" onClick={toggleFlipX} className={outlineImageTransform.flipX ? "bg-white/20 text-white" : "text-white"} title="左右反転"><FlipHorizontal className="h-4 w-4"/></Button>
                        <Button variant="ghost" size="icon" onClick={toggleFlipY} className={outlineImageTransform.flipY ? "bg-white/20 text-white" : "text-white"} title="上下反転"><FlipVertical className="h-4 w-4"/></Button>
                        <Button variant="ghost" size="icon" className="text-white" onClick={() => scaleImage(1.05)} title="拡大"><Plus className="h-4 w-4"/></Button>
                        <Button variant="ghost" size="icon" className="text-white" onClick={() => scaleImage(0.95)} title="縮小"><Minus className="h-4 w-4"/></Button>
                        <div className="h-px bg-white/10 my-1" />
                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-white text-[9px] font-bold leading-none"
                            onClick={() => setOutlineImageTransform({ rotation: 0 })}
                            title="回転リセット"
                        >
                            {rotationDisplay}°
                        </Button>
                    </div>
                )}
            </div>

            <div
                className={`flex-1 relative ${isRotating ? 'cursor-crosshair' : isPanning ? 'cursor-grabbing' : isImageEditMode ? 'cursor-move' : 'cursor-default'}`}
                onMouseDown={handlePanStart}
                onWheel={handleWheel}
            >
                <svg ref={svgRef} className="w-full h-full block touch-none">
                    <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
                        <rect x={-5000} y={-5000} width={10000} height={10000} fill="transparent" />
                        <defs>
                            <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="#ffffff" strokeWidth="0.2" opacity="0.1"/></pattern>
                            <pattern id="grid-large" width="50" height="50" patternUnits="userSpaceOnUse"><rect width="50" height="50" fill="url(#grid)" /><path d="M 50 0 L 0 0 0 50" fill="none" stroke="#14b8a6" strokeWidth="0.5" opacity="0.2"/></pattern>
                        </defs>
                        <rect x={-1000} y={-1000} width={3000} height={3000} fill="url(#grid-large)" />
                        {/* Rulers */}
                        {Array.from({ length: 15 }).map((_, i) => (
                            <g key={`rx-${i * 50}`}>
                                <text x={i * 50 + 2} y={10} fontSize="5" fontWeight="bold" fill="#ffffff" opacity="0.4">{i * 50}</text>
                                <line x1={i * 50} y1={-100} x2={i * 50} y2={500} stroke="#14b8a6" strokeWidth="0.3" strokeDasharray="2 2" opacity="0.2" />
                            </g>
                        ))}

                        {/* Background Image */}
                        {outlineImage && (
                            <g transform={`translate(${outlineImageTransform.x}, ${outlineImageTransform.y}) scale(${outlineImageTransform.scale}) rotate(${outlineImageTransform.rotation}, ${outlineImageSize.width / 2}, ${outlineImageSize.height / 2})`}>
                                {/* Image + resize handle (inside flip group) */}
                                <g style={{ transformOrigin: 'center', transformBox: 'fill-box', transform: `scale(${outlineImageTransform.flipX ? -1 : 1}, ${outlineImageTransform.flipY ? -1 : 1})` }}>
                                    <image href={outlineImage} x={0} y={0} width={outlineImageSize.width} height={outlineImageSize.height} opacity={isImageEditMode ? 0.8 : outlineImageTransform.opacity} className={isImageEditMode ? "outline outline-2 outline-primary" : ""} />
                                    {isImageEditMode && (
                                        <circle cx={outlineImageSize.width} cy={outlineImageSize.height} r={8/transform.k} fill="#ffffff" stroke="#14b8a6" strokeWidth={2/transform.k} style={{ cursor: 'se-resize' }} onMouseDown={handleResizeStart} />
                                    )}
                                </g>
                                {/* Rotate handle (outside flip group, rotates with image) */}
                                {isImageEditMode && (
                                    <>
                                        <line
                                            x1={rotHandleX}
                                            y1={0}
                                            x2={rotHandleX}
                                            y2={rotHandleY}
                                            stroke="#ffffff"
                                            strokeWidth={1.5 / transform.k}
                                            strokeDasharray={`${3 / transform.k} ${2 / transform.k}`}
                                            opacity={0.5}
                                            style={{ pointerEvents: 'none' }}
                                        />
                                        <circle
                                            cx={rotHandleX}
                                            cy={rotHandleY}
                                            r={8 / transform.k}
                                            fill={isRotating ? "#ffffff" : "#f59e0b"}
                                            stroke="#ffffff"
                                            strokeWidth={2 / transform.k}
                                            style={{ cursor: 'crosshair' }}
                                            onMouseDown={handleRotateStart}
                                        />
                                        {/* 回転角ラベル（ドラッグ中） */}
                                        {isRotating && (
                                            <text
                                                x={rotHandleX + 12 / transform.k}
                                                y={rotHandleY}
                                                fontSize={10 / transform.k}
                                                fill="#f59e0b"
                                                fontWeight="bold"
                                                style={{ pointerEvents: 'none', userSelect: 'none' }}
                                            >
                                                {rotationDisplay}°
                                            </text>
                                        )}
                                    </>
                                )}
                            </g>
                        )}

                        <path d={pathD} fill="rgba(20, 184, 166, 0.1)" stroke={isImageEditMode ? "#ffffff" : "#14b8a6"} strokeWidth={2 / transform.k} vectorEffect="non-scaling-stroke" opacity={isImageEditMode ? 0.3 : 1} />
                        {!isImageEditMode && outlinePoints.map((p, i) => (
                            <circle key={i} cx={p.x} cy={p.y} r={draggingIndex === i ? 8/transform.k : 4/transform.k} fill={draggingIndex === i ? "#ffffff" : "#14b8a6"} stroke="#ffffff" strokeWidth={1/transform.k} className="cursor-move transition-all hover:r-6" onMouseDown={(e) => handleMouseDown(i, e)} />
                        ))}
                    </g>
                </svg>
            </div>
            <div className="absolute bottom-4 left-4 bg-card/80 backdrop-blur-md p-3 rounded-xl text-[10px] text-white/70 font-medium pointer-events-none border border-white/10">
                {isImageEditMode ? (
                    <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-primary"/>画像移動: ドラッグ</span>
                        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400"/>回転: 上ハンドルをドラッグ</span>
                        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-primary"/>サイズ: 右下ハンドル</span>
                        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-primary"/>拡縮: ホイール</span>
                    </div>
                ) : (
                    <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-primary"/>ポイント移動: クリック</span>
                        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-primary"/>視点移動: ドラッグ</span>
                        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-primary"/>拡大縮小: ホイール</span>
                    </div>
                )}
            </div>
        </div>
    );
}
