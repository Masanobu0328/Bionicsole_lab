'use client';

import { useEffect, useState, useRef } from 'react';
import { useStore } from '@/lib/store';
import { generateInsole, getDownloadUrl, getTaskStatus, resolveApiUrl } from '@/lib/api';
import { densifyClosedPolygon } from '@/lib/geometry-utils';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Loader2, Download, AlertCircle, FileText, CheckCircle2, RotateCcw, FolderOpen } from 'lucide-react';
import Canvas3D from '@/components/canvas/Canvas3D';

type FootSide = 'left' | 'right';
type GenerationStatus = 'idle' | 'processing' | 'completed' | 'error';
type ResultUrls = { download: string; stl?: string };
type SideGenerationState = {
    status: GenerationStatus;
    progress: number;
    message: string;
    error: string | null;
    taskId: string | null;
};

const initialAutoGenerationState = (): Record<FootSide, SideGenerationState> => ({
    left: {
        status: 'processing',
        progress: 0,
        message: '右足の完了後に生成します...',
        error: null,
        taskId: null,
    },
    right: {
        status: 'processing',
        progress: 0,
        message: '生成を開始しています...',
        error: null,
        taskId: null,
    },
});

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

    const [generationBySide, setGenerationBySide] = useState(initialAutoGenerationState);
    const [resultsBySide, setResultsBySide] = useState<Partial<Record<FootSide, ResultUrls>>>({});
    const [displaySide, setDisplaySide] = useState<FootSide>('right');
    const autoRunStarted = useRef(false);

    const pollingTimeouts = useRef<Partial<Record<FootSide, NodeJS.Timeout>>>({});
    const pollErrorCounts = useRef<Record<FootSide, number>>({ left: 0, right: 0 });
    const generationTokens = useRef<Record<FootSide, number>>({ left: 0, right: 0 });
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const blobUrlRef = useRef<string | null>(null);
    const resultUrls = resultsBySide[displaySide] ?? null;

    const updateGeneration = (side: FootSide, update: Partial<SideGenerationState>) => {
        setGenerationBySide((current) => ({
            ...current,
            [side]: { ...current[side], ...update },
        }));
    };

    const clearPolling = (side: FootSide) => {
        const timeout = pollingTimeouts.current[side];
        if (timeout) clearTimeout(timeout);
        delete pollingTimeouts.current[side];
    };

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

    // Clean up both independent pollers on unmount.
    useEffect(() => {
        return () => {
            generationTokens.current.left += 1;
            generationTokens.current.right += 1;
            clearPolling('left');
            clearPolling('right');
        };
    }, []);

    // Each side owns its task state and poller. This lets the completed right model remain
    // interactive while the left task continues in the background.
    const handleGenerate = async (side: FootSide, showWhenComplete = true): Promise<boolean> => {
        if (!selectedPatient) return false;
        clearPolling(side);
        pollErrorCounts.current[side] = 0;
        const generationToken = generationTokens.current[side] + 1;
        generationTokens.current[side] = generationToken;

        updateGeneration(side, {
            status: 'processing',
            progress: 0,
            message: '生成を開始しています...',
            error: null,
            taskId: null,
        });
        setResultsBySide((current) => {
            const next = { ...current };
            delete next[side];
            return next;
        });

        let settle: (ok: boolean) => void = () => { };
        const done = new Promise<boolean>((resolve) => { settle = resolve; });
        const isCurrentGeneration = () => generationTokens.current[side] === generationToken;

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
            if (!isCurrentGeneration()) return false;
            updateGeneration(side, { taskId });

            // Poll for task completion
            const pollTask = async () => {
                try {
                    const status = await getTaskStatus(taskId);
                    if (!isCurrentGeneration()) return;
                    pollErrorCounts.current[side] = 0;
                    updateGeneration(side, {
                        progress: status.progress,
                        message: '3Dモデルを生成しています...',
                    });

                    if (status.status === 'completed') {
                        clearPolling(side);

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
                        setResultsBySide((current) => ({ ...current, [side]: urls }));
                        updateGeneration(side, {
                            status: 'completed',
                            progress: 100,
                            message: '生成が完了しました',
                            error: null,
                        });
                        if (showWhenComplete) {
                            setDisplaySide(side);
                            setCurrentModelUrl(appendCacheBuster(glbUrl));
                        }
                        settle(true);
                    } else if (status.status === 'failed') {
                        clearPolling(side);
                        updateGeneration(side, {
                            status: 'error',
                            error: '生成に失敗しました。再生成してください。',
                        });
                        settle(false);
                    } else {
                        pollingTimeouts.current[side] = setTimeout(pollTask, 500);
                    }
                } catch (pollError: any) {
                    if (!isCurrentGeneration()) return;
                    pollErrorCounts.current[side] += 1;
                    updateGeneration(side, { message: '接続を再試行しています...' });
                    if (pollErrorCounts.current[side] >= 3) {
                        clearPolling(side);
                        const message = String(pollError?.message || '');
                        if (message.includes('(404)')) {
                            updateGeneration(side, {
                                status: 'error',
                                error: '生成タスクが見つかりません。再生成してください。',
                            });
                        } else {
                            updateGeneration(side, {
                                status: 'error',
                                error: '生成状況を取得できませんでした。',
                            });
                        }
                        settle(false);
                    } else {
                        pollingTimeouts.current[side] = setTimeout(pollTask, 500);
                    }
                }
            };

            // Poll immediately; subsequent polls are scheduled after each response.
            await pollTask();

        } catch (err: any) {
            console.error(err);
            if (!isCurrentGeneration()) return false;
            updateGeneration(side, {
                status: 'error',
                error: '生成中にエラーが発生しました。',
            });
            settle(false);
        }

        return done;
    };

    // Run once per PreviewStep mount. A remount means the user left and re-entered the step.
    useEffect(() => {
        if (!selectedPatient) return;
        if (outlinePoints.length === 0) return;
        if (autoRunStarted.current) return;

        autoRunStarted.current = true;
        let cancelled = false;

        // Deferring one tick prevents React Strict Mode's mount check from submitting a
        // duplicate backend task; its first effect pass is cleaned up before this runs.
        const startTimeout = setTimeout(() => {
            void (async () => {
                setResultsBySide({});
                setGenerationBySide(initialAutoGenerationState());
                setDisplaySide('right');

                const rightCompleted = await handleGenerate('right', true);
                if (cancelled) return;

                // The backend remains sequential, but the left poller no longer controls the
                // viewer. The right model is therefore usable throughout left generation.
                void handleGenerate('left', !rightCompleted);
            })();
        }, 0);

        return () => {
            cancelled = true;
            clearTimeout(startTimeout);
            autoRunStarted.current = false;
        };
        // An empty dependency list makes step entry, rather than settings changes, the trigger.
        // Resetting the ref in cleanup also supports React Strict Mode's mount check.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const showSide = (side: FootSide) => {
        const urls = resultsBySide[side];
        if (!urls || generationBySide[side].status !== 'completed') return;
        setDisplaySide(side);
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
                    className={`p-3 rounded-lg border-2 transition-all ${resultsBySide.left && generationBySide.left.status === 'completed'
                        ? 'cursor-pointer'
                        : 'cursor-not-allowed'
                        } ${displaySide === 'left' && resultsBySide.left
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
                        disabled={generationBySide.left.status === 'processing'}
                    >
                        {generationBySide.left.status === 'processing' ? (
                            <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> 生成中</>
                        ) : (
                            <><FileText className="mr-1 h-3 w-3" /> 再生成</>
                        )}
                    </Button>
                    {generationBySide.left.status === 'processing' && (
                        <div className="mt-2 space-y-1">
                            <div className="text-xs text-muted-foreground">{generationBySide.left.message}</div>
                            <Progress value={generationBySide.left.progress} className="h-1.5" />
                            <div className="text-xs text-muted-foreground text-right">{generationBySide.left.progress}%</div>
                        </div>
                    )}
                    {generationBySide.left.status === 'error' && (
                        <div className="mt-2 flex items-start gap-1 text-xs text-destructive">
                            <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                            <span>{generationBySide.left.error}</span>
                        </div>
                    )}
                </div>

                {/* Right Foot */}
                <div
                    onClick={() => showSide('right')}
                    className={`p-3 rounded-lg border-2 transition-all ${resultsBySide.right && generationBySide.right.status === 'completed'
                        ? 'cursor-pointer'
                        : 'cursor-not-allowed'
                        } ${displaySide === 'right' && resultsBySide.right
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
                        disabled={generationBySide.right.status === 'processing'}
                    >
                        {generationBySide.right.status === 'processing' ? (
                            <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> 生成中</>
                        ) : (
                            <><FileText className="mr-1 h-3 w-3" /> 再生成</>
                        )}
                    </Button>
                    {generationBySide.right.status === 'processing' && (
                        <div className="mt-2 space-y-1">
                            <div className="text-xs text-muted-foreground">{generationBySide.right.message}</div>
                            <Progress value={generationBySide.right.progress} className="h-1.5" />
                            <div className="text-xs text-muted-foreground text-right">{generationBySide.right.progress}%</div>
                        </div>
                    )}
                    {generationBySide.right.status === 'error' && (
                        <div className="mt-2 flex items-start gap-1 text-xs text-destructive">
                            <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                            <span>{generationBySide.right.error}</span>
                        </div>
                    )}
                </div>

                {/* Download Buttons */}
                {resultUrls && (
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
                    {!currentModelUrl && generationBySide.right.status !== 'processing' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[2px] z-10 pointer-events-none">
                            <div className="text-center p-6 w-full">
                                <div className="mb-4">
                                    <img src="/logo.png" alt="Bionic Sole" className="h-24 w-auto mx-auto drop-shadow-xl" />
                                </div>
                                <p className="text-white text-lg font-bold tracking-wide drop-shadow-md">
                                    <span className="text-teal-400">右足を生成しています</span>。完了後すぐに3Dモデルを表示します
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Processing overlay */}
                    {generationBySide.right.status === 'processing' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/80">
                            <div className="text-center p-6">
                                <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
                                <p className="text-muted-foreground text-sm">{generationBySide.right.message}</p>
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
