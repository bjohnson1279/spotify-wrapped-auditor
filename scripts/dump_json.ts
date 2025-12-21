
import * as fs from 'fs';
import * as path from 'path';

const CONFIG = {
    DATA_DIR: path.join(process.cwd(), 'data'),
};

const runDump = () => {
    const allFiles = fs.readdirSync(CONFIG.DATA_DIR);
    const relevantFiles = allFiles.filter(f => f.includes('2025') && f.endsWith('.json'));

    const allEvents: any[] = [];
    relevantFiles.forEach(f => {
        const raw = fs.readFileSync(path.join(CONFIG.DATA_DIR, f), 'utf-8');
        allEvents.push(...JSON.parse(raw));
    });

    allEvents.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    const targetTs = "2025-02-13T02:34:14Z";
    const index = allEvents.findIndex(e => e.ts === targetTs);

    if (index !== -1) {
        console.log(`\n=== DUMP NEAR ${targetTs} ===`);
        for (let j = -1; j <= 2; j++) {
            const e = allEvents[index + j];
            if (e) {
                console.log(JSON.stringify(e));
                console.log("---");
            }
        }
    }
};

runDump();
