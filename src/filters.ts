
import { SpotifyAudioEvent } from '../interface/SpotifyAudioEvent.js';

export interface AuditConfig {
    START_DATE: Date;
    END_DATE: Date;
    MIN_MS_PLAYED: number;
}

export const applyWrappedFilters = (deduped: SpotifyAudioEvent[], config: AuditConfig): SpotifyAudioEvent[] => {
    return deduped.filter((e, index) => {
        const ts = new Date(e.ts);
        if (ts < config.START_DATE || ts > config.END_DATE) return false;
        if (e.ms_played < config.MIN_MS_PLAYED) return false;

        // Handle unknown reason for short plays (likely glitches)
        if (e.reason_end === 'unknown' && e.ms_played < 32000) return false;

        const isIPv4 = process.env.HOME_IP ? e.ip_addr === process.env.HOME_IP : false;
        const artist = e.master_metadata_album_artist_name || 'Unknown Artist';
        const track = e.master_metadata_track_name || 'Unknown Track';
        const currName = `${track} - ${artist} `;

        // RULE 1: UNIVERSAL GLITCH / SPLIT PLAY (Context-Aware)
        let nextSameTrack: SpotifyAudioEvent | null = null;
        let gapToNextSame = Infinity;
        for (let j = index + 1; j < Math.min(index + 5, deduped.length); j++) {
            const candidate = deduped[j];
            const candidateName = `${candidate.master_metadata_track_name} - ${candidate.master_metadata_album_artist_name} `;
            if (candidateName === currName) {
                nextSameTrack = candidate;
                gapToNextSame = Math.abs(new Date(candidate.ts).getTime() - ts.getTime());
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
        if (e.reason_end === 'logout' && isIPv4 && ts.getUTCMonth() === config.END_DATE.getUTCMonth() && ts.getUTCDate() === config.END_DATE.getUTCDate()) {
            return false;
        }

        // RULE 3: REDUNDANT SHORT PLAY (IPv4 Contextual)
        if (e.ms_played < 60000 && isIPv4) {
            const prevTrack = deduped[index - 1];
            const nextTrack = deduped[index + 1];
            const prevName = prevTrack ? `${prevTrack.master_metadata_track_name} - ${prevTrack.master_metadata_album_artist_name} ` : null;
            const nextName = nextTrack ? `${nextTrack.master_metadata_track_name} - ${nextTrack.master_metadata_album_artist_name} ` : null;

            const prevGap = prevTrack ? Math.abs(ts.getTime() - new Date(prevTrack.ts).getTime()) : Infinity;
            const nextGap = nextTrack ? Math.abs(new Date(nextTrack.ts).getTime() - ts.getTime()) : Infinity;

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
            if (ts.getUTCMonth() >= 7 && e.master_metadata_album_artist_name !== '311') {
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
    return deduped.filter(e => {
        const ts = new Date(e.ts);
        if (ts < config.START_DATE || ts > config.END_DATE) return false;
        if (e.ms_played < config.MIN_MS_PLAYED) return false;
        if (e.audiobook_title) return false;
        return true;
    });
};
