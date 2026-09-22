
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

    const year = yearArg ? parseInt(yearArg) : 2025;
    const TOP_N = topNArg ? parseInt(topNArg) : 200;

    // Validate CLI inputs
    if (isNaN(year) || year < 1970 || year > 2100) {
        throw new Error('Invalid year provided. Please provide a valid numeric year between 1970 and 2100.');
    }
    if (isNaN(TOP_N) || TOP_N <= 0) {
        throw new Error('Invalid TOP_N provided. Please provide a positive numeric value for --top.');
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
    // ⚡ Bolt: Use Map for faster dynamic dictionary lookups and inserts compared to Object.create(null)
    const trackStatsNested = new Map<string, Map<string, TrackStats>>();
    const artistStats = new Map<string, TrackStats>();
    let musicMs = 0;
    let podcastMs = 0;

    // ⚡ Bolt: Replaced .forEach with standard for-loop and cached property lookups.
    // This halves the time spent in the aggregation loop by avoiding redundant object accesses.
    // ⚡ Bolt: Use nested map for grouping to avoid massive string concatenation overhead in hot loop.
    for (let i = 0; i < filtered.length; i++) {
        const e = filtered[i];
        if (e.audiobook_title) continue;

        if (e.episode_name || e.episode_show_name) {
            podcastMs += e.ms_played;
            continue;
        }

        musicMs += e.ms_played;
        const artist = e.master_metadata_album_artist_name || 'Unknown Artist';
        const track = e.master_metadata_track_name || 'Unknown Track';

        let artistMap = trackStatsNested.get(artist);
        if (artistMap === undefined) {
            artistMap = new Map<string, TrackStats>();
            trackStatsNested.set(artist, artistMap);
        }

        let tStat = artistMap.get(track);
        if (tStat === undefined) {
            tStat = { count: 0, time: 0 };
            artistMap.set(track, tStat);
        }
        tStat.count++;
        tStat.time += e.ms_played;

        let aStat = artistStats.get(artist);
        if (aStat === undefined) {
            aStat = { count: 0, time: 0 };
            artistStats.set(artist, aStat);
        }
        aStat.count++;
        aStat.time += e.ms_played;
    }

    // Flatten nested stats
    // ⚡ Bolt: Convert Map directly to the array structure needed by generateReport
    // rather than building an intermediate object. This saves memory and time.
    const trackStats: [string, TrackStats][] = [];
    for (const [artist, artistMap] of trackStatsNested.entries()) {
        for (const [track, tStat] of artistMap.entries()) {
            trackStats.push([track + ' - ' + artist + ' ', tStat]);
        }
    }
    const finalArtistStats: [string, TrackStats][] = [...artistStats.entries()];

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
        console.error(`[ERROR] Audit failed: ${error.message}`);
    } else {
        console.error(`[ERROR] Audit failed due to an unknown error.`);
    }
    process.exit(1);
}
