
import * as fs from 'fs';
import * as path from 'path';

const CONFIG = {
    DATA_DIR: path.join(process.cwd(), 'data'),
};

const TARGETS: any[] = [
];

const runCompare = () => {
    const allFiles = fs.readdirSync(CONFIG.DATA_DIR);
    const relevantFiles = allFiles.filter(f => f.includes('2025') && f.endsWith('.json'));

    relevantFiles.forEach(fileName => {
        const filePath = path.join(CONFIG.DATA_DIR, fileName);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const events = JSON.parse(raw);

        events.forEach((e: any) => {
            if (!e.master_metadata_track_name) return;
            const name = `${e.master_metadata_track_name} - ${e.master_metadata_album_artist_name}`;

            const match = TARGETS.find(t => t.name === name && Math.abs(t.ms - e.ms_played) < 100);
            if (match) {
                console.log(`\n=== ${name} (${e.ms_played}ms) ===`);
                console.log(`End: ${e.reason_end} | OffTS: ${e.offline_timestamp} | IP: ${e.ip_addr} | TS: ${e.ts}`);
            }
        });
    });
};

runCompare();
