import algosdk from 'algosdk';

let nodeUrl: string;
let indexerUrl: string;

const network = process.env.NETWORK || 'testnet';

if (network === 'mainnet') {
  nodeUrl = process.env.MAINNET_NODE || 'https://mainnet-api.voi.nodely.dev';
  indexerUrl = process.env.MAINNET_INDEXER || 'https://mainnet-idx.voi.nodely.dev';
} else if (network === 'testnet') {
  nodeUrl = process.env.VOI_NODE || 'https://testnet-api.voi.nodely.dev';
  indexerUrl = process.env.VOI_INDEXER || 'https://testnet-idx.voi.nodely.dev';
} else if (network === 'local') {
  nodeUrl = process.env.LOCAL_NODE || 'http://localhost:4001';
  indexerUrl = process.env.LOCAL_INDEXER || 'http://localhost:8980';
} else {
  throw new Error('Invalid NETWORK env variable');
}

const algoClient = new algosdk.Algodv2('', nodeUrl, '');
const indexer = new algosdk.Indexer('', indexerUrl, '');
const signer = algosdk.mnemonicToSecretKey(process.env.SIGNER_MNEMONIC || '');

/**
 * Indexer responses vary across SDK versions.
 * Normalize asset list and amount type (number | bigint).
 */
type AccountAsset = {
  amount: number | bigint;
  'asset-id'?: number;
  assetId?: number;
  asset_id?: number;
};
type AccountAssetsResponse = {
  assets?: AccountAsset[];
  'asset-holdings'?: AccountAsset[];
};

export async function hasAchievement(account: string, assetId: number): Promise<boolean> {
  try {
    const raw = (await indexer.lookupAccountAssets(account).do()) as unknown as AccountAssetsResponse;
    const list: AccountAsset[] = raw.assets ?? raw['asset-holdings'] ?? [];
    const getId = (a: AccountAsset) => a['asset-id'] ?? a.assetId ?? a.asset_id;
    const found = list.find((a) => getId(a) === assetId);
    const amt = found?.amount ?? 0;
    const value = typeof amt === 'bigint' ? Number(amt) : amt; // avoid bigint literal for ES2017 target
    return value > 0;
  } catch {
    return false;
  }
}

export async function mintSBT(appId: number, account: string): Promise<string> {
  const params = await algoClient.getTransactionParams().do();
  const txn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: signer.addr,
    suggestedParams: params,
    appIndex: appId,
    appArgs: [new TextEncoder().encode('mint'), algosdk.decodeAddress(account).publicKey],
  });
  const signedTxn = txn.signTxn(signer.sk);
  const response = await algoClient.sendRawTransaction(signedTxn).do();
  const txId = response.txid;
  await algosdk.waitForConfirmation(algoClient, txId, 4);
  return txId;
}

type GlobalStateEntry = { key: string; value: { uint?: number; bytes?: string; type?: number } };
type AppLookupResponse = { application?: { params?: { 'global-state'?: GlobalStateEntry[] } } };

export async function getSBTAssetId(appId: number): Promise<number> {
  const appInfo = (await indexer.lookupApplications(appId).do()) as unknown as AppLookupResponse;
  const state = appInfo.application?.params?.['global-state'] ?? [];
  const assetEntry = state.find((s) => Buffer.from(s.key, 'base64').toString() === 'assetId');
  return assetEntry?.value.uint || 0;
}
