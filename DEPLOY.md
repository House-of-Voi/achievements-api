# Achievement Contract Deployment Guide

This guide explains how to use the deploy script to deploy ARC-72 contracts for achievements.

## Overview

The deploy script processes all achievements in a configuration file and deploys contracts for achievements that don't already have app IDs for the current network. This allows you to deploy contracts that are properly configured for specific achievements with the correct metadata.

## Usage

### Basic Usage

```bash
npm run deploy <path-to-achievement-file>
```

Or directly with tsx:
```bash
npx tsx scripts/deploy.ts <path-to-achievement-file>
```

### Examples

Deploy contracts for all Original Degens achievements:
```bash
npm run deploy src/lib/achievements/original-degens.ts
```

Deploy contracts for all Multiplier Master achievements:
```bash
npm run deploy src/lib/achievements/multiplier-master.ts
```

Deploy using an absolute path:
```bash
npm run deploy /absolute/path/to/achievement.ts
```

## What the Script Does

1. **Loads Achievement Configuration**: Reads the specified achievement file and loads all achievements from the exported array.

2. **Analyzes Deployment Needs**: Checks which achievements need deployment by examining their `contractAppIds` for the current network. Only achievements with `0` or missing app IDs will be deployed.

3. **Validates Environment**: Checks that all required environment variables are set:
   - `VOI_NODE`
   - `VOI_INDEXER` 
   - `SIGNER_MNEMONIC`
   - `VOI_NODE_PORT`
   - `VOI_INDEXER_PORT`

4. **Deploys Contracts**: For each achievement that needs deployment:
   - Creates a unique contract name in the format `achievement-{achievementId}`
   - Deploys the ARC-72 contract with achievement-specific configuration
   - Bootstraps the contract and approves the deployer as a minter
   - Sets the metadata URI based on the achievement ID
   - Waits 2 seconds between deployments to avoid rate limits

5. **Provides Comprehensive Summary**: Outputs detailed deployment results including app IDs and metadata URIs for updating your achievement configuration.

## Achievement File Requirements

The achievement file must:
- Export a default array of `IAchievement` objects
- Each achievement must have:
  - `id`: Unique identifier
  - `name`: Display name
  - `description`: Description text
  - `contractAppIds`: Object with `mainnet` and `testnet` app IDs
  - Other required `IAchievement` properties

## Environment Variables

Create a `.env` file with the following variables:

```env
VOI_NODE=http://localhost
VOI_INDEXER=http://localhost
VOI_NODE_PORT=4001
VOI_INDEXER_PORT=8980
SIGNER_MNEMONIC=your 25-word mnemonic phrase here
METADATA_BASE_URL=https://your-api.example.com  # Optional, defaults to https://achievements-api.example.com
NETWORK=mainnet  # Optional, defaults to mainnet
```

## Output

The script provides detailed output including:
- Achievement analysis (total found, need deployment, already deployed)
- Environment configuration validation
- Individual deployment progress with transaction IDs
- Comprehensive deployment summary with all results
- Copy-paste friendly configuration info for updating achievement files

## Example Output

```
📄 Loading achievement config from: /path/to/original-degens.ts
🎯 Selected achievement: Original Degens - 100 (original-degens-100)
📋 Description: As an early tester, reach a total wagered amount of 100 USD equivalent.
🚀 Deploying contract for achievement: Original Degens - 100
📝 Contract name: achievement-original-degens-100
🎉 App ID: 481585

============================================================
🎉 Deployment complete!
📋 Achievement: Original Degens - 100
🆔 Achievement ID: original-degens-100
🏗️  App ID: 481585
🔗 Metadata URI: https://achievements-api.example.com/metadata/original-degens-100.json
👤 Deployer: PMIVXUAIRMLNCXKCWB3DQ554EYRCYI3CCHFYIK5YJRYM6X43PYVZSGHPO4
============================================================

📋 Copy this info to update your achievement configuration:
App ID: 481585
Network: mainnet
```

## Updating Achievement Configurations

After deployment, update your achievement file with the new app ID:

```typescript
const TIERS: readonly TierDef[] = [
    { 
      key: '100', 
      label: '100', 
      usd: 100, 
      contractAppIds: { 
        mainnet: 481585, // <- Add the deployed app ID here
        testnet: 0 
      } 
    },
    // ... other tiers
];
```

## Troubleshooting

### Common Issues

1. **File not found**: Ensure the path to the achievement file is correct
2. **Environment variables missing**: Check your `.env` file
3. **Invalid mnemonic**: Ensure your mnemonic is exactly 25 words
4. **Network connection**: Verify your VOI node and indexer URLs are accessible

### Getting Help

If you encounter issues:
1. Check the console output for specific error messages
2. Verify your environment configuration
3. Ensure the achievement file exports the expected format
4. Test with a simple achievement file first
