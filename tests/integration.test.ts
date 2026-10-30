import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadAndDedupEvents } from '../src/dataLoader.js';
import { applyWrappedFilters, AuditConfig } from '../src/filters.js';
import { generateReport, TrackStats } from '../src/reporter.js';

describe('End-to-End Pipeline Integration Test', () => {
    const createTempDir = (): string => {
        return fs.mkdtempSync(path.join(os.tmpdir(), 'wrapped-e2e-'));
    };

    const cleanupTempDir = (dir: string) => {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {}
    };

    it('should process a complete audit pipeline from raw JSON files to generated report', () => {
        const dataDir = createTempDir();
        try {
            // Setup raw Spotify streaming history JSON fixture
            const streamingHistory = [
                // Music Track 1 - Valid (3 mins = 180000ms)
                {
                    ts: '2025-03-15T10:00:00Z',
                    ms_played: 180000,
                    master_metadata_track_name: 'Bohemian Rhapsody',
                    master_metadata_album_artist_name: 'Queen',
                    reason_end: 'trackdone',
                    ip_addr: '192.168.1.50'
                },
                // Music Track 1 - Duplicate exact clone (Tier 1 dedup)
                {
                    ts: '2025-03-15T10:03:00Z',
                    ms_played: 180000,
                    master_metadata_track_name: 'Bohemian Rhapsody',
                    master_metadata_album_artist_name: 'Queen',
                    reason_end: 'trackdone',
                    ip_addr: '192.168.1.50'
                },
                // Music Track 2 - Valid (4 mins = 240000ms)
                {
                    ts: '2025-03-15T10:07:00Z',
                    ms_played: 240000,
                    master_metadata_track_name: 'Hotel California',
                    master_metadata_album_artist_name: 'Eagles',
                    reason_end: 'trackdone',
                    ip_addr: '192.168.1.50'
                },
                // Podcast Episode - Valid (30 mins = 1800000ms)
                {
                    ts: '2025-03-15T11:00:00Z',
                    ms_played: 1800000,
                    episode_name: 'Episode 42: Quantum Computing',
                    episode_show_name: 'Tech Talk Daily',
                    reason_end: 'trackdone',
                    ip_addr: '192.168.1.50'
                },
                // Audiobook Chapter - Should be filtered out by audiobook filter
                {
                    ts: '2025-03-15T12:00:00Z',
                    ms_played: 600000,
                    audiobook_title: 'Dune',
                    audiobook_chapter_title: 'Chapter 1',
                    reason_end: 'trackdone',
                    ip_addr: '192.168.1.50'
                },
                // Short play (< 30s) - Should be filtered out by MIN_MS_PLAYED
                {
                    ts: '2025-03-15T13:00:00Z',
                    ms_played: 15000,
                    master_metadata_track_name: 'Skipped Track',
                    master_metadata_album_artist_name: 'Skipped Artist',
                    reason_end: 'fwdbtn',
                    ip_addr: '192.168.1.50'
                }
            ];

            const filePath = path.join(dataDir, 'streaming_history_audio_2025_0.json');
            fs.writeFileSync(filePath, JSON.stringify(streamingHistory));

            // Step 1: Data Loading & Deduplication
            const deduped = loadAndDedupEvents(dataDir, 2025);
            // Expected: 5 events total (1 duplicate 'Bohemian Rhapsody' deduplicated)
            assert.equal(deduped.length, 5);

            // Step 2: Wrapped Filtering
            const config: AuditConfig = {
                START_DATE: new Date('2025-01-01T00:00:00Z'),
                END_DATE: new Date('2025-11-30T23:59:59Z'),
                MIN_MS_PLAYED: 30000
            };
            const filtered = applyWrappedFilters(deduped, config);
            // Expected: 3 events (1 Bohemian Rhapsody, 1 Hotel California, 1 Tech Talk Daily podcast)
            // Audiobook and 15s short play are filtered out.
            assert.equal(filtered.length, 3);

            // Step 3: Aggregation (replicating index.ts logic)
            const trackStatsNested: Record<string, Record<string, TrackStats>> = Object.create(null);
            const artistStats: Record<string, TrackStats> = Object.create(null);
            let musicMs = 0;
            let podcastMs = 0;

            for (let i = 0; i < filtered.length; i++) {
                const e = filtered[i];
                const ms = e.ms_played;

                if (e.audiobook_title) continue;

                if (e.episode_name || e.episode_show_name) {
                    podcastMs += ms;
                    continue;
                }

                musicMs += ms;
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
                tStat.time += ms;

                let aStat = artistStats[artist];
                if (aStat === undefined) {
                    aStat = { count: 0, time: 0 };
                    artistStats[artist] = aStat;
                }
                aStat.count++;
                aStat.time += ms;
            }

            assert.equal(musicMs, 180000 + 240000); // 420,000 ms = 7 mins
            assert.equal(podcastMs, 1800000); // 1,800,000 ms = 30 mins

            // Flatten stats
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

            // Step 4: Report Generation
            const loggedLines: string[] = [];
            const originalLog = console.log;
            console.log = (...args: any[]) => {
                loggedLines.push(args.map(a => String(a)).join(' '));
            };

            try {
                generateReport(trackStats, finalArtistStats, {
                    TOP_N: 10,
                    TOP_ARTISTS_N: 10,
                    TITLE: '2025 WRAPPED AUDIT INTEGRATION TEST'
                });
            } finally {
                console.log = originalLog;
            }

            const reportOutput = loggedLines.join('\n');
            assert.ok(reportOutput.includes('=== 2025 WRAPPED AUDIT INTEGRATION TEST ==='));
            assert.ok(reportOutput.includes('Hotel California - Eagles'));
            assert.ok(reportOutput.includes('Bohemian Rhapsody - Queen'));
            assert.ok(reportOutput.includes('Eagles: 4m'));
            assert.ok(reportOutput.includes('Queen: 3m'));

        } finally {
            cleanupTempDir(dataDir);
        }
    });
});
