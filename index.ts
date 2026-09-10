
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

    // Security: Validate numeric input for CLI arguments
    const year = yearArg ? parseInt(yearArg) : 2025;
    if (isNaN(year)) throw new Error('Invalid year argument');

    const TOP_N = topNArg ? parseInt(topNArg) : 200;
    if (isNaN(TOP_N) || TOP_N <= 0) throw new Error('Invalid top argument');

    console.log(`\n--- Starting Spotify Audit ---`);
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
    // Security: Use Object.create(null) to prevent Prototype Pollution from untrusted track/artist names
    const trackStats: Record<string, TrackStats> = Object.create(null);
    const artistStats: Record<string, TrackStats> = Object.create(null);
    let musicMs = 0;
    let podcastMs = 0;

    filtered.forEach(e => {
        if (e.audiobook_title) return;

        if (e.episode_name || e.episode_show_name) {
            podcastMs += e.ms_played;
            return;
        }

        musicMs += e.ms_played;
        const artist = e.master_metadata_album_artist_name || 'Unknown Artist';
        const track = e.master_metadata_track_name || 'Unknown Track';
        const trackKey = `${track} - ${artist} `;

        trackStats[trackKey] = trackStats[trackKey] || { count: 0, time: 0 };
        trackStats[trackKey].count++;
        trackStats[trackKey].time += e.ms_played;

        artistStats[artist] = artistStats[artist] || { count: 0, time: 0 };
        artistStats[artist].count++;
        artistStats[artist].time += e.ms_played;
    });

    // 4. Report
    console.log(`\nMusic Listening: ${Math.floor(musicMs / 3600000)} hours`);
    console.log(`Podcast Listening: ${Math.floor(podcastMs / 3600000)} hours`);

    generateReport(trackStats, artistStats, {
        TOP_N,
        TOP_ARTISTS_N: 20,
        TITLE: allTime ? 'ALL-TIME WRAPPED AUDIT' : `${year} WRAPPED AUDIT`
    });
};

try {
    runAudit();
} catch (error: any) {
    // Security: Avoid exposing full stack trace in production runs
    console.error(`\n[Error]: ${error.message || 'An unexpected error occurred'}`);
    process.exit(1);
}
