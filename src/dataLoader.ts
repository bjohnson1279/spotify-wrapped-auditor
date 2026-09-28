
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

                // Validate string boundaries for DoS prevention
                const isTsValid = typeof item.ts === 'string' && item.ts.length <= 50;
                const isTrackValid = !item.master_metadata_track_name || (typeof item.master_metadata_track_name === 'string' && item.master_metadata_track_name.length <= 1000);
                const isArtistValid = !item.master_metadata_album_artist_name || (typeof item.master_metadata_album_artist_name === 'string' && item.master_metadata_album_artist_name.length <= 1000);

                if (item && typeof item === 'object' && isTsValid && typeof item.ms_played === 'number' && Number.isFinite(item.ms_played) && item.ms_played >= 0 && isTrackValid && isArtistValid) {
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
    // ⚡ Bolt: Pre-allocate array to avoid dynamic resizing overhead
    let deduped: SpotifyAudioEvent[] = new Array(rawEvents.length);
    let dedupedIdx = 0;
    let prev: { e: SpotifyAudioEvent, startTime: number | null, endTime: number | null } | null = null;

    // ⚡ Bolt: Replace for...of with a standard for-loop to avoid iterator overhead on large datasets
    for (let i = 0; i < rawEvents.length; i++) {
        const e = rawEvents[i];
        if (!prev) {
            prev = { e, startTime: null, endTime: null };
            continue;
        }

        const sameTrack = prev.e.master_metadata_track_name === e.master_metadata_track_name;

        if (sameTrack) {
            // ⚡ Bolt: Defer Date.parse() execution until we have a track match.
            // Avoids parsing overhead for ~95% of events since most track changes aren't duplicates.
            const currEndTime = Date.parse(e.ts);
            const currStartTime = currEndTime - e.ms_played;

            if (prev.endTime === null) {
                prev.endTime = Date.parse(prev.e.ts);
            }

            const overlapMs = prev.endTime - currStartTime;
            const gapMs = currStartTime - prev.endTime;

            // Tier 1: Exact Metadata Clone (Potential multi-file overlap)
            if (Math.abs(gapMs) < 10 && prev.e.ms_played === e.ms_played && prev.e.reason_end === e.reason_end) {
                prev = { e, startTime: currStartTime, endTime: currEndTime };
                continue;
            }

            // Tier 2: Glitched Double Log (Different reason)
            if (Math.abs(gapMs) < 1000 && prev.e.ms_played === e.ms_played && prev.e.reason_end !== e.reason_end) {
                prev = { e, startTime: currStartTime, endTime: currEndTime };
                continue;
            }

            // Tier 3: Overlapping Plays
            if (overlapMs > 0) {
                const isGlitch = prev.e.reason_end === 'trackdone' && e.reason_end === 'trackdone';
                if (isGlitch && prev.e.ms_played > 30000 && prev.e.ms_played < 160000) {
                    prev = { e, startTime: currStartTime, endTime: currEndTime };
                    continue;
                }
            }

            deduped[dedupedIdx++] = prev.e;
            prev = { e, startTime: currStartTime, endTime: currEndTime };
        } else {
            deduped[dedupedIdx++] = prev.e;
            prev = { e, startTime: null, endTime: null };
        }
    }
    if (prev) deduped[dedupedIdx++] = prev.e;

    deduped.length = dedupedIdx;
    return deduped;
};
