import { z } from 'zod';

// Helius DAS (Digital Asset Standard) API: https://www.helius.dev/docs/das-api

const DasAssetSchema = z.object({
  id: z.string(),
  interface: z.string(),
  burnt: z.boolean().optional(),
  ownership: z.object({ owner: z.string() }),
  authorities: z.array(z.object({ address: z.string() })).optional(),
  grouping: z.array(z.object({ group_key: z.string(), group_value: z.string() })).optional(),
  compression: z.object({ compressed: z.boolean() }).optional(),
  content: z.object({
    metadata: z.object({
      name: z.string().optional(),
      attributes: z.array(z.object({ trait_type: z.string(), value: z.unknown() })).optional(),
    }).partial().optional(),
    links: z.object({ image: z.string().optional() }).partial().optional(),
  }).partial().optional(),
});
export type DasAsset = z.infer<typeof DasAssetSchema>;

async function dasCall(url: string, method: string, params: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'lotus', method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`DAS ${method} HTTP ${res.status}`);
  const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(`DAS ${method}: ${body.error.message ?? 'error'}`);
  return body.result;
}

export async function dasGetAsset(url: string, id: string): Promise<DasAsset | null> {
  try {
    return DasAssetSchema.parse(await dasCall(url, 'getAsset', { id }));
  } catch (err) {
    if (err instanceof Error && /not found/i.test(err.message)) return null;
    throw err;
  }
}

/** Every non-fungible asset the owner holds, all pages. */
export async function dasGetAssetsByOwner(url: string, owner: string): Promise<DasAsset[]> {
  const limit = 1000;
  const out: DasAsset[] = [];
  for (let page = 1; page <= 100; page++) {
    const result = z
      .object({ items: z.array(z.unknown()) })
      .parse(await dasCall(url, 'getAssetsByOwner', { ownerAddress: owner, page, limit }));
    for (const raw of result.items) {
      const parsed = DasAssetSchema.safeParse(raw);
      if (parsed.success && !parsed.data.burnt && !/Fungible(Token|Asset)$/.test(parsed.data.interface)) {
        out.push(parsed.data);
      }
    }
    if (result.items.length < limit) return out;
  }
  throw new Error('getAssetsByOwner returned more than 100 pages');
}

export function collectionOf(asset: DasAsset): string | null {
  return asset.grouping?.find((g) => g.group_key === 'collection')?.group_value ?? null;
}

/** Up to 1000 assets by id in one call; ids that DAS does not know are left out. */
export async function dasGetAssetBatch(url: string, ids: string[]): Promise<DasAsset[]> {
  if (ids.length === 0) return [];
  const result = await dasCall(url, 'getAssetBatch', { ids });
  if (!Array.isArray(result)) throw new Error('DAS getAssetBatch returned no list');
  const out: DasAsset[] = [];
  for (const raw of result) {
    const parsed = DasAssetSchema.safeParse(raw);
    if (parsed.success && !parsed.data.burnt) out.push(parsed.data);
  }
  return out;
}
