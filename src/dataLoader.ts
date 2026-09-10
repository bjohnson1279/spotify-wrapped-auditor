
import * as fs from 'fs';
import * as path from 'path';
import { SpotifyAudioEvent } from '../interface/SpotifyAudioEvent.js';

export const loadAndDedupEvents = (dataDir: string, year?: number): SpotifyAudioEvent[] => {
    const allFiles = fs.readdirSync(dataDir);
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

            // 🛡️ Sentinel: Validate that parsed data is an array to prevent crashes or unexpected iteration
            if (!Array.isArray(parsed)) {
                console.error(`Warning: Skipping ${file} as it does not contain a valid JSON array.`);
                return;
            }

            // ⚡ Bolt Optimization: Avoid spread operator `...` on potentially massive arrays
            // which can throw "Maximum call stack size exceeded" on hundreds of thousands of events.
            for (const event of parsed) {
                rawEvents.push(event);
            }
        } catch (error) {
            console.error(`Error processing file ${file}. It has been skipped.`);
            // 🛡️ Sentinel: Do not leak stack trace or internal file paths
        }
    });

    // Sort by timestamp
    // ⚡ Bolt Optimization: Compare ISO 8601 strings directly instead of parsing to Date objects.
    // Lexicographical string comparison is significantly faster and yields identical ordering.
    rawEvents.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

    // --- DEDUPLICATION LOGIC ---
    let deduped: SpotifyAudioEvent[] = [];
    let prev: { e: SpotifyAudioEvent, startTime: number, endTime: number } | null = null;

    for (const e of rawEvents) {
        // ⚡ Bolt Optimization: Use Date.parse(ts) instead of new Date(ts).getTime()
        // Date.parse is significantly faster than allocating new Date objects in a loop.
        const endTime = Date.parse(e.ts);
        const startTime = endTime - e.ms_played;
        const curr = { e, startTime, endTime };

        if (!prev) {
            prev = curr;
            continue;
        }

        const sameTrack = prev.e.master_metadata_track_name === curr.e.master_metadata_track_name;
        if (sameTrack) {
            const overlapMs = prev.endTime - curr.startTime;
            const gapMs = curr.startTime - prev.endTime;

            // Tier 1: Exact Metadata Clone (Potential multi-file overlap)
            if (Math.abs(gapMs) < 10 && prev.e.ms_played === curr.e.ms_played && prev.e.reason_end === curr.e.reason_end) {
                prev = curr;
                continue;
            }

            // Tier 2: Glitched Double Log (Different reason)
            if (Math.abs(gapMs) < 1000 && prev.e.ms_played === curr.e.ms_played && prev.e.reason_end !== curr.e.reason_end) {
                prev = curr;
                continue;
            }

            // Tier 3: Overlapping Plays
            if (overlapMs > 0) {
                const isGlitch = prev.e.reason_end === 'trackdone' && curr.e.reason_end === 'trackdone';
                if (isGlitch && prev.e.ms_played > 30000 && prev.e.ms_played < 160000) {
                    prev = curr;
                    continue;
                }
            }
        }

        deduped.push(prev.e);
        prev = curr;
    }
    if (prev) deduped.push(prev.e);

    return deduped;
};
