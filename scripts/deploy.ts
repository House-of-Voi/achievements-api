import algosdk from 'algosdk';

// Example: Deploy ARC-72 contract
async function deploy() {
  const client = new algosdk.Algodv2('', process.env.VOI_NODE || '', '');
  const signer = algosdk.mnemonicToSecretKey(process.env.SIGNER_MNEMONIC || '');

  // Assume you have approval/clear programs as TEAL or PyTeal compiled to bytes
  const approvalProgram = new Uint8Array(); // Replace with actual
  const clearProgram = new Uint8Array(); // Replace with actual

  const params = await client.getTransactionParams().do();
  const txn = algosdk.makeApplicationCreateTxnFromObject({
    sender: signer.addr,
    suggestedParams: params,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    approvalProgram,
    clearProgram,
    // Add schema, extra pages, etc.
    numLocalInts: 0,
    numLocalByteSlices: 0,
    numGlobalInts: 1, // e.g., for assetId
    numGlobalByteSlices: 0,
  });

  const signedTxn = txn.signTxn(signer.sk);
  const response = await client.sendRawTransaction(signedTxn).do();
  const txId = response.txid;
  const result = await algosdk.waitForConfirmation(client, txId, 4);
  console.log(`App ID: ${result.applicationIndex}`);

  // Post-deploy: Call to create ASA (SBT), store in global state
}

deploy().catch(console.error);