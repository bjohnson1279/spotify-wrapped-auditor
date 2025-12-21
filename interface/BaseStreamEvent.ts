export interface BaseStreamEvent {
    ts: string;
    ms_played: number;
    reason_end: string;
    // ... other shared fields
}