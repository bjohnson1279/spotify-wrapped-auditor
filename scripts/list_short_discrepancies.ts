
import * as fs from 'fs';
import * as path from 'path';

const CONFIG = {
    DATA_DIR: path.join(process.cwd(), 'data'),
};

const DISCREPANCY_SONGS = [
    "INSERT SONG TITLES HERE"
];

const runList = () => {
    const allFiles = fs.readdirSync(CONFIG.DATA_DIR);
    const relevantFiles = allFiles.filter(f => f.includes('2025') && f.endsWith('.json'));
    const events: any[] = [];

    relevantFiles.forEach(f => events.push(...JSON.parse(fs.readFileSync(path.join(CONFIG.DATA_DIR, f), 'utf-8'))));

    console.log("Song | MS | End | Start | Shuffle | IP | TS");
    console.log("------------------------------------------");

    events.forEach((e: any) => {
        if (!e.master_metadata_track_name) return;
        const name = `${e.master_metadata_track_name} - ${e.master_metadata_album_artist_name}`;

        if (DISCREPANCY_SONGS.includes(name) && e.ms_played >= 30000 && e.ms_played < 60000) {
            console.log(`${name} | ${e.ms_played} | ${e.reason_end} | ${e.reason_start} | ${e.shuffle} | ${e.ip_addr} | ${e.ts}`);
        }
    });
};

runList();
