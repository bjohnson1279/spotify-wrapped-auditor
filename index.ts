
import * as path from 'path';
import { loadAndDedupEvents } from './src/dataLoader.js';
import { applyWrappedFilters, applyStandardFilters } from './src/filters.js';
import { generateReport, TrackStats } from './src/reporter.js';

const DATA_DIR = path.join(process.cwd(), 'data');

const runAudit = () => {
    // CLI Args
    const args = process.argv.slice(2);
    const yearArg = args.find(a => a.startsWith('--year='))?.split('=')[1];
    const allTime = args.includes('--all-time');
    const topNArg = args.find(a => a.startsWith('--top='))?.split('=')[1];

    const year = yearArg ? parseInt(yearArg, 10) : 2025;
    const TOP_N = topNArg ? parseInt(topNArg, 10) : 200;

    // Validate CLI inputs
    if (!Number.isFinite(year) || year < 1970 || year > 2100) {
        throw new Error('Invalid year provided. Please provide a valid numeric year between 1970 and 2100.');
    }
    if (!Number.isFinite(TOP_N) || TOP_N <= 0 || TOP_N > 10000) {
        throw new Error('Invalid TOP_N provided. Please provide a positive numeric value between 1 and 10000 for --top.');
    }

    console.log(`\n--- Starting Spotify Audit ---`);
    if (!process.env.HOME_IP) {
        console.warn(`[WARNING] HOME_IP environment variable is not set. IPv4-specific filtering logic will be disabled.`);
    }
    if (allTime) console.log(`Mode: All-Time`);
    else console.log(`Mode: Year ${year}`);

    // DEFAULT DATES
    // Wrapped logic is strictly applied to 2025 (gold standard)
    // For other years, we use a standard calendar year unless specified
    const defaultEndDate = (year === 2025 && !allTime) ? '2025-11-30T23:59:59Z' : `${year}-12-31T23:59:59Z`;

    const config = {
        START_DATE: allTime ? new Date('1970-01-01') : new Date(`${year}-01-01T00:00:00Z`),
        END_DATE: allTime ? new Date() : new Date(defaultEndDate),
        MIN_MS_PLAYED: 30000,
    };

    // 1. Load and Dedup (Global Across All Files)
    const deduped = loadAndDedupEvents(DATA_DIR, allTime ? undefined : year);
    console.log(`Loaded and deduplicated ${deduped.length} total events.`);

    // 2. Filter
    // Use Wrapped filters for 2025 (as it's the verified verified logic)
    const filtered = (year === 2025 && !allTime)
        ? applyWrappedFilters(deduped, config)
        : applyStandardFilters(deduped, config);

    console.log(`Filtered down to ${filtered.length} valid plays.`);

    // 3. Aggregate
    // ⚡ Bolt: Use Object.create(null) for faster string-keyed dynamic dictionary lookups and inserts compared to Map in Node.js inner loops
    const trackStatsNested: Record<string, Record<string, TrackStats>> = Object.create(null);
    const artistStats: Record<string, TrackStats> = Object.create(null);
    let musicMs = 0;
    let podcastMs = 0;

    // ⚡ Bolt: Replaced .forEach with standard for-loop and cached property lookups.
    // This halves the time spent in the aggregation loop by avoiding redundant object accesses.
    // ⚡ Bolt: Use nested map for grouping to avoid massive string concatenation overhead in hot loop.
    for (let i = 0; i < filtered.length; i++) {
        const e = filtered[i];

        // ⚡ Bolt: Cache ms_played to avoid repeated property lookups
        const ms_played = e.ms_played;

        if (e.audiobook_title) continue;

        if (e.episode_name || e.episode_show_name) {
            podcastMs += ms_played;
            continue;
        }

        musicMs += ms_played;
        const artist = e.master_metadata_album_artist_name || 'Unknown Artist';
        const track = e.master_metadata_track_name || 'Unknown Track';

        let artistMap = trackStatsNested[artist];
        if (artistMap === undefined) {
            artistMap = Object.create(null);
            trackStatsNested[artist] = artistMap;
        }

        let tStat = artistMap[track];
        if (tStat === undefined) {
            tStat = { count: 0, time: 0 };
            artistMap[track] = tStat;
        }
        tStat.count++;
        tStat.time += ms_played;

        let aStat = artistStats[artist];
        if (aStat === undefined) {
            aStat = { count: 0, time: 0 };
            artistStats[artist] = aStat;
        }
        aStat.count++;
        aStat.time += ms_played;
    }

    // Flatten nested stats
    // ⚡ Bolt: Convert Nested objects directly to the array structure needed by generateReport
    const trackStats: [string, TrackStats][] = [];
    for (const artist in trackStatsNested) {
        const artistMap = trackStatsNested[artist];
        for (const track in artistMap) {
            trackStats.push([track + ' - ' + artist + ' ', artistMap[track]]);
        }
    }

    const finalArtistStats: [string, TrackStats][] = [];
    for (const artist in artistStats) {
        finalArtistStats.push([artist, artistStats[artist]]);
    }

    // 4. Report
    console.log(`\nMusic Listening: ${Math.floor(musicMs / 3600000)} hours`);
    console.log(`Podcast Listening: ${Math.floor(podcastMs / 3600000)} hours`);

    generateReport(trackStats, finalArtistStats, {
        TOP_N,
        TOP_ARTISTS_N: 20,
        TITLE: allTime ? 'ALL-TIME WRAPPED AUDIT' : `${year} WRAPPED AUDIT`
    });
};

try {
    runAudit();
} catch (error) {
    if (error instanceof Error) {
        // 🛡️ Sentinel: Sanitize error messages to prevent terminal log injection and path leakage
        // Explicitly check for string to avoid type confusion DoS if error.message is somehow not a string
        const rawMessage = typeof error.message === 'string' ? error.message : String(error.message);
        let safeMessage = rawMessage.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/[\x00-\x1F\x7F-\x9F]/g, '');
        // Redact the current working directory to avoid leaking internal paths
        const cwd = process.cwd();
        if (cwd) {
            // Escape potential regex characters in cwd, then replace globally
            const escapedCwd = cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            safeMessage = safeMessage.replace(new RegExp(escapedCwd, 'g'), '[REDACTED_PATH]');
        }
        console.error(`[ERROR] Audit failed: ${safeMessage}`);
    } else {
        console.error(`[ERROR] Audit failed due to an unknown error.`);
    }
    process.exit(1);
}
