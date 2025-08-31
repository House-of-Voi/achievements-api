/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { testApiHandler } from 'next-test-api-route-handler';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock algosdk default export with isValidAddress
vi.mock('algosdk', () => ({
  default: {
    isValidAddress: (addr: string) => addr === 'VALID',
  },
}));

vi.mock('@/lib/utils/voi', () => ({
  getSBTAssetId: vi.fn().mockResolvedValue(555),
  hasAchievement: vi.fn().mockResolvedValue(false),
  mintSBT: vi.fn().mockResolvedValue('TX123'),
}));

import * as POST_ROUTE from '@/app/api/claim/route';

describe('POST /api/claim', () => {
  const achievementsDir = path.join(process.cwd(), 'src/lib/achievements');

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('400 on invalid account', async () => {
    vi.spyOn(fs, 'readdirSync').mockImplementation(
      ((..._args: unknown[]) => []) as unknown as typeof fs.readdirSync
    );

    await testApiHandler({
      appHandler: POST_ROUTE,
      async test({ fetch }) {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ account: 'INVALID' }),
          url: '/api/claim',
        } as any);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'Invalid account' });
      },
    });
  });

  it('mints when requirement met and not yet owned', async () => {
    const utils = await import('@/lib/utils/voi');
    (utils.hasAchievement as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (utils.mintSBT as unknown as ReturnType<typeof vi.fn>).mockResolvedValue('TX999');

    // For this test, map appId -> assetId 1:1 so ownership checks line up with given getContractAppId values
    (utils.getSBTAssetId as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (appId: number) => appId);

    vi.spyOn(fs, 'readdirSync').mockImplementation(
      ((..._args: unknown[]) => ['ach.ts']) as unknown as typeof fs.readdirSync
    );

    const spec = pathToFileURL(path.join(achievementsDir, 'ach.ts')).href;
    (vi as any).doMock(
      spec,
      () => ({
        default: {
          id: 'x1',
          name: 'X1',
          description: 'd',
          imageUrl: 'u',
          enabled: true,
          hidden: false,
          getContractAppId() {
            return 42;
          },
          checkRequirement: vi.fn().mockResolvedValue(true),
          mint: vi.fn(async (acct: string) => {
            const m = await import('@/lib/utils/voi');
            return (m.mintSBT as (appId: number, account: string) => Promise<string>)(42, acct);
          }),
        },
      }),
      { virtual: true }
    );

    await testApiHandler({
      appHandler: POST_ROUTE,
      async test({ fetch }) {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ account: 'VALID' }),
          url: '/api/claim',
        } as any);
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.minted).toEqual([{ id: 'x1', txnId: 'TX999' }]);
        expect(body.errors).toEqual([]);
      },
    });
  });

  it('skips disabled, already owned, unmet requirement; collects errors', async () => {
    const utils = await import('@/lib/utils/voi');

    // Map appId -> assetId 1:1 so that "owned" => assetId 2
    (utils.getSBTAssetId as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (appId: number) => appId);

    // hasAchievement returns true only for assetId 2 (the "owned" achievement)
    (utils.hasAchievement as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_acct: string, assetId: number) => assetId === 2
    );

    vi.spyOn(fs, 'readdirSync').mockImplementation(
      ((..._args: unknown[]) => ['disabled.ts', 'owned.ts', 'nope.ts', 'throws.ts']) as unknown as typeof fs.readdirSync
    );

    const base = (f: string) => pathToFileURL(path.join(achievementsDir, f)).href;

    (vi as any).doMock(
      base('disabled.ts'),
      () => ({
        default: {
          id: 'disabled',
          name: 'Disabled',
          description: '',
          imageUrl: '',
          enabled: false,
          hidden: false,
          getContractAppId() {
            return 1;
          },
          checkRequirement: vi.fn(),
          mint: vi.fn(),
        },
      }),
      { virtual: true }
    );

    (vi as any).doMock(
      base('owned.ts'),
      () => ({
        default: {
          id: 'owned',
          name: 'Owned',
          description: '',
          imageUrl: '',
          enabled: true,
          hidden: false,
          getContractAppId() {
            return 2;
          },
          checkRequirement: vi.fn().mockResolvedValue(true),
          mint: vi.fn(), // should not be called
        },
      }),
      { virtual: true }
    );

    (vi as any).doMock(
      base('nope.ts'),
      () => ({
        default: {
          id: 'nope',
          name: 'Nope',
          description: '',
          imageUrl: '',
          enabled: true,
          hidden: false,
          getContractAppId() {
            return 3;
          },
          checkRequirement: vi.fn().mockResolvedValue(false),
          mint: vi.fn(), // should not be called
        },
      }),
      { virtual: true }
    );

    (vi as any).doMock(
      base('throws.ts'),
      () => ({
        default: {
          id: 'throws',
          name: 'Throws',
          description: '',
          imageUrl: '',
          enabled: true,
          hidden: false,
          getContractAppId() {
            return 4;
          },
          checkRequirement: vi.fn().mockResolvedValue(true),
          mint: vi.fn().mockRejectedValue(new Error('Boom')),
        },
      }),
      { virtual: true }
    );

    await testApiHandler({
      appHandler: POST_ROUTE,
      async test({ fetch }) {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ account: 'VALID' }),
          url: '/api/claim',
        } as any);
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.minted).toEqual([]); // owned skipped, nope unmet, disabled skipped, throws -> error
        expect(body.errors).toEqual([{ id: 'throws', reason: 'Boom' }]);
      },
    });
  });
});
