'use client';

import React, { useEffect, useState, ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Download, Loader2, Upload, ChevronRight, ChevronLeft, CheckCircle2 } from 'lucide-react';
import { useStore, STEPS } from '@/lib/store';
import { getPatients, generateInsole, getTaskStatus, Patient } from '@/lib/api';
import { parseOutlineCsv, resamplePolygon } from '@/lib/geometry-utils';
import { DEMO_OUTLINE_CSV } from '@/lib/demo-data';

const LANDMARK_LIST = [
    { id: 'arch_start', label: 'アーチ開始 (Medial)' },
    { id: 'lateral_arch_start', label: 'アーチ開始 (Lateral)' },
    { id: 'subtalar', label: '距骨下 (Subtalar)' },
    { id: 'navicular', label: '舟状骨 (Navicular)' },
    { id: 'cuboid', label: '立方骨 (Cuboid)' },
    { id: 'medial_cuneiform', label: '楔状骨 (Cuneiform)' },
    { id: 'metatarsal', label: '中足骨 (Metatarsal)' },
];

export default function Sidebar() {
    const [targetSize, setTargetSize] = useState('260'); // String for Select

    const store = useStore();
    const {
        currentStep, setCurrentStep,
        patients, setPatients,
        patientId, setPatientId,
        footSide, setFootSide,
        flipOrientation, setFlipOrientation,
        
        outlinePoints, setOutlineImage, setOutlinePoints,
        landmarkConfig, updateLandmarkPos,
        activeLandmarkId, setActiveLandmarkId,
        
        baseThickness, setBaseThickness,
        wallHeightOffset, setWallHeightOffset,
        heelCupHeight, setHeelCupHeight,
        medialWallHeight, setMedialWallHeight,
        medialWallPeakX, setMedialWallPeakX,
        lateralWallHeight, setLateralWallHeight,
        lateralWallPeakX, setLateralWallPeakX,
        enableLattice, setEnableLattice,
        latticeCellSize, setLatticeCellSize,
        strutRadius, setStrutRadius,

        archScale, setArchScale,
        // New Arch State
        activeFootSide, setActiveFootSide,
        archSettingsRight, archSettingsLeft, updateArchSettings,
        
        useGridCells, gridCellHeights,
        
        isGenerating, setIsGenerating,
        progress, setProgress,
        progressMessage, setProgressMessage,
        currentModelUrl, setCurrentModelUrl,
        stlUrl, setStlUrl,
        setLatticeInfo,
    } = store;

    useEffect(() => {
        async function loadPatients() {
            try {
                const data = await getPatients();
                setPatients(data);
                if (data.length > 0 && !patientId) {
                    setPatientId(data[0].id);
                }
            } catch (error) {
                console.error('Failed to load patients:', error);
            }
        }
        loadPatients();
    }, [patientId, setPatientId]);

    const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (evt) => {
                setOutlineImage(evt.target?.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleApplySize = () => {
        const size = parseInt(targetSize, 10);
        // Use the demo outline as base, scaled to size, and smoothed/resampled
        // Use 50 points for easy editing. Higher density (300) will be added at generation time.
        setOutlinePoints(parseOutlineCsv(DEMO_OUTLINE_CSV, size, 50));
    };

    // Navigation Helpers
    const nextStep = () => {
        if (currentStep === STEPS.OUTLINE) {
            const resampled = resamplePolygon(outlinePoints, 200);
            setOutlinePoints(resampled);
        }
        setCurrentStep(Math.min(Object.keys(STEPS).length - 1, currentStep + 1));
    };
    const prevStep = () => setCurrentStep(Math.max(0, currentStep - 1));

    // Render Steps
    const renderStepContent = () => {
        switch (currentStep) {
            case STEPS.PATIENT:
                return (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>患者名</Label>
                            <Select value={patientId || ''} onValueChange={setPatientId}>
                                <SelectTrigger><SelectValue placeholder="選択..." /></SelectTrigger>
                                <SelectContent>{patients.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            ※足の左右は、後の工程で個別に調整・生成できます。
                        </p>
                    </div>
                );
            case STEPS.OUTLINE:
                return (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>足底画像 (任意)</Label>
                            <div className="flex items-center gap-2">
                                <Input type="file" accept="image/*" onChange={handleImageUpload} className="text-xs" />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>サイズ目安 (mm)</Label>
                            <div className="flex gap-2">
                                <Select value={targetSize} onValueChange={setTargetSize}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {Array.from({ length: (300 - 220) / 5 + 1 }).map((_, i) => {
                                            const s = 220 + i * 5;
                                            return (
                                                <SelectItem key={s} value={s.toString()}>{s} mm</SelectItem>
                                            );
                                        })}
                                    </SelectContent>
                                </Select>
                                <Button variant="secondary" onClick={handleApplySize}>適用</Button>
                            </div>
                            <p className="text-xs text-muted-foreground">※適用すると現在の形状がリセットされます</p>
                        </div>
                    </div>
                );
            case STEPS.LANDMARKS:
                return (
                    <div className="space-y-4">
                        <Label>ランドマーク位置調整 (%)</Label>
                        <div className="space-y-4 pr-2">
                            {LANDMARK_LIST.map(lm => {
                                const percent = landmarkConfig[lm.id] ?? 50;
                                const isActive = activeLandmarkId === lm.id;
                                return (
                                    <div 
                                        key={lm.id} 
                                        className={`space-y-1 p-2 rounded transition-colors ${isActive ? 'bg-muted' : ''}`}
                                        onMouseEnter={() => setActiveLandmarkId(lm.id)}
                                        onMouseLeave={() => setActiveLandmarkId(null)}
                                    >
                                        <div className="flex justify-between">
                                            <Label className={`text-xs ${isActive ? 'text-primary font-bold' : ''}`}>
                                                {lm.label}
                                            </Label>
                                            <span className="text-xs text-muted-foreground">{percent.toFixed(1)}%</span>
                                        </div>
                                        <Slider
                                            value={[percent]}
                                            min={0} max={100} step={0.5}
                                            onValueChange={([v]) => updateLandmarkPos(lm.id, v)}
                                            className="py-1"
                                        />
                                    </div>
                                );
                            })}
                        </div>
                        <p className="text-xs text-muted-foreground mt-2 border-t pt-2">
                            0% = 踵, 100% = つま先。スライダーまたは右の画面でラインをドラッグして調整してください。
                        </p>
                    </div>
                );
            case STEPS.SHAPE:
                return (
                    <div className="space-y-4 pr-2">
                        <div className="space-y-1">
                            <div className="flex justify-between">
                                <Label className="text-xs">ベース厚み</Label>
                                <span className="text-xs font-mono">{baseThickness}mm</span>
                            </div>
                            <Slider value={[baseThickness]} onValueChange={([v]) => setBaseThickness(v)} min={2} max={6} step={0.1} />
                        </div>
                        
                        <div className="space-y-1">
                            <div className="flex justify-between">
                                <Label className="text-xs">ヒールカップ高さ</Label>
                                <span className="text-xs font-mono">{heelCupHeight}mm</span>
                            </div>
                            <Slider value={[heelCupHeight]} onValueChange={([v]) => setHeelCupHeight(v)} min={0} max={15} step={0.5} />
                        </div>

                        <div className="pt-2 border-t space-y-3">
                            <Label className="text-[10px] uppercase text-muted-foreground">内側壁 (Medial Wall)</Label>
                            <div className="space-y-1">
                                <div className="flex justify-between">
                                    <Label className="text-[11px]">最大高さ</Label>
                                    <span className="text-xs">{medialWallHeight}mm</span>
                                </div>
                                <Slider value={[medialWallHeight]} onValueChange={([v]) => setMedialWallHeight(v)} min={0} max={15} step={0.1} />
                            </div>
                            <div className="space-y-1">
                                <div className="flex justify-between">
                                    <Label className="text-[11px]">位置 (%)</Label>
                                    <span className="text-xs">{medialWallPeakX}%</span>
                                </div>
                                <Slider value={[medialWallPeakX]} onValueChange={([v]) => setMedialWallPeakX(v)} min={5} max={95} step={1} />
                            </div>
                        </div>

                        <div className="pt-2 border-t space-y-3">
                            <Label className="text-[10px] uppercase text-muted-foreground">外側壁 (Lateral Wall)</Label>
                            <div className="space-y-1">
                                <div className="flex justify-between">
                                    <Label className="text-[11px]">最大高さ</Label>
                                    <span className="text-xs">{lateralWallHeight}mm</span>
                                </div>
                                <Slider value={[lateralWallHeight]} onValueChange={([v]) => setLateralWallHeight(v)} min={0} max={15} step={0.1} />
                            </div>
                            <div className="space-y-1">
                                <div className="flex justify-between">
                                    <Label className="text-[11px]">位置 (%)</Label>
                                    <span className="text-xs">{lateralWallPeakX}%</span>
                                </div>
                                <Slider value={[lateralWallPeakX]} onValueChange={([v]) => setLateralWallPeakX(v)} min={5} max={95} step={1} />
                            </div>
                        </div>

                        <div className="pt-4 border-t">
                            <div className="flex items-center justify-between mb-2">
                                <Label>ラティス構造</Label>
                                <Switch checked={enableLattice} onCheckedChange={setEnableLattice} />
                            </div>
                            {enableLattice && (
                                <div className="space-y-2 pl-2">
                                    <Label className="text-xs">セルサイズ: {latticeCellSize}mm</Label>
                                    <Slider value={[latticeCellSize]} onValueChange={([v]) => setLatticeCellSize(v)} min={2} max={10} step={1} />
                                </div>
                            )}
                        </div>
                    </div>
                );
            case STEPS.ARCH_REGION: // Step 5
                return (
                    <div className="space-y-4">
                        <div className="space-y-1">
                            <Label className="text-base font-semibold text-primary">アーチ領域調整 (2D)</Label>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                右足ベースでアーチの適用範囲（幅）を調整します。<br/>
                                <span className="text-foreground font-bold">※ここで作成した形状は反転して左足にも適用されます。</span><br/>
                                右側のエディタで制御点をドラッグしてください。
                            </p>
                        </div>
                    </div>
                );
            case STEPS.ARCH_HEIGHT: // Step 6
                const currentSettings = activeFootSide === 'right' ? archSettingsRight : archSettingsLeft;
                
                return (
                    <div className="space-y-6">
                        {/* Side Toggle */}
                        <div className="flex bg-muted p-1 rounded-lg">
                            <Button 
                                variant={activeFootSide === 'right' ? 'secondary' : 'ghost'} 
                                size="sm" 
                                className="flex-1"
                                onClick={() => setActiveFootSide('right')}
                            >
                                右足 (Right)
                            </Button>
                            <Button 
                                variant={activeFootSide === 'left' ? 'secondary' : 'ghost'} 
                                size="sm" 
                                className="flex-1"
                                onClick={() => setActiveFootSide('left')}
                            >
                                左足 (Left)
                            </Button>
                        </div>

                        <div className="space-y-4">
                            <Label className="text-base font-semibold text-primary">内側縦アーチ</Label>
                            <div className="space-y-1">
                                <div className="flex justify-between">
                                    <Label className="text-xs text-foreground">高さ</Label>
                                    <span className="text-xs font-mono text-foreground">{currentSettings.medial_height.toFixed(1)}mm</span>
                                </div>
                                <Slider
                                    value={[currentSettings.medial_height]}
                                    onValueChange={([v]) => updateArchSettings(activeFootSide, { medial_height: v })}
                                    min={0} max={10} step={0.1}
                                />
                            </div>
                        </div>

                        <div className="space-y-4">
                            <Label className="text-base font-semibold text-primary">横アーチ</Label>
                            <div className="space-y-1">
                                <div className="flex justify-between">
                                    <Label className="text-xs text-foreground">高さ</Label>
                                    <span className="text-xs font-mono text-foreground">{currentSettings.transverse_height.toFixed(1)}mm</span>
                                </div>
                                <Slider
                                    value={[currentSettings.transverse_height]}
                                    onValueChange={([v]) => updateArchSettings(activeFootSide, { transverse_height: v })}
                                    min={0} max={10} step={0.1}
                                />
                            </div>
                        </div>

                        <div className="space-y-4">
                            <Label className="text-base font-semibold text-primary">外側縦アーチ</Label>
                            <div className="space-y-1">
                                <div className="flex justify-between">
                                    <Label className="text-xs text-foreground">高さ</Label>
                                    <span className="text-xs font-mono text-foreground">{currentSettings.lateral_height.toFixed(1)}mm</span>
                                </div>
                                <Slider
                                    value={[currentSettings.lateral_height]}
                                    onValueChange={([v]) => updateArchSettings(activeFootSide, { lateral_height: v })}
                                    min={0} max={10} step={0.1}
                                />
                            </div>
                        </div>
                    </div>
                );
            case STEPS.PREVIEW:
                return (
                    <div className="space-y-4">
                        <div className="p-4 bg-muted/30 rounded border border-border text-sm text-foreground">
                            <p>すべての設定が完了しました。</p>
                            <p className="mt-2 text-muted-foreground">右側のメインエリアにある<br/><strong className="text-primary font-bold">「インソール生成を実行」</strong>ボタンを押して、3Dモデルを作成してください。</p>
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };

    const getStepTitle = () => {
        switch(currentStep) {
            case STEPS.PATIENT: return "基本情報";
            case STEPS.OUTLINE: return "輪郭作成";
            case STEPS.LANDMARKS: return "ランドマーク";
            case STEPS.SHAPE: return "基本形状";
            case STEPS.ARCH_REGION: return "アーチ領域"; // Swapped
            case STEPS.ARCH_HEIGHT: return "アーチ高さ"; // Swapped
            case STEPS.PREVIEW: return "生成と確認";
            default: return "";
        }
    }

    return (
        <div className="flex flex-col h-full">
            <div className="mb-6">
                <h2 className="text-lg font-bold tracking-tight mb-1 text-white">Step {currentStep + 1}</h2>
                <h3 className="text-xl font-bold text-primary uppercase">{getStepTitle()}</h3>
            </div>

            <div className="flex-1 overflow-y-auto pr-1">
                {renderStepContent()}
            </div>

            <div className="mt-auto pt-4 border-t flex gap-2">
                <Button variant="outline" onClick={prevStep} disabled={currentStep === 0} className="flex-1">
                    <ChevronLeft className="mr-1 h-4 w-4" /> 戻る
                </Button>
                {currentStep < STEPS.PREVIEW && (
                     <Button onClick={nextStep} className="flex-1 text-white font-bold">
                        次へ <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                )}
            </div>
        </div>
    );
}