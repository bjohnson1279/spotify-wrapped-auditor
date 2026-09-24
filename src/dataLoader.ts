
import * as fs from 'fs';
import * as path from 'path';
import { SpotifyAudioEvent } from '../interface/SpotifyAudioEvent.js';

const sanitizeLog = (str: string): string => {
    // Strip ANSI escape codes and control characters to prevent Terminal/Log Injection
    return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/[\x00-\x1F\x7F-\x9F]/g, '');
};

export const loadAndDedupEvents = (dataDir: string, year?: number): SpotifyAudioEvent[] => {
    let allFiles: string[];
    try {
        allFiles = fs.readdirSync(dataDir);
    } catch (error) {
        // Log original error for internal debugging, but throw a safe error message to avoid path leakage
        const errorCode = error instanceof Error && 'code' in error ? (error as any).code : 'UNKNOWN';
        console.error(`[ERROR] Internal operation failed during directory read. Code: ${errorCode}`);
        throw new Error('Data directory not found or cannot be read. Please ensure the data directory exists and is accessible.');
    }
    const relevantFiles = allFiles.filter(f => {
        const isJson = f.endsWith('.json');
        if (!year) return isJson;
        // Check if file name contains the year (e.g. streaming_history_audio_2025_0.json)
        return isJson && f.includes(year.toString());
    });

    let rawEvents: SpotifyAudioEvent[] = [];
    relevantFiles.forEach(file => {
        try {
            const raw = fs.readFileSync(path.join(dataDir, file), 'utf-8');
            const parsed = JSON.parse(raw);

            if (!Array.isArray(parsed)) {
                console.warn(`[WARNING] Skipping file ${sanitizeLog(file)}: Expected an array but received a different JSON structure.`);
                return;
            }

            // Using loop to avoid RangeError: Maximum call stack size exceeded for large arrays
            // See: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Too_many_arguments
            for (let i = 0; i < parsed.length; i++) {
                const item = parsed[i];
                if (item && typeof item === 'object' && typeof item.ts === 'string' && typeof item.ms_played === 'number' && Number.isFinite(item.ms_played) && item.ms_played >= 0) {
                    rawEvents.push(item);
                }
            }
        } catch (error) {
            console.warn(`[WARNING] Failed to read or parse file ${sanitizeLog(file)}. It may be corrupted or not valid JSON.`);
        }
    });

    // Sort by timestamp
    // ISO 8601 strings can be sorted lexicographically, much faster than parsing to Date
    rawEvents.sort((a, b) => a.ts < b.ts ? -1 : (a.ts > b.ts ? 1 : 0));

    // --- DEDUPLICATION LOGIC ---
    // ⚡ Bolt: Pre-allocate deduped array to prevent dynamic resizing/GC overhead.
    const rawLen = rawEvents.length;
    let deduped: SpotifyAudioEvent[] = new Array(rawLen);
    let dedupIdx = 0;

    // ⚡ Bolt: Flatten wrapper object into scalar variables to reduce massive GC object allocation in hot loop
    let prevE: SpotifyAudioEvent | null = null;
    let prevStartTime: number | null = null;
    let prevEndTime: number | null = null;

    // ⚡ Bolt: Replace for...of with a standard for-loop to avoid iterator overhead on large datasets
    for (let i = 0; i < rawLen; i++) {
        const e = rawEvents[i];
        if (!prevE) {
            prevE = e;
            prevStartTime = null;
            prevEndTime = null;
            continue;
        }

        const sameTrack = prevE.master_metadata_track_name === e.master_metadata_track_name;

        if (sameTrack) {
            // ⚡ Bolt: Defer Date.parse() execution until we have a track match.
            // Avoids parsing overhead for ~95% of events since most track changes aren't duplicates.
            const currEndTime = Date.parse(e.ts);
            const currStartTime = currEndTime - e.ms_played;

            if (prevEndTime === null) {
                prevEndTime = Date.parse(prevE.ts);
            }

            const overlapMs = prevEndTime - currStartTime;
            const gapMs = currStartTime - prevEndTime;

            // Tier 1: Exact Metadata Clone (Potential multi-file overlap)
            if (Math.abs(gapMs) < 10 && prevE.ms_played === e.ms_played && prevE.reason_end === e.reason_end) {
                prevE = e;
                prevStartTime = currStartTime;
                prevEndTime = currEndTime;
                continue;
            }

            // Tier 2: Glitched Double Log (Different reason)
            if (Math.abs(gapMs) < 1000 && prevE.ms_played === e.ms_played && prevE.reason_end !== e.reason_end) {
                prevE = e;
                prevStartTime = currStartTime;
                prevEndTime = currEndTime;
                continue;
            }

            // Tier 3: Overlapping Plays
            if (overlapMs > 0) {
                const isGlitch = prevE.reason_end === 'trackdone' && e.reason_end === 'trackdone';
                if (isGlitch && prevE.ms_played > 30000 && prevE.ms_played < 160000) {
                    prevE = e;
                    prevStartTime = currStartTime;
                    prevEndTime = currEndTime;
                    continue;
                }
            }

            deduped[dedupIdx++] = prevE;
            prevE = e;
            prevStartTime = currStartTime;
            prevEndTime = currEndTime;
        } else {
            deduped[dedupIdx++] = prevE;
            prevE = e;
            prevStartTime = null;
            prevEndTime = null;
        }
    }
    if (prevE) deduped[dedupIdx++] = prevE;

    // Truncate to actual size
    deduped.length = dedupIdx;

    return deduped;
};
