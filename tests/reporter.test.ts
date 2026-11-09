import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateReport, TrackStats, ReporterConfig } from '../src/reporter.js';

describe('reporter module', () => {
    it('should correctly format and sanitize report output', () => {
        const loggedLines: string[] = [];
        const originalLog = console.log;
        console.log = (...args: any[]) => {
            loggedLines.push(args.map(a => String(a)).join(' '));
        };

        try {
            const trackStats: [string, TrackStats][] = [
                ['Song A - Artist A ', { count: 10, time: 600000 }], // 10 plays, 10m
                ['\x1B[31mSong B\x1B[0m - Artist B ', { count: 5, time: 300000 }], // 5 plays, 5m (ANSI injected)
                ['Song C - Artist C ', { count: 10, time: 1200000 }], // 10 plays, 20m (higher time tie breaker)
            ];

            const artistStats: [string, TrackStats][] = [
                ['Artist A', { count: 10, time: 600000 }],
                ['\x1B[32mArtist B\x1B[0m', { count: 5, time: 300000 }],
                ['Artist C', { count: 10, time: 1200000 }],
            ];

            const config: ReporterConfig = {
                TOP_N: 3,
                TOP_ARTISTS_N: 3,
                TITLE: 'TEST AUDIT REPORT',
            };

            generateReport(trackStats, artistStats, config);

            const output = loggedLines.join('\n');

            // Header check
            assert.ok(output.includes('=== TEST AUDIT REPORT ==='));

            // Top songs check: Song C should be #1 due to tie breaker on time (10 plays, 20m vs 10m)
            assert.ok(output.includes('#1 Song C - Artist C : 10 plays (20m)'));
            assert.ok(output.includes('#2 Song A - Artist A : 10 plays (10m)'));

            // ANSI code sanitization check (Artist B / Song B should be clean)
            assert.ok(!output.includes('\x1B[31m'));
            assert.ok(!output.includes('\x1B[32m'));
            assert.ok(output.includes('Song B'));
            assert.ok(output.includes('Artist B'));

            // Top artists by time check: Artist C (20m/0.3h) -> Artist A (10m/0.2h)
            assert.ok(output.includes('TOP 3 ARTISTS (By Time)'));
            assert.ok(output.includes('#1 Artist C: 20m (0.3h)'));

            // Top artists by count check
            assert.ok(output.includes('TOP 3 ARTISTS (By Play Count)'));
            assert.ok(output.includes('#1 Artist C: 10 plays'));
        } finally {
            console.log = originalLog;
        }
    });

    it('should handle non-string track or artist keys gracefully during sanitization', () => {
        const loggedLines: string[] = [];
        const originalLog = console.log;
        console.log = (...args: any[]) => {
            loggedLines.push(args.map(a => String(a)).join(' '));
        };

        try {
            const trackStats: [string, TrackStats][] = [
                [null as any, { count: 1, time: 60000 }],
            ];
            const artistStats: [string, TrackStats][] = [
                [undefined as any, { count: 1, time: 60000 }],
            ];

            const config: ReporterConfig = {
                TOP_N: 5,
                TOP_ARTISTS_N: 5,
                TITLE: 'EMPTY SANITIZE TEST',
            };

            generateReport(trackStats, artistStats, config);

            const output = loggedLines.join('\n');
            assert.ok(output.includes('#1 : 1 plays (1m)'));
        } finally {
            console.log = originalLog;
        }
    });

    describe('Boundary Conditions & Empty Inputs', () => {
        it('should handle completely empty trackStats and artistStats arrays gracefully', () => {
            const loggedLines: string[] = [];
            const originalLog = console.log;
            console.log = (...args: any[]) => {
                loggedLines.push(args.map(a => String(a)).join(' '));
            };

            try {
                const trackStats: [string, TrackStats][] = [];
                const artistStats: [string, TrackStats][] = [];
                const config: ReporterConfig = {
                    TOP_N: 10,
                    TOP_ARTISTS_N: 10,
                    TITLE: 'EMPTY STATS REPORT',
                };

                generateReport(trackStats, artistStats, config);

                const output = loggedLines.join('\n');
                assert.ok(output.includes('=== EMPTY STATS REPORT ==='));
                assert.ok(output.includes('=== TOP 10 ARTISTS (By Time) ==='));
                assert.ok(output.includes('=== TOP 10 ARTISTS (By Play Count) ==='));
                // No item rankings should be printed
                assert.ok(!output.includes('#1 '));
            } finally {
                console.log = originalLog;
            }
        });

        it('should output no items when TOP_N or TOP_ARTISTS_N is 0', () => {
            const loggedLines: string[] = [];
            const originalLog = console.log;
            console.log = (...args: any[]) => {
                loggedLines.push(args.map(a => String(a)).join(' '));
            };

            try {
                const trackStats: [string, TrackStats][] = [
                    ['Song 1 - Artist 1 ', { count: 10, time: 600000 }],
                ];
                const artistStats: [string, TrackStats][] = [
                    ['Artist 1', { count: 10, time: 600000 }],
                ];
                const config: ReporterConfig = {
                    TOP_N: 0,
                    TOP_ARTISTS_N: 0,
                    TITLE: 'ZERO LIMIT REPORT',
                };

                generateReport(trackStats, artistStats, config);

                const output = loggedLines.join('\n');
                assert.ok(output.includes('=== ZERO LIMIT REPORT ==='));
                assert.ok(output.includes('=== TOP 0 ARTISTS (By Time) ==='));
                assert.ok(output.includes('=== TOP 0 ARTISTS (By Play Count) ==='));
                assert.ok(!output.includes('#1 '));
            } finally {
                console.log = originalLog;
            }
        });

        it('should handle TOP_N and TOP_ARTISTS_N limits exceeding the number of available items', () => {
            const loggedLines: string[] = [];
            const originalLog = console.log;
            console.log = (...args: any[]) => {
                loggedLines.push(args.map(a => String(a)).join(' '));
            };

            try {
                const trackStats: [string, TrackStats][] = [
                    ['Solo Track - Solo Artist ', { count: 7, time: 210000 }],
                ];
                const artistStats: [string, TrackStats][] = [
                    ['Solo Artist', { count: 7, time: 210000 }],
                ];
                const config: ReporterConfig = {
                    TOP_N: 50,
                    TOP_ARTISTS_N: 50,
                    TITLE: 'EXCEEDING LIMITS REPORT',
                };

                generateReport(trackStats, artistStats, config);

                const output = loggedLines.join('\n');
                assert.ok(output.includes('#1 Solo Track - Solo Artist : 7 plays (3m)'));
                assert.ok(!output.includes('#2 '));
            } finally {
                console.log = originalLog;
            }
        });

        it('should accurately slice results when limits are smaller than available items', () => {
            const loggedLines: string[] = [];
            const originalLog = console.log;
            console.log = (...args: any[]) => {
                loggedLines.push(args.map(a => String(a)).join(' '));
            };

            try {
                const trackStats: [string, TrackStats][] = [
                    ['Track 1 - Artist A ', { count: 30, time: 900000 }],
                    ['Track 2 - Artist A ', { count: 20, time: 600000 }],
                    ['Track 3 - Artist A ', { count: 10, time: 300000 }],
                ];
                const artistStats: [string, TrackStats][] = [
                    ['Artist A', { count: 60, time: 1800000 }],
                    ['Artist B', { count: 40, time: 1200000 }],
                    ['Artist C', { count: 20, time: 600000 }],
                ];
                const config: ReporterConfig = {
                    TOP_N: 2,
                    TOP_ARTISTS_N: 1,
                    TITLE: 'SLICED LIMITS REPORT',
                };

                generateReport(trackStats, artistStats, config);

                const output = loggedLines.join('\n');
                // Sliced top tracks to 2
                assert.ok(output.includes('#1 Track 1 - Artist A : 30 plays'));
                assert.ok(output.includes('#2 Track 2 - Artist A : 20 plays'));
                assert.ok(!output.includes('#3 Track 3'));

                // Sliced top artists by time to 1
                assert.ok(output.includes('#1 Artist A: 30m (0.5h)'));
                assert.ok(!output.includes('#2 Artist B'));

                // Sliced top artists by count to 1
                assert.ok(output.includes('#1 Artist A: 60 plays'));
            } finally {
                console.log = originalLog;
            }
        });
    });

    describe('Ranking, Sorting & Tie-Breaking Domain Invariants', () => {
        it('should break ties on listening time when play counts are equal for tracks', () => {
            const loggedLines: string[] = [];
            const originalLog = console.log;
            console.log = (...args: any[]) => {
                loggedLines.push(args.map(a => String(a)).join(' '));
            };

            try {
                const trackStats: [string, TrackStats][] = [
                    ['Short Track - Artist 1 ', { count: 15, time: 450000 }],
                    ['Long Track - Artist 2 ', { count: 15, time: 900000 }],
                    ['Medium Track - Artist 3 ', { count: 15, time: 600000 }],
                ];
                const config: ReporterConfig = {
                    TOP_N: 3,
                    TOP_ARTISTS_N: 0,
                    TITLE: 'TIE BREAK TRACKS REPORT',
                };

                generateReport(trackStats, [], config);

                const output = loggedLines.join('\n');
                // Same count (15), so ordered by descending time: Long (900s/15m) -> Medium (600s/10m) -> Short (450s/7m)
                assert.ok(output.indexOf('#1 Long Track') < output.indexOf('#2 Medium Track'));
                assert.ok(output.indexOf('#2 Medium Track') < output.indexOf('#3 Short Track'));
            } finally {
                console.log = originalLog;
            }
        });

        it('should prioritize higher play count over higher listening time for tracks', () => {
            const loggedLines: string[] = [];
            const originalLog = console.log;
            console.log = (...args: any[]) => {
                loggedLines.push(args.map(a => String(a)).join(' '));
            };

            try {
                const trackStats: [string, TrackStats][] = [
                    ['Long Epic - Artist 1 ', { count: 5, time: 3600000 }], // 1 hour, 5 plays
                    ['Short Pop Song - Artist 2 ', { count: 10, time: 1200000 }], // 20 mins, 10 plays
                ];
                const config: ReporterConfig = {
                    TOP_N: 2,
                    TOP_ARTISTS_N: 0,
                    TITLE: 'COUNT OVER TIME REPORT',
                };

                generateReport(trackStats, [], config);

                const output = loggedLines.join('\n');
                // Pop Song has 10 plays vs 5 plays, so must be #1 despite less listening time
                assert.ok(output.indexOf('#1 Short Pop Song') < output.indexOf('#2 Long Epic'));
            } finally {
                console.log = originalLog;
            }
        });

        it('should sort artist leaderboards independently: by time vs by play count', () => {
            const loggedLines: string[] = [];
            const originalLog = console.log;
            console.log = (...args: any[]) => {
                loggedLines.push(args.map(a => String(a)).join(' '));
            };

            try {
                const artistStats: [string, TrackStats][] = [
                    ['Ambient Artist', { count: 10, time: 7200000 }], // 2 hours, 10 plays
                    ['Punk Band', { count: 50, time: 3600000 }], // 1 hour, 50 plays
                ];
                const config: ReporterConfig = {
                    TOP_N: 0,
                    TOP_ARTISTS_N: 2,
                    TITLE: 'DUAL ARTIST LEADERBOARD REPORT',
                };

                generateReport([], artistStats, config);

                const output = loggedLines.join('\n');
                const timeSection = output.slice(output.indexOf('TOP 2 ARTISTS (By Time)'), output.indexOf('TOP 2 ARTISTS (By Play Count)'));
                const countSection = output.slice(output.indexOf('TOP 2 ARTISTS (By Play Count)'));

                // By Time: Ambient Artist (120m / 2.0h) should be #1
                assert.ok(timeSection.includes('#1 Ambient Artist: 120m (2.0h)'));
                assert.ok(timeSection.includes('#2 Punk Band: 60m (1.0h)'));

                // By Play Count: Punk Band (50 plays) should be #1
                assert.ok(countSection.includes('#1 Punk Band: 50 plays'));
                assert.ok(countSection.includes('#2 Ambient Artist: 10 plays'));
            } finally {
                console.log = originalLog;
            }
        });

        it('should break ties on listening time when artist play counts are equal in the play count leaderboard', () => {
            const loggedLines: string[] = [];
            const originalLog = console.log;
            console.log = (...args: any[]) => {
                loggedLines.push(args.map(a => String(a)).join(' '));
            };

            try {
                const artistStats: [string, TrackStats][] = [
                    ['Artist Low Time', { count: 20, time: 1200000 }], // 20m
                    ['Artist High Time', { count: 20, time: 2400000 }], // 40m
                ];
                const config: ReporterConfig = {
                    TOP_N: 0,
                    TOP_ARTISTS_N: 2,
                    TITLE: 'ARTIST COUNT TIE BREAKER REPORT',
                };

                generateReport([], artistStats, config);

                const output = loggedLines.join('\n');
                const countSection = output.slice(output.indexOf('TOP 2 ARTISTS (By Play Count)'));
                assert.ok(countSection.indexOf('#1 Artist High Time') < countSection.indexOf('#2 Artist Low Time'));
            } finally {
                console.log = originalLog;
            }
        });
    });

    describe('Duration Conversion & Decimal Formatting', () => {
        it('should format sub-minute listening times correctly as 0m', () => {
            const loggedLines: string[] = [];
            const originalLog = console.log;
            console.log = (...args: any[]) => {
                loggedLines.push(args.map(a => String(a)).join(' '));
            };

            try {
                const trackStats: [string, TrackStats][] = [
                    ['Short Clip - Sound Effects ', { count: 1, time: 45000 }], // 45 seconds = 0 minutes floored
                ];
                const artistStats: [string, TrackStats][] = [
                    ['Sound Effects', { count: 1, time: 45000 }],
                ];
                const config: ReporterConfig = {
                    TOP_N: 1,
                    TOP_ARTISTS_N: 1,
                    TITLE: 'SUB MINUTE REPORT',
                };

                generateReport(trackStats, artistStats, config);

                const output = loggedLines.join('\n');
                assert.ok(output.includes('#1 Short Clip - Sound Effects : 1 plays (0m)'));
                assert.ok(output.includes('#1 Sound Effects: 0m (0.0h)'));
            } finally {
                console.log = originalLog;
            }
        });

        it('should accurately calculate floor minutes and fixed 1-decimal-place hours for large durations', () => {
            const loggedLines: string[] = [];
            const originalLog = console.log;
            console.log = (...args: any[]) => {
                loggedLines.push(args.map(a => String(a)).join(' '));
            };

            try {
                // 155 minutes and 45 seconds: 155 * 60,000 + 45,000 = 9,345,000 ms
                // Floor minutes: 155m
                // Hours: 9345000 / 3600000 = 2.595833... -> fixed to 1 decimal place: 2.6h
                const artistStats: [string, TrackStats][] = [
                    ['Classic Symphony Orchestra', { count: 5, time: 9345000 }],
                ];
                const config: ReporterConfig = {
                    TOP_N: 0,
                    TOP_ARTISTS_N: 1,
                    TITLE: 'LARGE DURATION REPORT',
                };

                generateReport([], artistStats, config);

                const output = loggedLines.join('\n');
                assert.ok(output.includes('#1 Classic Symphony Orchestra: 155m (2.6h)'));
            } finally {
                console.log = originalLog;
            }
        });
    });

    describe('Terminal Injection & Control Character Sanitization', () => {
        it('should strip C0 and C1 control characters (null, bell, backspace, carriage return, delete) from outputs', () => {
            const loggedLines: string[] = [];
            const originalLog = console.log;
            console.log = (...args: any[]) => {
                loggedLines.push(args.map(a => String(a)).join(' '));
            };

            try {
                // Inject control characters: \x00 (null), \x07 (bell), \x08 (backspace), \r (CR), \x7F (DEL)
                const dirtyTrack = 'Dangerous\x00Track\x07Name\x08With\rChars\x7F - BadArtist ';
                const dirtyArtist = 'Dangerous\x00Artist\x1B[2JCleaned';
                const dirtyTitle = 'REPORT\x00WITH\x1B[33mCOLORS\x1B[0m\rINJECTED';

                const trackStats: [string, TrackStats][] = [
                    [dirtyTrack, { count: 3, time: 180000 }],
                ];
                const artistStats: [string, TrackStats][] = [
                    [dirtyArtist, { count: 3, time: 180000 }],
                ];
                const config: ReporterConfig = {
                    TOP_N: 1,
                    TOP_ARTISTS_N: 1,
                    TITLE: dirtyTitle,
                };

                generateReport(trackStats, artistStats, config);

                const output = loggedLines.join('\n');
                // No control chars or ANSI escapes should be present
                assert.ok(!output.includes('\x00'));
                assert.ok(!output.includes('\x07'));
                assert.ok(!output.includes('\x08'));
                assert.ok(!output.includes('\r'));
                assert.ok(!output.includes('\x7F'));
                assert.ok(!output.includes('\x1B'));

                // Sanitized content preserved
                assert.ok(output.includes('DangerousTrackNameWithChars - BadArtist : 3 plays (3m)'));
                assert.ok(output.includes('DangerousArtistCleaned'));
                assert.ok(output.includes('REPORTWITHCOLORSINJECTED'));
            } finally {
                console.log = originalLog;
            }
        });

        it('should sanitize untrusted title, track name, and artist name with non-string config TITLE', () => {
            const loggedLines: string[] = [];
            const originalLog = console.log;
            console.log = (...args: any[]) => {
                loggedLines.push(args.map(a => String(a)).join(' '));
            };

            try {
                const trackStats: [string, TrackStats][] = [
                    ['Song 1 - Artist 1 ', { count: 1, time: 60000 }],
                ];
                const artistStats: [string, TrackStats][] = [
                    ['Artist 1', { count: 1, time: 60000 }],
                ];
                const config: ReporterConfig = {
                    TOP_N: 1,
                    TOP_ARTISTS_N: 1,
                    TITLE: null as any,
                };

                generateReport(trackStats, artistStats, config);

                const output = loggedLines.join('\n');
                assert.ok(output.includes('===  ==='));
                assert.ok(output.includes('#1 Song 1 - Artist 1 : 1 plays (1m)'));
            } finally {
                console.log = originalLog;
            }
        });
    });
});
