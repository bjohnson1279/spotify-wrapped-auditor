import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadAndDedupEvents } from '../src/dataLoader.js';
import { applyWrappedFilters, applyStandardFilters, AuditConfig } from '../src/filters.js';
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

    /**
     * Helper to replicate the core aggregation and reporting pipeline from index.ts.
     * Keeps integration tests clean, deterministic, and tightly aligned with the orchestrator.
     */
    const aggregateAndFormatReport = (filtered: ReturnType<typeof applyWrappedFilters>, options: { topN?: number; title?: string } = {}) => {
        const trackStatsNested: Record<string, Record<string, TrackStats>> = Object.create(null);
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
        }

        const trackStats: [string, TrackStats][] = [];
        const finalArtistStats: [string, TrackStats][] = [];

        for (const artist in trackStatsNested) {
            const artistMap = trackStatsNested[artist];
            let artistCount = 0;
            let artistTime = 0;
            for (const track in artistMap) {
                const tStat = artistMap[track];
                artistCount += tStat.count;
                artistTime += tStat.time;
                trackStats.push([track + ' - ' + artist + ' ', tStat]);
            }
            finalArtistStats.push([artist, { count: artistCount, time: artistTime }]);
        }

        const loggedLines: string[] = [];
        const originalLog = console.log;
        console.log = (...args: any[]) => {
            loggedLines.push(args.map(a => String(a)).join(' '));
        };

        try {
            generateReport(trackStats, finalArtistStats, {
                TOP_N: options.topN ?? 10,
                TOP_ARTISTS_N: 20,
                TITLE: options.title ?? 'TEST PIPELINE AUDIT'
            });
        } finally {
            console.log = originalLog;
        }

        return {
            musicMs,
            podcastMs,
            musicHours: Math.floor(musicMs / 3600000),
            podcastHours: Math.floor(podcastMs / 3600000),
            trackStats,
            finalArtistStats,
            output: loggedLines.join('\n')
        };
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

            // Step 3 & 4: Aggregation and Reporting
            const report = aggregateAndFormatReport(filtered, {
                topN: 10,
                title: '2025 WRAPPED AUDIT INTEGRATION TEST'
            });

            assert.equal(report.musicMs, 180000 + 240000); // 420,000 ms = 7 mins
            assert.equal(report.podcastMs, 1800000); // 1,800,000 ms = 30 mins
            assert.ok(report.output.includes('=== 2025 WRAPPED AUDIT INTEGRATION TEST ==='));
            assert.ok(report.output.includes('Hotel California - Eagles'));
            assert.ok(report.output.includes('Bohemian Rhapsody - Queen'));
            assert.ok(report.output.includes('Eagles: 4m'));
            assert.ok(report.output.includes('Queen: 3m'));

        } finally {
            cleanupTempDir(dataDir);
        }
    });

    it('should cross-deduplicate across multiple chunk files with out-of-order timestamps and multi-tier duplicates', () => {
        const dataDir = createTempDir();
        try {
            // Chunk 1 has later event (12:03:00)
            const chunk1 = [
                // Tier 1 clone counterpart (ends at 12:03:00, 180s played -> start 12:00:00)
                {
                    ts: '2025-06-10T12:03:00Z',
                    ms_played: 180000,
                    master_metadata_track_name: 'Cross Chunk Song',
                    master_metadata_album_artist_name: 'Chunk Artist',
                    reason_end: 'trackdone',
                    ip_addr: '192.168.1.1'
                },
                // Tier 2 double log counterpart (ends at 12:06:00, 180s played)
                {
                    ts: '2025-06-10T12:06:00Z',
                    ms_played: 180000,
                    master_metadata_track_name: 'Glitch Double Log',
                    master_metadata_album_artist_name: 'Chunk Artist',
                    reason_end: 'trackdone',
                    ip_addr: '192.168.1.1'
                }
            ];

            // Chunk 2 has earlier events and Tier 3 overlap
            const chunk2 = [
                // Tier 1 clone first part (ends at 12:00:00, 180s played)
                {
                    ts: '2025-06-10T12:00:00Z',
                    ms_played: 180000,
                    master_metadata_track_name: 'Cross Chunk Song',
                    master_metadata_album_artist_name: 'Chunk Artist',
                    reason_end: 'trackdone',
                    ip_addr: '192.168.1.1'
                },
                // Tier 2 double log first part (ends at 12:03:00, 180s played, unexpectedexit)
                {
                    ts: '2025-06-10T12:03:00Z',
                    ms_played: 180000,
                    master_metadata_track_name: 'Glitch Double Log',
                    master_metadata_album_artist_name: 'Chunk Artist',
                    reason_end: 'unexpectedexit',
                    ip_addr: '192.168.1.1'
                },
                // Tier 3 overlap play 1 (ends at 12:10:00, 120s played -> start 12:08:00)
                {
                    ts: '2025-06-10T12:10:00Z',
                    ms_played: 120000,
                    master_metadata_track_name: 'Overlapping Stream',
                    master_metadata_album_artist_name: 'Chunk Artist',
                    reason_end: 'trackdone',
                    ip_addr: '192.168.1.1'
                },
                // Tier 3 overlap play 2 (ends at 12:10:30, 120s played -> start 12:08:30, overlaps by 90s)
                {
                    ts: '2025-06-10T12:10:30Z',
                    ms_played: 120000,
                    master_metadata_track_name: 'Overlapping Stream',
                    master_metadata_album_artist_name: 'Chunk Artist',
                    reason_end: 'trackdone',
                    ip_addr: '192.168.1.1'
                }
            ];

            // Chunk 3 has an independent legitimate track
            const chunk3 = [
                {
                    ts: '2025-06-10T12:15:00Z',
                    ms_played: 210000,
                    master_metadata_track_name: 'Independent Hit',
                    master_metadata_album_artist_name: 'Solo Artist',
                    reason_end: 'trackdone',
                    ip_addr: '192.168.1.1'
                }
            ];

            fs.writeFileSync(path.join(dataDir, 'streaming_history_audio_2025_chunk1.json'), JSON.stringify(chunk1));
            fs.writeFileSync(path.join(dataDir, 'streaming_history_audio_2025_chunk2.json'), JSON.stringify(chunk2));
            fs.writeFileSync(path.join(dataDir, 'streaming_history_audio_2025_chunk3.json'), JSON.stringify(chunk3));

            const deduped = loadAndDedupEvents(dataDir, 2025);
            // 7 total raw events across 3 chunks:
            // - Cross Chunk Song (Tier 1): 2 -> 1
            // - Glitch Double Log (Tier 2): 2 -> 1
            // - Overlapping Stream (Tier 3): 2 -> 1
            // - Independent Hit: 1
            // Total deduped = 4
            assert.equal(deduped.length, 4);

            const config: AuditConfig = {
                START_DATE: new Date('2025-01-01T00:00:00Z'),
                END_DATE: new Date('2025-11-30T23:59:59Z'),
                MIN_MS_PLAYED: 30000
            };
            const filtered = applyWrappedFilters(deduped, config);
            assert.equal(filtered.length, 4);

            const report = aggregateAndFormatReport(filtered, { title: 'CROSS CHUNK DEDUP AUDIT' });
            assert.ok(report.output.includes('Cross Chunk Song - Chunk Artist : 1 plays (3m)'));
            assert.ok(report.output.includes('Glitch Double Log - Chunk Artist : 1 plays (3m)'));
            assert.ok(report.output.includes('Overlapping Stream - Chunk Artist : 1 plays (2m)'));
            assert.ok(report.output.includes('Independent Hit - Solo Artist : 1 plays (3m)'));
            assert.ok(report.output.includes('Chunk Artist: 8m (0.1h)'));
            assert.ok(report.output.includes('Solo Artist: 3m (0.1h)'));
        } finally {
            cleanupTempDir(dataDir);
        }
    });

    it('should correctly handle multi-year archive segregation, 2025 Wrapped cutoff vs calendar year, and all-time lifetime aggregation', () => {
        const dataDir = createTempDir();
        try {
            const history2023 = [
                {
                    ts: '2023-07-04T12:00:00Z',
                    ms_played: 180000,
                    master_metadata_track_name: 'Summer of 2023',
                    master_metadata_album_artist_name: 'Archive Artist',
                    reason_end: 'trackdone'
                }
            ];

            const history2024 = [
                // In July 2024
                {
                    ts: '2024-07-04T12:00:00Z',
                    ms_played: 200000,
                    master_metadata_track_name: 'Midyear 2024 Track',
                    master_metadata_album_artist_name: 'Archive Artist',
                    reason_end: 'trackdone'
                },
                // On Dec 20, 2024 (December play) - should be included in 2024 standard calendar year audit
                {
                    ts: '2024-12-20T12:00:00Z',
                    ms_played: 240000,
                    master_metadata_track_name: 'December 2024 Track',
                    master_metadata_album_artist_name: 'Archive Artist',
                    reason_end: 'trackdone'
                }
            ];

            const history2025 = [
                // Valid in-window play (October 2025)
                {
                    ts: '2025-10-15T12:00:00Z',
                    ms_played: 300000,
                    master_metadata_track_name: 'Autumn 2025 Anthem',
                    master_metadata_album_artist_name: 'Archive Artist',
                    reason_end: 'trackdone'
                },
                // Cutoff play (December 02, 2025) - must be excluded by 2025 Wrapped cutoff (2025-11-30T23:59:59Z)
                {
                    ts: '2025-12-02T12:00:00Z',
                    ms_played: 300000,
                    master_metadata_track_name: 'December 2025 Cutoff Track',
                    master_metadata_album_artist_name: 'Archive Artist',
                    reason_end: 'trackdone'
                }
            ];

            fs.writeFileSync(path.join(dataDir, 'streaming_history_audio_2023_0.json'), JSON.stringify(history2023));
            fs.writeFileSync(path.join(dataDir, 'streaming_history_audio_2024_0.json'), JSON.stringify(history2024));
            fs.writeFileSync(path.join(dataDir, 'streaming_history_audio_2025_0.json'), JSON.stringify(history2025));

            // Test 1: 2025 Wrapped audit (filters strictly through 2025-11-30T23:59:59Z)
            const deduped2025 = loadAndDedupEvents(dataDir, 2025);
            assert.equal(deduped2025.length, 2);
            const config2025: AuditConfig = {
                START_DATE: new Date('2025-01-01T00:00:00Z'),
                END_DATE: new Date('2025-11-30T23:59:59Z'),
                MIN_MS_PLAYED: 30000
            };
            const filtered2025 = applyWrappedFilters(deduped2025, config2025);
            assert.equal(filtered2025.length, 1);
            assert.equal(filtered2025[0].master_metadata_track_name, 'Autumn 2025 Anthem');

            // Test 2: 2024 Custom year audit (uses standard calendar year filters through 2024-12-31T23:59:59Z)
            const deduped2024 = loadAndDedupEvents(dataDir, 2024);
            assert.equal(deduped2024.length, 2);
            const config2024: AuditConfig = {
                START_DATE: new Date('2024-01-01T00:00:00Z'),
                END_DATE: new Date('2024-12-31T23:59:59Z'),
                MIN_MS_PLAYED: 30000
            };
            const filtered2024 = applyStandardFilters(deduped2024, config2024);
            assert.equal(filtered2024.length, 2);
            assert.ok(filtered2024.some(e => e.master_metadata_track_name === 'Midyear 2024 Track'));
            assert.ok(filtered2024.some(e => e.master_metadata_track_name === 'December 2024 Track'));

            // Test 3: All-Time mode (allTime = true loads all files and aggregates lifetime history)
            const dedupedAllTime = loadAndDedupEvents(dataDir, undefined);
            assert.equal(dedupedAllTime.length, 5); // 1 (2023) + 2 (2024) + 2 (2025)
            const configAllTime: AuditConfig = {
                START_DATE: new Date('1970-01-01'),
                END_DATE: new Date('2100-01-01'),
                MIN_MS_PLAYED: 30000
            };
            const filteredAllTime = applyStandardFilters(dedupedAllTime, configAllTime);
            assert.equal(filteredAllTime.length, 5);

            const allTimeReport = aggregateAndFormatReport(filteredAllTime, { title: 'ALL-TIME WRAPPED AUDIT' });
            assert.ok(allTimeReport.output.includes('=== ALL-TIME WRAPPED AUDIT ==='));
            // Total music time: 180000 + 200000 + 240000 + 300000 + 300000 = 1,220,000 ms = 20 mins
            assert.ok(allTimeReport.output.includes('Archive Artist: 20m (0.3h)'));
            assert.ok(allTimeReport.output.includes('Archive Artist: 5 plays'));
        } finally {
            cleanupTempDir(dataDir);
        }
    });

    it('should evaluate complex Wrapped heuristics, content types, and exception rules in concert', () => {
        const dataDir = createTempDir();
        const originalHomeIp = process.env.HOME_IP;
        process.env.HOME_IP = '192.168.1.100';

        try {
            const rawEvents = [
                // 1. Legitimate Spaced Repeat Play 1 (10:00:00 - 10:03:00, 180s)
                {
                    ts: '2025-04-10T10:03:00Z',
                    ms_played: 180000,
                    master_metadata_track_name: 'Repeat Jam',
                    master_metadata_album_artist_name: 'Favorite Band',
                    reason_end: 'trackdone',
                    ip_addr: '192.168.1.100'
                },
                // 2. Rule 1 Glitch Split Play: interrupted play followed by resume within 150s window (< 150000ms)
                {
                    ts: '2025-04-10T10:10:00Z',
                    ms_played: 45000,
                    master_metadata_track_name: 'Glitchy Song',
                    master_metadata_album_artist_name: 'Synth Pop',
                    reason_end: 'unexpectedexit',
                    ip_addr: '192.168.1.100'
                },
                // Resume of Glitchy Song 30 seconds later (10:10:30)
                {
                    ts: '2025-04-10T10:13:30Z',
                    ms_played: 180000,
                    master_metadata_track_name: 'Glitchy Song',
                    master_metadata_album_artist_name: 'Synth Pop',
                    reason_end: 'trackdone',
                    ip_addr: '192.168.1.100'
                },
                // 3. Rule 3.2 Sandwich Redundancy: Bread -> Meat (< 60s, unexpectedexit) -> Bread
                {
                    ts: '2025-04-10T11:00:00Z',
                    ms_played: 180000,
                    master_metadata_track_name: 'Sandwich Bread',
                    master_metadata_album_artist_name: 'Bakery',
                    reason_end: 'trackdone',
                    ip_addr: '192.168.1.100'
                },
                {
                    ts: '2025-04-10T11:01:00Z', // 60s gap (< 600000ms)
                    ms_played: 45000,
                    master_metadata_track_name: 'Sandwich Filling',
                    master_metadata_album_artist_name: 'Bakery',
                    reason_end: 'unexpectedexit',
                    ip_addr: '192.168.1.100'
                },
                {
                    ts: '2025-04-10T11:04:00Z',
                    ms_played: 180000,
                    master_metadata_track_name: 'Sandwich Bread',
                    master_metadata_album_artist_name: 'Bakery',
                    reason_end: 'trackdone',
                    ip_addr: '192.168.1.100'
                },
                // 4. Rule 3.3 Exception for Artist "311" (late-year logout short play should NOT be filtered)
                {
                    ts: '2025-09-15T12:00:00Z',
                    ms_played: 40000,
                    master_metadata_track_name: 'Amber',
                    master_metadata_album_artist_name: '311',
                    reason_end: 'logout',
                    ip_addr: '192.168.1.100'
                },
                // 5. Rule 2 Boundary Logout on Final Day (Nov 30) on Home IP -> must be filtered
                {
                    ts: '2025-11-30T22:00:00Z',
                    ms_played: 90000,
                    master_metadata_track_name: 'Cutoff Track',
                    master_metadata_album_artist_name: 'Late Artist',
                    reason_end: 'logout',
                    ip_addr: '192.168.1.100'
                },
                // 6. Podcast Episode (1 hour = 3600000ms)
                {
                    ts: '2025-04-10T14:00:00Z',
                    ms_played: 3600000,
                    episode_name: 'Deep Dive into V8 Optimization',
                    episode_show_name: 'Engineering Podcast',
                    reason_end: 'trackdone',
                    ip_addr: '192.168.1.100'
                },
                // 7. Audiobook (must be filtered out)
                {
                    ts: '2025-04-10T16:00:00Z',
                    ms_played: 1800000,
                    audiobook_title: 'The Great Gatsby',
                    audiobook_chapter_title: 'Chapter 2',
                    reason_end: 'trackdone',
                    ip_addr: '192.168.1.100'
                },
                // 8. Legitimate Spaced Repeat Play 2 (17:00:00, 7 hours later)
                {
                    ts: '2025-04-10T17:03:00Z',
                    ms_played: 180000,
                    master_metadata_track_name: 'Repeat Jam',
                    master_metadata_album_artist_name: 'Favorite Band',
                    reason_end: 'trackdone',
                    ip_addr: '192.168.1.100'
                }
            ];

            fs.writeFileSync(path.join(dataDir, 'streaming_history_audio_2025_0.json'), JSON.stringify(rawEvents));

            const deduped = loadAndDedupEvents(dataDir, 2025);
            assert.equal(deduped.length, 11);

            const config: AuditConfig = {
                START_DATE: new Date('2025-01-01T00:00:00Z'),
                END_DATE: new Date('2025-11-30T23:59:59Z'),
                MIN_MS_PLAYED: 30000
            };

            const filtered = applyWrappedFilters(deduped, config);

            // Analysis of filtered results across the 11 raw/deduped events:
            // 1. Repeat Jam play 1: kept
            // 2. Glitchy Song (45s): filtered out by Rule 1 lookahead
            //    Glitchy Song (180s resume): kept
            // 3. Sandwich Bread play 1: kept
            //    Sandwich Filling (45s): filtered out by Rule 3.2 sandwich redundancy
            //    Sandwich Bread play 2: kept
            // 4. 311 Amber (40s logout in Sep): kept due to 311 exemption
            // 5. Nov 30 Cutoff Track logout on Home IP: filtered out by Rule 2
            // 6. Podcast episode: kept by filter (aggregated to podcastMs)
            // 7. Audiobook: filtered out by audiobook filter
            // 8. Repeat Jam play 2: kept (spaced repeat)
            // Expected remaining valid plays: 7
            assert.equal(filtered.length, 7);

            const report = aggregateAndFormatReport(filtered, { title: 'COMPLEX HEURISTICS AUDIT' });

            assert.equal(report.podcastHours, 1);
            assert.ok(report.output.includes('Repeat Jam - Favorite Band : 2 plays (6m)'));
            assert.ok(report.output.includes('Sandwich Bread - Bakery : 2 plays (6m)'));
            assert.ok(report.output.includes('Glitchy Song - Synth Pop : 1 plays (3m)'));
            assert.ok(report.output.includes('Amber - 311 : 1 plays (0m)'));
            assert.ok(!report.output.includes('Sandwich Filling'));
            assert.ok(!report.output.includes('Cutoff Track'));
            assert.ok(!report.output.includes('The Great Gatsby'));
        } finally {
            if (originalHomeIp !== undefined) {
                process.env.HOME_IP = originalHomeIp;
            } else {
                delete process.env.HOME_IP;
            }
            cleanupTempDir(dataDir);
        }
    });

    it('should maintain pipeline fault tolerance and safety when corrupt, non-array, and oversized files are present', () => {
        const dataDir = createTempDir();
        try {
            // 1. Corrupt JSON syntax file
            fs.writeFileSync(path.join(dataDir, 'streaming_history_audio_2025_corrupt.json'), '{"incomplete": true, ');

            // 2. Non-array JSON file
            fs.writeFileSync(path.join(dataDir, 'streaming_history_audio_2025_not_array.json'), JSON.stringify({ message: 'not an array' }));

            // 3. Non-JSON file (e.g. text or readme)
            fs.writeFileSync(path.join(dataDir, 'notes_2025.txt'), 'random notes');

            // 4. Oversized file (> 50MB) created via sparse file
            const largeFilePath = path.join(dataDir, 'streaming_history_audio_2025_huge.json');
            const fd = fs.openSync(largeFilePath, 'w');
            fs.ftruncateSync(fd, 52 * 1024 * 1024);
            fs.closeSync(fd);

            // 5. Valid JSON file with clean records
            const validHistory = [
                {
                    ts: '2025-05-01T10:00:00Z',
                    ms_played: 180000,
                    master_metadata_track_name: 'Resilient Track',
                    master_metadata_album_artist_name: 'Survivor Artist',
                    reason_end: 'trackdone'
                }
            ];
            fs.writeFileSync(path.join(dataDir, 'streaming_history_audio_2025_valid.json'), JSON.stringify(validHistory));

            // The pipeline should safely bypass corrupt, non-array, non-JSON, and oversized files without throwing unhandled exceptions
            const deduped = loadAndDedupEvents(dataDir, 2025);
            assert.equal(deduped.length, 1);
            assert.equal(deduped[0].master_metadata_track_name, 'Resilient Track');

            const config: AuditConfig = {
                START_DATE: new Date('2025-01-01T00:00:00Z'),
                END_DATE: new Date('2025-11-30T23:59:59Z'),
                MIN_MS_PLAYED: 30000
            };
            const filtered = applyWrappedFilters(deduped, config);
            assert.equal(filtered.length, 1);

            const report = aggregateAndFormatReport(filtered, { title: 'FAULT TOLERANCE AUDIT' });
            assert.ok(report.output.includes('Resilient Track - Survivor Artist : 1 plays (3m)'));
            assert.ok(report.output.includes('Survivor Artist: 3m (0.1h)'));
        } finally {
            cleanupTempDir(dataDir);
        }
    });

    it('should gracefully handle empty datasets and produce empty reports without errors', () => {
        const dataDir = createTempDir();
        try {
            // Empty data directory
            const deduped = loadAndDedupEvents(dataDir, 2025);
            assert.deepEqual(deduped, []);

            const config: AuditConfig = {
                START_DATE: new Date('2025-01-01T00:00:00Z'),
                END_DATE: new Date('2025-11-30T23:59:59Z'),
                MIN_MS_PLAYED: 30000
            };
            const filtered = applyWrappedFilters(deduped, config);
            assert.deepEqual(filtered, []);

            const report = aggregateAndFormatReport(filtered, { title: 'EMPTY PIPELINE AUDIT' });
            assert.equal(report.musicMs, 0);
            assert.equal(report.podcastMs, 0);
            assert.equal(report.musicHours, 0);
            assert.equal(report.podcastHours, 0);
            assert.ok(report.output.includes('=== EMPTY PIPELINE AUDIT ==='));
            assert.ok(!report.output.includes('#1 '));
        } finally {
            cleanupTempDir(dataDir);
        }
    });
});
