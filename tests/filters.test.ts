import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { applyStandardFilters, applyWrappedFilters, AuditConfig } from '../src/filters.js';
import { SpotifyAudioEvent } from '../interface/SpotifyAudioEvent.js';

describe('filters module', () => {
    const defaultConfig: AuditConfig = {
        START_DATE: new Date('2025-01-01T00:00:00Z'),
        END_DATE: new Date('2025-11-30T23:59:59Z'),
        MIN_MS_PLAYED: 30000,
    };

    const createEvent = (overrides: Partial<SpotifyAudioEvent> = {}): SpotifyAudioEvent => ({
        ts: '2025-05-15T12:00:00Z',
        platform: 'iOS',
        ms_played: 180000,
        conn_country: 'US',
        ip_addr: '192.168.1.1',
        master_metadata_track_name: 'Test Song',
        master_metadata_album_artist_name: 'Test Artist',
        master_metadata_album_album_name: 'Test Album',
        spotify_track_uri: 'spotify:track:123',
        episode_name: null,
        episode_show_name: null,
        spotify_episode_uri: null,
        audiobook_title: null,
        audiobook_uri: null,
        audiobook_chapter_uri: null,
        audiobook_chapter_title: null,
        reason_start: 'trackdone',
        reason_end: 'trackdone',
        shuffle: false,
        skipped: false,
        offline: false,
        offline_timestamp: null,
        incognito_mode: false,
        ...overrides,
    });

    describe('applyStandardFilters', () => {
        it('should return an empty array when input is empty', () => {
            const result = applyStandardFilters([], defaultConfig);
            assert.deepEqual(result, []);
        });

        it('should filter out events before START_DATE or after END_DATE', () => {
            const events = [
                createEvent({ ts: '2024-12-31T23:59:59Z', master_metadata_track_name: 'Too Early' }),
                createEvent({ ts: '2025-06-01T10:00:00Z', master_metadata_track_name: 'In Range' }),
                createEvent({ ts: '2025-12-01T00:00:01Z', master_metadata_track_name: 'Too Late' }),
            ];
            const result = applyStandardFilters(events, defaultConfig);
            assert.equal(result.length, 1);
            assert.equal(result[0].master_metadata_track_name, 'In Range');
        });

        it('should filter out events with ms_played less than MIN_MS_PLAYED', () => {
            const events = [
                createEvent({ ms_played: 29999, master_metadata_track_name: 'Short' }),
                createEvent({ ms_played: 30000, master_metadata_track_name: 'Exact Min' }),
                createEvent({ ms_played: 45000, master_metadata_track_name: 'Normal' }),
            ];
            const result = applyStandardFilters(events, defaultConfig);
            assert.equal(result.length, 2);
            assert.equal(result[0].master_metadata_track_name, 'Exact Min');
            assert.equal(result[1].master_metadata_track_name, 'Normal');
        });

        it('should filter out audiobooks', () => {
            const events = [
                createEvent({ audiobook_title: 'An Audiobook', master_metadata_track_name: 'Book Chapter' }),
                createEvent({ master_metadata_track_name: 'Music Song' }),
            ];
            const result = applyStandardFilters(events, defaultConfig);
            assert.equal(result.length, 1);
            assert.equal(result[0].master_metadata_track_name, 'Music Song');
        });
    });

    describe('applyWrappedFilters', () => {
        const originalEnv = process.env.HOME_IP;

        afterEach(() => {
            if (originalEnv !== undefined) {
                process.env.HOME_IP = originalEnv;
            } else {
                delete process.env.HOME_IP;
            }
        });

        it('should return empty array for empty input', () => {
            const result = applyWrappedFilters([], defaultConfig);
            assert.deepEqual(result, []);
        });

        it('should filter by start/end dates and MIN_MS_PLAYED', () => {
            const events = [
                createEvent({ ts: '2024-12-31T23:59:59Z', master_metadata_track_name: 'Early' }),
                createEvent({ ts: '2025-05-01T12:00:00Z', ms_played: 20000, master_metadata_track_name: 'Too Short' }),
                createEvent({ ts: '2025-05-01T12:05:00Z', ms_played: 30000, master_metadata_track_name: 'Valid' }),
                createEvent({ ts: '2025-12-01T00:00:00Z', master_metadata_track_name: 'Late' }),
            ];
            const result = applyWrappedFilters(events, defaultConfig);
            assert.equal(result.length, 1);
            assert.equal(result[0].master_metadata_track_name, 'Valid');
        });

        it('should skip unknown reason short plays (ms_played < 32000)', () => {
            const events = [
                createEvent({ reason_end: 'unknown', ms_played: 31000, master_metadata_track_name: 'Unknown Short' }),
                createEvent({ reason_end: 'unknown', ms_played: 33000, master_metadata_track_name: 'Unknown Long' }),
            ];
            const result = applyWrappedFilters(events, defaultConfig);
            assert.equal(result.length, 1);
            assert.equal(result[0].master_metadata_track_name, 'Unknown Long');
        });

        it('Rule 1: should handle universal glitch/split play lookahead filter', () => {
            const events = [
                createEvent({
                    ts: '2025-05-15T12:00:00Z',
                    ms_played: 50000,
                    reason_end: 'unexpectedexit',
                    master_metadata_track_name: 'Glitch Song',
                    master_metadata_album_artist_name: 'Glitch Artist',
                }),
                createEvent({
                    ts: '2025-05-15T12:01:00Z',
                    ms_played: 180000,
                    reason_end: 'trackdone',
                    master_metadata_track_name: 'Glitch Song',
                    master_metadata_album_artist_name: 'Glitch Artist',
                }),
            ];

            const result = applyWrappedFilters(events, defaultConfig);
            assert.equal(result.length, 1);
            assert.equal(result[0].ms_played, 180000);
        });

        it('Rule 2: should filter boundary logout on IPv4 final day', () => {
            process.env.HOME_IP = '192.168.1.1';
            const events = [
                createEvent({
                    ts: '2025-11-30T22:00:00Z',
                    reason_end: 'logout',
                    ip_addr: '192.168.1.1',
                    master_metadata_track_name: 'Logout Song',
                }),
            ];
            const result = applyWrappedFilters(events, defaultConfig);
            assert.equal(result.length, 0);
        });

        it('Rule 3.1: should filter consecutive redundant short play on IPv4 home IP', () => {
            process.env.HOME_IP = '192.168.1.1';
            const events = [
                createEvent({
                    ts: '2025-05-15T12:00:00Z',
                    ms_played: 180000,
                    reason_end: 'trackdone',
                    master_metadata_track_name: 'Track A',
                    master_metadata_album_artist_name: 'Artist A',
                    ip_addr: '192.168.1.1',
                }),
                createEvent({
                    ts: '2025-05-15T12:03:00Z',
                    ms_played: 45000,
                    reason_end: 'fwdbtn',
                    master_metadata_track_name: 'Track A',
                    master_metadata_album_artist_name: 'Artist A',
                    ip_addr: '192.168.1.1',
                }),
            ];
            const result = applyWrappedFilters(events, defaultConfig);
            assert.equal(result.length, 1);
            assert.equal(result[0].ms_played, 180000);
        });

        it('Rule 3: exception for artist "311"', () => {
            process.env.HOME_IP = '192.168.1.1';
            const events = [
                createEvent({
                    ts: '2025-05-15T12:00:00Z',
                    ms_played: 180000,
                    reason_end: 'trackdone',
                    master_metadata_track_name: 'Amber',
                    master_metadata_album_artist_name: '311',
                    ip_addr: '192.168.1.1',
                }),
                createEvent({
                    ts: '2025-05-15T12:03:00Z',
                    ms_played: 45000,
                    reason_end: 'fwdbtn',
                    master_metadata_track_name: 'Amber',
                    master_metadata_album_artist_name: '311',
                    ip_addr: '192.168.1.1',
                }),
            ];
            const result = applyWrappedFilters(events, defaultConfig);
            assert.equal(result.length, 2);
        });

        it('Rule 3.3: should filter late-year logout/skipped short plays on IPv4', () => {
            process.env.HOME_IP = '192.168.1.1';
            const events = [
                createEvent({
                    ts: '2025-08-15T12:00:00Z',
                    ms_played: 40000,
                    reason_end: 'logout',
                    ip_addr: '192.168.1.1',
                }),
                createEvent({
                    ts: '2025-09-15T12:00:00Z',
                    ms_played: 40000,
                    reason_end: 'endplay',
                    skipped: true,
                    ip_addr: '192.168.1.1',
                }),
            ];
            const result = applyWrappedFilters(events, defaultConfig);
            assert.equal(result.length, 0);
        });

        it('should filter audiobooks in wrapped filters', () => {
            const events = [
                createEvent({ audiobook_title: 'Test Audiobook' }),
            ];
            const result = applyWrappedFilters(events, defaultConfig);
            assert.equal(result.length, 0);
        });
    });
});
