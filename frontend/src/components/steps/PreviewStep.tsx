'use client';

import { useEffect, useState, useRef } from 'react';
import { useStore } from '@/lib/store';
import { generateInsole, getDownloadUrl, getTaskStatus, resolveApiUrl } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Loader2, Download, AlertCircle, FileText, CheckCircle2, RotateCcw } from 'lucide-react';
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

    const pollingInterval = useRef<NodeJS.Timeout | null>(null);
    const pollErrorCount = useRef(0);

    // Clean up polling on unmount
    useEffect(() => {
        return () => {
            if (pollingInterval.current) clearInterval(pollingInterval.current);
        };
    }, []);

    const handleGenerate = async (side: 'left' | 'right') => {
        if (!selectedPatient) return;
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
                outline_points: outlinePoints,
                landmark_config: mergedLandmarkConfig,
                arch_curves: archCurves || undefined
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
                        if (status.result) {
                            const cacheBuster = `?t=${Date.now()}`;
                            const glbUrl = resolveApiUrl(status.result.download_url);
                            const stlUrl = status.result.stl_url
                                ? resolveApiUrl(status.result.stl_url)
                                : undefined;
                            setResultUrls({
                                download: glbUrl,
                                stl: stlUrl
                            });
                            setCurrentModelUrl(glbUrl + cacheBuster);
                        } else {
                            // Fallback to constructed URLs
                            const cacheBuster = `?t=${Date.now()}`;
                            const glbUrl = getDownloadUrl(`generated_${patientId}_${side}.glb`);
                            const stlUrl = getDownloadUrl(`generated_${patientId}_${side}.stl`);
                            setResultUrls({
                                download: glbUrl,
                                stl: stlUrl
                            });
                            setCurrentModelUrl(glbUrl + cacheBuster);
                        }
                    } else if (status.status === 'failed') {
                        if (pollingInterval.current) {
                            clearInterval(pollingInterval.current);
                            pollingInterval.current = null;
                        }
                        setError(status.message || 'Generation failed');
                        setStatus('error');
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
        }
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
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">生成</h3>

                {/* Left Foot */}
                <div
                    className={`p-3 rounded-lg border-2 transition-all cursor-pointer ${activeGenerationSide === 'left'
                        ? 'border-orange-500/50 bg-orange-500/10'
                        : 'border-border hover:border-border/80 bg-card'
                        }`}
                >
                    <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm">左足</span>
                        {status === 'completed' && activeGenerationSide === 'left' && (
                            <CheckCircle2 className="text-green-500 h-4 w-4" />
                        )}
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">
                        内側: {archSettingsLeft.medial_height.toFixed(1)}mm / 外側: {archSettingsLeft.lateral_height.toFixed(1)}mm
                    </div>
                    <Button
                        className="w-full"
                        size="sm"
                        variant={activeGenerationSide === 'left' ? 'default' : 'outline'}
                        onClick={() => handleGenerate('left')}
                        disabled={status === 'processing'}
                    >
                        {status === 'processing' && activeGenerationSide === 'left' ? (
                            <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> 生成中</>
                        ) : (
                            <><FileText className="mr-1 h-3 w-3" /> 生成</>
                        )}
                    </Button>
                </div>

                {/* Right Foot */}
                <div
                    className={`p-3 rounded-lg border-2 transition-all cursor-pointer ${activeGenerationSide === 'right'
                        ? 'border-blue-500/50 bg-blue-500/10'
                        : 'border-border hover:border-border/80 bg-card'
                        }`}
                >
                    <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm">右足</span>
                        {status === 'completed' && activeGenerationSide === 'right' && (
                            <CheckCircle2 className="text-green-500 h-4 w-4" />
                        )}
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">
                        内側: {archSettingsRight.medial_height.toFixed(1)}mm / 外側: {archSettingsRight.lateral_height.toFixed(1)}mm
                    </div>
                    <Button
                        className="w-full"
                        size="sm"
                        variant={activeGenerationSide === 'right' ? 'default' : 'outline'}
                        onClick={() => handleGenerate('right')}
                        disabled={status === 'processing'}
                    >
                        {status === 'processing' && activeGenerationSide === 'right' ? (
                            <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> 生成中</>
                        ) : (
                            <><FileText className="mr-1 h-3 w-3" /> 生成</>
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
                                    左側のパネルから<span className="text-teal-400">足を選択</span>して<span className="text-teal-400">「生成」ボタン</span>を押してください
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
