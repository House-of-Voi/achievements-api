import algosdk from 'algosdk';

// Narrow type for waitForConfirmation result when creating an app
type PendingAppCreate = {
  applicationIndex?: number;
  'application-index'?: number;
};

// Example: Deploy ARC-72 contract
async function deploy() {
  // Node + token/port pulled from env (empty strings are fine for public nodes)
  const client = new algosdk.Algodv2(
    process.env.VOI_NODE_TOKEN || '',
    process.env.VOI_NODE || '',
    process.env.VOI_NODE_PORT || ''
  );

  const signer = algosdk.mnemonicToSecretKey(process.env.SIGNER_MNEMONIC || '');

  // TODO: replace with real compiled program bytes
  const approvalProgram = new Uint8Array(); // <-- supply TEAL/AVM bytes
  const clearProgram = new Uint8Array();    // <-- supply TEAL/AVM bytes

  const params = await client.getTransactionParams().do();

  const txn = algosdk.makeApplicationCreateTxnFromObject({
    from: signer.addr, // <-- was `sender`
    suggestedParams: params,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    approvalProgram,
    clearProgram,
    // schema + extras as needed
    numLocalInts: 0,
    numLocalByteSlices: 0,
    numGlobalInts: 1,       // e.g., to store an assetId
    numGlobalByteSlices: 0,
    // extraPages: 0,        // set if your program needs > 1 page
    // appArgs: [],          // if your approval expects init args
  });

  const signedTxn = txn.signTxn(signer.sk);
  const { txid } = await client.sendRawTransaction(signedTxn).do();

  const result = (await algosdk.waitForConfirmation(client, txid, 4)) as PendingAppCreate;

  const appId = result.applicationIndex ?? result['application-index'];

  console.log(`App ID: ${appId}`);
  // Post-deploy: create ASA / set global state, etc.
}

deploy().catch(console.error);
