export interface SpotifyStreamEvent {
    ts: string;                            // ISO 8601 Timestamp (UTC)
    username: string;
    platform: string;
    ms_played: number;                     // Milliseconds played
    conn_country: string;
    ip_addr_dec: string;
    user_agent_dec: string;
    master_metadata_track_name: string | null;
    master_metadata_album_artist_name: string | null;
    master_metadata_album_album_name: string | null;
    spotify_track_uri: string | null;
    episode_name: string | null;           // If populated, it's likely a podcast
    episode_show_name: string | null;
    spotify_episode_uri: string | null;
    reason_start: string;
    reason_end: string;
    shuffle: boolean;
    skipped: boolean | null;
    offline: boolean;
    offline_timestamp: number;
    incognito_mode: boolean;
}
