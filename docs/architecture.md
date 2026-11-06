# Spotify Wrapped Auditor - Architecture & Module Reference

This document provides a comprehensive technical overview of the architecture, data processing pipeline, module interfaces, and algorithmic filtering models used within the Spotify Wrapped Auditor.

## Architectural Overview

Spotify Wrapped Auditor processes raw JSON streaming history files exported from Spotify's privacy dashboard to replicate official Spotify Wrapped play counts and listening metrics.

The processing lifecycle consists of four distinct sequential stages:

```
[Raw JSON Files in /data]
          │
          ▼
┌────────────────────────┐
│ 1. Ingestion & Guards   │ (src/dataLoader.ts: loadAndDedupEvents)
│    - Atomic O_NONBLOCK │
│    - Byte & Item Limits│
│    - Prototype Defense │
└─────────┬──────────────┘
          ▼
┌────────────────────────┐
│ 2. Deduplication       │ (src/dataLoader.ts: loadAndDedupEvents)
│    - Tier 1: Clones    │
│    - Tier 2: Glitches  │
│    - Tier 3: Overlaps  │
└─────────┬──────────────┘
          ▼
┌────────────────────────┐
│ 3. Playback Filtering  │ (src/filters.ts: applyWrappedFilters / applyStandardFilters)
│    - 30s Threshold     │
│    - Glitch Lookahead  │
│    - Final Day Logout  │
│    - Redundancy Logic  │
└─────────┬──────────────┘
          ▼
┌────────────────────────┐
│ 4. Aggregation & Report│ (index.ts & src/reporter.ts: generateReport)
│    - Null-prototype map│
│    - Ranked Track Stats│
│    - Top Artists (Time)│
│    - Top Artists (Play)│
└────────────────────────┘
```

---

## Module Interfaces & API Reference

### 1. Data Loader (`src/dataLoader.ts`)

Responsible for secure file I/O, strict validation of JSON payloads, chronological ordering, and global stream deduplication across export files.

#### `loadAndDedupEvents(dataDir: string, year?: number): SpotifyAudioEvent[]`
- **Parameters**:
  - `dataDir` (`string`, required): Absolute or relative filesystem directory path where Spotify export JSON files reside.
  - `year` (`number`, optional): If specified, restricts ingestion to `.json` files containing the target year in their filename. If omitted, ingests all `.json` files.
- **Returns**: `SpotifyAudioEvent[]` - Chronologically sorted and deduplicated audio streaming events.
- **Security & Safety Invariants**:
  - Uses `fs.openSync` with `O_RDONLY | O_NONBLOCK` followed by `fs.fstatSync` to eliminate Time-Of-Check to Time-Of-Use (TOCTOU) race conditions and prevent FIFO hangs.
  - Enforces a 50MB single-file limit and a 250MB cumulative processing limit to prevent memory exhaustion (DoS).
  - Bounds total ingestion to a maximum of 5,000,000 events.
  - Rejects prototype pollution keys (`__proto__`, `constructor`, `prototype`) and rejects nested non-primitive objects.

---

### 2. Playback Filters (`src/filters.ts`)

Implements both Wrapped-specific heuristics and standard playback filtering rules.

#### `AuditConfig` Interface
- `START_DATE` (`Date`): Lower boundary timestamp for playback qualification.
- `END_DATE` (`Date`): Upper boundary timestamp for playback qualification.
- `MIN_MS_PLAYED` (`number`): Minimum threshold in milliseconds (typically 30,000 ms).

#### `applyWrappedFilters(deduped: SpotifyAudioEvent[], config: AuditConfig): SpotifyAudioEvent[]`
- **Parameters**:
  - `deduped` (`SpotifyAudioEvent[]`): Deduplicated array of events sorted chronologically by timestamp.
  - `config` (`AuditConfig`): Configuration parameters defining date boundaries and threshold requirements.
- **Returns**: `SpotifyAudioEvent[]` - Events that satisfy Spotify Wrapped 2025 play-counting criteria.
- **Heuristics Evaluated**:
  1. **Binary Search Skip**: Uses $O(\log N)$ binary search to immediately locate the first record $\ge$ `START_DATE`.
  2. **Short Play Elimination**: Eliminates plays below 30,000 ms and unknown-reason plays under 32,000 ms.
  3. **Universal Glitch / Split Play (Rule 1)**: Evaluates up to 5 subsequent items if playback did not end normally (`reason_end !== 'trackdone'`). Reconciles split events within a network-dependent window (150s for IPv4, 120s for IPv6).
  4. **Boundary Logout (Rule 2)**: Rejects cutoff logouts logged on the final day of the audit period on home IPv4 networks.
  5. **Redundant Consecutive Plays (Rule 3)**: Filters sub-60s short plays flanked by identical tracks or occurring consecutively within 30 minutes, with exceptions for specific artists (e.g., '311').

#### `applyStandardFilters(deduped: SpotifyAudioEvent[], config: AuditConfig): SpotifyAudioEvent[]`
- **Parameters**:
  - `deduped` (`SpotifyAudioEvent[]`): Deduplicated array of events sorted chronologically.
  - `config` (`AuditConfig`): Configuration parameters defining date boundaries and threshold requirements.
- **Returns**: `SpotifyAudioEvent[]` - Filtered streams strictly enforcing the minimum play time threshold and audio content filtering.

---

### 3. Reporter (`src/reporter.ts`)

Formats aggregated stats into clean, terminal-safe output tables.

#### `TrackStats` Interface
- `count` (`number`): Total play count.
- `time` (`number`): Cumulative play duration in milliseconds.

#### `ReporterConfig` Interface
- `TOP_N` (`number`): Number of top tracks to display.
- `TOP_ARTISTS_N` (`number`): Number of top artists to display (default: 20).
- `TITLE` (`string`): Report header text.

#### `generateReport(trackStats: [string, TrackStats][], artistStats: [string, TrackStats][], config: ReporterConfig): void`
- **Parameters**:
  - `trackStats` (`[string, TrackStats][]`): Array of tuple entries representing track descriptions and stats.
  - `artistStats` (`[string, TrackStats][]`): Array of tuple entries representing artist names and stats.
  - `config` (`ReporterConfig`): Configuration controlling report bounds and title formatting.
- **Behavior**:
  - Strips ANSI escape codes and control characters from untrusted strings before logging to stdout to eliminate log/terminal injection vulnerabilities.
  - Displays top tracks ranked by play count and listening time.
  - Displays top artists ranked both by total listening time and by stream play count.

---

## Data Model & Schema Reference

### `SpotifyAudioEvent` (`interface/SpotifyAudioEvent.ts`)

The primary data model representing an individual streaming event ingested from Spotify Extended Streaming History export files (`streaming_history_audio_*.json`).

| Property | Type | Nullable | Description & Pipeline Usage |
| :--- | :--- | :--- | :--- |
| `ts` | `string` | No | UTC timestamp of stream completion formatted in ISO 8601 (`YYYY-MM-DDTHH:mm:ssZ`). Used for chronological ordering, date range boundaries, and fast integer timestamp comparisons via `parseISO()`. |
| `platform` | `string` | No | Operating system and client platform identifier (e.g., `iOS`, `Android`, `OS X`). |
| `ms_played` | `number` | No | Milliseconds the audio track or episode was actively played. Evaluated against minimum thresholds (e.g., 30,000 ms) and duration heuristics. |
| `conn_country` | `string` | No | Country code of playback connection (e.g., `US`). |
| `ip_addr` | `string` | No | Client IP address at playback time. Compared against `process.env.HOME_IP` to enable contextual home IPv4 network filtering heuristics. |
| `master_metadata_track_name` | `string` | Yes | Title of the music track. When null, track is treated as non-music or fallback (`Unknown Track`). |
| `master_metadata_album_artist_name` | `string` | Yes | Primary artist name of the track. Used for grouping stats, artist leaderboards, and artist-specific filter rules (e.g., `311`). |
| `master_metadata_album_album_name` | `string` | Yes | Album title containing the track. |
| `spotify_track_uri` | `string` | Yes | Spotify URI identifier for the track (e.g., `spotify:track:<id>`). |
| `episode_name` | `string` | Yes | Title of podcast episode. When present, playback time is categorized under podcast listening and excluded from music stats. |
| `episode_show_name` | `string` | Yes | Name of podcast show or podcast series. |
| `spotify_episode_uri` | `string` | Yes | Spotify URI identifier for the podcast episode. |
| `audiobook_title` | `string` | Yes | Title of audiobook. Non-null values indicate audiobook content and are filtered out of Wrapped music stats. |
| `audiobook_uri` | `string` | Yes | Spotify URI identifier for the audiobook. |
| `audiobook_chapter_uri` | `string` | Yes | Spotify URI identifier for the audiobook chapter. |
| `audiobook_chapter_title` | `string` | Yes | Title of the audiobook chapter. |
| `reason_start` | `string` | No | Trigger for playback start (e.g., `clickrow`, `trackdone`, `playbtn`). |
| `reason_end` | `string` | No | Trigger for playback termination (e.g., `trackdone`, `fwdbtn`, `logout`, `endplay`, `unknown`). Core input for glitch, boundary, and redundancy filters. |
| `shuffle` | `boolean` | No | Indicates whether shuffle mode was active during playback. |
| `skipped` | `boolean` | Yes | Indicates whether playback was explicitly skipped by user before track completion. |
| `offline` | `boolean` | No | Indicates whether playback occurred in offline mode. |
| `offline_timestamp` | `number` | Yes | Unix epoch timestamp recorded when playback started while offline. |
| `incognito_mode` | `boolean` | No | Indicates whether the playback occurred within a private / incognito listening session. |

### Supporting Interfaces (`interface/`)

- **`BaseStreamEvent` (`interface/BaseStreamEvent.ts`)**: Minimal common base interface defining core playback properties (`ts`, `ms_played`, `reason_end`).
- **`MusicEvent` (`interface/MusicEvent.ts`)**: Discriminated music event schema requiring non-null track and artist names with null `episode_name`.
- **`PodcastEvent` (`interface/PodcastEvent.ts`)**: Placeholder interface reserved for future podcast-specific streaming schema definitions.
- **`SpotifyStreamEvent` (`interface/SpotifyStreamEvent.ts`)**: Alternative/extended schema representation featuring raw IP and user agent decoders (`ip_addr_dec`, `user_agent_dec`).
- **`StatsBucket` (`interface/StatsBucket.ts`)**: Generic numerical aggregation container storing cumulative `totalMs` and `playCount`.
- **`WrappedStats` (`interface/WrappedStats.ts`)**: Higher-level structure modeling overall listening statistics (`totalMsPlayed`, `artistPlayTime`, `trackPlayCounts`).
