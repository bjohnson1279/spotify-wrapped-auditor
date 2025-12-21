
import * as fs from 'fs';
import * as path from 'path';
import { SpotifyAudioEvent } from '../interface/SpotifyAudioEvent.js';

const CONFIG = {
    DATA_DIR: path.join(process.cwd(), 'data'),
};

const TARGET = "";

const runGapCheck = () => {
    const allFiles = fs.readdirSync(CONFIG.DATA_DIR);
    const relevantFiles = allFiles.filter(f => f.includes('2025') && f.endsWith('.json'));
    const rawEvents: SpotifyAudioEvent[] = [];
    relevantFiles.forEach(file => {
        const raw = fs.readFileSync(path.join(CONFIG.DATA_DIR, file), 'utf-8');
        rawEvents.push(...JSON.parse(raw));
    });

    rawEvents.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    const plays = rawEvents.filter(e => `${e.master_metadata_track_name} - ${e.master_metadata_album_artist_name}` === TARGET);

    console.log(`\n=== Gaps for ${TARGET} (< 300s) ===`);
    for (let i = 0; i < plays.length - 1; i++) {
        const p1 = plays[i];
        const p2 = plays[i + 1];
        const ts1 = new Date(p1.ts).getTime();
        const ts2 = new Date(p2.ts).getTime();
        const gap = (ts2 - ts1) / 1000;
        if (gap < 300) {
            console.log(`${p1.ts} | ${p1.ms_played}ms | Gap: ${gap}s | ${p2.ts} (${p2.ms_played}ms) | Reason: ${p1.reason_end}`);
        }
    }
};

runGapCheck();
