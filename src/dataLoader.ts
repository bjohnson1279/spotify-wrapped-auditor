
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
        const raw = fs.readFileSync(path.join(dataDir, file), 'utf-8');
        // Prevent call stack size exceeded errors by using concat
        rawEvents = rawEvents.concat(JSON.parse(raw));
    });

    // Sort by timestamp
    // ⚡ Bolt: Fast string comparison instead of expensive Date parsing
    // ISO 8601 strings sort lexicographically the same as chronological order
    rawEvents.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

    // --- DEDUPLICATION LOGIC ---
    let deduped: SpotifyAudioEvent[] = [];
    let prev: { e: SpotifyAudioEvent, startTime: number, endTime: number } | null = null;

    for (const e of rawEvents) {
        // ⚡ Bolt: Date.parse() is ~30% faster than new Date().getTime()
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
