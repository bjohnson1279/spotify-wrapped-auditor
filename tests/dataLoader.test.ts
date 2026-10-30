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
});
