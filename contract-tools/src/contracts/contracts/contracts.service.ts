// src/contracts/contracts/contracts.service.ts
import { Injectable, InternalServerErrorException, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { PreDeployDto } from '../dto/pre-deploy.dto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as bitcoin from 'bitcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
bitcoin.initEccLib(ecc);

// Adjust OYLSDK import paths relative to this file:
// Assuming oylsdk is in /app/src and this file is /app/contract-tools/src/contracts/contracts/contracts.service.ts
// So, ../../../../src/
import { generateMnemonic, mnemonicToAccount, Account } from '../../../../src/account';
import { Provider } from '../../../../src/provider';
import { 
    actualDeployCommitFee, 
    actualDeployRevealFee 
} from '../../../../src/alkanes/contract';
import { 
    createDeployCommitPsbt,
    AlkanesPayload,
    // encodeProtostone, // Not directly used in preDeploy for PSBT creation, but for fee estimation helper
    // ProtostoneMessage
} from '../../../../src/alkanes/alkanes';
import { FormattedUtxo } from '../../../../src/utxo';
import { getEstimatedFee } from '../../../../src/psbt';
// import { tweakSigner } from '../../../../src/shared/utils'; // tweakSigner is not directly used in preDeploy logic for key generation

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  // --- Helper: Estimate Reveal Fee (Simplified, adapted from old index.ts) ---
  private async estimateSimplifiedRevealFee(
      provider: Provider, 
      feeRate: number, 
      deployerAccount: Account, 
      placeholderProtostone: Buffer // This was simplified, actual protostone not built here
  ): Promise<number> {
      const dummyCommitTxId = '0000000000000000000000000000000000000000000000000000000000000000';
      const dummyScript = Buffer.from('00c8', 'hex'); 
      const internalKey = Buffer.from(deployerAccount.taproot.pubKeyXOnly, 'hex');
      
      const revealInputPayment = bitcoin.payments.p2tr({
          internalPubkey: internalKey,
          scriptTree: { output: dummyScript },
          network: provider.network,
      });

      const psbt = new bitcoin.Psbt({ network: provider.network });
      psbt.addInput({
          hash: dummyCommitTxId,
          index: 0,
          witnessUtxo: { value: 10000, script: revealInputPayment.output! },
          tapLeafScript: [
              {
                  leafVersion: bitcoin.payments.bip341.LEAF_VERSION_TAPSCRIPT,
                  script: dummyScript,
                  controlBlock: Buffer.from(revealInputPayment.witness![revealInputPayment.witness!.length - 1]!),
              },
          ],
      });
      psbt.addOutput({ address: deployerAccount.taproot.address, value: 546 });
      psbt.addOutput({ script: placeholderProtostone, value: 0 });

      try {
          const { fee } = await getEstimatedFee({ feeRate, psbt: psbt.toBase64(), provider });
          return fee;
      } catch (e) {
          this.logger.warn("Simplified reveal fee estimation using getEstimatedFee failed, using fallback size.", e.stack);
          const typicalRevealVSize = 150; 
          return typicalRevealVSize * feeRate;
      }
  }

  async preDeployContract(preDeployDto: PreDeployDto): Promise<any> {
    this.logger.log(`Starting preDeployContract for ${preDeployDto.contractName}`);
    try {
      // 1. Initialize Provider (assuming testnet for now)
      const provider = new Provider(bitcoin.networks.testnet);
      const feeRate = (await provider.esplora.getFeeEstimates())['1'] || 2;

      // 2. Generate mnemonic and deployer account
      const mnemonic = generateMnemonic();
      const deployerAccount = mnemonicToAccount({ mnemonic, opts: { network: provider.network } });
      const recipientAddress = deployerAccount.taproot.address;

      // 3. Load placeholder Wasm
      // Path to wasm directory from project root (contract-tools)
      const wasmBaseDir = path.join(process.cwd(), 'wasm'); 
      const wasmFileName = 'placeholder_contract_1.wasm'; // Later use preDeployDto.contractName for selection if needed
      const wasmFilePath = path.join(wasmBaseDir, wasmFileName);
      
      this.logger.log(`Reading Wasm file from: ${wasmFilePath}`);
      let contractWasm: Buffer;
      try {
        contractWasm = await fs.readFile(wasmFilePath);
      } catch (err) {
        this.logger.error(`Failed to read Wasm file at ${wasmFilePath}`, err.stack);
        throw new InternalServerErrorException(`Wasm file not found or unreadable: ${wasmFileName}`);
      }


      // 4. Prepare AlkanesPayload for commit
      const payload: AlkanesPayload = {
        body: contractWasm.toString('hex'),
        contentType: 'application/wasm',
      };

      // 5. Estimate Commit Fee
      const commitOutputInternalKey = Buffer.from(deployerAccount.taproot.pubKeyXOnly, 'hex');
      // const commitPayment = bitcoin.payments.p2tr({ internalPubkey: commitOutputInternalKey, network: provider.network });
      // The tweakedPublicKey for actualDeployCommitFee is just the xOnly pubkey string.
      const tweakedPublicKeyForEstimation = commitOutputInternalKey.toString('hex');

      const { fee: commitFee } = await actualDeployCommitFee({
        payload,
        utxos: [] as FormattedUtxo[],
        tweakedPublicKey: tweakedPublicKeyForEstimation,
        account: deployerAccount,
        provider,
        feeRate,
      });
      
      // 6. Estimate Reveal Fee (Simplified)
      // This is a very rough placeholder for what might go into protostone for fee estimation
      const simpleProtostoneForFeeEst = Buffer.from(
          `000102030405${Buffer.from(preDeployDto.symbol).toString('hex')}${preDeployDto.totalSupply.toString(16)}`, 
          'hex'
      );
      const revealFee = await this.estimateSimplifiedRevealFee(provider, feeRate, deployerAccount, simpleProtostoneForFeeEst);
      const totalEstimatedFee = commitFee + revealFee;

      // 7. Create Commit PSBT
      const { psbt: commitPsbtBase64 } = await createDeployCommitPsbt({
        payload,
        utxos: [] as FormattedUtxo[],
        tweakedPublicKey: tweakedPublicKeyForEstimation,
        account: deployerAccount,
        provider,
        feeRate,
        fee: commitFee,
      });

      this.logger.log(`Pre-deployment successful for ${preDeployDto.contractName}`);
      return { 
        psbt: commitPsbtBase64, 
        mnemonic,
        estimatedCommitFee: commitFee,
        estimatedRevealFee: revealFee,
        totalEstimatedFee: totalEstimatedFee,
        recipientAddress: recipientAddress,
      };

    } catch (error) {
      this.logger.error(`Error in preDeployContract for ${preDeployDto.contractName}: ${error.message}`, error.stack);
      if (error instanceof HttpException) {
        throw error;
      }
      // Check for specific SDK error types if available and rethrow as HttpException
      // For now, a generic internal server error for unknown issues.
      throw new InternalServerErrorException(`Failed to pre-deploy contract: ${error.message}`);
    }
  }

  async deployContract(deployDto: DeployDto): Promise<any> {
    this.logger.log(`Starting deployContract for ${deployDto.contractName}`);
    try {
      // 1. Initialize SDK components
      const provider = new Provider(bitcoin.networks.testnet); // Assuming testnet
      const feeRate = (await provider.esplora.getFeeEstimates())['1'] || 2;

      const deployerAccount = mnemonicToAccount({ mnemonic: deployDto.mnemonic, opts: { network: provider.network } });
      const { Signer } = await import('../../../../src/signer'); // Dynamically import Signer or ensure it's at top
      const signer = new Signer({ account: deployerAccount, provider });

      // 2. Process and Broadcast Commit Transaction
      const { Psbt: OylPsbt } = await import('../../../../src/psbt'); // Dynamically import Psbt or ensure it's at top
      const commitPsbt = OylPsbt.fromBase64(deployDto.signedCommitPsbtBase64, { network: provider.network });
      
      const commitTxHex = commitPsbt.extractTransaction(true).toHex();
      const commitTxId = await provider.esplora.broadcastTx(commitTxHex);
      this.logger.log(`Commit Tx broadcasted: ${commitTxId}`);

      // Basic delay for mempool propagation
      await new Promise(resolve => setTimeout(resolve, 5000));

      // 3. Load Wasm
      const wasmFileName = `${deployDto.contractName}.wasm`;
      const wasmFilePath = path.join(process.cwd(), 'wasm', wasmFileName);
      this.logger.log(`Reading Wasm file from: ${wasmFilePath}`);
      let contractWasm: Buffer;
      try {
        contractWasm = await fs.readFile(wasmFilePath);
      } catch (err) {
        this.logger.error(`Failed to read Wasm file at ${wasmFilePath}`, err.stack);
        throw new InternalServerErrorException(`Wasm file not found or unreadable: ${wasmFileName}`);
      }

      // 4. Prepare AlkanesPayload for Reveal
      const revealPayload: AlkanesPayload = {
        body: contractWasm.toString('hex'),
        contentType: 'application/wasm',
      };
      
      // 5. Construct Protostone data for contract initialization
      const { encodeProtostone: encodeProtostoneAlkanes } = await import('../../../../src/alkanes/alkanes');
      const calldata = [
        BigInt('0x' + Buffer.from(deployDto.symbol, 'utf8').toString('hex')),
        BigInt(deployDto.totalSupply),
        BigInt(deployDto.decimals ?? 0), // Use DTO decimals, default to 0
        BigInt('0x' + Buffer.from(deployerAccount.taproot.address, 'ascii').toString('hex')), // Owner
        BigInt('0x' + Buffer.from(deployDto.contractName, 'utf8').toString('hex')), // Contract name in metadata
      ];
      const protostoneBuffer = encodeProtostoneAlkanes({ calldata });

      // 6. Determine script for reveal (from commit output)
      const internalKeyHex = deployerAccount.taproot.pubKeyXOnly;
      const internalKeyBuffer = Buffer.from(internalKeyHex, 'hex');
      
      // Dynamically import p2tr_ord_reveal from alkanes/lib
      const { p2tr_ord_reveal } = await import('alkanes/lib/index'); 
      const inscriptionScript = Buffer.from(
          p2tr_ord_reveal(internalKeyBuffer, [revealPayload])
              .script
      ).toString('hex');

      // 7. Perform the Reveal step
      const { deployReveal: sdkDeployReveal } = await import('../../../../src/alkanes/contract');
      const revealResult = await sdkDeployReveal({
        commitTxId,
        script: inscriptionScript,
        protostone: protostoneBuffer,
        account: deployerAccount,
        provider,
        feeRate,
        signer,
      });

      const contractId = revealResult.txId;
      this.logger.log(`Deployment successful for ${deployDto.contractName}. Reveal TXID: ${contractId}`);
      return {
        success: true,
        commitTxId,
        revealTxId: revealResult.txId,
        contractId: contractId,
        alkaneId: `${revealResult.txId}:0`, // Standard Alkane ID format
      };

    } catch (error) {
      this.logger.error(`Error in deployContract for ${deployDto.contractName}: ${error.message}`, error.stack);
      if (error instanceof HttpException) {
        throw error;
      }
      // Check for specific SDK error types if available and rethrow as HttpException
      let errorMessage = `Failed to deploy contract: ${error.message}`;
      if (error.response && error.response.data) { 
          errorMessage += ` - Details: ${typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data)}`;
      }
      throw new InternalServerErrorException(errorMessage);
    }
  }

  async executeContractMethod(executeDto: ExecuteDto): Promise<any> {
    this.logger.log(`Starting executeContractMethod for contract ${executeDto.contractId}, method ${executeDto.methodName}`);
    try {
      // 1. Initialize SDK components
      const provider = new Provider(bitcoin.networks.testnet); // Assuming testnet
      const feeRate = (await provider.esplora.getFeeEstimates())['1'] || 2;

      const callerAccount = mnemonicToAccount({ mnemonic: executeDto.mnemonic, opts: { network: provider.network } });
      const { Signer } = await import('../../../../src/signer');
      const signer = new Signer({ account: callerAccount, provider });

      // 2. Parse contractId and fetch contract UTXO (alkane UTXO)
      const [contractTxid, contractVoutStr] = executeDto.contractId.split(':');
      const contractVout = parseInt(contractVoutStr, 10);
      if (!contractTxid || isNaN(contractVout)) {
        throw new HttpException('Invalid contractId format. Expected txid:vout.', HttpStatus.BAD_REQUEST);
      }

      const contractUtxoDetails = await provider.esplora.getTxOutput(contractTxid, contractVout);
      if (!contractUtxoDetails) {
        throw new HttpException(`Contract UTXO not found for ${executeDto.contractId}`, HttpStatus.NOT_FOUND);
      }
      const { FormattedUtxo } = await import('../../../../src/utxo'); // Import type if not already at top
      const contractAlkaneUtxo: FormattedUtxo = {
        txId: contractTxid,
        outputIndex: contractVout,
        satoshis: contractUtxoDetails.value,
        scriptPk: contractUtxoDetails.scriptpubkey,
        address: contractUtxoDetails.address,
      };
      
      // 3. Prepare Protostone calldata
      const { encodeProtostone: encodeProtostoneAlkanes, ProtostoneMessage } = await import('../../../../src/alkanes/alkanes');
      let encodedArgs: bigint[] = [];
      try {
        let methodId: bigint;
        if (!isNaN(Number(executeDto.methodName))) {
          methodId = BigInt(executeDto.methodName);
        } else {
          // Simple hash for string method names (example, replace with robust solution if needed)
          methodId = BigInt(executeDto.methodName.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0));
        }
        encodedArgs.push(methodId);

        for (const arg of executeDto.args) {
          if (typeof arg === 'number' || (typeof arg === 'string' && !isNaN(Number(arg)))) {
            encodedArgs.push(BigInt(arg));
          } else if (typeof arg === 'string') {
            encodedArgs.push(BigInt('0x' + Buffer.from(arg, 'utf8').toString('hex')));
          } else {
            throw new Error(`Unsupported argument type: ${typeof arg}`);
          }
        }
      } catch (e: any) {
        throw new HttpException(`Invalid argument format for protostone encoding: ${e.message}`, HttpStatus.BAD_REQUEST);
      }
      
      const protostoneMessage: typeof ProtostoneMessage = { // Use typeof for imported type
          calldata: encodedArgs,
      };
      const protostoneBuffer = encodeProtostoneAlkanes(protostoneMessage);

      // 4. Fetch UTXOs for the caller
      const { getUtxos } = await import('../../../../src/utxo');
      const allUtxos = await getUtxos({ address: callerAccount.taproot.address, provider });
      if (!allUtxos || allUtxos.length === 0) {
        throw new HttpException('No UTXOs found for the caller account to pay fees.', HttpStatus.BAD_REQUEST);
      }
      const spendableUtxos = allUtxos.filter(utxo => !(utxo.txId === contractTxid && utxo.outputIndex === contractVout));
      if (spendableUtxos.length === 0 && contractAlkaneUtxo.address !== callerAccount.taproot.address) {
        throw new HttpException('No spendable UTXOs found for the caller account to pay fees, excluding the contract UTXO itself if not owned.', HttpStatus.BAD_REQUEST);
      }

      // 5. Execute the contract method
      const { execute: sdkExecute } = await import('../../../../src/alkanes/alkanes');
      const executionResult = await sdkExecute({
        alkanesUtxos: [contractAlkaneUtxo],
        utxos: spendableUtxos,
        account: callerAccount,
        protostone: protostoneBuffer,
        provider,
        feeRate,
        signer,
        frontendFee: executeDto.frontendFee ? BigInt(executeDto.frontendFee) : undefined,
        feeAddress: executeDto.feeAddress,
      });

      this.logger.log(`Execution successful for contract ${executeDto.contractId}, method ${executeDto.methodName}. TXID: ${executionResult.txId}`);
      return {
        success: true,
        executionTxId: executionResult.txId,
      };

    } catch (error) {
      this.logger.error(`Error in executeContractMethod for ${executeDto.contractId}: ${error.message}`, error.stack);
      if (error instanceof HttpException) {
        throw error;
      }
      let errorMessage = `Failed to execute contract method: ${error.message}`;
       if (error.response && error.response.data) { 
          errorMessage += ` - Details: ${typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data)}`;
      }
      throw new InternalServerErrorException(errorMessage);
    }
  }
}
