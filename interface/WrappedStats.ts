export interface WrappedStats {
    totalMsPlayed: number;
    artistPlayTime: Record<string, number>; // Artist -> ms played
    trackPlayCounts: Record<string, number>; // Track -> stream count
}
