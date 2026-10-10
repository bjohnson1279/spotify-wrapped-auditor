
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
            const filePath = path.join(dataDir, file);

            // 🛡️ Sentinel: Enforce maximum file size limit (100MB) to prevent V8 Heap Out-Of-Memory (DoS)
            // JSON parsing memory overhead is 3x-5x, so 100MB limits heap impact to safe bounds
            const stats = fs.statSync(filePath);
            const MAX_FILE_SIZE = 100 * 1024 * 1024;
            if (stats.size > MAX_FILE_SIZE) {
                console.warn(`[WARNING] Skipping file ${sanitizeLog(file)}: File size exceeds 100MB limit.`);
                return;
            }

            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw);

            if (!Array.isArray(parsed)) {
                console.warn(`[WARNING] Skipping file ${sanitizeLog(file)}: Expected an array but received a different JSON structure.`);
                return;
            }

            // Using loop to avoid RangeError: Maximum call stack size exceeded for large arrays
            // See: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Too_many_arguments
            for (let i = 0; i < parsed.length; i++) {
                const item = parsed[i];
                if (!item || typeof item !== 'object') continue;

                // ⚡ Bolt & 🛡️ Sentinel: Fast-fail validation with strict length boundaries
                if (!item || typeof item !== 'object') continue;
                if (typeof item.ts !== 'string' || item.ts.length > 50) continue;
                if (typeof item.ms_played !== 'number' || !Number.isFinite(item.ms_played) || item.ms_played < 0) continue;
                if (item.master_metadata_track_name != null && (typeof item.master_metadata_track_name !== 'string' || item.master_metadata_track_name.length > 1000)) continue;
                if (item.master_metadata_album_artist_name != null && (typeof item.master_metadata_album_artist_name !== 'string' || item.master_metadata_album_artist_name.length > 1000)) continue;
                if (item.reason_end != null && (typeof item.reason_end !== 'string' || item.reason_end.length > 500)) continue;
                if (item.ip_addr != null && (typeof item.ip_addr !== 'string' || item.ip_addr.length > 500)) continue;
                if (item.audiobook_title != null && (typeof item.audiobook_title !== 'string' || item.audiobook_title.length > 1000)) continue;
                if (item.episode_name != null && (typeof item.episode_name !== 'string' || item.episode_name.length > 1000)) continue;
                if (item.episode_show_name != null && (typeof item.episode_show_name !== 'string' || item.episode_show_name.length > 1000)) continue;

                // Check *all* keys for extreme string lengths or unexpected complex types to prevent OOM
                let isMalicious = false;
                for (const key in item) {
                    const val = item[key];
                    if (typeof val === 'string' && val.length > 5000) {
                        isMalicious = true;
                        break;
                    }
                    // Reject arrays and nested objects to prevent deep OOM and type confusion
                    if (val !== null && typeof val === 'object') {
                        isMalicious = true;
                        break;
                    }
                }

                if (isMalicious) continue;

                rawEvents.push(item);
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

    // ⚡ Bolt: Decouple wrapper object strictly for loop processing into flat scalar variables
    // to significantly reduce heap allocation and garbage collection overhead in the hot loop.
    let prevE: SpotifyAudioEvent | null = null;
    let prevStartTime: number | null = null;
    let prevEndTime: number | null = null;

    // ⚡ Bolt: Replace for...of with a standard for-loop to avoid iterator overhead on large datasets
    for (let i = 0; i < rawEvents.length; i++) {
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

            deduped[dedupedIdx++] = prevE;
            prevE = e;
            prevStartTime = currStartTime;
            prevEndTime = currEndTime;
        } else {
            deduped[dedupedIdx++] = prevE;
            prevE = e;
            prevStartTime = null;
            prevEndTime = null;
        }
    }
    if (prevE) deduped[dedupedIdx++] = prevE;

    deduped.length = dedupedIdx;
    return deduped;
};
