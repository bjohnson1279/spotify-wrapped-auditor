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
