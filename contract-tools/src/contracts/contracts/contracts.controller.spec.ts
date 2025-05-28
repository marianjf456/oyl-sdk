// src/contracts/contracts/contracts.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { PreDeployDto } from '../dto/pre-deploy.dto';
import { DeployDto } from '../dto/deploy.dto';
import { ExecuteDto } from '../dto/execute.dto';
import { Logger } from '@nestjs/common'; // Import Logger

// Mock ContractsService
// We define the methods that ContractsController will call.
const mockContractsService = {
  preDeployContract: jest.fn(),
  deployContract: jest.fn(),
  executeContractMethod: jest.fn(),
};

describe('ContractsController', () => {
  let controller: ContractsController;
  let service: ContractsService; // To access the mocked service methods

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContractsController],
      providers: [
        {
          provide: ContractsService,
          useValue: mockContractsService, // Use the mock implementation
        },
        // Logger is often provided by NestJS automatically, but if you use it directly in controller, mock it too.
        // Controller constructor doesn't show direct Logger injection, so it's fine.
      ],
    }).compile();

    controller = module.get<ContractsController>(ContractsController);
    service = module.get<ContractsService>(ContractsService); // Get the mocked instance

    // Reset mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('preDeployContract', () => {
    it('should call service.preDeployContract and return its result', async () => {
      const dto = new PreDeployDto();
      dto.contractName = 'TestPreDeploy';
      dto.symbol = 'TPD';
      dto.totalSupply = 100;
      
      const expectedResult = { psbt: 'mock_psbt', mnemonic: 'mock_mnemonic' };
      (mockContractsService.preDeployContract as jest.Mock).mockResolvedValue(expectedResult);

      const result = await controller.preDeployContract(dto);
      
      expect(result).toBe(expectedResult);
      expect(mockContractsService.preDeployContract).toHaveBeenCalledWith(dto);
      expect(mockContractsService.preDeployContract).toHaveBeenCalledTimes(1);
    });
  });

  describe('deployContract', () => {
    it('should call service.deployContract and return its result', async () => {
      const dto = new DeployDto();
      dto.signedCommitPsbtBase64 = 'mock_signed_psbt';
      dto.mnemonic = 'mock_mnemonic_deploy';
      dto.contractName = 'TestDeploy';
      dto.symbol = 'TDC';
      dto.totalSupply = 1000;
      dto.decimals = 0;

      const expectedResult = { success: true, commitTxId: 'c_txid', revealTxId: 'r_txid' };
      (mockContractsService.deployContract as jest.Mock).mockResolvedValue(expectedResult);

      const result = await controller.deployContract(dto);

      expect(result).toBe(expectedResult);
      expect(mockContractsService.deployContract).toHaveBeenCalledWith(dto);
      expect(mockContractsService.deployContract).toHaveBeenCalledTimes(1);
    });
  });

  describe('executeContractMethod', () => {
    it('should call service.executeContractMethod and return its result', async () => {
      const dto = new ExecuteDto();
      dto.contractId = 'contract_id_execute';
      dto.methodName = 'executeMethod';
      dto.args = ['arg1', 123];
      dto.mnemonic = 'mock_mnemonic_execute';

      const expectedResult = { success: true, executionTxId: 'exec_txid' };
      (mockContractsService.executeContractMethod as jest.Mock).mockResolvedValue(expectedResult);
      
      const result = await controller.executeContractMethod(dto);

      expect(result).toBe(expectedResult);
      expect(mockContractsService.executeContractMethod).toHaveBeenCalledWith(dto);
      expect(mockContractsService.executeContractMethod).toHaveBeenCalledTimes(1);
    });
  });
});
