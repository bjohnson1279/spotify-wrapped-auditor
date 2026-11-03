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

        it('Rule 1: should filter long glitch play (>300000ms) with gap < 210000ms even if reason_end is remote', () => {
            const events = [
                createEvent({
                    ts: '2025-05-15T12:00:00Z',
                    ms_played: 350000,
                    reason_end: 'remote',
                    master_metadata_track_name: 'Long Track',
                    master_metadata_album_artist_name: 'Long Artist',
                }),
                createEvent({
                    ts: '2025-05-15T12:02:00Z', // gap = 120,000ms (< 210,000ms)
                    ms_played: 40000,
                    reason_end: 'trackdone',
                    master_metadata_track_name: 'Long Track',
                    master_metadata_album_artist_name: 'Long Artist',
                }),
            ];
            const result = applyWrappedFilters(events, defaultConfig);
            assert.equal(result.length, 1);
            assert.equal(result[0].ms_played, 40000);
        });

        it('Rule 1: should respect IPv6 glitch window (120000ms) vs IPv4 glitch window (150000ms)', () => {
            delete process.env.HOME_IP; // IPv6 / non-home mode
            const eventsIpv6 = [
                createEvent({
                    ts: '2025-05-15T12:00:00Z',
                    ms_played: 60000,
                    reason_end: 'fwdbtn',
                    master_metadata_track_name: 'Window Song',
                    master_metadata_album_artist_name: 'Window Artist',
                }),
                createEvent({
                    ts: '2025-05-15T12:02:10Z', // gap = 130,000ms (> 120,000ms IPv6 window)
                    ms_played: 60000,
                    reason_end: 'trackdone',
                    master_metadata_track_name: 'Window Song',
                    master_metadata_album_artist_name: 'Window Artist',
                }),
            ];
            const resultIpv6 = applyWrappedFilters(eventsIpv6, defaultConfig);
            // In IPv6, gap of 130s is outside 120s window, so first event is NOT filtered
            assert.equal(resultIpv6.length, 2);

            process.env.HOME_IP = '192.168.1.1'; // IPv4 home mode
            const eventsIpv4 = [
                createEvent({
                    ts: '2025-05-15T12:00:00Z',
                    ms_played: 60000,
                    reason_end: 'fwdbtn',
                    ip_addr: '192.168.1.1',
                    master_metadata_track_name: 'Window Song',
                    master_metadata_album_artist_name: 'Window Artist',
                }),
                createEvent({
                    ts: '2025-05-15T12:02:10Z', // gap = 130,000ms (< 150,000ms IPv4 window)
                    ms_played: 60000,
                    reason_end: 'trackdone',
                    ip_addr: '192.168.1.1',
                    master_metadata_track_name: 'Window Song',
                    master_metadata_album_artist_name: 'Window Artist',
                }),
            ];
            const resultIpv4 = applyWrappedFilters(eventsIpv4, defaultConfig);
            // In IPv4, gap of 130s is within 150s window, so first event IS filtered
            assert.equal(resultIpv4.length, 1);
            assert.equal(resultIpv4[0].ts, '2025-05-15T12:02:10Z');
        });

        it('Rule 3.2: should filter sandwich redundancy when track is flanked by same song within 10 minutes (600,000ms)', () => {
            process.env.HOME_IP = '192.168.1.1';
            const events = [
                createEvent({
                    ts: '2025-05-15T12:00:00Z',
                    ms_played: 180000,
                    reason_end: 'trackdone',
                    master_metadata_track_name: 'Sandwich Bread',
                    master_metadata_album_artist_name: 'Sandwich Artist',
                    ip_addr: '192.168.1.1',
                }),
                createEvent({
                    ts: '2025-05-15T12:05:00Z', // gap from prev = 300,000ms (< 600,000ms)
                    ms_played: 45000,
                    reason_end: 'fwdbtn',
                    master_metadata_track_name: 'Middle Filling',
                    master_metadata_album_artist_name: 'Middle Artist',
                    ip_addr: '192.168.1.1',
                }),
                createEvent({
                    ts: '2025-05-15T12:06:00Z',
                    ms_played: 180000,
                    reason_end: 'trackdone',
                    master_metadata_track_name: 'Sandwich Bread',
                    master_metadata_album_artist_name: 'Sandwich Artist',
                    ip_addr: '192.168.1.1',
                }),
            ];

            const result = applyWrappedFilters(events, defaultConfig);
            // Middle filling should be filtered out by sandwich redundancy
            assert.equal(result.length, 2);
            assert.equal(result[0].master_metadata_track_name, 'Sandwich Bread');
            assert.equal(result[1].master_metadata_track_name, 'Sandwich Bread');
        });

        it('Rule 3.2: should not filter sandwich when prevGap is >= 600000ms', () => {
            process.env.HOME_IP = '192.168.1.1';
            const events = [
                createEvent({
                    ts: '2025-05-15T12:00:00Z',
                    ms_played: 180000,
                    reason_end: 'trackdone',
                    master_metadata_track_name: 'Sandwich Bread',
                    master_metadata_album_artist_name: 'Sandwich Artist',
                    ip_addr: '192.168.1.1',
                }),
                createEvent({
                    ts: '2025-05-15T12:11:00Z', // gap from prev = 660,000ms (>= 600,000ms)
                    ms_played: 45000,
                    reason_end: 'fwdbtn',
                    master_metadata_track_name: 'Middle Filling',
                    master_metadata_album_artist_name: 'Middle Artist',
                    ip_addr: '192.168.1.1',
                }),
                createEvent({
                    ts: '2025-05-15T12:12:00Z',
                    ms_played: 180000,
                    reason_end: 'trackdone',
                    master_metadata_track_name: 'Sandwich Bread',
                    master_metadata_album_artist_name: 'Sandwich Artist',
                    ip_addr: '192.168.1.1',
                }),
            ];

            const result = applyWrappedFilters(events, defaultConfig);
            assert.equal(result.length, 3);
        });

        it('Rule 3.3: should not filter late-year plays before August (e.g. July) or if ms_played >= 50000', () => {
            process.env.HOME_IP = '192.168.1.1';
            const events = [
                // In July (month 07), logout short play should not be filtered
                createEvent({
                    ts: '2025-07-15T12:00:00Z',
                    ms_played: 40000,
                    reason_end: 'logout',
                    ip_addr: '192.168.1.1',
                    master_metadata_track_name: 'July Logout',
                }),
                // In September (month 09), play with ms_played >= 50000 should not be filtered
                createEvent({
                    ts: '2025-09-15T12:00:00Z',
                    ms_played: 52000,
                    reason_end: 'logout',
                    ip_addr: '192.168.1.1',
                    master_metadata_track_name: 'Sept Long Logout',
                }),
            ];

            const result = applyWrappedFilters(events, defaultConfig);
            assert.equal(result.length, 2);
        });

        it('should handle binary search edge cases when all events are before START_DATE or after END_DATE', () => {
            const beforeEvents = [
                createEvent({ ts: '2024-01-01T10:00:00Z' }),
                createEvent({ ts: '2024-06-01T10:00:00Z' }),
            ];
            assert.equal(applyWrappedFilters(beforeEvents, defaultConfig).length, 0);
            assert.equal(applyStandardFilters(beforeEvents, defaultConfig).length, 0);

            const afterEvents = [
                createEvent({ ts: '2025-12-05T10:00:00Z' }),
                createEvent({ ts: '2026-01-01T10:00:00Z' }),
            ];
            assert.equal(applyWrappedFilters(afterEvents, defaultConfig).length, 0);
            assert.equal(applyStandardFilters(afterEvents, defaultConfig).length, 0);
        });

        it('should handle exact timestamp boundaries at START_DATE and END_DATE', () => {
            const events = [
                createEvent({ ts: '2024-12-31T23:59:59.999Z', master_metadata_track_name: 'Before Boundary' }),
                createEvent({ ts: '2025-01-01T00:00:00.000Z', master_metadata_track_name: 'Exact Start' }),
                createEvent({ ts: '2025-11-30T23:59:59.000Z', master_metadata_track_name: 'Exact End' }),
                createEvent({ ts: '2025-11-30T23:59:59.001Z', master_metadata_track_name: 'After Boundary' }),
            ];
            const resultWrapped = applyWrappedFilters(events, defaultConfig);
            assert.equal(resultWrapped.length, 2);
            assert.equal(resultWrapped[0].master_metadata_track_name, 'Exact Start');
            assert.equal(resultWrapped[1].master_metadata_track_name, 'Exact End');

            const resultStandard = applyStandardFilters(events, defaultConfig);
            assert.equal(resultStandard.length, 2);
            assert.equal(resultStandard[0].master_metadata_track_name, 'Exact Start');
            assert.equal(resultStandard[1].master_metadata_track_name, 'Exact End');
        });

        it('should strictly enforce MIN_MS_PLAYED boundary (29999ms excluded, 30000ms included)', () => {
            const events = [
                createEvent({ ms_played: 29999, master_metadata_track_name: 'Below Threshold' }),
                createEvent({ ms_played: 30000, master_metadata_track_name: 'Exact Threshold' }),
            ];
            const result = applyWrappedFilters(events, defaultConfig);
            assert.equal(result.length, 1);
            assert.equal(result[0].master_metadata_track_name, 'Exact Threshold');
        });

        it('Rule 1: should check candidates up to index + 4 but not beyond index + 4 (loopMax boundary)', () => {
            // Event 0 is the glitch play; events 1..3 are different songs
            // If candidate is at index 4 (j = 4 < 5), it should trigger glitch filter
            const eventsWithinBoundary = [
                createEvent({ ts: '2025-05-15T12:00:00Z', ms_played: 50000, reason_end: 'unexpectedexit', master_metadata_track_name: 'Glitch Target', master_metadata_album_artist_name: 'Artist' }),
                createEvent({ ts: '2025-05-15T12:00:10Z', ms_played: 180000, master_metadata_track_name: 'Interlude 1', master_metadata_album_artist_name: 'Other' }),
                createEvent({ ts: '2025-05-15T12:00:20Z', ms_played: 180000, master_metadata_track_name: 'Interlude 2', master_metadata_album_artist_name: 'Other' }),
                createEvent({ ts: '2025-05-15T12:00:30Z', ms_played: 180000, master_metadata_track_name: 'Interlude 3', master_metadata_album_artist_name: 'Other' }),
                createEvent({ ts: '2025-05-15T12:00:40Z', ms_played: 180000, reason_end: 'trackdone', master_metadata_track_name: 'Glitch Target', master_metadata_album_artist_name: 'Artist' }),
            ];
            const resultWithin = applyWrappedFilters(eventsWithinBoundary, defaultConfig);
            // Glitch target at index 0 filtered out; 4 remaining
            assert.equal(resultWithin.length, 4);
            assert.ok(!resultWithin.some(e => e.master_metadata_track_name === 'Glitch Target' && e.ms_played === 50000));

            // If candidate is at index 5 (j = 5 not < 5), it is outside lookahead window so event 0 is NOT filtered
            const eventsBeyondBoundary = [
                createEvent({ ts: '2025-05-15T12:00:00Z', ms_played: 50000, reason_end: 'unexpectedexit', master_metadata_track_name: 'Glitch Target', master_metadata_album_artist_name: 'Artist' }),
                createEvent({ ts: '2025-05-15T12:00:10Z', ms_played: 180000, master_metadata_track_name: 'Interlude 1', master_metadata_album_artist_name: 'Other' }),
                createEvent({ ts: '2025-05-15T12:00:20Z', ms_played: 180000, master_metadata_track_name: 'Interlude 2', master_metadata_album_artist_name: 'Other' }),
                createEvent({ ts: '2025-05-15T12:00:30Z', ms_played: 180000, master_metadata_track_name: 'Interlude 3', master_metadata_album_artist_name: 'Other' }),
                createEvent({ ts: '2025-05-15T12:00:40Z', ms_played: 180000, master_metadata_track_name: 'Interlude 4', master_metadata_album_artist_name: 'Other' }),
                createEvent({ ts: '2025-05-15T12:00:50Z', ms_played: 180000, reason_end: 'trackdone', master_metadata_track_name: 'Glitch Target', master_metadata_album_artist_name: 'Artist' }),
            ];
            const resultBeyond = applyWrappedFilters(eventsBeyondBoundary, defaultConfig);
            // Event 0 is preserved because subsequent same track was outside 4-track lookahead window
            assert.equal(resultBeyond.length, 6);
            assert.ok(resultBeyond.some(e => e.master_metadata_track_name === 'Glitch Target' && e.ms_played === 50000));
        });

        it('Rule 1: should not filter glitch play if candidate has ms_played < 30000', () => {
            const events = [
                createEvent({ ts: '2025-05-15T12:00:00Z', ms_played: 50000, reason_end: 'unexpectedexit', master_metadata_track_name: 'Glitch Song', master_metadata_album_artist_name: 'Artist' }),
                createEvent({ ts: '2025-05-15T12:01:00Z', ms_played: 25000, reason_end: 'trackdone', master_metadata_track_name: 'Glitch Song', master_metadata_album_artist_name: 'Artist' }),
            ];
            const result = applyWrappedFilters(events, defaultConfig);
            // The candidate has ms_played < 30000, so Rule 1 does not filter event 0. Event 1 is filtered by MIN_MS_PLAYED.
            assert.equal(result.length, 1);
            assert.equal(result[0].ms_played, 50000);
        });

        it('Rule 1: should not filter remote playback when ms_played < 150000 and gap is within glitch window', () => {
            const events = [
                createEvent({ ts: '2025-05-15T12:00:00Z', ms_played: 80000, reason_end: 'remote', master_metadata_track_name: 'Remote Track', master_metadata_album_artist_name: 'Remote Artist' }),
                createEvent({ ts: '2025-05-15T12:01:00Z', ms_played: 180000, reason_end: 'trackdone', master_metadata_track_name: 'Remote Track', master_metadata_album_artist_name: 'Remote Artist' }),
            ];
            const result = applyWrappedFilters(events, defaultConfig);
            // reason_end === 'remote' is exempt from the ms_played < 150000 glitch filter
            assert.equal(result.length, 2);
        });

        it('Rule 1: should not filter plays with intermediate duration (between 150000ms and 300000ms)', () => {
            const events = [
                createEvent({ ts: '2025-05-15T12:00:00Z', ms_played: 200000, reason_end: 'fwdbtn', master_metadata_track_name: 'Intermediate Track', master_metadata_album_artist_name: 'Artist' }),
                createEvent({ ts: '2025-05-15T12:02:00Z', ms_played: 180000, reason_end: 'trackdone', master_metadata_track_name: 'Intermediate Track', master_metadata_album_artist_name: 'Artist' }),
            ];
            const result = applyWrappedFilters(events, defaultConfig);
            // 200,000ms is not < 150000 and not > 300000, so Rule 1 does not filter it
            assert.equal(result.length, 2);
        });

        it('Rule 2: should not filter IPv4 logout on non-final day or non-logout on final day', () => {
            process.env.HOME_IP = '192.168.1.1';
            const events = [
                // IPv4 logout on Nov 29 (day before final day Nov 30) -> should be kept
                createEvent({ ts: '2025-11-29T22:00:00Z', reason_end: 'logout', ip_addr: '192.168.1.1', master_metadata_track_name: 'Nov 29 Logout' }),
                // IPv4 trackdone on Nov 30 (final day) -> should be kept
                createEvent({ ts: '2025-11-30T22:00:00Z', reason_end: 'trackdone', ip_addr: '192.168.1.1', master_metadata_track_name: 'Nov 30 Trackdone' }),
            ];
            const result = applyWrappedFilters(events, defaultConfig);
            assert.equal(result.length, 2);
        });

        it('Rule 2: should not filter logout on final day if on IPv6 / non-home IP', () => {
            process.env.HOME_IP = '192.168.1.1';
            const events = [
                // Logout on final day, but different IP (e.g. mobile/IPv6)
                createEvent({ ts: '2025-11-30T22:00:00Z', reason_end: 'logout', ip_addr: '10.0.0.1', master_metadata_track_name: 'Mobile Logout' }),
            ];
            const result = applyWrappedFilters(events, defaultConfig);
            assert.equal(result.length, 1);
            assert.equal(result[0].master_metadata_track_name, 'Mobile Logout');
        });

        it('Rule 3.1: should filter short play when followed by same track (isNextSame lookahead redundancy)', () => {
            process.env.HOME_IP = '192.168.1.1';
            const events = [
                createEvent({ ts: '2025-05-15T12:00:00Z', ms_played: 45000, reason_end: 'fwdbtn', master_metadata_track_name: 'Next Target', master_metadata_album_artist_name: 'Target Artist', ip_addr: '192.168.1.1' }),
                createEvent({ ts: '2025-05-15T12:02:00Z', ms_played: 180000, reason_end: 'trackdone', master_metadata_track_name: 'Next Target', master_metadata_album_artist_name: 'Target Artist', ip_addr: '192.168.1.1' }),
            ];
            const result = applyWrappedFilters(events, defaultConfig);
            // The 45s play preceding the full play is filtered out via isNextSame
            assert.equal(result.length, 1);
            assert.equal(result[0].ms_played, 180000);
        });

        it('Rule 3.1: should not filter consecutive play when gap is >= 30 minutes (1800000ms)', () => {
            process.env.HOME_IP = '192.168.1.1';
            const events = [
                createEvent({ ts: '2025-05-15T12:00:00Z', ms_played: 180000, reason_end: 'trackdone', master_metadata_track_name: 'Spaced Track', master_metadata_album_artist_name: 'Artist', ip_addr: '192.168.1.1' }),
                createEvent({ ts: '2025-05-15T12:35:00Z', ms_played: 45000, reason_end: 'fwdbtn', master_metadata_track_name: 'Spaced Track', master_metadata_album_artist_name: 'Artist', ip_addr: '192.168.1.1' }),
            ];
            const result = applyWrappedFilters(events, defaultConfig);
            // Gap is 35 minutes (2100000ms >= 1800000ms), so not filtered
            assert.equal(result.length, 2);
        });

        it('Rule 3.1: should not filter consecutive short play if neighbor has ms_played < 30000', () => {
            process.env.HOME_IP = '192.168.1.1';
            const events = [
                createEvent({ ts: '2025-05-15T12:00:00Z', ms_played: 20000, reason_end: 'trackdone', master_metadata_track_name: 'Short Neighbor Track', master_metadata_album_artist_name: 'Artist', ip_addr: '192.168.1.1' }),
                createEvent({ ts: '2025-05-15T12:01:00Z', ms_played: 45000, reason_end: 'fwdbtn', master_metadata_track_name: 'Short Neighbor Track', master_metadata_album_artist_name: 'Artist', ip_addr: '192.168.1.1' }),
            ];
            const result = applyWrappedFilters(events, defaultConfig);
            // Neighbor has ms_played < 30000, so neighbor.ms_played >= 30000 condition fails
            // Event 0 filtered by MIN_MS_PLAYED, Event 1 retained
            assert.equal(result.length, 1);
            assert.equal(result[0].ms_played, 45000);
        });

        it('Rule 3.1: should not filter short play if reason_end is trackdone', () => {
            process.env.HOME_IP = '192.168.1.1';
            const events = [
                createEvent({ ts: '2025-05-15T12:00:00Z', ms_played: 180000, reason_end: 'trackdone', master_metadata_track_name: 'Short Song', master_metadata_album_artist_name: 'Artist', ip_addr: '192.168.1.1' }),
                // A short song (e.g. 40s punk/hardcore track) that played to completion (reason_end === 'trackdone')
                createEvent({ ts: '2025-05-15T12:03:00Z', ms_played: 40000, reason_end: 'trackdone', master_metadata_track_name: 'Short Song', master_metadata_album_artist_name: 'Artist', ip_addr: '192.168.1.1' }),
            ];
            const result = applyWrappedFilters(events, defaultConfig);
            // reason_end === 'trackdone' must not be filtered by consecutive redundancy
            assert.equal(result.length, 2);
        });

        it('Rule 3.2: should preserve legitimate trackdone play even when flanked in sandwich', () => {
            process.env.HOME_IP = '192.168.1.1';
            const events = [
                createEvent({ ts: '2025-05-15T12:00:00Z', ms_played: 180000, reason_end: 'trackdone', master_metadata_track_name: 'Sandwich Bread', master_metadata_album_artist_name: 'Artist', ip_addr: '192.168.1.1' }),
                createEvent({ ts: '2025-05-15T12:03:00Z', ms_played: 45000, reason_end: 'trackdone', master_metadata_track_name: 'Sandwich Meat', master_metadata_album_artist_name: 'Artist', ip_addr: '192.168.1.1' }),
                createEvent({ ts: '2025-05-15T12:04:00Z', ms_played: 180000, reason_end: 'trackdone', master_metadata_track_name: 'Sandwich Bread', master_metadata_album_artist_name: 'Artist', ip_addr: '192.168.1.1' }),
            ];
            const result = applyWrappedFilters(events, defaultConfig);
            // Sandwich redundancy requires reason_end !== 'trackdone'
            assert.equal(result.length, 3);
        });

        it('Rule 3.3: late-year exceptions: artist 311 and unskipped endplay', () => {
            process.env.HOME_IP = '192.168.1.1';
            const events = [
                // Artist 311 late-year logout short play -> preserved by exception
                createEvent({ ts: '2025-09-01T12:00:00Z', ms_played: 40000, reason_end: 'logout', master_metadata_album_artist_name: '311', ip_addr: '192.168.1.1' }),
                // Late-year endplay with skipped = false -> preserved
                createEvent({ ts: '2025-09-01T12:01:00Z', ms_played: 40000, reason_end: 'endplay', skipped: false, master_metadata_album_artist_name: 'Other', ip_addr: '192.168.1.1' }),
                // December month code (m1 = 1, m2 = 2) late-year logout -> filtered
                createEvent({ ts: '2025-12-01T12:00:00Z', ms_played: 40000, reason_end: 'logout', master_metadata_album_artist_name: 'Other', ip_addr: '192.168.1.1' }),
            ];
            const configWithDecember: AuditConfig = {
                START_DATE: new Date('2025-01-01T00:00:00Z'),
                END_DATE: new Date('2025-12-31T23:59:59Z'),
                MIN_MS_PLAYED: 30000,
            };
            const result = applyWrappedFilters(events, configWithDecember);
            assert.equal(result.length, 2);
            assert.equal(result[0].master_metadata_album_artist_name, '311');
            assert.equal(result[1].reason_end, 'endplay');
        });

        it('should handle null or undefined metadata fields gracefully without throwing', () => {
            const events = [
                createEvent({ master_metadata_track_name: null, master_metadata_album_artist_name: null }),
                createEvent({ master_metadata_track_name: undefined, master_metadata_album_artist_name: undefined }),
            ];
            assert.doesNotThrow(() => {
                const result = applyWrappedFilters(events, defaultConfig);
                assert.equal(result.length, 2);
            });
            assert.doesNotThrow(() => {
                const result = applyStandardFilters(events, defaultConfig);
                assert.equal(result.length, 2);
            });
        });
    });
});
