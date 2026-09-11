const { execSync } = require('child_process');

// create fake data with 1 million records
const fs = require('fs');

if (!fs.existsSync('data')) {
    fs.mkdirSync('data');
}

const numEvents = 500000;
const events = [];
for(let i=0; i<numEvents; i++) {
    events.push({
        ts: '2025-06-01T12:00:00Z',
        ms_played: 40000 + i,
        master_metadata_track_name: 'Song ' + (i % 10),
        master_metadata_album_artist_name: 'Artist',
        reason_end: 'trackdone'
    });
}
fs.writeFileSync('data/streaming_history_audio_2025_0.json', JSON.stringify(events));

console.time('Execution');
execSync('node dist/index.js');
console.timeEnd('Execution');
