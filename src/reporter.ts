
export interface TrackStats {
    count: number;
    time: number;
}

export interface ReporterConfig {
    TOP_N: number;
    TOP_ARTISTS_N: number;
    TITLE: string;
}

export const generateReport = (trackStats: Record<string, TrackStats>, artistStats: Record<string, TrackStats>, config: ReporterConfig) => {
    console.log(`\n === ${config.TITLE} === `);

    const sortedSongs = Object.entries(trackStats)
        .sort((a, b) => b[1].count - a[1].count || b[1].time - a[1].time)
        .slice(0, config.TOP_N);

    sortedSongs.forEach((s, i) => {
        console.log(`#${i + 1} ${s[0]}: ${s[1].count} plays (${Math.floor(s[1].time / 60000)}m)`);
    });

    console.log(`\n === TOP ${config.TOP_ARTISTS_N} ARTISTS (By Time) === `);
    const sortedArtistsByTime = Object.entries(artistStats)
        .sort((a, b) => b[1].time - a[1].time)
        .slice(0, config.TOP_ARTISTS_N);

    sortedArtistsByTime.forEach((a, i) => {
        const minutes = Math.floor(a[1].time / 60000);
        const hours = (a[1].time / 3600000).toFixed(1);
        console.log(`#${i + 1} ${a[0]}: ${minutes}m (${hours}h)`);
    });

    console.log(`\n === TOP ${config.TOP_ARTISTS_N} ARTISTS (By Play Count) === `);
    const sortedArtistsByCount = Object.entries(artistStats)
        .sort((a, b) => b[1].count - a[1].count || b[1].time - a[1].time)
        .slice(0, config.TOP_ARTISTS_N);

    sortedArtistsByCount.forEach((a, i) => {
        console.log(`#${i + 1} ${a[0]}: ${a[1].count} plays`);
    });
};
