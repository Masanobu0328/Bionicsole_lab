'use client';

import { createBrowserClient } from '@supabase/ssr';

// Fail fast when the Supabase project is unreachable (free-plan auto-pause,
// offline, DNS failure). Without this, requests pile up behind gotrue's retry
// and lock machinery and flood the console with "Failed to fetch".
const REQUEST_TIMEOUT_MS = 8000;

const fetchWithTimeout: typeof fetch = async (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const externalSignal = init?.signal;
    const forwardAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', forwardAbort);

    try {
        return await fetch(input, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener('abort', forwardAbort);
    }
};

export const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
        global: { fetch: fetchWithTimeout },
    },
);
