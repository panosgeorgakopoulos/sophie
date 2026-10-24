import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UploadJob } from './uploadQueue';
const mocks = vi.hoisted(() => ({ query: vi.fn(), claim: vi.fn() }));
vi.mock('./db', () => ({ pool: { query: mocks.query } }));
vi.mock('./uploadQueue', () => ({ claimUpload: mocks.claim }));
import { runUploadBatch } from './uploadWorker';
const job = (id: string) => ({ id } as UploadJob);
afterEach(() => vi.resetAllMocks());
describe('upload batch run lifecycle', () => {
  it('records failed jobs and continues the bounded batch with a fresh run', async () => {
    mocks.claim.mockResolvedValueOnce(job('first')).mockResolvedValueOnce(job('second')).mockResolvedValue(undefined);
    let next = 0;
    mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith('INSERT') ? [{ id: `run-${++next}` }] : [] }));
    const processJob = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await runUploadBatch(processJob)).toEqual({ processed: 1, failed: 1 });
    expect(processJob.mock.calls.map(([, runId]) => runId)).toEqual(['run-1', 'run-2']);
    expect(mocks.query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE')).map(([, values]) => values[1])).toEqual(['failed', 'complete']);
  });
  it('records an unexpected processor failure before aborting the worker', async () => {
    mocks.claim.mockResolvedValue(job('first'));
    mocks.query.mockResolvedValue({ rows: [{ id: 'run-1' }] });
    await expect(runUploadBatch(async () => { throw new Error('worker failed'); })).rejects.toThrow('worker failed');
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls.at(-1)?.[1]).toEqual(['run-1', 'failed', { uploadId: 'first', processed: 0, failed: 1 }]);
  });
  it('does not leave empty running records for idle workers', async () => {
    mocks.claim.mockResolvedValue(undefined);
    expect(await runUploadBatch(vi.fn())).toEqual({ processed: 0, failed: 0 });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
