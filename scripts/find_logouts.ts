
import * as fs from 'fs';
import * as path from 'path';
import { SpotifyAudioEvent } from '../interface/SpotifyAudioEvent.js';

const CONFIG = {
    DATA_DIR: path.join(process.cwd(), 'data'),
};

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

const runSearch = () => {
    const rawEvents = loadRawEvents();
    // Exclude 311 as they are exempt
    const logouts = rawEvents.filter(e =>
        e.reason_end === 'logout' &&
        e.ms_played >= 30000 &&
        e.ms_played < 60000 &&
        e.master_metadata_album_artist_name !== '311' &&
        (process.env.HOME_IP ? e.ip_addr === process.env.HOME_IP : false) &&
        new Date(e.ts) < new Date('2025-11-10T11:59:59Z')
    );

    console.log(`Found ${logouts.length} short IPv4 logouts for non-311 songs:`);
    logouts.forEach(e => {
        console.log(`  ${e.ts} | ${e.ms_played}ms | ${e.master_metadata_track_name} - ${e.master_metadata_album_artist_name}`);
    });
};

runSearch();
