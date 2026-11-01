import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

describe('CLI Orchestration & Argument Boundaries', () => {
    const cliScriptPath = path.resolve('dist/index.js');
    const projectRoot = process.cwd();

    const runCli = (args: string[], customEnv?: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> => {
        return new Promise((resolve) => {
            const mergedEnv = customEnv ? { ...customEnv } : { ...process.env };
            execFile(
                process.execPath,
                [cliScriptPath, ...args],
                {
                    cwd: projectRoot,
                    env: mergedEnv
                },
                (error, stdout, stderr) => {
                    resolve({
                        code: error ? (error as any).code ?? 1 : 0,
                        stdout: stdout.toString(),
                        stderr: stderr.toString()
                    });
                }
            );
        });
    };

    describe('CLI Parameter Validation & Boundary Conditions', () => {
        it('should exit with error code 1 when year is below 1970 boundary', async () => {
            const result = await runCli(['--year=1969']);
            assert.equal(result.code, 1);
            assert.match(result.stderr, /Invalid year provided/);
        });

        it('should exit with error code 1 when year is above 2100 boundary', async () => {
            const result = await runCli(['--year=2101']);
            assert.equal(result.code, 1);
            assert.match(result.stderr, /Invalid year provided/);
        });

        it('should exit with error code 1 when year is non-numeric or NaN', async () => {
            const result = await runCli(['--year=invalid']);
            assert.equal(result.code, 1);
            assert.match(result.stderr, /Invalid year provided/);
        });

        it('should exit with error code 1 when TOP_N is 0 or negative', async () => {
            const res0 = await runCli(['--top=0']);
            assert.equal(res0.code, 1);
            assert.match(res0.stderr, /Invalid TOP_N provided/);

            const resNeg = await runCli(['--top=-10']);
            assert.equal(resNeg.code, 1);
            assert.match(resNeg.stderr, /Invalid TOP_N provided/);
        });

        it('should exit with error code 1 when TOP_N exceeds maximum limit (10000)', async () => {
            const result = await runCli(['--top=10001']);
            assert.equal(result.code, 1);
            assert.match(result.stderr, /Invalid TOP_N provided/);
        });

        it('should exit with error code 1 when TOP_N is non-numeric', async () => {
            const result = await runCli(['--top=many']);
            assert.equal(result.code, 1);
            assert.match(result.stderr, /Invalid TOP_N provided/);
        });
    });

    describe('Error Boundary Sanitization & Path Redaction', () => {
        it('should redact current working directory to [REDACTED_PATH] and home to [REDACTED_HOME]', async () => {
            // When data/ is missing (or fails to read), safe error is thrown and caught by runAudit() catch block
            const result = await runCli(['--year=2025']);
            assert.equal(result.code, 1);
            assert.match(result.stderr, /\[ERROR\] Audit failed:/);
            // Verify no unhandled stack trace or raw sensitive paths leaked
            assert.ok(!result.stderr.includes(projectRoot));
            assert.ok(!result.stderr.includes(os.homedir()));
            // Should contain no raw ANSI escape sequences
            assert.ok(!/\x1B\[[0-9;]*[a-zA-Z]/.test(result.stderr));
        });
    });

    describe('Environment Configuration & Mode Indicators', () => {
        it('should log warning when HOME_IP environment variable is unset', async () => {
            const env = { ...process.env };
            delete env.HOME_IP;

            const result = await runCli(['--year=2025'], env);
            const combinedOutput = result.stdout + result.stderr;
            assert.match(combinedOutput, /HOME_IP environment variable is not set/);
            assert.match(result.stdout, /Mode: Year 2025/);
        });

        it('should not log HOME_IP warning when HOME_IP environment variable is present', async () => {
            const result = await runCli(['--year=2025'], { HOME_IP: '192.168.1.55' });
            assert.ok(!result.stdout.includes('HOME_IP environment variable is not set'));
            assert.match(result.stdout, /Mode: Year 2025/);
        });

        it('should correctly indicate All-Time mode when --all-time flag is provided', async () => {
            const result = await runCli(['--all-time']);
            assert.match(result.stdout, /Mode: All-Time/);
        });
    });

    describe('End-to-End CLI Pipeline Execution With Temporary Data', () => {
        const dataDir = path.join(projectRoot, 'data');
        let dataDirCreated = false;

        it('should execute full audit pipeline successfully via CLI with valid data directory', async () => {
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
                dataDirCreated = true;
            }

            const testJsonFile = path.join(dataDir, 'streaming_history_audio_2025_cli_test.json');
            try {
                const samplePayload = [
                    {
                        ts: '2025-06-15T14:00:00Z',
                        ms_played: 180000,
                        master_metadata_track_name: 'Stairway to Heaven',
                        master_metadata_album_artist_name: 'Led Zeppelin',
                        reason_end: 'trackdone'
                    },
                    {
                        ts: '2025-06-15T15:00:00Z',
                        ms_played: 3600000,
                        episode_name: 'Tech Show Ep 1',
                        episode_show_name: 'Tech Show',
                        reason_end: 'trackdone'
                    }
                ];

                fs.writeFileSync(testJsonFile, JSON.stringify(samplePayload));

                const result = await runCli(['--year=2025', '--top=10'], { HOME_IP: '192.168.1.1' });
                assert.equal(result.code, 0);
                assert.match(result.stdout, /Loaded and deduplicated 2 total events/);
                assert.match(result.stdout, /Music Listening: 0 hours/);
                assert.match(result.stdout, /Podcast Listening: 1 hours/);
                assert.match(result.stdout, /=== 2025 WRAPPED AUDIT ===/);
                assert.match(result.stdout, /Stairway to Heaven - Led Zeppelin/);
                assert.match(result.stdout, /TOP 20 ARTISTS \(By Time\)/);
                assert.match(result.stdout, /Led Zeppelin: 3m \(0.1h\)/);
            } finally {
                if (fs.existsSync(testJsonFile)) {
                    fs.unlinkSync(testJsonFile);
                }
                if (dataDirCreated && fs.existsSync(dataDir)) {
                    fs.rmSync(dataDir, { recursive: true, force: true });
                }
            }
        });
    });
});
