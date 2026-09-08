
import { SpotifyAudioEvent } from '../interface/SpotifyAudioEvent.js';

export interface AuditConfig {
    START_DATE: Date;
    END_DATE: Date;
    MIN_MS_PLAYED: number;
}

export const applyWrappedFilters = (deduped: SpotifyAudioEvent[], config: AuditConfig): SpotifyAudioEvent[] => {
    // ⚡ Bolt Optimization: Pre-calculate ISO strings to avoid new Date() in the inner loop
    const startDateStr = config.START_DATE.toISOString();
    const endDateStr = config.END_DATE.toISOString();
    const endMonth = config.END_DATE.getUTCMonth();
    const endDate = config.END_DATE.getUTCDate();

    return deduped.filter((e, index) => {
        const tsStr = e.ts;
        // ⚡ Bolt Optimization: Direct string comparison for ISO 8601 timestamps
        if (tsStr < startDateStr || tsStr > endDateStr) return false;
        if (e.ms_played < config.MIN_MS_PLAYED) return false;

        // Handle unknown reason for short plays (likely glitches)
        if (e.reason_end === 'unknown' && e.ms_played < 32000) return false;

        const isIPv4 = e.ip_addr === '76.149.238.152';
        const artist = e.master_metadata_album_artist_name || 'Unknown Artist';
        const track = e.master_metadata_track_name || 'Unknown Track';
        const currName = `${track} - ${artist} `;

        // Lazy initialization for parsing ms timestamp
        let tsMs = 0;
        const getTsMs = () => {
            if (tsMs === 0) tsMs = Date.parse(tsStr); // ⚡ Bolt Optimization: Date.parse is faster than new Date().getTime()
            return tsMs;
        };

        // RULE 1: UNIVERSAL GLITCH / SPLIT PLAY (Context-Aware)
        let nextSameTrack: SpotifyAudioEvent | null = null;
        let gapToNextSame = Infinity;
        for (let j = index + 1; j < Math.min(index + 5, deduped.length); j++) {
            const candidate = deduped[j];
            const candidateName = `${candidate.master_metadata_track_name} - ${candidate.master_metadata_album_artist_name} `;
            if (candidateName === currName) {
                nextSameTrack = candidate;
                gapToNextSame = Math.abs(Date.parse(candidate.ts) - getTsMs());
                break;
            }
        }

        if (nextSameTrack && nextSameTrack.ms_played >= 30000) {
            if (e.reason_end !== 'remote' && e.reason_end !== 'trackdone') {
                const glitchWindow = isIPv4 ? 150000 : 120000;
                if (gapToNextSame < glitchWindow && e.ms_played < 150000) return false;
            }
            if (gapToNextSame < 210000 && e.ms_played > 300000 && e.reason_end !== 'trackdone') return false;
        }

        // RULE 2: BOUNDARY LOGOUT (IPv4 Final Day)
        if (e.reason_end === 'logout' && isIPv4) {
            // ⚡ Bolt Optimization: Fast string substring checks for month/day
            const tsMonth = parseInt(tsStr.substring(5, 7), 10) - 1;
            const tsDate = parseInt(tsStr.substring(8, 10), 10);
            if (tsMonth === endMonth && tsDate === endDate) return false;
        }

        // RULE 3: REDUNDANT SHORT PLAY (IPv4 Contextual)
        if (e.ms_played < 60000 && isIPv4) {
            const prevTrack = deduped[index - 1];
            const nextTrack = deduped[index + 1];
            const prevName = prevTrack ? `${prevTrack.master_metadata_track_name} - ${prevTrack.master_metadata_album_artist_name} ` : null;
            const nextName = nextTrack ? `${nextTrack.master_metadata_track_name} - ${nextTrack.master_metadata_album_artist_name} ` : null;

            const prevGap = prevTrack ? Math.abs(getTsMs() - Date.parse(prevTrack.ts)) : Infinity;
            const nextGap = nextTrack ? Math.abs(Date.parse(nextTrack.ts) - getTsMs()) : Infinity;

            // 3.1: Consecutive Redundancy
            if (e.reason_end !== 'trackdone' && e.master_metadata_album_artist_name !== '311') {
                const neighbor = (currName === prevName) ? prevTrack : nextTrack;
                if (neighbor && neighbor.ms_played >= 30000) {
                    if ((currName === prevName && prevGap < 1800000) || (currName === nextName && nextGap < 1800000)) {
                        return false;
                    }
                }
            }

            // Sandwich redundancy
            if (prevName && prevName === nextName && prevGap < 600000 && e.reason_end !== 'trackdone') return false;

            // 3.3: Late Year Logout Filter
            const tsMonth = parseInt(tsStr.substring(5, 7), 10) - 1;
            if (tsMonth >= 7 && e.master_metadata_album_artist_name !== '311') {
                if (e.reason_end === 'logout' || (e.reason_end === 'endplay' && e.skipped)) {
                    if (e.ms_played < 50000) return false;
                }
            }
        }

        // Exclude non-music content
        if (e.audiobook_title) return false;

        return true;
    });
};

export const applyStandardFilters = (deduped: SpotifyAudioEvent[], config: AuditConfig): SpotifyAudioEvent[] => {
    // ⚡ Bolt Optimization: Pre-calculate ISO strings to avoid new Date() in the inner loop
    const startDateStr = config.START_DATE.toISOString();
    const endDateStr = config.END_DATE.toISOString();

    return deduped.filter(e => {
        const tsStr = e.ts;
        // ⚡ Bolt Optimization: Direct string comparison for ISO 8601 timestamps
        if (tsStr < startDateStr || tsStr > endDateStr) return false;
        if (e.ms_played < config.MIN_MS_PLAYED) return false;
        if (e.audiobook_title) return false;
        return true;
    });
};
