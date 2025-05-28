// src/contracts/contracts/contracts.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ContractsService } from './contracts.service';
import { Provider } from '../../../../src/provider'; // Adjust path to oylsdk
import { generateMnemonic, mnemonicToAccount, Account } from '../../../../src/account';
import { 
    actualDeployCommitFee, 
    actualDeployRevealFee,
    deployReveal as sdkDeployReveal // aliased in service
} from '../../../../src/alkanes/contract';
import { 
    createDeployCommitPsbt,
    AlkanesPayload,
    encodeProtostone,
    ProtostoneMessage, // Type for protostone message
    execute as sdkExecute // aliased in service
} from '../../../../src/alkanes/alkanes';
import { FormattedUtxo, getUtxos } from '../../../../src/utxo';
import { getEstimatedFee, Psbt as OylPsbt } from '../../../../src/psbt'; // Renamed to OylPsbt to avoid conflict with bitcoinjs-lib Psbt if used directly
import { Signer } from '../../../../src/signer';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as bitcoin from 'bitcoinjs-lib'; // Used by service
import { InternalServerErrorException, HttpException, HttpStatus } from '@nestjs/common';
import { PreDeployDto } from '../dto/pre-deploy.dto';
import { DeployDto } from '../dto/deploy.dto';
import { ExecuteDto } from '../dto/execute.dto';

// Mock oylsdk modules and other dependencies
jest.mock('fs/promises');

jest.mock('../../../../src/account', () => ({
  generateMnemonic: jest.fn(),
  mnemonicToAccount: jest.fn(),
}));

jest.mock('../../../../src/provider', () => ({
  Provider: jest.fn().mockImplementation(() => ({
    esplora: {
      getFeeEstimates: jest.fn().mockResolvedValue({ '1': 2 }),
      broadcastTx: jest.fn(),
      getTxOutput: jest.fn(),
    },
    getUtxos: jest.fn(), // Mock for getUtxos if directly on provider
  })),
}));

// Mocking specific functions from alkanes/contract and alkanes/alkanes
jest.mock('../../../../src/alkanes/contract', () => ({
  actualDeployCommitFee: jest.fn(),
  actualDeployRevealFee: jest.fn(),
  deployReveal: jest.fn(), // This is sdkDeployReveal in the service due to dynamic import
}));

jest.mock('../../../../src/alkanes/alkanes', () => ({
  createDeployCommitPsbt: jest.fn(),
  encodeProtostone: jest.fn(),
  execute: jest.fn(), // This is sdkExecute in the service
  // Other exports if any used by service directly that are not functions
  AlkanesPayload: jest.fn(), // if it's a class used with new
  ProtostoneMessage: jest.fn(), // if it's a class used with new
}));


jest.mock('../../../../src/psbt', () => ({
  getEstimatedFee: jest.fn(),
  Psbt: { // Mocking the Psbt class (assuming fromBase64 and extractTransaction are static or instance methods)
    fromBase64: jest.fn().mockReturnThis(), // Return this for chaining if methods are on instance
    extractTransaction: jest.fn().mockReturnValue({ toHex: jest.fn() }),
  },
}));

jest.mock('../../../../src/signer', () => ({
  Signer: jest.fn().mockImplementation(() => ({
    // Mock Signer instance methods if any are called by the service
  })),
}));

// Mock for dynamic import of 'alkanes/lib/index' for p2tr_ord_reveal
// This is a common way to mock dynamic imports.
jest.mock('alkanes/lib/index', () => ({
  __esModule: true, // This is important for ES modules
  p2tr_ord_reveal: jest.fn().mockReturnValue({ script: Buffer.from('mock_inscription_script') }),
}), { virtual: true }); // virtual true can help with non-existent paths if only types are imported by service


describe('ContractsService', () => {
  let service: ContractsService;
  let mockProvider: Provider; // To access provider's mocked methods

  // Mock data
  const mockMnemonicValue = 'mock test mnemonic words';
  const mockAccountValue: Account = { 
    taproot: { address: 'mock_taproot_address', pubKeyXOnly: 'mockpubkeyxonlyhex', pubkey: 'mocktaprootpubkey' },
    nativeSegwit: { address: 'mock_nativesegwit_address', pubkey: 'mocknativesegwitpubkey' },
    nestedSegwit: { address: 'mock_nestedsegwit_address', pubkey: 'mocknestedsegwitpubkey' },
    legacy: { address: 'mock_legacy_address', pubkey: 'mocklegacypubkey' },
    spendStrategy: { addressOrder: ['taproot'], utxoSortGreatestToLeast: true, changeAddress: 'taproot'},
    network: bitcoin.networks.testnet,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractsService,
        // Provider is mocked via jest.mock at the top, so NestJS will use the mock
        // No need to provide it here unless you want to override the mock for specific tests
      ],
    }).compile();

    service = module.get<ContractsService>(ContractsService);
    
    // Setup mock return values for each test
    (generateMnemonic as jest.Mock).mockReturnValue(mockMnemonicValue);
    (mnemonicToAccount as jest.Mock).mockReturnValue(mockAccountValue);
    
    // Access the mocked provider instance for more specific method mocking if needed
    // This relies on the Provider mock being a singleton or the same instance being used.
    // For class mocks, each `new Provider()` would be a new mock instance.
    // If Provider methods need to be configured per test, this setup might need adjustment
    // or direct use of the jest.fn() mocks from the top-level mocks.
    // For instance:
    // mockProvider = module.get(Provider); // This line might not work as expected with jest.mock() for classes.
    // Instead, directly use the imported mock functions or the mockResolvedValue on Provider constructor's methods.

    // Reset and re-configure mocks that return promises for each test
    (fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('00asm_mock_wasm_content'));
    (actualDeployCommitFee as jest.Mock).mockResolvedValue({ fee: 1000, vsize: 100 });
    (getEstimatedFee as jest.Mock).mockResolvedValue({ fee: 500, vsize: 50 }); // For simplifiedRevealFee
    (createDeployCommitPsbt as jest.Mock).mockResolvedValue({ psbt: 'mock_psbt_base64_string' });

    // For deployContract
    const mockCommitPsbtInstance = { extractTransaction: jest.fn().mockReturnValue({ toHex: jest.fn().mockReturnValue('mock_commit_tx_hex') }) };
    (OylPsbt.fromBase64 as jest.Mock).mockReturnValue(mockCommitPsbtInstance);
    
    // Provider methods that return promises
    // Ensure these are from the correct mock instance if Provider is instantiated multiple times
    // or use jest.requireMock if you need to access the mock from within the test
    const providerMockInstance = (Provider as jest.Mock).getMockImplementation()();
    providerMockInstance.esplora.broadcastTx.mockResolvedValue('mock_commit_tx_id');
    providerMockInstance.esplora.getTxOutput.mockResolvedValue({ value: 1000, scriptpubkey: 'mock_script_pub_key', address: 'mock_contract_utxo_address' });
    providerMockInstance.esplora.getFeeEstimates.mockResolvedValue({ '1': 2 });
    providerMockInstance.getUtxos.mockResolvedValue([{ txId: 'utxo1', outputIndex: 0, satoshis: 50000, scriptPk: 'scriptpk', address: 'addr1' }]);


    (sdkDeployReveal as jest.Mock).mockResolvedValue({ txId: 'mock_reveal_tx_id' });
    (encodeProtostone as jest.Mock).mockReturnValue(Buffer.from('mock_protostone_buffer'));
    (sdkExecute as jest.Mock).mockResolvedValue({ txId: 'mock_execution_tx_id' });

  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // Tests for preDeployContract
  describe('preDeployContract', () => {
    const preDeployDto: PreDeployDto = {
      contractName: 'TestContract',
      symbol: 'TST',
      totalSupply: 1000,
    };

    it('should successfully pre-deploy a contract', async () => {
      const result = await service.preDeployContract(preDeployDto);
      expect(result).toHaveProperty('psbt', 'mock_psbt_base64_string');
      expect(result).toHaveProperty('mnemonic', mockMnemonicValue);
      expect(result).toHaveProperty('estimatedCommitFee', 1000);
      expect(result).toHaveProperty('estimatedRevealFee', 500);
      expect(result).toHaveProperty('totalEstimatedFee', 1500);
      expect(result).toHaveProperty('recipientAddress', mockAccountValue.taproot.address);

      expect(generateMnemonic).toHaveBeenCalledTimes(1);
      expect(mnemonicToAccount).toHaveBeenCalledWith({ mnemonic: mockMnemonicValue, opts: { network: bitcoin.networks.testnet } });
      expect(fs.readFile).toHaveBeenCalledWith(path.join(process.cwd(), 'wasm', 'placeholder_contract_1.wasm'));
      expect(actualDeployCommitFee).toHaveBeenCalled();
      expect(getEstimatedFee).toHaveBeenCalled(); // For simplifiedRevealFee
      expect(createDeployCommitPsbt).toHaveBeenCalled();
    });

    it('should throw InternalServerErrorException if Wasm file not found', async () => {
      (fs.readFile as jest.Mock).mockRejectedValueOnce(new Error('File not found'));
      await expect(service.preDeployContract(preDeployDto)).rejects.toThrow(InternalServerErrorException);
      await expect(service.preDeployContract(preDeployDto)).rejects.toThrow('Wasm file not found or unreadable: placeholder_contract_1.wasm');
    });
    
    it('should throw InternalServerErrorException if actualDeployCommitFee fails', async () => {
        (actualDeployCommitFee as jest.Mock).mockRejectedValueOnce(new Error('Commit fee error'));
        await expect(service.preDeployContract(preDeployDto)).rejects.toThrow(InternalServerErrorException);
        await expect(service.preDeployContract(preDeployDto)).rejects.toThrow('Failed to pre-deploy contract: Commit fee error');
    });
  });

  describe('deployContract', () => {
    const deployDto: DeployDto = {
      signedCommitPsbtBase64: 'mock_signed_psbt_base64',
      mnemonic: mockMnemonicValue,
      contractName: 'TestDeployContract',
      symbol: 'TDC',
      totalSupply: 2000,
      decimals: 2,
    };

    it('should successfully deploy a contract', async () => {
      const result = await service.deployContract(deployDto);
      expect(result).toEqual({
        success: true,
        commitTxId: 'mock_commit_tx_id',
        revealTxId: 'mock_reveal_tx_id',
        contractId: 'mock_reveal_tx_id',
        alkaneId: 'mock_reveal_tx_id:0',
      });

      expect(OylPsbt.fromBase64).toHaveBeenCalledWith(deployDto.signedCommitPsbtBase64, { network: bitcoin.networks.testnet });
      // Check if the mock instance's method was called. This requires OylPsbt.fromBase64 to return the mockCommitPsbtInstance.
      const providerMockInstance = (Provider as jest.Mock).getMockImplementation()();
      expect(providerMockInstance.esplora.broadcastTx).toHaveBeenCalledWith('mock_commit_tx_hex');
      expect(fs.readFile).toHaveBeenCalledWith(path.join(process.cwd(), 'wasm', `${deployDto.contractName}.wasm`));
      expect(encodeProtostone).toHaveBeenCalled();
      expect(sdkDeployReveal).toHaveBeenCalled(); // This is the aliased deployReveal from contract.ts
      // Verify p2tr_ord_reveal from 'alkanes/lib/index' was called by the service logic (if not deeply mocked)
      const alkanesLib = await import('alkanes/lib/index'); // Need to import to check mock on its method
      expect(alkanesLib.p2tr_ord_reveal).toHaveBeenCalled();
    });

    it('should throw InternalServerErrorException if Wasm file not found for deploy', async () => {
      (fs.readFile as jest.Mock).mockRejectedValueOnce(new Error('File not found for deploy'));
      await expect(service.deployContract(deployDto)).rejects.toThrow(InternalServerErrorException);
      await expect(service.deployContract(deployDto)).rejects.toThrow(`Wasm file not found or unreadable: ${deployDto.contractName}.wasm`);
    });

    it('should throw InternalServerErrorException if commit broadcast fails', async () => {
      const providerMockInstance = (Provider as jest.Mock).getMockImplementation()();
      providerMockInstance.esplora.broadcastTx.mockRejectedValueOnce(new Error('Broadcast failed'));
      await expect(service.deployContract(deployDto)).rejects.toThrow(InternalServerErrorException);
      await expect(service.deployContract(deployDto)).rejects.toThrow('Failed to deploy contract: Broadcast failed');
    });
    
    it('should throw InternalServerErrorException if sdkDeployReveal fails', async () => {
        (sdkDeployReveal as jest.Mock).mockRejectedValueOnce(new Error('Reveal failed'));
        await expect(service.deployContract(deployDto)).rejects.toThrow(InternalServerErrorException);
        await expect(service.deployContract(deployDto)).rejects.toThrow('Failed to deploy contract: Reveal failed');
    });
  });

  describe('executeContractMethod', () => {
    const executeDto: ExecuteDto = {
      contractId: 'mock_tx_id:0',
      methodName: 'testMethod',
      args: ['arg1', 123],
      mnemonic: mockMnemonicValue,
    };

    it('should successfully execute a contract method', async () => {
      const result = await service.executeContractMethod(executeDto);
      expect(result).toEqual({
        success: true,
        executionTxId: 'mock_execution_tx_id',
      });

      const providerMockInstance = (Provider as jest.Mock).getMockImplementation()();
      expect(providerMockInstance.esplora.getTxOutput).toHaveBeenCalledWith('mock_tx_id', 0);
      expect(providerMockInstance.getUtxos).toHaveBeenCalledWith({ address: mockAccountValue.taproot.address, provider: providerMockInstance });
      expect(encodeProtostone).toHaveBeenCalled();
      expect(sdkExecute).toHaveBeenCalled();
    });

    it('should throw HttpException if contractId is invalid', async () => {
      await expect(service.executeContractMethod({ ...executeDto, contractId: 'invalid_id' })).rejects.toThrow(HttpException);
      await expect(service.executeContractMethod({ ...executeDto, contractId: 'invalid_id' })).rejects.toThrow('Invalid contractId format. Expected txid:vout.');
    });

    it('should throw HttpException if contract UTXO not found', async () => {
      const providerMockInstance = (Provider as jest.Mock).getMockImplementation()();
      providerMockInstance.esplora.getTxOutput.mockResolvedValueOnce(null);
      await expect(service.executeContractMethod(executeDto)).rejects.toThrow(HttpException);
      await expect(service.executeContractMethod(executeDto)).rejects.toThrow(`Contract UTXO not found for ${executeDto.contractId}`);
    });
    
    it('should throw HttpException if an argument cannot be encoded to BigInt', async () => {
        const invalidArgsDto: ExecuteDto = { ...executeDto, args: [{ an: 'object' }]};
        await expect(service.executeContractMethod(invalidArgsDto)).rejects.toThrow(HttpException);
        await expect(service.executeContractMethod(invalidArgsDto)).rejects.toThrow('Invalid argument format for protostone encoding: Unsupported argument type: object');
    });

    it('should throw HttpException if no UTXOs found for caller', async () => {
      const providerMockInstance = (Provider as jest.Mock).getMockImplementation()();
      providerMockInstance.getUtxos.mockResolvedValueOnce([]);
      await expect(service.executeContractMethod(executeDto)).rejects.toThrow(HttpException);
      await expect(service.executeContractMethod(executeDto)).rejects.toThrow('No UTXOs found for the caller account to pay fees.');
    });
    
    it('should throw InternalServerErrorException if sdkExecute fails', async () => {
        (sdkExecute as jest.Mock).mockRejectedValueOnce(new Error('Execute failed'));
        await expect(service.executeContractMethod(executeDto)).rejects.toThrow(InternalServerErrorException);
        await expect(service.executeContractMethod(executeDto)).rejects.toThrow('Failed to execute contract method: Execute failed');
    });
  });
});
