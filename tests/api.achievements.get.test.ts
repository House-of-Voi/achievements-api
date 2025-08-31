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

// Mock utils
vi.mock('@/lib/utils/voi', () => ({
  getSBTAssetId: vi.fn().mockResolvedValue(123),
  hasAchievement: vi.fn().mockResolvedValue(false),
}));

// Import route AFTER mocks
import * as GET_ROUTE from '@/app/api/achievements/route';

describe('GET /api/achievements', () => {
  const achievementsDir = path.join(process.cwd(), 'src/lib/achievements');

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('400 on invalid account', async () => {
    vi.spyOn(fs, 'readdirSync').mockImplementation(
      ((..._args: unknown[]) => ['a1.ts']) as unknown as typeof fs.readdirSync
    );

    const spec = pathToFileURL(path.join(achievementsDir, 'a1.ts')).href;
    (vi as any).doMock(
      spec,
      () => ({
        default: {
          id: 'a1',
          name: 'A1',
          description: 'd',
          imageUrl: 'u',
          enabled: true,
          hidden: false,
          getContractAppId() {
            return 0;
          },
          checkRequirement: vi.fn(),
          mint: vi.fn(),
        },
      }),
      { virtual: true }
    );

    await testApiHandler({
      appHandler: GET_ROUTE,
      async test({ fetch }) {
        const res = await fetch({ method: 'GET', url: '/api/achievements?account=INVALID' } as any);
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body).toEqual({ error: 'Invalid account' });
      },
    });
  });

  it('lists enabled, non-hidden; excludes hidden when no account', async () => {
    vi.spyOn(fs, 'readdirSync').mockImplementation(
      ((..._args: unknown[]) => ['a1.ts', 'hidden.ts']) as unknown as typeof fs.readdirSync
    );

    const a1 = pathToFileURL(path.join(achievementsDir, 'a1.ts')).href;
    (vi as any).doMock(
      a1,
      () => ({
        default: {
          id: 'a1',
          name: 'A1',
          description: 'd1',
          imageUrl: 'u1',
          enabled: true,
          hidden: false,
          getContractAppId() {
            return 0;
          },
          checkRequirement: vi.fn(),
          mint: vi.fn(),
        },
      }),
      { virtual: true }
    );

    const hidden = pathToFileURL(path.join(achievementsDir, 'hidden.ts')).href;
    (vi as any).doMock(
      hidden,
      () => ({
        default: {
          id: 'h1',
          name: 'H1',
          description: 'hd',
          imageUrl: 'hu',
          enabled: true,
          hidden: true,
          getContractAppId() {
            return 0;
          },
          checkRequirement: vi.fn(),
          mint: vi.fn(),
        },
      }),
      { virtual: true }
    );

    await testApiHandler({
      appHandler: GET_ROUTE,
      async test({ fetch }) {
        const res = await fetch({ method: 'GET', url: '/api/achievements' } as any);
        expect(res.status).toBe(200);
        const list = await res.json();
        expect(list).toEqual([{ id: 'a1', name: 'A1', description: 'd1', imageUrl: 'u1' }]);
      },
    });
  });

  it('includes hidden only when account has the SBT', async () => {
    const utils = await import('@/lib/utils/voi');
    (utils.hasAchievement as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    vi.spyOn(fs, 'readdirSync').mockImplementation(
      ((..._args: unknown[]) => ['hidden.ts']) as unknown as typeof fs.readdirSync
    );

    const hidden = pathToFileURL(path.join(achievementsDir, 'hidden.ts')).href;
    (vi as any).doMock(
      hidden,
      () => ({
        default: {
          id: 'h1',
          name: 'H1',
          description: 'hd',
          imageUrl: 'hu',
          enabled: true,
          hidden: true,
          getContractAppId() {
            return 77;
          },
          checkRequirement: vi.fn(),
          mint: vi.fn(),
        },
      }),
      { virtual: true }
    );

    await testApiHandler({
      appHandler: GET_ROUTE,
      async test({ fetch }) {
        const res = await fetch({ method: 'GET', url: '/api/achievements?account=VALID' } as any);
        expect(res.status).toBe(200);
        const list = await res.json();
        expect(list).toEqual([{ id: 'h1', name: 'H1', description: 'hd', imageUrl: 'hu' }]);
      },
    });
  });

  it('applies defaults enabled=true, hidden=false', async () => {
    vi.spyOn(fs, 'readdirSync').mockImplementation(
      ((..._args: unknown[]) => ['a1.ts']) as unknown as typeof fs.readdirSync
    );

    const a1 = pathToFileURL(path.join(achievementsDir, 'a1.ts')).href;
    (vi as any).doMock(
      a1,
      () => ({
        default: {
          id: 'a1',
          name: 'A1',
          description: 'd1',
          imageUrl: 'u1',
          getContractAppId() {
            return 0;
          },
          checkRequirement: vi.fn(),
          mint: vi.fn(),
        },
      }),
      { virtual: true }
    );

    await testApiHandler({
      appHandler: GET_ROUTE,
      async test({ fetch }) {
        const res = await fetch({ method: 'GET', url: '/api/achievements' } as any);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual([{ id: 'a1', name: 'A1', description: 'd1', imageUrl: 'u1' }]);
      },
    });
  });
});
