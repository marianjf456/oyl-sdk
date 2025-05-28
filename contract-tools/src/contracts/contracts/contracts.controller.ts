// src/contracts/contracts/contracts.controller.ts
import { Controller, Post, Body } from '@nestjs/common'; // Removed UsePipes, ValidationPipe as global pipe is used
import { ContractsService } from './contracts.service';
import { PreDeployDto } from '../dto/pre-deploy.dto';
import { DeployDto } from '../dto/deploy.dto'; // Import DeployDto

@Controller('contracts') // Base path for all routes in this controller
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Post('preDeploy')
  async preDeployContract(@Body() preDeployDto: PreDeployDto) {
    // Basic logging to see if DTO is received correctly
    console.log('Received preDeployDto in controller:', preDeployDto); 
    return this.contractsService.preDeployContract(preDeployDto);
  }

  @Post('deploy')
  async deployContract(@Body() deployDto: DeployDto) {
    console.log('Received deployDto:', deployDto);
    return this.contractsService.deployContract(deployDto);
  }

  @Post('execute')
  async executeContractMethod(@Body() executeDto: ExecuteDto) {
    console.log('Received executeDto:', executeDto);
    return this.contractsService.executeContractMethod(executeDto);
  }
}
