'use client';

import React, { useEffect, useState } from 'react';
import { useStore, STEPS } from '@/lib/store';
import AppLayout from '@/components/layout/AppLayout';
import Sidebar from '@/components/layout/Sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { User, Calendar, ArrowRight } from 'lucide-react';
import { getPatients, Patient } from '@/lib/api';

// Step Components
import OutlineEditorCanvas from '@/components/steps/OutlineEditorCanvas';
import LandmarkEditorCanvas from '@/components/steps/LandmarkEditorCanvas';
import ShapeEditorCanvas from '@/components/steps/ShapeEditorCanvas';
import ArchAdjustmentCanvas from '@/components/steps/ArchAdjustmentCanvas';
import ArchRegionEditorCanvas from '@/components/steps/ArchRegionEditorCanvas';
import PreviewStep from '@/components/steps/PreviewStep';

export default function Home() {
  const { currentStep, setCurrentStep, setPatientId, patientId } = useStore();
  const [patients, setPatients] = useState<Patient[]>([]);

  useEffect(() => {
    async function load() {
        try {
            const data = await getPatients();
            setPatients(data);
        } catch (e) {
            console.error(e);
        }
    }
    load();
  }, []);

  const handleSelectPatient = (id: string) => {
      setPatientId(id);
      setCurrentStep(STEPS.OUTLINE);
  };

  const renderStep = () => {
    switch (currentStep) {
      case STEPS.PATIENT:
        return (
          <div className="flex flex-col h-full bg-background p-12 overflow-y-auto">
            <div className="max-w-5xl mx-auto w-full space-y-12">
                <div className="text-center space-y-6">
                    <div className="mb-8">
                        <img src="/logo.png" alt="Bionic Sole Lab" className="h-24 w-auto mx-auto object-contain" />
                    </div>
                    <div>
                        <h2 className="text-4xl font-black tracking-tighter text-white uppercase mb-2">患者選択 <span className="text-primary">/ Select Patient</span></h2>
                        <p className="text-white/40 font-medium tracking-widest text-xs uppercase">Please select a patient to start the insole design process.</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {patients.map((patient) => (
                        <Card 
                            key={patient.id} 
                            className={`cursor-pointer transition-all duration-300 border-white/5 bg-card/50 backdrop-blur-md hover:border-primary/50 hover:bg-primary/5 group ${patientId === patient.id ? 'border-primary ring-1 ring-primary bg-primary/10' : ''}`}
                            onClick={() => handleSelectPatient(patient.id)}
                        >
                            <CardHeader className="pb-4">
                                <div className="flex justify-between items-start mb-2">
                                    <div className="bg-white/5 p-2.5 rounded-xl group-hover:bg-primary/20 transition-colors border border-white/5">
                                        <User className="h-5 w-5 text-white/40 group-hover:text-primary transition-colors" />
                                    </div>
                                    {patientId === patient.id && <div className="text-[10px] font-black text-primary bg-primary/10 px-3 py-1 rounded-full border border-primary/20 tracking-widest uppercase">Active</div>}
                                </div>
                                <CardTitle className="pt-2 text-xl font-bold text-white group-hover:text-primary transition-colors">{patient.name}</CardTitle>
                                <CardDescription className="text-white/30 font-mono text-xs">ID: {patient.id}</CardDescription>
                            </CardHeader>
                            <CardContent className="pt-0">
                                <div className="flex items-center text-[10px] text-white/20 font-bold uppercase tracking-widest mt-2">
                                    <Calendar className="mr-2 h-3.5 w-3.5" />
                                    <span>Created: 2024/01/01</span>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                    
                    {/* Placeholder for 'New Patient' */}
                    <Card className="border-dashed border-white/10 border-2 flex items-center justify-center min-h-[200px] bg-white/[0.02] hover:bg-white/[0.05] transition-colors cursor-not-allowed opacity-40 rounded-2xl">
                        <div className="text-center space-y-3">
                            <div className="bg-white/5 p-3 rounded-full w-fit mx-auto border border-white/5">
                                <User className="h-6 w-6 text-white/20" />
                            </div>
                            <div className="font-black text-[10px] text-white/30 uppercase tracking-[0.2em]">Add New Patient</div>
                            <div className="text-[9px] text-primary/40 font-bold">(Coming Soon)</div>
                        </div>
                    </Card>
                </div>
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

  return (
    <AppLayout sidebar={<Sidebar />}>
      <div className="h-full w-full">
        {renderStep()}
      </div>
    </AppLayout>
  );
}