import { describe, expect, it } from 'vitest';
import { selectBuildBuyTx, type BuildBuyTx } from '../src/buyTx.js';

const keyed: BuildBuyTx = async () => Uint8Array.of(1);
const local: BuildBuyTx = async () => Uint8Array.of(2);
const listing = { mint: 'm', seller: 's', priceLamports: 1n, name: 'n', image: null, attributes: {}, raw: {} };

describe('selectBuildBuyTx', () => {
  it('uses the keyed API only when a key is set', async () => {
    expect(await selectBuildBuyTx({ apiKey: 'k', keyed, local })(listing, 'b')).toEqual(Uint8Array.of(1));
    expect(await selectBuildBuyTx({ apiKey: undefined, keyed, local })(listing, 'b')).toEqual(Uint8Array.of(2));
    expect(await selectBuildBuyTx({ apiKey: '', keyed, local })(listing, 'b')).toEqual(Uint8Array.of(2));
  });
});
