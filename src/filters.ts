
import { SpotifyAudioEvent } from '../interface/SpotifyAudioEvent.js';

export interface AuditConfig {
    START_DATE: Date;
    END_DATE: Date;
    MIN_MS_PLAYED: number;
}

export const applyWrappedFilters = (deduped: SpotifyAudioEvent[], config: AuditConfig): SpotifyAudioEvent[] => {
    const startDateStr = config.START_DATE.toISOString();
    const endDateStr = config.END_DATE.toISOString();
    const homeIp = process.env.HOME_IP; // ⚡ Bolt: Cache process.env lookup outside the loop

    // ⚡ Bolt: Pre-calculate end date string boundaries to avoid parsing overhead
    const endMonthStr = (config.END_DATE.getUTCMonth() + 1).toString().padStart(2, '0');
    const endDayStr = config.END_DATE.getUTCDate().toString().padStart(2, '0');
    const endMonthDayStr = `${endMonthStr}-${endDayStr}`;

    const len = deduped.length;
    // ⚡ Bolt: Pre-allocate array instead of using .push() to eliminate dynamic resizing overhead
    const result: SpotifyAudioEvent[] = new Array(len);
    let resultIdx = 0;

    // ⚡ Bolt: Use binary search to find the starting index instead of a linear scan.
    // This turns an O(N) scan into O(log N) for skipping initial out-of-bounds events.
    let startIndex = len;
    let l = 0, r = len - 1;
    while (l <= r) {
        const m = Math.floor((l + r) / 2);
        if (deduped[m].ts >= startDateStr) {
            startIndex = m;
            r = m - 1;
        } else {
            l = m + 1;
        }
    }

    for (let index = startIndex; index < len; index++) {
        const e = deduped[index];
        // ⚡ Bolt: Fast string comparison instead of expensive Date parsing for boundaries
        if (e.ts > endDateStr) break; // Events are sorted chronologically, break early
        if (e.ms_played < config.MIN_MS_PLAYED) continue;

        // Handle unknown reason for short plays (likely glitches)
        if (e.reason_end === 'unknown' && e.ms_played < 32000) continue;

        const isIPv4 = homeIp ? e.ip_addr === homeIp : false;
        const artist = e.master_metadata_album_artist_name || 'Unknown Artist';
        const track = e.master_metadata_track_name || 'Unknown Track';
        const currTrack = e.master_metadata_track_name;
        const currArtist = e.master_metadata_album_artist_name;

        // RULE 1: UNIVERSAL GLITCH / SPLIT PLAY (Context-Aware)
        let nextSameTrack: SpotifyAudioEvent | null = null;
        let gapToNextSame = Infinity;
        let tsTime: number | null = null; // Lazy load numeric time

        const loopMax = Math.min(index + 5, len);
        for (let j = index + 1; j < loopMax; j++) {
            const candidate = deduped[j];
            if (candidate.master_metadata_track_name === currTrack && candidate.master_metadata_album_artist_name === currArtist) {
                nextSameTrack = candidate;
                if (tsTime === null) tsTime = Date.parse(e.ts);
                gapToNextSame = Math.abs(Date.parse(candidate.ts) - tsTime);
                break;
            }
        }

        if (nextSameTrack && nextSameTrack.ms_played >= 30000) {
            if (e.reason_end !== 'remote' && e.reason_end !== 'trackdone') {
                const glitchWindow = isIPv4 ? 150000 : 120000;
                if (gapToNextSame < glitchWindow && e.ms_played < 150000) continue;
            }
            if (gapToNextSame < 210000 && e.ms_played > 300000 && e.reason_end !== 'trackdone') continue;
        }

        // ⚡ Bolt: Defer string parsing until absolutely necessary. Use fast substrings instead of new Date()
        let lazyTsMonthDay: string | null = null;

        // RULE 2: BOUNDARY LOGOUT (IPv4 Final Day)
        if (e.reason_end === 'logout' && isIPv4) {
            lazyTsMonthDay = e.ts.substring(5, 10);
            if (lazyTsMonthDay === endMonthDayStr) {
                continue;
            }
        }

        // RULE 3: REDUNDANT SHORT PLAY (IPv4 Contextual)
        if (e.ms_played < 60000 && isIPv4) {
            const prevTrack = deduped[index - 1];
            const nextTrack = deduped[index + 1];
            const isPrevSame = prevTrack ? (prevTrack.master_metadata_track_name === currTrack && prevTrack.master_metadata_album_artist_name === currArtist) : false;
            const isNextSame = nextTrack ? (nextTrack.master_metadata_track_name === currTrack && nextTrack.master_metadata_album_artist_name === currArtist) : false;
            const isPrevNextSame = (prevTrack && nextTrack) ? (prevTrack.master_metadata_track_name === nextTrack.master_metadata_track_name && prevTrack.master_metadata_album_artist_name === nextTrack.master_metadata_album_artist_name) : false;

            // ⚡ Bolt: Defer Date.parse() execution until we actually need it for the gap comparisons
            let prevGap = Infinity;
            let nextGap = Infinity;

            // 3.1: Consecutive Redundancy
            if (e.reason_end !== 'trackdone' && e.master_metadata_album_artist_name !== '311') {
                const neighbor = isPrevSame ? prevTrack : nextTrack;
                if (neighbor && neighbor.ms_played >= 30000) {
                    if (tsTime === null) tsTime = Date.parse(e.ts);
                    if (isPrevSame && prevTrack) prevGap = Math.abs(tsTime - Date.parse(prevTrack.ts));
                    if (isNextSame && nextTrack) nextGap = Math.abs(Date.parse(nextTrack.ts) - tsTime);

                    if ((isPrevSame && prevGap < 1800000) || (isNextSame && nextGap < 1800000)) {
                        continue;
                    }
                }
            }

            // Sandwich redundancy
            if (isPrevNextSame && e.reason_end !== 'trackdone') {
                if (tsTime === null) tsTime = Date.parse(e.ts);
                if (prevGap === Infinity && prevTrack) prevGap = Math.abs(tsTime - Date.parse(prevTrack.ts));

                if (prevGap < 600000) continue;
            }

            // 3.3: Late Year Logout Filter
            if (e.master_metadata_album_artist_name !== '311') {
                if (!lazyTsMonthDay) lazyTsMonthDay = e.ts.substring(5, 10);
                if (lazyTsMonthDay.substring(0, 2) >= '08') { // August is month 08 (0-indexed 7)
                    if (e.reason_end === 'logout' || (e.reason_end === 'endplay' && e.skipped)) {
                        if (e.ms_played < 50000) continue;
                    }
                }
            }
        }

        // Exclude non-music content
        if (e.audiobook_title) continue;

        result[resultIdx++] = e;
    }
    result.length = resultIdx;
    return result;
};

export const applyStandardFilters = (deduped: SpotifyAudioEvent[], config: AuditConfig): SpotifyAudioEvent[] => {
    const startDateStr = config.START_DATE.toISOString();
    const endDateStr = config.END_DATE.toISOString();

    const len = deduped.length;
    // ⚡ Bolt: Pre-allocate array instead of using .push() to eliminate dynamic resizing overhead
    const result: SpotifyAudioEvent[] = new Array(len);
    let resultIdx = 0;

    // ⚡ Bolt: Use binary search to find the starting index instead of a linear scan.
    let startIndex = len;
    let l = 0, r = len - 1;
    while (l <= r) {
        const m = Math.floor((l + r) / 2);
        if (deduped[m].ts >= startDateStr) {
            startIndex = m;
            r = m - 1;
        } else {
            l = m + 1;
        }
    }

    for (let i = startIndex; i < len; i++) {
        const e = deduped[i];
        // ⚡ Bolt: Fast string comparison instead of expensive Date parsing for boundaries
        if (e.ts > endDateStr) break; // Events are sorted chronologically, break early
        if (e.ms_played < config.MIN_MS_PLAYED) continue;
        if (e.audiobook_title) continue;
        result[resultIdx++] = e;
    }
    result.length = resultIdx;
    return result;
};
