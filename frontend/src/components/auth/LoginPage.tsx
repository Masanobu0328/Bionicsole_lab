'use client';

import React, { useState } from 'react';
import { Loader2, LogIn, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';

type Mode = 'login' | 'signup';

export default function LoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [mode, setMode] = useState<Mode>('login');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [infoMessage, setInfoMessage] = useState<string | null>(null);

    const handleGoogleLogin = async () => {
        setErrorMessage(null);
        setIsSubmitting(true);
        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: window.location.origin,
                },
            });
            if (error) throw error;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Google login failed.';
            setErrorMessage(message);
            setIsSubmitting(false);
        }
    };

    const handleAuth = async (nextMode: Mode) => {
        setMode(nextMode);
        setErrorMessage(null);
        setInfoMessage(null);
        setIsSubmitting(true);

        try {
            if (nextMode === 'login') {
                const { error } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });
                if (error) {
                    throw error;
                }
                setInfoMessage('Signed in.');
                return;
            }

            const { error, data } = await supabase.auth.signUp({
                email,
                password,
            });
            if (error) {
                throw error;
            }

            if (data.session) {
                setInfoMessage('Account created and signed in.');
            } else {
                setInfoMessage('Account created. Check your email if confirmation is required.');
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Authentication failed.';
            setErrorMessage(message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(45,212,191,0.18),_transparent_40%),linear-gradient(135deg,_#050816_0%,_#0f172a_45%,_#111827_100%)] text-white">
            <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6 py-12">
                <div className="grid w-full gap-10 lg:grid-cols-[1.1fr_420px]">
                    <div className="hidden flex-col justify-center lg:flex">
                        <img
                            src="/logo.png"
                            alt="Bionic Sole Lab"
                            className="mb-8 h-24 w-auto object-contain"
                        />
                        <p className="mb-4 text-xs font-black uppercase tracking-[0.35em] text-teal-300/80">
                            Bionic Sole Lab
                        </p>
                        <h1 className="max-w-xl text-5xl font-black tracking-tight text-white">
                            Secure cloud workflow for custom insole design.
                        </h1>
                        <p className="mt-6 max-w-xl text-base leading-7 text-slate-300">
                            Sign in to access patient records, save design versions, and download generated models from Supabase-backed storage.
                        </p>
                    </div>

                    <Card className="border-white/10 bg-slate-950/70 text-white shadow-2xl backdrop-blur-xl">
                        <CardHeader className="space-y-3">
                            <div className="flex items-center gap-3">
                                <img
                                    src="/logo.png"
                                    alt="Bionic Sole Lab"
                                    className="h-12 w-auto object-contain"
                                />
                                <div>
                                    <CardTitle className="text-2xl font-black uppercase tracking-wide">
                                        {mode === 'login' ? 'Sign In' : 'Create Account'}
                                    </CardTitle>
                                    <CardDescription className="text-slate-400">
                                        {mode === 'login'
                                            ? 'Use your practitioner account to continue.'
                                            : 'Create a practitioner account with email and password.'}
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-5">
                                <div className="space-y-2">
                                    <Label htmlFor="email">Email</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        autoComplete="email"
                                        value={email}
                                        onChange={(event) => setEmail(event.target.value)}
                                        placeholder="name@clinic.com"
                                        required
                                        className="border-white/10 bg-white/5 text-white placeholder:text-slate-500"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="password">Password</Label>
                                    <Input
                                        id="password"
                                        type="password"
                                        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                                        value={password}
                                        onChange={(event) => setPassword(event.target.value)}
                                        placeholder="At least 6 characters"
                                        minLength={6}
                                        required
                                        className="border-white/10 bg-white/5 text-white placeholder:text-slate-500"
                                    />
                                </div>

                                {errorMessage && (
                                    <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                                        {errorMessage}
                                    </div>
                                )}

                                {infoMessage && (
                                    <div className="rounded-md border border-teal-500/30 bg-teal-500/10 px-3 py-2 text-sm text-teal-100">
                                        {infoMessage}
                                    </div>
                                )}

                                <div className="relative">
                                    <div className="absolute inset-0 flex items-center">
                                        <span className="w-full border-t border-white/10" />
                                    </div>
                                    <div className="relative flex justify-center text-xs uppercase">
                                        <span className="bg-slate-950 px-2 text-slate-500">or</span>
                                    </div>
                                </div>

                                <Button
                                    type="button"
                                    disabled={isSubmitting}
                                    onClick={() => void handleGoogleLogin()}
                                    className="h-11 w-full border border-white/10 bg-white/5 font-semibold text-white hover:bg-white/10"
                                >
                                    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                                    </svg>
                                    Continue with Google
                                </Button>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Button
                                        type="button"
                                        disabled={isSubmitting}
                                        onClick={() => void handleAuth('login')}
                                        className="h-11 bg-teal-500 font-bold text-slate-950 hover:bg-teal-400"
                                    >
                                        {isSubmitting && mode === 'login' ? <Loader2 className="animate-spin" /> : <LogIn />}
                                        Login
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        disabled={isSubmitting}
                                        onClick={() => void handleAuth('signup')}
                                        className="h-11 border-white/15 bg-white/5 text-white hover:bg-white/10"
                                    >
                                        {isSubmitting && mode === 'signup' ? <Loader2 className="animate-spin" /> : <UserPlus />}
                                        Sign Up
                                    </Button>
                                </div>

                                <div className="border-t border-white/10 pt-4 text-center text-sm text-slate-400">
                                    {mode === 'login' ? 'Need an account?' : 'Already have an account?'}{' '}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setMode(mode === 'login' ? 'signup' : 'login');
                                            setErrorMessage(null);
                                            setInfoMessage(null);
                                        }}
                                        className="font-semibold text-teal-300 transition-colors hover:text-teal-200"
                                    >
                                        {mode === 'login' ? 'Create one here' : 'Sign in here'}
                                    </button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
