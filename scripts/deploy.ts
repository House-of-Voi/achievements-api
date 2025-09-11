import algosdk from "algosdk";
import {
  MintableSbnftClient as Client,
  APP_SPEC,
} from "@/clients/MintableSBNFTClient";
import { CONTRACT } from "ulujs";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import type { IAchievement } from "@/lib/types";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });


// Optional: declare a typed global debug flag so we don't need `as any`
declare global {
  var GLOBAL_DEBUG: boolean | undefined;
}

function stripTrailingZeroBytes(str: string) {
  return str.replace(/\0+$/, "");
}

function padStringWithZeroBytes(input: string, length: number): string {
  const paddingLength = length - input.length;
  return paddingLength > 0 ? input + "\0".repeat(paddingLength) : input;
}

// Precise type for a signed txn returned by algosdk.signTransaction
type SignedTxn = { txID: string; blob: Uint8Array };

// What waitForConfirmation returns (subset we use)
type PendingTxInfo = {
  ["confirmed-round"]?: number;
  confirmedRound?: number;
  ["pool-error"]?: string;
  txID?: string;
  [k: string]: unknown;
};

// Send helper (typed)
const signSendAndConfirm = async (
  algodClient: algosdk.Algodv2,
  txns: string[],
  sk: Uint8Array
): Promise<PendingTxInfo[]> => {
  const unsignedBytes: Uint8Array[] = txns.map(
    (t) => new Uint8Array(Buffer.from(t, "base64"))
  );

  const unsigned: algosdk.Transaction[] = unsignedBytes.map((b) =>
    algosdk.decodeUnsignedTransaction(b)
  );

  const signed: SignedTxn[] = unsigned.map((u) =>
    algosdk.signTransaction(u, sk) as SignedTxn
  );

  const blobs: Uint8Array[] = signed.map((s) => s.blob);
  const res = await algodClient.sendRawTransaction(blobs).do();

  if (globalThis.GLOBAL_DEBUG) console.log(res);

  // Confirm each txID
  return Promise.all(
    signed.map((s) =>
      algosdk.waitForConfirmation(algodClient, s.txID, 4) as Promise<PendingTxInfo>
    )
  );
};

// Load all achievements from file
async function loadAllAchievements(
  achievementFilePath: string
): Promise<IAchievement[]> {
  try {
    const absolutePath = path.resolve(achievementFilePath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Achievement file not found: ${absolutePath}`);
    }

    console.log(`📄 Loading achievement config from: ${absolutePath}`);

    const achievementModule = await import(absolutePath);
    const achievements: IAchievement[] = achievementModule.default;

    if (!Array.isArray(achievements) || achievements.length === 0) {
      throw new Error("Achievement file must export an array of achievements");
    }

    console.log(`🎯 Found ${achievements.length} achievements to process`);
    return achievements;
  } catch (error) {
    console.error("❌ Failed to load achievement config:", error);
    throw error;
  }
}

// Generate metadata URI for the achievement
function generateMetadataURI(achievement: IAchievement): string {
  const baseUrl =
    process.env.METADATA_BASE_URL || "'https://achievements.houseofvoi.com";
  return `${baseUrl}/api/achievements?id=${achievement.id}`;
}

// Check if achievement needs deployment (has no app ID for current network)
function needsDeployment(achievement: IAchievement): boolean {
  const network = process.env.NETWORK || "mainnet";
  const currentNetwork =
    network === "localnet"
      ? "localnet"
      : network === "testnet"
      ? "testnet"
      : "mainnet";
  const appId = achievement.contractAppIds[currentNetwork];
  return !appId || appId === 0;
}

// Type the params object passed to MintableSbnftClient
type AppClientParams = {
  resolveBy: "creatorAndName";
  findExistingUsing: algosdk.Indexer;
  creatorAddress: string;
  name: string;
  sender: { addr: string; sk: Uint8Array };
};

// Deploy ARC-72 contract for a specific achievement
async function deploySingleAchievement(
  achievement: IAchievement,
  algodClient: algosdk.Algodv2,
  indexerClient: algosdk.Indexer,
  deployer: algosdk.Account,
  tierIndex: number,
  totalTiers: number
): Promise<{ appId: number; metadataURI: string }> {
  console.log(`\n${"=".repeat(80)}`);
  console.log(
    `🚀 Deploying tier ${tierIndex + 1}/${totalTiers}: ${achievement.name}`
  );
  console.log(`🆔 Achievement ID: ${achievement.id}`);
  console.log(`📋 Description: ${achievement.description}`);
  console.log(`${"=".repeat(80)}`);

  const contractName = `achievement-${achievement.id}`;

  // Use `as const` to keep literal types (not widened to string)
  const clientParams = {
    resolveBy: "creatorAndName",
    findExistingUsing: indexerClient,
    creatorAddress: deployer.addr,
    name: contractName,
    sender: { addr: deployer.addr, sk: deployer.sk },
  } as const satisfies AppClientParams;

  const appClient = new Client(clientParams, algodClient);

  console.log(`📝 Contract name: ${contractName}`);

    const app = await appClient.deploy({
    deployTimeParams: {},
    onUpdate: "update",
    onSchemaBreak: "fail",
  });

  const appIdRaw = app.appId as number | bigint | undefined;
  if (!appIdRaw) {
    throw new Error("Failed to deploy contract");
  }

  // Normalize to number for the rest of this script
  const appId =
    typeof appIdRaw === "bigint" ? Number(appIdRaw) : appIdRaw;

  if (!Number.isSafeInteger(appId)) {
    throw new Error(`App ID is not a safe integer: ${String(appIdRaw)}`);
  }

  console.log(`🎉 App ID: ${appId}`);


  const ci = new CONTRACT(
    Number(appId),
    algodClient,
    undefined,
    {
      ...APP_SPEC.contract,
      events: [],
    },
    deployer
  );

  console.log("📝 Posting update...");

  const postUpdateR = await ci.post_update();
  if (!postUpdateR.success) {
    throw new Error("Failed to post update");
  }

  const res0 = await signSendAndConfirm(
    algodClient,
    postUpdateR.txns,
    deployer.sk
  );

  const round0 = res0[0]["confirmed-round"] ?? res0[0].confirmedRound ?? "unknown";
  console.log(`  ✅ Confirmed round: ${round0}`);
  console.log(
    "  📄 Confirmed txid:",
    algosdk
      .decodeUnsignedTransaction(
        new Uint8Array(Buffer.from(postUpdateR.txns[0], "base64"))
      )
      .txID()
  );

  console.log("🔧 Bootstrapping contract...");

  const bootstrapCost = await ci.bootstrap_cost();
  ci.setPaymentAmount(bootstrapCost.returnValue);
  const bootstrapR = await ci.bootstrap();
  if (!bootstrapR.success) {
    throw new Error("Failed to bootstrap");
  }

  const res1 = await signSendAndConfirm(
    algodClient,
    bootstrapR.txns,
    deployer.sk
  );

  const round1 = res1[0]["confirmed-round"] ?? res1[0].confirmedRound ?? "unknown";
  console.log(`  ✅ Confirmed round: ${round1}`);
  console.log(
    "  📄 Confirmed txid:",
    algosdk
      .decodeUnsignedTransaction(
        new Uint8Array(Buffer.from(bootstrapR.txns[0], "base64"))
      )
      .txID()
  );

  console.log(`👤 Approving minter... ${deployer.addr}`);

  const approveMinterCost = await ci.approve_minter_cost();
  ci.setPaymentAmount(approveMinterCost.returnValue);
  const approveMinterR = await ci.approve_minter(deployer.addr, 1);

  if (!approveMinterR.success) {
    console.log(approveMinterR);
    throw new Error("Failed to approve minter");
  }

  const res2 = await signSendAndConfirm(
    algodClient,
    approveMinterR.txns,
    deployer.sk
  );

  const round2 = res2[0]["confirmed-round"] ?? res2[0].confirmedRound ?? "unknown";
  console.log(`  ✅ Confirmed round: ${round2}`);
  console.log(
    "  📄 Confirmed txid:",
    algosdk
      .decodeUnsignedTransaction(
        new Uint8Array(Buffer.from(approveMinterR.txns[0], "base64"))
      )
      .txID()
  );

  const metadataURI = generateMetadataURI(achievement);
  console.log(`🔗 Setting metadata URI... ${metadataURI}`);

  const setMetadataURICost = await ci.set_metadata_uri_cost();
  ci.setPaymentAmount(setMetadataURICost.returnValue);
  const setMetadataURIR = await ci.set_metadata_uri(
    new Uint8Array(Buffer.from(padStringWithZeroBytes(metadataURI, 256)))
  );
  if (!setMetadataURIR.success) {
    throw new Error("Failed to set metadata URI");
  }

  const res3 = await signSendAndConfirm(
    algodClient,
    setMetadataURIR.txns,
    deployer.sk
  );

  const round3 = res3[0]["confirmed-round"] ?? res3[0].confirmedRound ?? "unknown";
  console.log(`  ✅ Confirmed round: ${round3}`);
  console.log(
    "  📄 Confirmed txid:",
    algosdk
      .decodeUnsignedTransaction(
        new Uint8Array(Buffer.from(setMetadataURIR.txns[0], "base64")))
      .txID()
  );

  console.log("🔍 Verifying metadata URI...");
  const metadataURI2 = stripTrailingZeroBytes(
    (await ci.metadata_uri()).returnValue
  );

  if (metadataURI2 !== metadataURI) {
    throw new Error("Failed to set metadata URI");
  }

  console.log("✅ Metadata URI set correctly");
  console.log(`🎉 Tier ${tierIndex + 1}/${totalTiers} deployment complete!`);

  return { appId, metadataURI };
}

// Deploy ARC-72 contracts for all achievements in the file
async function deploy(achievementFilePath?: string) {
  const args = process.argv.slice(2);
  let filePath = achievementFilePath;

  if (!filePath && args.length > 0) {
    filePath = args[0];
  }

  if (!filePath) {
    console.error("❌ Usage: npm run deploy <path-to-achievement-file>");
    console.error(
      "   Example: npm run deploy src/lib/achievements/original-degens.ts"
    );
    console.error(
      "   Example: npm run deploy /absolute/path/to/achievement.ts"
    );
    process.exit(1);
  }

  const achievements = await loadAllAchievements(filePath);

  const achievementsToDeployment = achievements.filter(needsDeployment);

  console.log(`\n🔍 Analysis:`);
  console.log(`  📊 Total achievements found: ${achievements.length}`);
  console.log(`  🚀 Need deployment: ${achievementsToDeployment.length}`);
  console.log(
    `  ✅ Already deployed: ${
      achievements.length - achievementsToDeployment.length
    }`
  );

  if (achievementsToDeployment.length === 0) {
    console.log("\n🎉 All achievements already have contracts deployed!");
    console.log("No deployment needed.");
    return;
  }

  console.log(`\n📋 Achievements to deploy:`);
  achievementsToDeployment.forEach((achievement, index) => {
    console.log(`  ${index + 1}. ${achievement.name} (${achievement.id})`);
  });

  const requiredEnvVars = {
    VOI_NODE: process.env.VOI_NODE,
    VOI_INDEXER: process.env.VOI_INDEXER,
    SIGNER_MNEMONIC: process.env.SIGNER_MNEMONIC,
    VOI_NODE_PORT: process.env.VOI_NODE_PORT,
    VOI_INDEXER_PORT: process.env.VOI_INDEXER_PORT,
  };

  console.log("\n🔍 Environment configuration:", {
    VOI_NODE: requiredEnvVars.VOI_NODE,
    VOI_INDEXER: requiredEnvVars.VOI_INDEXER,
    VOI_NODE_PORT: requiredEnvVars.VOI_NODE_PORT,
    VOI_INDEXER_PORT: requiredEnvVars.VOI_INDEXER_PORT,
    SIGNER_MNEMONIC: requiredEnvVars.SIGNER_MNEMONIC
      ? "***PROVIDED***"
      : "❌ MISSING",
    NETWORK: process.env.NETWORK || "mainnet",
  });

  const missingVars = Object.entries(requiredEnvVars)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missingVars.length > 0) {
    console.error("❌ Missing required environment variables:");
    missingVars.forEach((varName) => {
      console.error(`   - ${varName}`);
    });
    console.error(
      "\nPlease set these variables in your .env file or environment."
    );
    console.error("See .env-sample for reference.");
    process.exit(1);
  }

  const mnemonicWords = process.env.SIGNER_MNEMONIC!.split(" ");
  if (mnemonicWords.length !== 25) {
    console.error("❌ SIGNER_MNEMONIC must be a 25-word mnemonic phrase");
    console.error(`   Found ${mnemonicWords.length} words, expected 25`);
    process.exit(1);
  }

  console.log("✅ Environment variables validated");

  const algodClient = new algosdk.Algodv2(
    process.env.VOI_NODE_TOKEN || "",
    process.env.VOI_NODE!,
    Number(process.env.VOI_NODE_PORT || "")
  );

  const indexerClient = new algosdk.Indexer(
    process.env.VOI_INDEXER_TOKEN || "",
    process.env.VOI_INDEXER!,
    process.env.VOI_INDEXER_PORT || ""
  );

  const deployer = algosdk.mnemonicToSecretKey(process.env.SIGNER_MNEMONIC!);

  console.log(`\n👤 Deployer address: ${deployer.addr}`);
  console.log(`🌐 Network: ${process.env.NETWORK || "mainnet"}`);

  const deploymentResults: Array<{
    achievement: IAchievement;
    appId: number;
    metadataURI: string;
  }> = [];

  for (let i = 0; i < achievementsToDeployment.length; i++) {
    const achievement = achievementsToDeployment[i];

    try {
      const result = await deploySingleAchievement(
        achievement,
        algodClient,
        indexerClient,
        deployer,
        i,
        achievementsToDeployment.length
      );

      deploymentResults.push({
        achievement,
        appId: result.appId,
        metadataURI: result.metadataURI,
      });

      if (i < achievementsToDeployment.length - 1) {
        console.log("⏳ Waiting 2 seconds before next deployment...");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error(`❌ Failed to deploy ${achievement.name}:`, error);
      console.log("🔄 Continuing with remaining deployments...");
    }
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log("🎉 DEPLOYMENT SUMMARY");
  console.log(`${"=".repeat(80)}`);
  console.log(`📊 Total achievements processed: ${achievements.length}`);
  console.log(`✅ Successfully deployed: ${deploymentResults.length}`);
  console.log(
    `❌ Failed deployments: ${
      achievementsToDeployment.length - deploymentResults.length
    }`
  );
  console.log(`👤 Deployer: ${deployer.addr}`);
  console.log(`🌐 Network: ${process.env.NETWORK || "mainnet"}`);

  if (deploymentResults.length > 0) {
    console.log("\n📋 Deployment Results:");
    deploymentResults.forEach(({ achievement, appId, metadataURI }) => {
      console.log(`\n  🏗️  ${achievement.name}`);
      console.log(`     🆔 ID: ${achievement.id}`);
      console.log(`     📱 App ID: ${appId}`);
      console.log(`     🔗 Metadata URI: ${metadataURI}`);
    });

    console.log(
      "\n📄 Copy this info to update your achievement configuration:"
    );
    deploymentResults.forEach(({ achievement, appId }) => {
      const network = process.env.NETWORK || "mainnet";
      const currentNetwork =
        network === "localnet"
          ? "localnet"
          : network === "testnet"
          ? "testnet"
          : "mainnet";
      console.log(`${achievement.id}: { ${currentNetwork}: ${appId} }`);
    });
  }

  console.log(`${"=".repeat(80)}`);
}

// Only run if this file is executed directly
if (require.main === module) {
  deploy().catch(console.error);
}

export { deploy };
