'use client';

import React, { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Calendar, Loader2, Plus, User } from 'lucide-react';
import LoginPage from '@/components/auth/LoginPage';
import AppLayout from '@/components/layout/AppLayout';
import Sidebar from '@/components/layout/Sidebar';
import OutlineEditorCanvas from '@/components/steps/OutlineEditorCanvas';
import LandmarkEditorCanvas from '@/components/steps/LandmarkEditorCanvas';
import ShapeEditorCanvas from '@/components/steps/ShapeEditorCanvas';
import ArchAdjustmentCanvas from '@/components/steps/ArchAdjustmentCanvas';
import ArchRegionEditorCanvas from '@/components/steps/ArchRegionEditorCanvas';
import PreviewStep from '@/components/steps/PreviewStep';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createPatient, fetchPatientsFromDB } from '@/lib/api';
import { STEPS, useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

export default function Home() {
    const {
        currentStep,
        setCurrentStep,
        setPatientId,
        patientId,
        patients,
        setPatients,
    } = useStore();

    const [session, setSession] = useState<Session | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [patientsLoading, setPatientsLoading] = useState(false);
    const [patientsError, setPatientsError] = useState<string | null>(null);
    const [newPatientCode, setNewPatientCode] = useState('');
    const [newPatientName, setNewPatientName] = useState('');
    const [creatingPatient, setCreatingPatient] = useState(false);

    useEffect(() => {
        let active = true;

        supabase.auth.getSession().then(({ data: { session: nextSession } }) => {
            if (!active) {
                return;
            }
            setSession(nextSession);
            setAuthLoading(false);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
            if (!active) {
                return;
            }
            setSession(nextSession);
            setAuthLoading(false);
        });

        return () => {
            active = false;
            subscription.unsubscribe();
        };
    }, []);

    useEffect(() => {
        let active = true;

        if (!session) {
            setPatients([]);
            setCurrentStep(STEPS.PATIENT);
            setPatientsLoading(false);
            setPatientsError(null);
            return () => {
                active = false;
            };
        }

        const loadPatients = async () => {
            setPatientsLoading(true);
            setPatientsError(null);
            try {
                const data = await fetchPatientsFromDB();
                if (!active) {
                    return;
                }
                setPatients(data);
            } catch (error) {
                if (!active) {
                    return;
                }
                const message = error instanceof Error ? error.message : 'Failed to load patients.';
                setPatients([]);
                setPatientsError(message);
            } finally {
                if (active) {
                    setPatientsLoading(false);
                }
            }
        };

        void loadPatients();

        return () => {
            active = false;
        };
    }, [session, setCurrentStep, setPatients]);

    const handleSelectPatient = (id: string) => {
        setPatientId(id);
        setCurrentStep(STEPS.OUTLINE);
    };

    const generatePatientCode = () => {
        const existing = patients
            .map(p => p.id)
            .filter(id => /^P-\d+$/.test(id))
            .map(id => parseInt(id.replace('P-', ''), 10))
            .filter(n => !isNaN(n));
        const next = existing.length > 0 ? Math.max(...existing) + 1 : 1;
        return `P-${String(next).padStart(4, '0')}`;
    };

    const handleCreatePatient = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const displayLabel = newPatientName.trim();
        if (!displayLabel) {
            setPatientsError('患者名または管理ラベルを入力してください。');
            return;
        }

        const patientCode = generatePatientCode();
        setCreatingPatient(true);
        setPatientsError(null);

        try {
            const createdPatient = await createPatient(patientCode, displayLabel);
            const nextPatients = [...patients, createdPatient].sort((left, right) => left.id.localeCompare(right.id));
            setPatients(nextPatients);
            setPatientId(createdPatient.id);
            setCurrentStep(STEPS.OUTLINE);
            setNewPatientName('');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to create patient.';
            setPatientsError(message);
        } finally {
            setCreatingPatient(false);
        }
    };

    const renderStep = () => {
        switch (currentStep) {
            case STEPS.PATIENT:
                return (
                    <div className="flex h-full flex-col overflow-y-auto bg-background p-12">
                        <div className="mx-auto w-full max-w-5xl space-y-10">
                            <div className="space-y-6 text-center">
                                <div className="mb-8">
                                    <img
                                        src="/logo.png"
                                        alt="Bionic Sole Lab"
                                        className="mx-auto h-24 w-auto object-contain"
                                    />
                                </div>
                                <div>
                                    <h2 className="mb-2 text-4xl font-black tracking-tighter text-white uppercase">
                                        患者選択 <span className="text-primary">/ Select Patient</span>
                                    </h2>
                                    <p className="text-xs font-medium uppercase tracking-widest text-white/40">
                                        Select an existing patient or create a new cloud record.
                                    </p>
                                </div>
                            </div>

                            {patientsError && (
                                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-200">
                                    {patientsError}
                                </div>
                            )}

                            {patientsLoading ? (
                                <div className="flex min-h-[320px] items-center justify-center rounded-3xl border border-white/5 bg-card/40">
                                    <div className="text-center">
                                        <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-primary" />
                                        <p className="text-sm text-white/60">Loading patients from Supabase...</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                                    {patients.map((patient) => (
                                        <Card
                                            key={patient.id}
                                            className={`group cursor-pointer border-white/5 bg-card/50 backdrop-blur-md transition-all duration-300 hover:border-primary/50 hover:bg-primary/5 ${
                                                patientId === patient.id ? 'border-primary ring-1 ring-primary bg-primary/10' : ''
                                            }`}
                                            onClick={() => handleSelectPatient(patient.id)}
                                        >
                                            <CardHeader className="pb-4">
                                                <div className="mb-2 flex items-start justify-between">
                                                    <div className="rounded-xl border border-white/5 bg-white/5 p-2.5 transition-colors group-hover:bg-primary/20">
                                                        <User className="h-5 w-5 text-white/40 transition-colors group-hover:text-primary" />
                                                    </div>
                                                    {patientId === patient.id && (
                                                        <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-primary">
                                                            Active
                                                        </div>
                                                    )}
                                                </div>
                                                <CardTitle className="pt-2 text-xl font-bold text-white transition-colors group-hover:text-primary">
                                                    {patient.name}
                                                </CardTitle>
                                                <CardDescription className="text-xs font-mono text-white/30">
                                                    Code: {patient.id}
                                                </CardDescription>
                                            </CardHeader>
                                            <CardContent className="pt-0">
                                                <div className="mt-2 flex items-center text-[10px] font-bold uppercase tracking-widest text-white/20">
                                                    <Calendar className="mr-2 h-3.5 w-3.5" />
                                                    <span>Cloud record</span>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    ))}

                                    <Card className="border-white/10 bg-white/[0.02] text-white">
                                        <CardHeader>
                                            <div className="mb-3 flex items-center gap-3">
                                                <div className="rounded-xl border border-white/5 bg-primary/10 p-2.5">
                                                    <Plus className="h-5 w-5 text-primary" />
                                                </div>
                                                <div>
                                                    <CardTitle className="text-xl font-bold">New Patient</CardTitle>
                                                    <CardDescription className="text-white/40">
                                                        Create a patient record in Supabase.
                                                    </CardDescription>
                                                </div>
                                            </div>
                                        </CardHeader>
                                        <CardContent>
                                            <form className="space-y-4" onSubmit={handleCreatePatient}>
                                                <div className="space-y-2">
                                                    <Label htmlFor="patient-name">患者名 / 管理ラベル</Label>
                                                    <Input
                                                        id="patient-name"
                                                        value={newPatientName}
                                                        onChange={(event) => setNewPatientName(event.target.value)}
                                                        placeholder="例：山田 太郎 / Case-001"
                                                        className="border-white/10 bg-white/5 text-white placeholder:text-white/30"
                                                        required
                                                    />
                                                    <p className="text-xs text-white/30">患者IDは自動で採番されます（P-0001, P-0002...）</p>
                                                </div>
                                                <Button
                                                    type="submit"
                                                    className="w-full font-bold text-slate-950"
                                                    disabled={creatingPatient}
                                                >
                                                    {creatingPatient ? <Loader2 className="animate-spin" /> : <Plus />}
                                                    Create Patient
                                                </Button>
                                            </form>
                                        </CardContent>
                                    </Card>
                                </div>
                            )}
                        </div>
                    </div>
                );
            case STEPS.OUTLINE:
                return <OutlineEditorCanvas />;
            case STEPS.LANDMARKS:
                return <LandmarkEditorCanvas />;
            case STEPS.SHAPE:
                return <ShapeEditorCanvas />;
            case STEPS.ARCH_REGION:
                return <ArchRegionEditorCanvas />;
            case STEPS.ARCH_HEIGHT:
                return <ArchAdjustmentCanvas />;
            case STEPS.PREVIEW:
                return <PreviewStep />;
            default:
                return <div>Unknown Step</div>;
        }
    };

    if (authLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background">
                <div className="text-center">
                    <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm text-white/60">Checking session...</p>
                </div>
            </div>
        );
    }

    if (!session) {
        return <LoginPage />;
    }

    return (
        <AppLayout sidebar={<Sidebar />}>
            <div className="h-full w-full">{renderStep()}</div>
        </AppLayout>
    );
}
