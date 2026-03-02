'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { Undo, Redo, Save, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStore } from '@/lib/store';

export default function Layout({
    children,
    sidebar
}: {
    children: React.ReactNode;
    sidebar: React.ReactNode;
}) {
    const { savePatientPreset, patientId } = useStore();
    const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');

    const handleSave = () => {
        if (!patientId) {
            setSaveState('error');
            setTimeout(() => setSaveState('idle'), 2000);
            return;
        }
        const ok = savePatientPreset();
        setSaveState(ok ? 'saved' : 'error');
        setTimeout(() => setSaveState('idle'), 2000);
    };

    return (
        <div className="flex flex-col h-screen w-full bg-background text-foreground overflow-hidden dark">
            {/* Header */}
            <header className="flex-none h-14 border-b border-border bg-card px-4 flex items-center justify-between z-10 relative">
                {/* Accent line for "Lab" feel */}
                <div className="absolute top-0 left-0 w-full h-[2px] bg-linear-to-r from-sky-700 via-teal-500 to-emerald-400" />
                
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <img 
                            src="/logo.png" 
                            alt="Bionic Sole Lab" 
                            className="h-8 w-auto object-contain" 
                        />
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest mt-1">Lab</span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <div className="flex items-center border-r border-border pr-2 mr-2 gap-1">
                        <Button variant="ghost" size="icon" disabled>
                            <Undo className="h-4 w-4 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" disabled>
                            <Redo className="h-4 w-4 text-muted-foreground" />
                        </Button>
                    </div>

                    <Button
                        variant="outline"
                        size="sm"
                        className={`gap-2 text-foreground transition-colors ${
                            saveState === 'saved' ? 'border-green-500/50 text-green-400' :
                            saveState === 'error' ? 'border-red-500/50 text-red-400' :
                            'border-primary/20 hover:border-primary/50'
                        }`}
                        onClick={handleSave}
                    >
                        {saveState === 'saved'
                            ? <><CheckCircle2 className="h-4 w-4" /><span>Saved!</span></>
                            : saveState === 'error'
                            ? <><Save className="h-4 w-4" /><span>{patientId ? 'Save Failed' : 'No Patient'}</span></>
                            : <><Save className="h-4 w-4 text-primary" /><span>Save Project</span></>
                        }
                    </Button>
                </div>
            </header>

            {/* Main Area */}
            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar */}
                <aside className="w-80 border-r border-border bg-card flex flex-col overflow-hidden transition-all duration-300">
                    <div className="flex-1 overflow-y-auto p-4 space-y-6">
                        {sidebar}
                    </div>
                </aside>

                {/* 3D Canvas Area */}
                <main className="flex-1 relative bg-background overflow-hidden">
                    {children}
                </main>
            </div>
        </div>
    );
}