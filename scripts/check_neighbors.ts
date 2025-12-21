
import * as fs from 'fs';
import * as path from 'path';
import { SpotifyAudioEvent } from '../interface/SpotifyAudioEvent.js';

const CONFIG = {
    DATA_DIR: path.join(process.cwd(), 'data'),
};

const TARGET_TS = '2025-02-13T13:52:11Z';

const loadRawEvents = (): SpotifyAudioEvent[] => {
    const allFiles = fs.readdirSync(CONFIG.DATA_DIR);
    const relevantFiles = allFiles.filter(f => f.includes('2025') && f.endsWith('.json'));
    const rawEvents: SpotifyAudioEvent[] = [];
    relevantFiles.forEach(file => {
        const raw = fs.readFileSync(path.join(CONFIG.DATA_DIR, file), 'utf-8');
        rawEvents.push(...JSON.parse(raw));
    });
    return rawEvents.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
};

const deduplicate = (rawEvents: SpotifyAudioEvent[]): SpotifyAudioEvent[] => {
    let deduped: SpotifyAudioEvent[] = [];
    let prev: { e: SpotifyAudioEvent, startTime: number, endTime: number } | null = null;

    for (const e of rawEvents) {
        const endTime = new Date(e.ts).getTime();
        const startTime = endTime - e.ms_played;
        const curr = { e, startTime, endTime };
        if (!prev) { prev = curr; continue; }

        const sameTrack = prev.e.master_metadata_track_name === curr.e.master_metadata_track_name;
        if (sameTrack) {
            const gapMs = curr.startTime - prev.endTime;
            if (Math.abs(gapMs) < 10 && prev.e.ms_played === curr.e.ms_played && prev.e.reason_end === curr.e.reason_end) {
                prev = curr; continue;
            }
            if (Math.abs(gapMs) < 1000 && prev.e.ms_played === curr.e.ms_played && prev.e.reason_end !== curr.e.reason_end) {
                prev = curr; continue;
            }
        }
        deduped.push(prev.e);
        prev = curr;
    }
    if (prev) deduped.push(prev.e);
    return deduped;
};

const runCheck = () => {
    const rawEvents = loadRawEvents();
    const deduped = deduplicate(rawEvents);

    const targetIndex = deduped.findIndex(e => e.ts === TARGET_TS);
    if (targetIndex === -1) {
        console.log("Target TS not found in deduped events.");
        return;
    }

    console.log(`\n=== TARGET PLAY AT ${TARGET_TS} ===`);
    for (let i = targetIndex - 2; i <= targetIndex + 2; i++) {
        const e = deduped[i];
        if (!e) continue;
        const pointer = (i === targetIndex) ? ">>> " : "    ";
        console.log(`${pointer}${e.ts} | ${e.ms_played}ms | ${e.master_metadata_track_name} - ${e.master_metadata_album_artist_name} | Reason: ${e.reason_end} | IP: ${e.ip_addr}`);
    }
};

runCheck();
