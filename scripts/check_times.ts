
import * as fs from 'fs';
import * as path from 'path';
import { SpotifyAudioEvent } from '../interface/SpotifyAudioEvent.js';

const CONFIG = {
    DATA_DIR: path.join(process.cwd(), 'data'),
};

const TARGETS: any[] = [
];

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

const runTimeCheck = () => {
    const rawEvents = loadRawEvents();
    TARGETS.forEach(target => {
        const plays = rawEvents.filter(e => `${e.master_metadata_track_name} - ${e.master_metadata_album_artist_name}` === target);
        const last = plays[plays.length - 1];
        console.log(`${target}: Last Play ${last?.ts}`);
    });
};

runTimeCheck();
