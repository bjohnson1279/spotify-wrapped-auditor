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
});
