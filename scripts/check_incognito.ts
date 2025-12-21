
import * as fs from 'fs';
import * as path from 'path';

// Minimal interface locally to avoid import issues
interface SpotifyAudioEvent {
    ts: string;
    ms_played: number;
    master_metadata_track_name: string;
    master_metadata_album_artist_name: string;
    reason_start: string;
    reason_end: string;
    shuffle: boolean;
    skipped: boolean | null;
    offline: boolean;
    incognito_mode?: boolean;
}

const CONFIG = {
    DATA_DIR: path.join(process.cwd(), 'data'),
    // Songs to check
    TARGETS: [
    ]
};

const runCheck = () => {
    const allFiles = fs.readdirSync(CONFIG.DATA_DIR);
    const relevantFiles = allFiles.filter(f => f.includes('2025') && f.endsWith('.json'));
    const events: SpotifyAudioEvent[] = [];

    relevantFiles.forEach(fileName => {
        const filePath = path.join(CONFIG.DATA_DIR, fileName);
        const raw = fs.readFileSync(filePath, 'utf-8');
        events.push(...JSON.parse(raw));
    });

    CONFIG.TARGETS.forEach(song => {
        console.log(`\n--- ${song} ---`);
        const songEvents = events.filter(e =>
            e.master_metadata_track_name &&
            `${e.master_metadata_track_name} - ${e.master_metadata_album_artist_name}` === song
        );

        // Check Incognito
        const incognito = songEvents.filter(e => e.incognito_mode);
        if (incognito.length > 0) {
            console.log(`  !!! INCOGNITO PLAYS (${incognito.length}) !!!`);
            incognito.forEach(e => {
                console.log(`  ${e.ts} | ${e.ms_played}ms | ${e.reason_end}`);
            });
        } else {
            console.log(`  No Incognito Plays`);
        }

        // Also check short plays for context
        const short = songEvents.filter(e => e.ms_played < 60000);
        short.forEach(e => {
            console.log(`  Short: ${e.ts} | ${e.ms_played}ms | ${e.reason_end} | Incognito: ${e.incognito_mode || false}`);
        });
    });
};

runCheck();
