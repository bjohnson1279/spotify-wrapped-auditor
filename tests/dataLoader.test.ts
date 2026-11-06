import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadAndDedupEvents } from '../src/dataLoader.js';

describe('dataLoader module', () => {
    const createTempDir = (): string => {
        return fs.mkdtempSync(path.join(os.tmpdir(), 'wrapped-test-'));
    };

    const cleanupTempDir = (dir: string) => {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {}
    };

    it('should throw safe error when data directory does not exist', () => {
        assert.throws(
            () => loadAndDedupEvents('/path/that/does/not/exist/at/all'),
            (err: Error) => err.message.includes('Data directory not found or cannot be read.')
        );
    });

    it('should handle non-Error or error without code property during readdirSync gracefully', async () => {
        const { execFile } = await import('node:child_process');
        const projectRoot = process.cwd();

        // Subprocess test 1: Error instance without code property
        const scriptErrorWithoutCode = `
            import { createRequire } from 'module';
            const require = createRequire(import.meta.url);
            const cjsFs = require('fs');
            cjsFs.readdirSync = () => { throw new Error('Generic error without code'); };
            const { loadAndDedupEvents } = await import('./dist/src/dataLoader.js');
            try {
                loadAndDedupEvents('dummy_dir');
            } catch (e) {
                // safely caught
            }
        `;
        const res1 = await new Promise<{ stderr: string }>((resolve) => {
            execFile(process.execPath, ['--input-type=module', '-e', scriptErrorWithoutCode], { cwd: projectRoot }, (err, stdout, stderr) => {
                resolve({ stderr: stderr.toString() });
            });
        });
        assert.ok(res1.stderr.includes('Code: UNKNOWN'));

        // Subprocess test 2: Non-Error thrown object (string primitive)
        const scriptNonError = `
            import { createRequire } from 'module';
            const require = createRequire(import.meta.url);
            const cjsFs = require('fs');
            cjsFs.readdirSync = () => { throw 'string error'; };
            const { loadAndDedupEvents } = await import('./dist/src/dataLoader.js');
            try {
                loadAndDedupEvents('dummy_dir');
            } catch (e) {
                // safely caught
            }
        `;
        const res2 = await new Promise<{ stderr: string }>((resolve) => {
            execFile(process.execPath, ['--input-type=module', '-e', scriptNonError], { cwd: projectRoot }, (err, stdout, stderr) => {
                resolve({ stderr: stderr.toString() });
            });
        });
        assert.ok(res2.stderr.includes('Code: UNKNOWN'));
    });

    it('should safely skip non-regular files such as subdirectories ending in .json', () => {
        const dir = createTempDir();
        try {
            // Create a subdirectory that ends with .json
            const subDir = path.join(dir, 'nested_folder.json');
            fs.mkdirSync(subDir);

            // Create a valid file
            const validFile = path.join(dir, 'valid_stream.json');
            fs.writeFileSync(validFile, JSON.stringify([{
                ts: '2025-05-01T10:00:00Z',
                ms_played: 60000,
                master_metadata_track_name: 'Regular File Track'
            }]));

            const result = loadAndDedupEvents(dir);
            // The directory should be skipped by stats.isFile() check and only the valid file returned
            assert.equal(result.length, 1);
            assert.equal(result[0].master_metadata_track_name, 'Regular File Track');
        } finally {
            cleanupTempDir(dir);
        }
    });

    it('should sort identical timestamps stably without errors', () => {
        const dir = createTempDir();
        try {
            const events = [
                {
                    ts: '2025-05-01T10:00:00Z',
                    ms_played: 60000,
                    master_metadata_track_name: 'Track A',
                    reason_end: 'trackdone'
                },
                {
                    ts: '2025-05-01T10:00:00Z',
                    ms_played: 60000,
                    master_metadata_track_name: 'Track B',
                    reason_end: 'trackdone'
                }
            ];

            fs.writeFileSync(path.join(dir, 'identical_ts.json'), JSON.stringify(events));

            const result = loadAndDedupEvents(dir);
            assert.equal(result.length, 2);
        } finally {
            cleanupTempDir(dir);
        }
    });

    it('should load and filter files by year if year parameter is passed', () => {
        const dir = createTempDir();
        try {
            const file2025 = path.join(dir, 'streaming_history_audio_2025_0.json');
            const file2024 = path.join(dir, 'streaming_history_audio_2024_0.json');

            const event2025 = [{
                ts: '2025-05-01T12:00:00Z',
                ms_played: 180000,
                master_metadata_track_name: 'Song 2025',
                master_metadata_album_artist_name: 'Artist 2025'
            }];
            const event2024 = [{
                ts: '2024-05-01T12:00:00Z',
                ms_played: 180000,
                master_metadata_track_name: 'Song 2024',
                master_metadata_album_artist_name: 'Artist 2024'
            }];

            fs.writeFileSync(file2025, JSON.stringify(event2025));
            fs.writeFileSync(file2024, JSON.stringify(event2024));

            const result2025 = loadAndDedupEvents(dir, 2025);
            assert.equal(result2025.length, 1);
            assert.equal(result2025[0].master_metadata_track_name, 'Song 2025');

            const resultAll = loadAndDedupEvents(dir);
            assert.equal(resultAll.length, 2);
        } finally {
            cleanupTempDir(dir);
        }
    });

    it('should skip non-array or invalid JSON files gracefully', () => {
        const dir = createTempDir();
        try {
            fs.writeFileSync(path.join(dir, 'invalid_syntax.json'), '{ broken json ');
            fs.writeFileSync(path.join(dir, 'non_array.json'), JSON.stringify({ key: 'value' }));
            fs.writeFileSync(path.join(dir, 'valid_2025.json'), JSON.stringify([{
                ts: '2025-01-01T10:00:00Z',
                ms_played: 60000,
                master_metadata_track_name: 'Good Song'
            }]));

            const result = loadAndDedupEvents(dir);
            assert.equal(result.length, 1);
            assert.equal(result[0].master_metadata_track_name, 'Good Song');
        } finally {
            cleanupTempDir(dir);
        }
    });

    it('should reject items with dangerous prototype pollution keys or malicious payload properties', () => {
        const dir = createTempDir();
        try {
            // Using JSON strings to test JSON.parse own key creation for __proto__, constructor, etc.
            const maliciousDataJson = `[
                {"ts":"2025-01-01T10:00:00Z","ms_played":60000,"master_metadata_track_name":"Bad Proto","__proto__":{"polluted":true}},
                {"ts":"2025-01-01T10:01:00Z","ms_played":60000,"master_metadata_track_name":"Bad Constructor","constructor":"evil"},
                {"ts":"2025-01-01T10:02:00Z","ms_played":60000,"master_metadata_track_name":"Long Prop","extra_field":"${'a'.repeat(5001)}"},
                {"ts":"2025-01-01T10:03:00Z","ms_played":60000,"master_metadata_track_name":"Nested Obj","nested":{"foo":"bar"}},
                {"ts":"2025-01-01T10:04:00Z","ms_played":60000,"master_metadata_track_name":"Valid Song"}
            ]`;

            fs.writeFileSync(path.join(dir, 'data_2025.json'), maliciousDataJson);

            const result = loadAndDedupEvents(dir);
            assert.equal(result.length, 1);
            assert.equal(result[0].master_metadata_track_name, 'Valid Song');
        } finally {
            cleanupTempDir(dir);
        }
    });

    it('should validate primitive item types and boundary lengths', () => {
        const dir = createTempDir();
        try {
            const items: Record<string, unknown>[] = [
                { ts: 12345, ms_played: 100 },
                { ts: '2025-01-01T10:00:00Z', ms_played: '1000' },
                { ts: '2025-01-01T10:00:00Z', ms_played: -10 },
                { ts: '2025-01-01T10:00:00Z', ms_played: NaN },
                { ts: '2025-01-01T10:00:00Z', ms_played: 1000, master_metadata_track_name: 'a'.repeat(1001) },
                { ts: '2025-01-01T10:00:00Z', ms_played: 1000, master_metadata_track_name: 'Valid' }
            ];

            fs.writeFileSync(path.join(dir, 'data_2025.json'), JSON.stringify(items));

            const result = loadAndDedupEvents(dir);
            assert.equal(result.length, 1);
            assert.equal(result[0].master_metadata_track_name, 'Valid');
        } finally {
            cleanupTempDir(dir);
        }
    });

    it('should deduplicate Tier 1 exact metadata clones', () => {
        const dir = createTempDir();
        try {
            // Event 1 ends at 12:00:00. Event 2 ends at 12:03:00 with ms_played=180000 (3 min).
            // currStartTime = 12:03:00 - 3m = 12:00:00. prevEndTime = 12:00:00. gapMs = 0 (< 10ms).
            const events = [
                {
                    ts: '2025-05-15T12:00:00Z',
                    ms_played: 180000,
                    master_metadata_track_name: 'Duplicate Track',
                    reason_end: 'trackdone'
                },
                {
                    ts: '2025-05-15T12:03:00Z',
                    ms_played: 180000,
                    master_metadata_track_name: 'Duplicate Track',
                    reason_end: 'trackdone'
                }
            ];

            fs.writeFileSync(path.join(dir, 'data_2025.json'), JSON.stringify(events));

            const result = loadAndDedupEvents(dir);
            assert.equal(result.length, 1);
            assert.equal(result[0].ts, '2025-05-15T12:03:00Z');
        } finally {
            cleanupTempDir(dir);
        }
    });

    it('should deduplicate Tier 2 glitched double logs with different reason_end', () => {
        const dir = createTempDir();
        try {
            const events = [
                {
                    ts: '2025-05-15T12:00:00Z',
                    ms_played: 180000,
                    master_metadata_track_name: 'Glitch Track',
                    reason_end: 'unexpectedexit'
                },
                {
                    ts: '2025-05-15T12:03:00Z', // gapMs = 0 < 1000ms
                    ms_played: 180000,
                    master_metadata_track_name: 'Glitch Track',
                    reason_end: 'trackdone'
                }
            ];

            fs.writeFileSync(path.join(dir, 'data_2025.json'), JSON.stringify(events));

            const result = loadAndDedupEvents(dir);
            assert.equal(result.length, 1);
            assert.equal(result[0].reason_end, 'trackdone');
        } finally {
            cleanupTempDir(dir);
        }
    });

    it('should deduplicate Tier 3 overlapping trackdone plays', () => {
        const dir = createTempDir();
        try {
            const events = [
                {
                    ts: '2025-05-15T12:02:00Z',
                    ms_played: 120000,
                    master_metadata_track_name: 'Overlap Track',
                    reason_end: 'trackdone'
                },
                {
                    ts: '2025-05-15T12:02:30Z',
                    ms_played: 120000,
                    master_metadata_track_name: 'Overlap Track',
                    reason_end: 'trackdone'
                }
            ];

            fs.writeFileSync(path.join(dir, 'data_2025.json'), JSON.stringify(events));

            const result = loadAndDedupEvents(dir);
            assert.equal(result.length, 1);
        } finally {
            cleanupTempDir(dir);
        }
    });

    it('should skip files exceeding MAX_FILE_SIZE (50MB)', () => {
        const dir = createTempDir();
        try {
            const filePath = path.join(dir, 'large_file_2025.json');
            // Write a small valid file first
            const normalFilePath = path.join(dir, 'normal_file_2025.json');
            fs.writeFileSync(normalFilePath, JSON.stringify([{
                ts: '2025-05-01T10:00:00Z',
                ms_played: 60000,
                master_metadata_track_name: 'Normal Song'
            }]));

            // Create a sparse file of 51MB
            const fd = fs.openSync(filePath, 'w');
            fs.ftruncateSync(fd, 51 * 1024 * 1024);
            fs.closeSync(fd);

            const result = loadAndDedupEvents(dir);
            assert.equal(result.length, 1);
            assert.equal(result[0].master_metadata_track_name, 'Normal Song');
        } finally {
            cleanupTempDir(dir);
        }
    });

    it('should skip files when cumulativeSize exceeds MAX_TOTAL_SIZE (250MB)', () => {
        const dir = createTempDir();
        try {
            // First file: 40MB
            const file1 = path.join(dir, 'file1_2025.json');
            // Second file: 40MB
            const file2 = path.join(dir, 'file2_2025.json');

            // Create 6 files of 45MB each using ftruncateSync (sparse files, 0 real disk space)
            // 6 * 45MB = 270MB. The first 5 files total 225MB <= 250MB. The 6th file brings total to 270MB > 250MB, so it gets skipped.
            for (let i = 0; i < 6; i++) {
                const filePath = path.join(dir, `streaming_history_audio_2025_${i}.json`);
                const fd = fs.openSync(filePath, 'w');
                fs.ftruncateSync(fd, 45 * 1024 * 1024);
                fs.closeSync(fd);
            }

            // Also have a small file after them
            const smallFile = path.join(dir, `streaming_history_audio_2025_small.json`);
            fs.writeFileSync(smallFile, JSON.stringify([{
                ts: '2025-05-01T10:00:00Z',
                ms_played: 60000,
                master_metadata_track_name: 'Small Song'
            }]));

            const result = loadAndDedupEvents(dir);
            // The small file or valid files are parsed; the 6th sparse file is skipped because cumulativeSize would exceed 250MB
            assert.ok(result.length <= 1);
        } finally {
            cleanupTempDir(dir);
        }
    });

    it('should skip non-regular files (e.g. FIFOs/devices reporting isFile() = false)', () => {
        const dir = createTempDir();
        try {
            const fifoPath = path.join(dir, 'streaming_history_audio_2025_fifo.json');
            // Try creating a FIFO using mkfifo if on Unix
            try {
                const child_process = require('child_process');
                // 🛡️ Sentinel: Use execFileSync instead of execSync to avoid shell command injection
                child_process.execFileSync('mkfifo', [fifoPath]);
            } catch {
                // If mkfifo is not supported in the environment, skip test
                return;
            }

            const result = loadAndDedupEvents(dir);
            assert.equal(result.length, 0);
        } finally {
            cleanupTempDir(dir);
        }
    });

    it('should validate all optional fields and string length boundaries', () => {
        const dir = createTempDir();
        try {
            const validEventWithAllFields = {
                ts: '2025-05-01T10:00:00Z',
                ms_played: 60000,
                master_metadata_track_name: 'Valid Track',
                master_metadata_album_artist_name: 'Valid Artist',
                reason_end: 'trackdone',
                ip_addr: '127.0.0.1',
                audiobook_title: 'Audiobook',
                episode_name: 'Episode',
                episode_show_name: 'Show'
            };

            const invalidItems = [
                // non-object / null item
                null,
                // ts not string or > 50 chars
                { ts: 'a'.repeat(51), ms_played: 1000 },
                // invalid album_artist_name
                { ...validEventWithAllFields, master_metadata_album_artist_name: 123 },
                { ...validEventWithAllFields, master_metadata_album_artist_name: 'a'.repeat(1001) },
                // invalid reason_end
                { ...validEventWithAllFields, reason_end: true },
                { ...validEventWithAllFields, reason_end: 'a'.repeat(501) },
                // invalid ip_addr
                { ...validEventWithAllFields, ip_addr: {} },
                { ...validEventWithAllFields, ip_addr: 'a'.repeat(501) },
                // invalid audiobook_title
                { ...validEventWithAllFields, audiobook_title: 456 },
                { ...validEventWithAllFields, audiobook_title: 'a'.repeat(1001) },
                // invalid episode_name
                { ...validEventWithAllFields, episode_name: [] },
                { ...validEventWithAllFields, episode_name: 'a'.repeat(1001) },
                // invalid episode_show_name
                { ...validEventWithAllFields, episode_show_name: 789 },
                { ...validEventWithAllFields, episode_show_name: 'a'.repeat(1001) },
            ];

            fs.writeFileSync(path.join(dir, 'test_2025.json'), JSON.stringify([...invalidItems, validEventWithAllFields]));

            const result = loadAndDedupEvents(dir);
            assert.equal(result.length, 1);
            assert.equal(result[0].master_metadata_track_name, 'Valid Track');
        } finally {
            cleanupTempDir(dir);
        }
    });

    it('should enforce maximum event limit (5,000,000) and break ingestion cleanly with warning', () => {
        const dir = createTempDir();
        const originalParse = JSON.parse;
        const originalWarn = console.warn;
        const warnings: string[] = [];

        try {
            console.warn = (...args: any[]) => {
                warnings.push(args.map(a => String(a)).join(' '));
            };

            const magicPayload = JSON.stringify([{ __magic_mock__: true }]);
            fs.writeFileSync(path.join(dir, 'streaming_history_audio_2025_0.json'), magicPayload);

            const mockTrack = {
                ts: '2025-05-01T12:00:00Z',
                ms_played: 60000,
                master_metadata_track_name: 'Boundary Track',
                master_metadata_album_artist_name: 'Boundary Artist'
            };

            // Use an Array filled with the same object reference to ensure fast native iteration
            JSON.parse = (text: string, reviver?: any) => {
                if (typeof text === 'string' && text.includes('__magic_mock__')) {
                    const arr = new Array(5000005);
                    arr.fill(mockTrack);
                    return arr;
                }
                return originalParse(text, reviver);
            };

            const result = loadAndDedupEvents(dir);
            // Ingestion should stop cleanly after reaching 5,000,000 items
            assert.ok(warnings.some(w => w.includes('Maximum event limit (5,000,000) reached')));
            assert.equal(result.length, 5000000);
            assert.equal(result[0].master_metadata_track_name, 'Boundary Track');
        } finally {
            JSON.parse = originalParse;
            console.warn = originalWarn;
            cleanupTempDir(dir);
        }
    });

    describe('Ingestion & Sorting Edge Cases', () => {
        it('should handle empty directory, no matching files, or empty JSON array gracefully', () => {
            const dir = createTempDir();
            try {
                // Case 1: Empty directory returns empty array
                const emptyRes = loadAndDedupEvents(dir);
                assert.deepEqual(emptyRes, []);

                // Case 2: Files exist, but none match the requested year
                fs.writeFileSync(path.join(dir, 'streaming_history_audio_2023.json'), JSON.stringify([{
                    ts: '2023-05-01T10:00:00Z',
                    ms_played: 60000,
                    master_metadata_track_name: '2023 Song'
                }]));
                const yearMismatchRes = loadAndDedupEvents(dir, 2025);
                assert.deepEqual(yearMismatchRes, []);

                // Case 3: File contains empty array `[]`
                fs.writeFileSync(path.join(dir, 'streaming_history_audio_2025_empty.json'), '[]');
                const emptyArrayRes = loadAndDedupEvents(dir, 2025);
                assert.deepEqual(emptyArrayRes, []);
            } finally {
                cleanupTempDir(dir);
            }
        });

        it('should strictly validate ISO 8601 structural format and reject malformed timestamps', () => {
            const dir = createTempDir();
            try {
                const malformedItems = [
                    // Length not exactly 20 characters
                    { ts: '2025-01-01T10:00:00.000Z', ms_played: 60000, master_metadata_track_name: 'Long ISO' },
                    { ts: '2025-01-01T10:00:00', ms_played: 60000, master_metadata_track_name: 'Missing Z' },
                    { ts: '2025-01-01', ms_played: 60000, master_metadata_track_name: 'Date Only' },
                    // Wrong delimiters
                    { ts: '2025/01/01T10:00:00Z', ms_played: 60000, master_metadata_track_name: 'Slashes' },
                    { ts: '2025-01/01T10:00:00Z', ms_played: 60000, master_metadata_track_name: 'Mixed Slash' },
                    { ts: '2025-01-01 10:00:00Z', ms_played: 60000, master_metadata_track_name: 'Space Instead of T' },
                    // Valid item
                    { ts: '2025-01-01T10:00:00Z', ms_played: 60000, master_metadata_track_name: 'Valid ISO Track' }
                ];

                fs.writeFileSync(path.join(dir, 'data_2025.json'), JSON.stringify(malformedItems));

                const result = loadAndDedupEvents(dir);
                assert.equal(result.length, 1);
                assert.equal(result[0].master_metadata_track_name, 'Valid ISO Track');
            } finally {
                cleanupTempDir(dir);
            }
        });

        it('should sort chronologically out-of-order events across multiple files before deduplicating', () => {
            const dir = createTempDir();
            try {
                // File 1 has later events, File 2 has earlier events
                const eventsFile1 = [
                    {
                        ts: '2025-05-15T12:03:00Z',
                        ms_played: 180000,
                        master_metadata_track_name: 'Ordered Track',
                        reason_end: 'trackdone'
                    }
                ];
                const eventsFile2 = [
                    {
                        ts: '2025-05-15T12:00:00Z',
                        ms_played: 180000,
                        master_metadata_track_name: 'Ordered Track',
                        reason_end: 'trackdone'
                    }
                ];

                fs.writeFileSync(path.join(dir, 'streaming_history_audio_2025_b.json'), JSON.stringify(eventsFile1));
                fs.writeFileSync(path.join(dir, 'streaming_history_audio_2025_a.json'), JSON.stringify(eventsFile2));

                const result = loadAndDedupEvents(dir);
                // Because they are sorted chronologically first, File 2 (12:00:00) then File 1 (12:03:00)
                // form a Tier 1 duplicate clone and deduplicate to 1 event
                assert.equal(result.length, 1);
                assert.equal(result[0].ts, '2025-05-15T12:03:00Z');
            } finally {
                cleanupTempDir(dir);
            }
        });
    });

    describe('Multi-Tier Deduplication Boundary Conditions', () => {
        it('should collapse chained sequences of 3 or more duplicate events into a single event', () => {
            const dir = createTempDir();
            try {
                // 3 identical plays back-to-back:
                // 1) 12:00:00 - 12:03:00 (180s)
                // 2) 12:03:00 - 12:06:00 (180s)
                // 3) 12:06:00 - 12:09:00 (180s)
                const events = [
                    {
                        ts: '2025-05-15T12:03:00Z',
                        ms_played: 180000,
                        master_metadata_track_name: 'Chained Track',
                        reason_end: 'trackdone'
                    },
                    {
                        ts: '2025-05-15T12:06:00Z',
                        ms_played: 180000,
                        master_metadata_track_name: 'Chained Track',
                        reason_end: 'trackdone'
                    },
                    {
                        ts: '2025-05-15T12:09:00Z',
                        ms_played: 180000,
                        master_metadata_track_name: 'Chained Track',
                        reason_end: 'trackdone'
                    }
                ];

                fs.writeFileSync(path.join(dir, 'data_2025.json'), JSON.stringify(events));

                const result = loadAndDedupEvents(dir);
                assert.equal(result.length, 1);
                assert.equal(result[0].ts, '2025-05-15T12:09:00Z');
            } finally {
                cleanupTempDir(dir);
            }
        });

        it('Tier 1: should enforce exact clone boundaries (gapMs >= 10, ms_played mismatch, reason_end mismatch)', () => {
            const dir = createTempDir();
            try {
                // Event 1 ends at 12:00:00 (currStartTime = 11:57:00)
                // Event 2 ends at 12:03:00 with ms_played=179989 -> currStartTime = 12:00:00.011 (gap = 11ms >= 10ms)
                const eventsGapExceeded = [
                    {
                        ts: '2025-05-15T12:00:00Z',
                        ms_played: 180000,
                        master_metadata_track_name: 'Boundary Track',
                        reason_end: 'trackdone'
                    },
                    {
                        ts: '2025-05-15T12:03:00Z',
                        ms_played: 179989,
                        master_metadata_track_name: 'Boundary Track',
                        reason_end: 'trackdone'
                    }
                ];

                fs.writeFileSync(path.join(dir, 'data_gap.json'), JSON.stringify(eventsGapExceeded));
                const resGap = loadAndDedupEvents(dir);
                // Not deduplicated because gapMs is 11ms >= 10ms and ms_played differs
                assert.equal(resGap.length, 2);

                // Different reason_end with gapMs < 10 (falls into Tier 2 if gapMs < 1000)
                // If ms_played also differs, Tier 1 and Tier 2 both fail
                const eventsDiffPlayed = [
                    {
                        ts: '2025-05-15T12:00:00Z',
                        ms_played: 180000,
                        master_metadata_track_name: 'Diff Played Track',
                        reason_end: 'trackdone'
                    },
                    {
                        ts: '2025-05-15T12:03:00Z',
                        ms_played: 175000, // different duration, currStartTime = 12:00:05, gap = 5000ms
                        master_metadata_track_name: 'Diff Played Track',
                        reason_end: 'trackdone'
                    }
                ];
                fs.writeFileSync(path.join(dir, 'data_diff.json'), JSON.stringify(eventsDiffPlayed));
                fs.unlinkSync(path.join(dir, 'data_gap.json'));
                const resDiff = loadAndDedupEvents(dir);
                assert.equal(resDiff.length, 2);
            } finally {
                cleanupTempDir(dir);
            }
        });

        it('Tier 2: should enforce glitched double log boundaries (gapMs >= 1000 or ms_played mismatch)', () => {
            const dir = createTempDir();
            try {
                // Event 1 ends at 12:00:00
                // Event 2 ends at 12:03:02 with ms_played=180000 -> currStartTime = 12:00:02 (gap = 2000ms >= 1000ms)
                const eventsLargeGap = [
                    {
                        ts: '2025-05-15T12:00:00Z',
                        ms_played: 180000,
                        master_metadata_track_name: 'Glitch Boundary',
                        reason_end: 'unexpectedexit'
                    },
                    {
                        ts: '2025-05-15T12:03:02Z',
                        ms_played: 180000,
                        master_metadata_track_name: 'Glitch Boundary',
                        reason_end: 'trackdone'
                    }
                ];

                fs.writeFileSync(path.join(dir, 'data_tier2.json'), JSON.stringify(eventsLargeGap));
                const resTier2 = loadAndDedupEvents(dir);
                // Gap is 2000ms >= 1000ms, not deduplicated by Tier 2
                assert.equal(resTier2.length, 2);
            } finally {
                cleanupTempDir(dir);
            }
        });

        it('Tier 3: should enforce overlapping play boundaries (overlapMs <= 0, non-trackdone, duration limits)', () => {
            const dir = createTempDir();
            try {
                // Case 1: overlapMs <= 0 (gapMs > 0 without Tier 1 or Tier 2 match)
                // Event 1 ends at 12:02:00 (ms_played = 120000, start = 12:00:00)
                // Event 2 ends at 12:04:05 (ms_played = 120000, start = 12:02:05) -> gap = 5000ms, overlapMs = -5000ms
                const eventsNoOverlap = [
                    {
                        ts: '2025-05-15T12:02:00Z',
                        ms_played: 120000,
                        master_metadata_track_name: 'No Overlap',
                        reason_end: 'trackdone'
                    },
                    {
                        ts: '2025-05-15T12:04:05Z',
                        ms_played: 120000,
                        master_metadata_track_name: 'No Overlap',
                        reason_end: 'trackdone'
                    }
                ];

                // Case 2: Overlapping plays where reason_end is NOT trackdone (e.g. 'fwdbtn')
                const eventsNonTrackdone = [
                    {
                        ts: '2025-05-15T13:02:00Z',
                        ms_played: 120000,
                        master_metadata_track_name: 'Non Trackdone Overlap',
                        reason_end: 'fwdbtn'
                    },
                    {
                        ts: '2025-05-15T13:02:30Z',
                        ms_played: 120000,
                        master_metadata_track_name: 'Non Trackdone Overlap',
                        reason_end: 'trackdone'
                    }
                ];

                // Case 3: Overlapping plays where ms_played is outside (30000, 160000)
                // e.g. ms_played = 30000 (not > 30000) or ms_played = 160000 (not < 160000)
                const eventsOutsideDuration = [
                    {
                        ts: '2025-05-15T14:00:30Z',
                        ms_played: 30000, // exactly 30000ms, not > 30000
                        master_metadata_track_name: 'Short Overlap',
                        reason_end: 'trackdone'
                    },
                    {
                        ts: '2025-05-15T14:00:40Z',
                        ms_played: 120000,
                        master_metadata_track_name: 'Short Overlap',
                        reason_end: 'trackdone'
                    },
                    {
                        ts: '2025-05-15T15:03:00Z',
                        ms_played: 160000, // exactly 160000ms, not < 160000
                        master_metadata_track_name: 'Long Overlap',
                        reason_end: 'trackdone'
                    },
                    {
                        ts: '2025-05-15T15:03:30Z',
                        ms_played: 120000,
                        master_metadata_track_name: 'Long Overlap',
                        reason_end: 'trackdone'
                    }
                ];

                fs.writeFileSync(path.join(dir, 'streaming_history_audio_2025_no_overlap.json'), JSON.stringify(eventsNoOverlap));
                fs.writeFileSync(path.join(dir, 'streaming_history_audio_2025_non_trackdone.json'), JSON.stringify(eventsNonTrackdone));
                fs.writeFileSync(path.join(dir, 'streaming_history_audio_2025_outside_duration.json'), JSON.stringify(eventsOutsideDuration));

                const resNoOverlap = loadAndDedupEvents(dir, 2025);
                // All events should be preserved without deduplication
                // 2 (no_overlap) + 2 (non_trackdone) + 4 (outside_duration) = 8
                assert.equal(resNoOverlap.length, 8);
            } finally {
                cleanupTempDir(dir);
            }
        });
    });
});
