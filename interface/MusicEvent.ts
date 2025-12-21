import { BaseStreamEvent } from "./BaseStreamEvent.js";

interface MusicEvent extends BaseStreamEvent {
    master_metadata_track_name: string; // The discriminator (presence of value)
    master_metadata_album_artist_name: string;
    episode_name: null;
}