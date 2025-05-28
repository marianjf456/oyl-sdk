// src/contracts/dto/pre-deploy.dto.ts
import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';

export class PreDeployDto {
  @IsString()
  @IsNotEmpty()
  contractName: string;

  @IsString()
  @IsNotEmpty()
  symbol: string;

  @IsNumber()
  @Min(1)
  totalSupply: number;
}
