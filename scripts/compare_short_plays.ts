
import * as fs from 'fs';
import * as path from 'path';

const CONFIG = {
    DATA_DIR: path.join(process.cwd(), 'data'),
};

const TARGETS = [
];

const runCompare = () => {
    const allFiles = fs.readdirSync(CONFIG.DATA_DIR);
    const relevantFiles = allFiles.filter(f => f.includes('2025') && f.endsWith('.json'));
    const events: any[] = [];

    relevantFiles.forEach(fileName => {
        const filePath = path.join(CONFIG.DATA_DIR, fileName);
        const raw = fs.readFileSync(filePath, 'utf-8');
        events.push(...JSON.parse(raw));
    });

    console.log("Song | MS | End | Start | Shuffle | Offline | TS");
    console.log("---------------------------------------------------");

    events.forEach((e: any) => {
        if (!e.master_metadata_track_name) return;
        const name = `${e.master_metadata_track_name} - ${e.master_metadata_album_artist_name}`;

        const target = TARGETS.find(t => t.name === name);
        if (target && e.ms_played >= 30000 && e.ms_played < 60000) {
            if (e.reason_end === 'logout' || (e.reason_end === 'endplay' && e.skipped)) {
                console.log(`${name} | ${e.ms_played} | ${e.reason_end} | ${e.reason_start} | ${e.shuffle} | ${e.offline} | ${e.ts}`);
            }
        }
    });
};

runCompare();
