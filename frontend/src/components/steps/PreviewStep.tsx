'use client';

import { useEffect, useState, useRef } from 'react';
import { useStore } from '@/lib/store';
import { generateInsole, getDownloadUrl, getTaskStatus, resolveApiUrl } from '@/lib/api';
import { densifyClosedPolygon } from '@/lib/geometry-utils';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Loader2, Download, AlertCircle, FileText, CheckCircle2, RotateCcw, FolderOpen } from 'lucide-react';
import Canvas3D from '@/components/canvas/Canvas3D';

export default function PreviewStep() {
    const {
        patients,
        patientId,
        flipOrientation,
        outlinePoints,
        landmarkConfig,
        widthConfig,
        archSettingsRight,
        archSettingsLeft,
        archCurves,
        currentModelUrl,
        setCurrentModelUrl,
        // Shape parameters from store
        baseThickness,
        wallHeightOffset,
        heelCupHeight,
        medialWallHeight,
        medialWallPeakX,
        lateralWallHeight,
        lateralWallPeakX,
        archScale,
        enableLattice,
        latticeCellSize,
        strutRadius,
        setCurrentStep,
        // Bottom outline
        bottomOutlinePoints,
        useBottomOutline,
    } = useStore();

    // Compute selectedPatient from patients and patientId
    // (Zustand getters don't work as expected, so we compute it here)
    const selectedPatient = patients.find(p => p.id === patientId);

    const [status, setStatus] = useState<'idle' | 'processing' | 'completed' | 'error'>('idle');
    const [progress, setProgress] = useState(0);
    const [progressMessage, setProgressMessage] = useState('');
    const [resultUrls, setResultUrls] = useState<{ download: string; stl?: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [taskId, setTaskId] = useState<string | null>(null);
    const [activeGenerationSide, setActiveGenerationSide] = useState<'left' | 'right' | null>(null);
    // Both feet are generated on entering this step, so results are kept per side and the
    // viewer just switches between them instead of regenerating.
    const [resultsBySide, setResultsBySide] = useState<Partial<Record<'left' | 'right', { download: string; stl?: string }>>>({});
    const [displaySide, setDisplaySide] = useState<'left' | 'right'>('right');
    const autoRunSignature = useRef<string | null>(null);
    const autoRunning = useRef(false);

    const pollingInterval = useRef<NodeJS.Timeout | null>(null);
    const pollErrorCount = useRef(0);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const blobUrlRef = useRef<string | null>(null);

    const handleOpenLocalSTL = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        const url = URL.createObjectURL(file);
        blobUrlRef.current = url;
        // Add extension marker via query so Canvas3D file-type detection works for blob URLs
        const ext = file.name.toLowerCase().endsWith('.glb') ? '.glb' : '.stl';
        setCurrentModelUrl(`${url}#dummy${ext}`);
        e.target.value = '';
    };

    useEffect(() => () => {
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    }, []);

    // Clean up polling on unmount
    useEffect(() => {
        return () => {
            if (pollingInterval.current) clearInterval(pollingInterval.current);
        };
    }, []);

    // Resolves once the task finishes, so both feet can be generated one after the other.
    const handleGenerate = async (side: 'left' | 'right'): Promise<boolean> => {
        if (!selectedPatient) return false;
        if (pollingInterval.current) {
            clearInterval(pollingInterval.current);
            pollingInterval.current = null;
        }
        pollErrorCount.current = 0;

        setStatus('processing');
        setProgress(0);
        setProgressMessage('Initializing generation...');
        setError(null);
        setResultUrls(null);
        setActiveGenerationSide(side);
        setDisplaySide(side);

        let settle: (ok: boolean) => void = () => { };
        const done = new Promise<boolean>((resolve) => { settle = resolve; });

        try {
            const patientId = selectedPatient.id;

            // Select settings
            const selectedSettings = side === 'right' ? archSettingsRight : archSettingsLeft;

            // Map settings (if needed) - currently just passing through
            const mappedArchSettings = { ...selectedSettings };

            // Merge landmarkConfig and widthConfig for backend
            const mergedLandmarkConfig = {
                ...landmarkConfig,
                ...widthConfig,
            };

            // Densify outline for smooth mesh generation (control points -> smooth curve)
            // Target ~450 dense points for consistent mesh resolution regardless of editing point count.
            const targetDense = 450;
            const subdivisions = Math.max(1, Math.ceil(targetDense / Math.max(1, outlinePoints.length)));
            const denseOutlinePoints = densifyClosedPolygon(outlinePoints, subdivisions);

            // Compute bottom outline points if enabled
            let bottomPoints: { x: number; y: number }[] | undefined;
            if (useBottomOutline && bottomOutlinePoints.length > 0) {
                const subBottom = Math.max(1, Math.ceil(targetDense / Math.max(1, bottomOutlinePoints.length)));
                bottomPoints = densifyClosedPolygon(bottomOutlinePoints, subBottom);
            }

            const response = await generateInsole({
                patient_id: patientId,
                foot_side: side,
                flip_orientation: flipOrientation,
                base_thickness: baseThickness,
                wall_height_offset_mm: wallHeightOffset,
                heel_cup_height: heelCupHeight,
                medial_wall_height: medialWallHeight,
                medial_wall_peak_x: medialWallPeakX,
                lateral_wall_height: lateralWallHeight,
                lateral_wall_peak_x: lateralWallPeakX,
                arch_scale: archScale,
                arch_settings: mappedArchSettings,
                enable_lattice: enableLattice,
                lattice_cell_size: latticeCellSize,
                strut_radius: strutRadius,
                outline_points: denseOutlinePoints,
                landmark_config: mergedLandmarkConfig,
                arch_curves: archCurves || undefined,
                bottom_outline_points: bottomPoints
            });

            const taskId = response.task_id;
            setTaskId(taskId);

            // Poll for task completion
            const pollTask = async () => {
                try {
                    const status = await getTaskStatus(taskId);
                    pollErrorCount.current = 0;
                    setProgress(status.progress);
                    setProgressMessage(status.message);

                    if (status.status === 'completed') {
                        if (pollingInterval.current) {
                            clearInterval(pollingInterval.current);
                            pollingInterval.current = null;
                        }
                        setStatus('completed');

                        // Use URLs from backend response if available
                        const appendCacheBuster = (url: string) => {
                            const sep = url.includes('?') ? '&' : '?';
                            return `${url}${sep}t=${Date.now()}`;
                        };
                        let glbUrl: string;
                        let stlUrl: string | undefined;
                        if (status.result) {
                            glbUrl = resolveApiUrl(status.result.download_url);
                            stlUrl = status.result.stl_url
                                ? resolveApiUrl(status.result.stl_url)
                                : undefined;
                        } else {
                            // Fallback to constructed URLs
                            glbUrl = getDownloadUrl(`generated_${patientId}_${side}.glb`);
                            stlUrl = getDownloadUrl(`generated_${patientId}_${side}.stl`);
                        }
                        const urls = { download: glbUrl, stl: stlUrl };
                        setResultUrls(urls);
                        setResultsBySide((current) => ({ ...current, [side]: urls }));
                        setCurrentModelUrl(appendCacheBuster(glbUrl));
                        settle(true);
                    } else if (status.status === 'failed') {
                        if (pollingInterval.current) {
                            clearInterval(pollingInterval.current);
                            pollingInterval.current = null;
                        }
                        setError(status.message || 'Generation failed');
                        setStatus('error');
                        settle(false);
                    }
                } catch (pollError: any) {
                    pollErrorCount.current += 1;
                    setProgressMessage('Connection issue. Retrying...');
                    if (pollErrorCount.current >= 3) {
                        if (pollingInterval.current) {
                            clearInterval(pollingInterval.current);
                            pollingInterval.current = null;
                        }
                        const message = String(pollError?.message || '');
                        if (message.includes('(404)')) {
                            setError('Task not found. Backend may have restarted. Please regenerate.');
                        } else {
                            setError(message || 'Failed to poll generation status.');
                        }
                        setStatus('error');
                        settle(false);
                    }
                }
            };

            // Start polling every 500ms
            pollingInterval.current = setInterval(pollTask, 500);
            // Also poll immediately
            await pollTask();

        } catch (err: any) {
            console.error(err);
            setError(err.message || 'An error occurred during generation.');
            setStatus('error');
            settle(false);
        }

        return done;
    };

    // Auto-generate both feet on entering this step. Re-runs when anything that affects the
    // mesh changes, so what is on screen always matches the current settings. The signature
    // keeps it from regenerating when the user merely navigates back and forth.
    const generationSignature = JSON.stringify({
        patientId: selectedPatient?.id,
        flipOrientation,
        outlinePoints,
        bottomOutlinePoints: useBottomOutline ? bottomOutlinePoints : null,
        landmarkConfig,
        widthConfig,
        archSettingsRight,
        archSettingsLeft,
        archCurves,
        baseThickness,
        wallHeightOffset,
        heelCupHeight,
        medialWallHeight,
        medialWallPeakX,
        lateralWallHeight,
        lateralWallPeakX,
        archScale,
        enableLattice,
        latticeCellSize,
        strutRadius,
    });

    useEffect(() => {
        if (!selectedPatient) return;
        if (outlinePoints.length === 0) return;
        if (autoRunSignature.current === generationSignature) return;
        if (autoRunning.current) return;

        autoRunSignature.current = generationSignature;
        autoRunning.current = true;
        let cancelled = false;

        (async () => {
            setResultsBySide({});
            // Sequential: the backend runs one task at a time, and the progress bar tracks one.
            for (const side of ['right', 'left'] as const) {
                if (cancelled) break;
                await handleGenerate(side);
            }
            if (!cancelled) setDisplaySide('right');
            autoRunning.current = false;
        })();

        return () => {
            cancelled = true;
            autoRunning.current = false;
        };
        // handleGenerate is recreated every render; the signature is the real trigger.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [generationSignature, selectedPatient?.id]);

    const showSide = (side: 'left' | 'right') => {
        const urls = resultsBySide[side];
        if (!urls) return;
        setDisplaySide(side);
        setResultUrls(urls);
        const sep = urls.download.includes('?') ? '&' : '?';
        setCurrentModelUrl(`${urls.download}${sep}t=${Date.now()}`);
    };

    if (!selectedPatient) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-8 text-muted-foreground gap-4">
                <AlertCircle className="h-12 w-12 text-muted-foreground/50" />
                <p className="text-lg">患者データが選択されていません</p>
                <p className="text-sm">左側のメニューから対象の患者を選択してください。</p>
            </div>
        );
    }

    return (
        <div className="h-full flex gap-4 p-4">
            {/* Side Panel - Controls */}
            <div className="w-64 flex-shrink-0 flex flex-col gap-3 overflow-y-auto">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">生成</h3>
                    <span className="text-[10px] text-muted-foreground">両足を自動生成します</span>
                </div>

                {/* Left Foot */}
                <div
                    onClick={() => showSide('left')}
                    className={`p-3 rounded-lg border-2 transition-all cursor-pointer ${displaySide === 'left'
                        ? 'border-orange-500/50 bg-orange-500/10'
                        : 'border-border hover:border-border/80 bg-card'
                        }`}
                >
                    <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm">左足</span>
                        {resultsBySide.left && (
                            <CheckCircle2 className="text-green-500 h-4 w-4" />
                        )}
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">
                        内側: {archSettingsLeft.medial_height.toFixed(1)}mm / 外側: {archSettingsLeft.lateral_height.toFixed(1)}mm
                    </div>
                    <Button
                        className="w-full"
                        size="sm"
                        variant={displaySide === 'left' ? 'default' : 'outline'}
                        onClick={(e) => { e.stopPropagation(); handleGenerate('left'); }}
                        disabled={status === 'processing'}
                    >
                        {status === 'processing' && activeGenerationSide === 'left' ? (
                            <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> 生成中</>
                        ) : (
                            <><FileText className="mr-1 h-3 w-3" /> 再生成</>
                        )}
                    </Button>
                </div>

                {/* Right Foot */}
                <div
                    onClick={() => showSide('right')}
                    className={`p-3 rounded-lg border-2 transition-all cursor-pointer ${displaySide === 'right'
                        ? 'border-blue-500/50 bg-blue-500/10'
                        : 'border-border hover:border-border/80 bg-card'
                        }`}
                >
                    <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm">右足</span>
                        {resultsBySide.right && (
                            <CheckCircle2 className="text-green-500 h-4 w-4" />
                        )}
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">
                        内側: {archSettingsRight.medial_height.toFixed(1)}mm / 外側: {archSettingsRight.lateral_height.toFixed(1)}mm
                    </div>
                    <Button
                        className="w-full"
                        size="sm"
                        variant={displaySide === 'right' ? 'default' : 'outline'}
                        onClick={(e) => { e.stopPropagation(); handleGenerate('right'); }}
                        disabled={status === 'processing'}
                    >
                        {status === 'processing' && activeGenerationSide === 'right' ? (
                            <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> 生成中</>
                        ) : (
                            <><FileText className="mr-1 h-3 w-3" /> 再生成</>
                        )}
                    </Button>
                </div>

                {/* Progress */}
                {status === 'processing' && (
                    <div className="p-3 rounded-lg bg-card border border-border">
                        <div className="text-xs text-muted-foreground mb-1">{progressMessage}</div>
                        <Progress value={progress} className="h-1.5" />
                        <div className="text-xs text-muted-foreground mt-1 text-right">{progress}%</div>
                    </div>
                )}

                {/* Error */}
                {status === 'error' && (
                    <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                        <div className="flex items-start gap-2">
                            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                            <div>
                                <div className="text-xs font-medium text-destructive">エラー</div>
                                <div className="text-xs text-destructive/80">{error}</div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Download Buttons */}
                {status === 'completed' && resultUrls && (
                    <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 space-y-2">
                        <div className="text-xs font-medium text-green-500 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> ダウンロード
                        </div>
                        <Button
                            className="w-full bg-green-600 hover:bg-green-700 text-white"
                            size="sm"
                            asChild
                        >
                            <a href={resultUrls.download} download>
                                <Download className="mr-1 h-3 w-3" /> GLB
                            </a>
                        </Button>
                        {resultUrls.stl && (
                            <Button
                                variant="outline"
                                className="w-full border-green-600/30 text-green-500 hover:bg-green-500/10 hover:text-green-400"
                                size="sm"
                                asChild
                            >
                                <a href={resultUrls.stl} download>
                                    <Download className="mr-1 h-3 w-3" /> STL
                                </a>
                            </Button>
                        )}
                    </div>
                )}

                {/* Open Local STL/GLB Button */}
                <div className="space-y-2">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".stl,.glb,model/stl,model/gltf-binary"
                        onChange={handleOpenLocalSTL}
                        className="hidden"
                    />
                    <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <FolderOpen className="mr-1 h-3 w-3" />
                        保存した STL/GLB を開く
                    </Button>
                </div>

                {/* Back to Start Button */}
                <div className="mt-auto pt-4">
                    <Button
                        variant="ghost"
                        onClick={() => setCurrentStep(0)}
                        className="w-full text-muted-foreground hover:text-foreground"
                        size="sm"
                    >
                        <RotateCcw className="mr-1 h-3 w-3" /> 最初から
                    </Button>
                </div>
            </div>

            {/* Main Area - 3D Preview */}
            <div className="flex-1 flex flex-col min-h-0">
                <div className="flex-1 rounded-lg border border-border bg-background overflow-hidden relative">
                    <Canvas3D />

                    {/* Overlay when no model */}
                    {!currentModelUrl && status !== 'processing' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[2px] z-10 pointer-events-none">
                            <div className="text-center p-6 w-full">
                                <div className="mb-4">
                                    <img src="/logo.png" alt="Bionic Sole" className="h-24 w-auto mx-auto drop-shadow-xl" />
                                </div>
                                <p className="text-white text-lg font-bold tracking-wide drop-shadow-md">
                                    <span className="text-teal-400">両足を自動生成中</span>です。完了後、左側のパネルで<span className="text-teal-400">左右を切り替え</span>られます
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Processing overlay */}
                    {status === 'processing' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/80">
                            <div className="text-center p-6">
                                <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
                                <p className="text-muted-foreground text-sm">{progressMessage}</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer info */}
                <div className="mt-2 text-xs text-muted-foreground text-center">
                    ドラッグで回転 / スクロールでズーム / 右ドラッグで移動
                </div>
            </div>
        </div>
    );
}
