'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

// ランドマークの日本語ラベル定義
const LANDMARK_LABELS: Record<string, string> = {
    'arch_start': '起始',
    'lateral_arch_start': '外側起始',
    'subtalar': '距骨下',
    'navicular': '舟状骨',
    'cuboid': '立方骨',
    'medial_cuneiform': '楔状骨',
    'metatarsal': '中足骨'
};

// ビューごとの表示ランドマーク
const MEDIAL_LANDMARKS = ['arch_start', 'subtalar', 'navicular', 'medial_cuneiform', 'metatarsal'];
const LATERAL_LANDMARKS = ['lateral_arch_start', 'cuboid', 'metatarsal'];

const VIEW_HEIGHT = 250; // 少し高さを増やす
const VIEW_WIDTH = 800; // 幅も広げる
const PADDING_TOP = 20;
const PADDING_BOTTOM = 30;
const PADDING_X = 40;
const MAX_DISPLAY_HEIGHT = 25; // 表示する最大高さ(mm)

export default function ShapeEditorCanvas() {
  const {
    baseThickness,
    heelCupHeight,
    bottomRounding,
    outlinePoints,
    medialWallHeight,
    medialWallPeakX,
    lateralWallHeight,
    lateralWallPeakX,
    landmarkConfig,
    activeLandmarkId,
    setHeelCupHeight,
    setMedialWallHeight,
    setMedialWallPeakX,
    setLateralWallHeight,
    setLateralWallPeakX,
  } = useStore();

  const [draggingPoint, setDraggingPoint] = useState<{ side: 'medial' | 'lateral'; id: string } | null>(null);
  const svgRefMedial = useRef<SVGSVGElement>(null);
  const svgRefLateral = useRef<SVGSVGElement>(null);

  // 座標変換: mm (底面からの絶対高さ) -> pixels
  // Y=0(底面)が下、MAX_DISPLAY_HEIGHTが上
  const mmToPx = (mm: number) => {
    const safeMm = Math.max(0, Math.min(MAX_DISPLAY_HEIGHT, mm));
    return VIEW_HEIGHT - PADDING_BOTTOM - (safeMm / MAX_DISPLAY_HEIGHT) * (VIEW_HEIGHT - PADDING_TOP - PADDING_BOTTOM);
  };

  const pctToPx = (pct: number) => PADDING_X + (pct / 100) * (VIEW_WIDTH - 2 * PADDING_X);

  // 座標変換: pixels -> mm (底面からの絶対高さ)
  const pxToMm = (px: number) => {
    const plotHeight = VIEW_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
    const yFromBottom = VIEW_HEIGHT - PADDING_BOTTOM - px;
    const rawMm = (yFromBottom / plotHeight) * MAX_DISPLAY_HEIGHT;
    return Math.max(0, Math.min(MAX_DISPLAY_HEIGHT, Math.round(rawMm * 10) / 10));
  };
  
  const pxToPct = (px: number) => {
    const plotWidth = VIEW_WIDTH - 2 * PADDING_X;
    const xFromLeft = px - PADDING_X;
    const rawPct = (xFromLeft / plotWidth) * 100;
    return Math.max(0, Math.min(100, Math.round(rawPct * 10) / 10));
  };

  // Cursor position in SVG units. width="100%" means the on-screen size and the
  // viewBox differ, so the ratio has to be applied.
  const toSvgPoint = useCallback(
    (side: 'medial' | 'lateral', e: { clientX: number; clientY: number }) => {
      const svg = side === 'medial' ? svgRefMedial.current : svgRefLateral.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (VIEW_WIDTH / rect.width),
        y: (e.clientY - rect.top) * (VIEW_HEIGHT / rect.height),
      };
    },
    [],
  );

  // Where inside the handle the drag started. The hit target is a transparent
  // circle of radius 18, deliberately generous so the point is easy to grab - but
  // the height and x were read straight off the cursor, so grabbing anywhere but
  // the exact centre threw the point by up to those 18 units (about 2.3% of foot
  // length) on the first mousemove. Holding the offset keeps it under the cursor.
  const grabOffsetRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = (
    side: 'medial' | 'lateral',
    id: string,
    e: React.MouseEvent,
    pointPx: { x: number; y: number },
  ) => {
    const cursor = toSvgPoint(side, e);
    grabOffsetRef.current = cursor
      ? { x: cursor.x - pointPx.x, y: cursor.y - pointPx.y }
      : { x: 0, y: 0 };
    setDraggingPoint({ side, id });
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!draggingPoint) return;

    const cursor = toSvgPoint(draggingPoint.side, e);
    if (!cursor) return;

    const xPx = cursor.x - grabOffsetRef.current.x;
    const yPx = cursor.y - grabOffsetRef.current.y;

    const valX = pxToPct(xPx);
    const absHeightMm = pxToMm(yPx); // 底面からの絶対高さ

    // パラメータは「ベースからの相対高さ」で保存する
    // ただし、ベース厚みを下回らないように制限（埋没防止）
    const relHeightMm = Math.max(0, Math.round((absHeightMm - baseThickness) * 10) / 10);

    if (draggingPoint.id === 'heel') {
        // ヒールカップはベースからの高さ
        setHeelCupHeight(relHeightMm);
    } else if (draggingPoint.id === 'peak') {
      if (draggingPoint.side === 'medial') {
        setMedialWallHeight(relHeightMm);
        setMedialWallPeakX(valX);
      } else {
        setLateralWallHeight(relHeightMm);
        setLateralWallPeakX(valX);
      }
    }
  }, [draggingPoint, baseThickness, toSvgPoint, setHeelCupHeight, setMedialWallHeight, setMedialWallPeakX, setLateralWallHeight, setLateralWallPeakX]);

  const handleMouseUp = useCallback(() => {
    setDraggingPoint(null);
  }, []);

  useEffect(() => {
    if (draggingPoint) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingPoint, handleMouseMove, handleMouseUp]);

  const renderView = (side: 'medial' | 'lateral') => {
    const isMedial = side === 'medial';
    const svgRef = isMedial ? svgRefMedial.current : svgRefLateral.current;
    
    // パラメータ取得
    const peakX = isMedial ? medialWallPeakX : lateralWallPeakX;
    // 表示用にベース厚みを加算（絶対高さ）
    const peakY_abs = (isMedial ? medialWallHeight : lateralWallHeight) + baseThickness;
    const heelY_abs = heelCupHeight + baseThickness;
    
    // ヒールカップ終了位置（アーチ起始）
    const heelEnd = isMedial 
        ? (landmarkConfig['arch_start'] || 15) 
        : (landmarkConfig['lateral_arch_start'] || 20);

    // 壁終了位置
    const wallEnd = isMedial 
        ? (landmarkConfig['metatarsal'] || 70)
        : (landmarkConfig['cuboid'] || 45);

    // Control points (絶対高さ)
    const points = [
      { id: 'heel', x: 0, y: heelY_abs, label: 'Heel' },
      { id: 'peak', x: peakX, y: peakY_abs, label: 'Peak' },
    ];

    // プロファイル曲線 (絶対高さで計算)
    // 0 -> heelEnd: 水平 (ヒールカップ高さ一定)
    // heelEnd -> peak: 曲線 (二次ベジェ)
    // peak -> wallEnd: 曲線 (二次ベジェ、ベースへ滑らかに着地)
    // wallEnd -> 100: 水平 (ベース高さ)
    
    // Rounded bottom edge. In this longitudinal elevation the fillet is only
    // visible at the back of the heel (x=0%), where its inward normal lies in the
    // plane of the view. Radius fade mirrors _bottom_rounding_radii() in
    // core/geometry_v4_frontend.py.
    const ROUND_WALL_FULL_MM = 1.5;
    const ROUND_MAX_FRACTION = 0.7;
    const heelRoundMm = bottomRounding <= 0 ? 0 : (() => {
        const fullAt = Math.max(ROUND_WALL_FULL_MM, bottomRounding);
        const wall = Math.max(0, heelY_abs - baseThickness);
        const t = Math.max(0, Math.min(1, wall / fullAt));
        return Math.min(bottomRounding * t * t * (3 - 2 * t), heelY_abs * ROUND_MAX_FRACTION);
    })();
    const footLengthMm = outlinePoints.length > 0
        ? Math.max(...outlinePoints.map(pt => pt.x)) - Math.min(...outlinePoints.map(pt => pt.x))
        : 260;
    const heelRoundPct = footLengthMm > 0 ? (heelRoundMm / footLengthMm) * 100 : 0;
    const heelArcRx = Math.abs(pctToPx(heelRoundPct) - pctToPx(0));
    const heelArcRy = Math.abs(mmToPx(0) - mmToPx(heelRoundMm));

    const pathData = `
      M ${pctToPx(heelRoundPct)} ${mmToPx(0)}
      A ${heelArcRx} ${heelArcRy} 0 0 1 ${pctToPx(0)} ${mmToPx(heelRoundMm)}
      L ${pctToPx(0)} ${mmToPx(heelY_abs)}
      L ${pctToPx(heelEnd)} ${mmToPx(heelY_abs)}
      Q ${pctToPx(heelEnd + (peakX - heelEnd) * 0.5)} ${mmToPx(Math.max(heelY_abs, peakY_abs))} 
        ${pctToPx(peakX)} ${mmToPx(peakY_abs)}
      Q ${pctToPx(peakX + (wallEnd - peakX) * 0.5)} ${mmToPx(peakY_abs * 0.8 + baseThickness * 0.2)}
        ${pctToPx(wallEnd)} ${mmToPx(baseThickness)}
      L ${pctToPx(100)} ${mmToPx(baseThickness)}
    `;
    
    // ベースライン（底面 = 0mm）からベース厚みまでの塗りつぶしエリア
    const areaPathData = `
      ${pathData}
      L ${pctToPx(100)} ${mmToPx(0)}
      L ${pctToPx(heelRoundPct)} ${mmToPx(0)}
      Z
    `;

    // ランドマークガイド線
    const targetLandmarks = isMedial ? MEDIAL_LANDMARKS : LATERAL_LANDMARKS;

    const sideColor = isMedial ? "#14b8a6" : "#0ea5e9";

    return (
      <Card className="p-6 mb-6 bg-card/50 backdrop-blur-sm border-white/5 rounded-2xl">
        <div className="flex justify-between items-end mb-4">
          <div>
            <Label className="text-xl font-black text-white tracking-tight uppercase">
              {isMedial ? <span className="text-primary">Medial Side View</span> : <span className="text-[#0ea5e9]">Lateral Side View</span>}
            </Label>
            <div className="text-[10px] font-bold text-white/30 uppercase tracking-widest mt-1">
              {isMedial ? '内側プロファイル' : '外側プロファイル'}
            </div>
          </div>
          <div 
            className="text-xs font-mono px-3 py-1 rounded-full font-bold border"
            style={{ 
                color: sideColor, 
                backgroundColor: `${sideColor}15`, 
                borderColor: `${sideColor}30` 
            }}
          >
             PEAK: {(peakY_abs - baseThickness).toFixed(1)}mm <span className="opacity-40">/</span> {peakX.toFixed(1)}%
          </div>
        </div>
        <div className="relative w-full overflow-hidden rounded-xl border border-white/5 bg-black/20">
            <svg
            ref={isMedial ? svgRefMedial : svgRefLateral}
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            className="w-full h-auto cursor-crosshair touch-none select-none"
            >
            {/* Grid lines (Y axis) */}
            {[0, 5, 10, 15, 20, 25].map(h => (
                <g key={h}>
                <line
                    x1={PADDING_X}
                    y1={mmToPx(h)}
                    x2={VIEW_WIDTH - PADDING_X}
                    y2={mmToPx(h)}
                    stroke={h === 0 ? sideColor : "#ffffff"}
                    strokeWidth={h === 0 ? 1.5 : 0.5}
                    opacity={h === 0 ? 0.4 : 0.05}
                />
                <text x={PADDING_X - 8} y={mmToPx(h) + 3} textAnchor="end" className="text-[9px] fill-white/40 font-mono font-bold">
                    {h}mm
                </text>
                </g>
            ))}

            {/* Landmark Guidelines (Vertical) */}
            {targetLandmarks.map(lmId => {
                const pct = landmarkConfig[lmId];
                if (pct === undefined) return null;
                const xPos = pctToPx(pct);
                return (
                    <g key={lmId}>
                        <line
                            x1={xPos} y1={PADDING_TOP}
                            x2={xPos} y2={VIEW_HEIGHT - PADDING_BOTTOM}
                            stroke="#ffffff"
                            strokeWidth="0.5"
                            strokeDasharray="4 4"
                            opacity={activeLandmarkId === lmId ? 0.4 : 0.15}
                        />
                        <text
                             x={xPos} 
                             y={PADDING_TOP - 8}
                             textAnchor="middle"
                             className={`text-[9px] font-black uppercase tracking-tighter ${activeLandmarkId === lmId ? 'fill-white' : 'fill-white/30'}`}
                        >
                             {LANDMARK_LABELS[lmId] || lmId}
                        </text>
                    </g>
                );
            })}

            {/* Base Thickness Area */}
            <path
                d={`M ${pctToPx(0)} ${mmToPx(0)} L ${pctToPx(100)} ${mmToPx(0)} L ${pctToPx(100)} ${mmToPx(baseThickness)} L ${pctToPx(0)} ${mmToPx(baseThickness)} Z`}
                fill={sideColor}
                opacity="0.05"
            />
            <line
                x1={PADDING_X} y1={mmToPx(baseThickness)}
                x2={VIEW_WIDTH - PADDING_X} y2={mmToPx(baseThickness)}
                stroke={sideColor} strokeWidth="1" strokeDasharray="2 2" opacity="0.3"
            />
            <text x={VIEW_WIDTH - PADDING_X + 8} y={mmToPx(baseThickness * 0.5) + 3} className="text-[9px] font-bold uppercase tracking-widest" style={{ fill: sideColor, opacity: 0.4 }}>
                Base
            </text>

            {/* Main Profile Area Fill */}
            <path
                d={areaPathData}
                fill={isMedial ? "url(#grad-medial)" : "url(#grad-lateral)"}
                opacity="0.2"
            />
            <defs>
                <linearGradient id="grad-medial" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#14b8a6" />
                    <stop offset="100%" stopColor="transparent" />
                </linearGradient>
                <linearGradient id="grad-lateral" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0ea5e9" />
                    <stop offset="100%" stopColor="transparent" />
                </linearGradient>
            </defs>

            {/* Profile Line */}
            <path
                d={pathData}
                fill="none"
                stroke={sideColor}
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
            />

            {/* Draggable points */}
            {points.map(pt => (
                <g
                key={pt.id}
                onMouseDown={(e) => handleMouseDown(side, pt.id, e, { x: pctToPx(pt.x), y: mmToPx(pt.y) })}
                className="cursor-move group"
                >
                <circle cx={pctToPx(pt.x)} cy={mmToPx(pt.y)} r="18" fill="transparent" />
                <circle
                    cx={pctToPx(pt.x)}
                    cy={mmToPx(pt.y)}
                    r="7"
                    fill={sideColor}
                    stroke="white"
                    strokeWidth="3"
                    // A CSS transform on an SVG element defaults to
                    // transform-box: view-box with transform-origin 0 0, so the hover
                    // scale grew the circle about the SVG's origin instead of its own
                    // centre - the dot jumped 54px right and 33px down the moment the
                    // pointer touched it, while the hit target stayed put. fill-box
                    // makes it scale about itself.
                    className="transition-transform group-hover:scale-125 [transform-box:fill-box] [transform-origin:center]"
                />
                
                {/* Tooltip-like label */}
                <g transform={`translate(${pctToPx(pt.x)}, ${mmToPx(pt.y) - 20})`}>
                    <rect x="-24" y="-16" width="48" height="18" rx="6" fill={sideColor} />
                    <text
                        x="0" y="-4"
                        textAnchor="middle"
                        className="text-[10px] fill-white font-black pointer-events-none"
                    >
                        {(pt.y - baseThickness).toFixed(1)}mm
                    </text>
                </g>
                </g>
            ))}
            </svg>
        </div>
      </Card>
    );
  };

  return (
    <div className="h-full w-full overflow-y-auto p-8 bg-background">
      <div className="max-w-5xl mx-auto pb-24">
        <div className="mb-10 flex items-center justify-between border-b border-white/5 pb-6">
            <div>
                <h2 className="text-3xl font-black tracking-tighter text-white uppercase">基本形状設計 <span className="text-primary">/ Profile</span></h2>
                <p className="text-white/40 mt-2 font-medium tracking-wide">
                    断面プロファイルの制御点をドラッグして、インソールの壁の高さをmm単位で精密に調整します。
                </p>
            </div>
            <div className="bg-primary px-4 py-3 rounded-2xl border border-white/10 text-right">
                <div className="text-[10px] font-bold text-white/80 uppercase tracking-[0.2em] mb-1">Current Base</div>
                <div className="text-xl font-mono font-black text-white">{baseThickness}mm</div>
            </div>
        </div>
        
        {renderView('medial')}
        {renderView('lateral')}
      </div>
    </div>
  );
}