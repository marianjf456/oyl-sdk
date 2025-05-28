import { Module } from '@nestjs/common';
import { ContractsController } from './contracts/contracts.controller';
import { ContractsService } from './contracts/contracts.service';

@Module({
  controllers: [ContractsController],
  providers: [ContractsService]
})
export class ContractsModule {}
