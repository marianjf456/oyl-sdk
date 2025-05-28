import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ContractsModule } from './contracts/contracts.module';

@Module({
  imports: [ContractsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
