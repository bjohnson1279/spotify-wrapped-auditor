
import * as fs from 'fs';
import * as path from 'path';
import { SpotifyAudioEvent } from '../interface/SpotifyAudioEvent.js';

const CONFIG = {
    DATA_DIR: path.join(process.cwd(), 'data'),
    START_DATE: new Date('2025-01-01T00:00:00Z'),
    END_DATE: new Date('2025-11-10T11:59:59Z'),
};

const TARGET = "";

const runDebug = () => {
    const allFiles = fs.readdirSync(CONFIG.DATA_DIR);
    const relevantFiles = allFiles.filter(f => f.includes('2025') && f.endsWith('.json'));

    const rawEvents: SpotifyAudioEvent[] = [];
    relevantFiles.forEach(file => {
        const raw = fs.readFileSync(path.join(CONFIG.DATA_DIR, file), 'utf-8');
        rawEvents.push(...JSON.parse(raw));
    });

    rawEvents.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    let deduped: SpotifyAudioEvent[] = [];
    let prev: { e: SpotifyAudioEvent, startTime: number, endTime: number } | null = null;

    for (const e of rawEvents) {
        const endTime = new Date(e.ts).getTime();
        const startTime = endTime - e.ms_played;
        const curr = { e, startTime, endTime };
        if (!prev) { prev = curr; continue; }

        const sameTrack = prev.e.master_metadata_track_name === curr.e.master_metadata_track_name;
        if (sameTrack) {
            const overlapMs = prev.endTime - curr.startTime;
            const gapMs = curr.startTime - prev.endTime;
            if (Math.abs(gapMs) < 10 && prev.e.ms_played === curr.e.ms_played && prev.e.reason_end === curr.e.reason_end) {
                prev = curr; continue;
            }
            if (Math.abs(gapMs) < 1000 && prev.e.ms_played === curr.e.ms_played && prev.e.reason_end !== curr.e.reason_end) {
                prev = curr; continue;
            }
            if (overlapMs > 0) {
                const isGlitch = prev.e.reason_end === 'trackdone' && curr.e.reason_end === 'trackdone';
                if (isGlitch && prev.e.ms_played > 30000 && prev.e.ms_played < 160000) {
                    prev = curr; continue;
                }
            }
        }
        deduped.push(prev.e);
        prev = curr;
    }
    if (prev) deduped.push(prev.e);

    const list: any[] = [];
    deduped.forEach((e, index) => {
        const full = `${e.master_metadata_track_name} - ${e.master_metadata_album_artist_name}`;
        if (full !== TARGET) return;
        const ts = new Date(e.ts);
        const isIPv4 = process.env.HOME_IP ? e.ip_addr === process.env.HOME_IP : false;

        let drop = null;
        if (ts < CONFIG.START_DATE || ts > CONFIG.END_DATE) drop = "Date";
        else if (e.ms_played < 30000) drop = "Short";
        else if (e.reason_end === 'unknown' && e.ms_played < 32000) drop = "UnknownReason";
        else {
            // Rule 1
            let nextSameTrack: SpotifyAudioEvent | null = null;
            let gapToNextSame = Infinity;
            for (let j = index + 1; j < Math.min(index + 5, deduped.length); j++) {
                const candidate = deduped[j];
                if (`${candidate.master_metadata_track_name} - ${candidate.master_metadata_album_artist_name}` === full) {
                    nextSameTrack = candidate;
                    gapToNextSame = Math.abs(new Date(candidate.ts).getTime() - ts.getTime());
                    break;
                }
            }
            if (nextSameTrack && nextSameTrack.ms_played >= 30000) {
                if (e.reason_end !== 'remote' && e.reason_end !== 'trackdone') {
                    const window = isIPv4 ? 150000 : 120000;
                    if (gapToNextSame < window && e.ms_played < 150000) drop = "Rule1Glitch";
                }
                if (gapToNextSame < 210000 && e.ms_played > 300000) drop = "Rule1Extreme";
            }
            if (!drop) {
                if (e.reason_end === 'logout' && isIPv4 && ts.getUTCMonth() === 10 && ts.getUTCDate() === 10) drop = "Rule2Boundary";
                else if (e.ms_played < 60000 && isIPv4) {
                    const prevTrack = deduped[index - 1];
                    const nextTrack = deduped[index + 1];
                    const prevName = prevTrack ? `${prevTrack.master_metadata_track_name} - ${prevTrack.master_metadata_album_artist_name}` : null;
                    const nextName = nextTrack ? `${nextTrack.master_metadata_track_name} - ${nextTrack.master_metadata_album_artist_name}` : null;
                    const prevGap = prevTrack ? Math.abs(ts.getTime() - new Date(prevTrack.ts).getTime()) : Infinity;
                    const nextGap = nextTrack ? Math.abs(new Date(nextTrack.ts).getTime() - ts.getTime()) : Infinity;

                    if (e.reason_end !== 'trackdone') {
                        const neighbor = (full === prevName) ? prevTrack : nextTrack;
                        if (neighbor && neighbor.ms_played >= 30000) {
                            if (e.master_metadata_album_artist_name !== '311') {
                                if ((full === prevName && prevGap < 1800000) || (full === nextName && nextGap < 1800000)) drop = "Rule3Redundancy";
                            }
                        }
                    }
                    if (!drop && prevName && prevName === nextName && prevGap < 600000 && e.reason_end !== 'trackdone') drop = "Rule3Sandwich";
                    if (!drop && ts.getUTCMonth() >= 7 && e.master_metadata_album_artist_name !== '311') {
                        if (e.reason_end === 'logout' || (e.reason_end === 'endplay' && e.skipped)) {
                            if (e.ms_played < 50000) drop = "Rule3LateLogout";
                        }
                    }
                }
            }
        }
        list.push({ e, drop });
    });

    const kept = list.filter(x => !x.drop);
    console.log(`\n=== ${TARGET} ===`);
    console.log(`Kept: ${kept.length}`);
    list.filter(x => x.drop).forEach(x => {
        console.log(`  [DROP: ${x.drop}] ${x.e.ts} | ${x.e.ms_played}ms | Reason: ${x.e.reason_end} | IP: ${x.e.ip_addr}`);
    });
    console.log(`\n--- Logouts/Skips ---`);
    list.filter(x => !x.drop && (x.e.reason_end === 'logout' || x.e.reason_end === 'fwdbtn')).forEach(x => {
        console.log(`  [KEPT] ${x.e.ts} | ${x.e.ms_played}ms | Reason: ${x.e.reason_end} | IP: ${x.e.ip_addr}`);
    });
};

runDebug();
