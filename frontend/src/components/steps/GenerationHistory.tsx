'use client';

import { useCallback, useEffect, useState } from 'react';
import { Clock, Download, Loader2 } from 'lucide-react';
import {
    fetchGenerationHistory,
    GENERATION_HISTORY_LIMIT,
    type GenerationHistoryEntry,
} from '@/lib/api';

type Props = {
    patientCode: string;
    footSide: 'left' | 'right';
    /** Bump to reload - e.g. after a generation finishes. */
    reloadKey?: number;
    /** Which entry the viewer is showing, so it can be marked. */
    activeUrl?: string | null;
    onOpen: (entry: GenerationHistoryEntry) => void;
};

function whenLabel(iso: string): string {
    const at = new Date(iso);
    const minutes = Math.floor((Date.now() - at.getTime()) / 60000);
    if (minutes < 1) return 'たった今';
    if (minutes < 60) return `${minutes}分前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}時間前`;
    return at.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
        + ' ' + at.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

export default function GenerationHistory({
    patientCode,
    footSide,
    reloadKey = 0,
    activeUrl,
    onOpen,
}: Props) {
    const [entries, setEntries] = useState<GenerationHistoryEntry[]>([]);
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        if (!patientCode) return;
        setLoading(true);
        try {
            setEntries(await fetchGenerationHistory(patientCode, footSide));
        } catch {
            // History is a convenience; a failure here must not disturb the
            // generation the practitioner is actually working on.
            setEntries([]);
        } finally {
            setLoading(false);
        }
    }, [patientCode, footSide]);

    useEffect(() => {
        void load();
    }, [load, reloadKey]);

    if (!loading && entries.length === 0) return null;

    return (
        <div className="mt-2 pt-2 border-t border-border/60">
            <div className="flex items-center gap-1 mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>履歴（最新{GENERATION_HISTORY_LIMIT}件）</span>
                {loading && <Loader2 className="h-3 w-3 animate-spin ml-auto" />}
            </div>

            <ul className="space-y-1">
                {entries.map((entry, index) => {
                    const isActive = !!activeUrl && activeUrl.startsWith(entry.glbUrl.split('?')[0]);
                    return (
                        <li key={entry.id} className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onOpen(entry); }}
                                className={`flex-1 text-left px-2 py-1 rounded text-xs transition-colors ${isActive
                                    ? 'bg-primary/15 text-foreground'
                                    : 'hover:bg-muted text-muted-foreground'
                                    }`}
                                title="この世代を3Dで表示"
                            >
                                <span className="tabular-nums">{whenLabel(entry.createdAt)}</span>
                                {index === 0 && (
                                    <span className="ml-1 text-[10px] text-green-500">最新</span>
                                )}
                            </button>
                            {entry.stlUrl && (
                                <a
                                    href={entry.stlUrl}
                                    onClick={(e) => e.stopPropagation()}
                                    className="p-1 rounded hover:bg-muted text-muted-foreground"
                                    title="この世代のSTLを保存"
                                    download
                                >
                                    <Download className="h-3 w-3" />
                                </a>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
