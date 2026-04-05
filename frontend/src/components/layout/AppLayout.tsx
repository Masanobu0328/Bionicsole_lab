'use client';

import React, { useState } from 'react';
import { CheckCircle2, Loader2, LogOut, Redo, Save, Undo } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

export default function Layout({
    children,
    sidebar,
}: {
    children: React.ReactNode;
    sidebar: React.ReactNode;
}) {
    const { savePatientPreset, patientId } = useStore();
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [isSigningOut, setIsSigningOut] = useState(false);

    const handleSave = async () => {
        if (!patientId) {
            setSaveState('error');
            setTimeout(() => setSaveState('idle'), 2000);
            return;
        }

        setSaveState('saving');
        const ok = await savePatientPreset();
        setSaveState(ok ? 'saved' : 'error');
        setTimeout(() => setSaveState('idle'), 2000);
    };

    const handleSignOut = async () => {
        setIsSigningOut(true);
        try {
            await supabase.auth.signOut();
        } finally {
            setIsSigningOut(false);
        }
    };

    return (
        <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground dark">
            <header className="relative z-10 flex h-14 flex-none items-center justify-between border-b border-border bg-card px-4">
                <div className="absolute top-0 left-0 h-[2px] w-full bg-linear-to-r from-sky-700 via-teal-500 to-emerald-400" />

                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <img
                            src="/logo.png"
                            alt="Bionic Sole Lab"
                            className="h-8 w-auto object-contain"
                        />
                        <span className="mt-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                            Lab
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <div className="mr-2 flex items-center gap-1 border-r border-border pr-2">
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
                        className="gap-2 border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.08]"
                        onClick={handleSignOut}
                        disabled={isSigningOut}
                    >
                        {isSigningOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                        <span>Logout</span>
                    </Button>

                    <Button
                        variant="outline"
                        size="sm"
                        className={`gap-2 text-foreground transition-colors ${
                            saveState === 'saved'
                                ? 'border-green-500/50 text-green-400'
                                : saveState === 'error'
                                    ? 'border-red-500/50 text-red-400'
                                    : 'border-primary/20 hover:border-primary/50'
                        }`}
                        onClick={() => void handleSave()}
                        disabled={saveState === 'saving'}
                    >
                        {saveState === 'saving' ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span>Saving...</span>
                            </>
                        ) : saveState === 'saved' ? (
                            <>
                                <CheckCircle2 className="h-4 w-4" />
                                <span>Saved!</span>
                            </>
                        ) : saveState === 'error' ? (
                            <>
                                <Save className="h-4 w-4" />
                                <span>{patientId ? 'Save Failed' : 'No Patient'}</span>
                            </>
                        ) : (
                            <>
                                <Save className="h-4 w-4 text-primary" />
                                <span>Save Project</span>
                            </>
                        )}
                    </Button>
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
                <aside className="flex w-80 flex-col overflow-hidden border-r border-border bg-card transition-all duration-300">
                    <div className="flex-1 overflow-y-auto p-4 space-y-6">
                        {sidebar}
                    </div>
                </aside>

                <main className="relative flex-1 overflow-hidden bg-background">
                    {children}
                </main>
            </div>
        </div>
    );
}
