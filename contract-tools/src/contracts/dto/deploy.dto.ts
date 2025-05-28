// src/contracts/dto/deploy.dto.ts
import { IsString, IsNotEmpty, IsNumber, Min, IsOptional, IsInt } from 'class-validator';

export class DeployDto {
  @IsString()
  @IsNotEmpty()
  signedCommitPsbtBase64: string;

  @IsString()
  @IsNotEmpty()
  mnemonic: string;

  @IsString()
  @IsNotEmpty()
  contractName: string; // To identify Wasm file & potentially for metadata

  @IsString()
  @IsNotEmpty()
  symbol: string; // For protostone metadata

  @IsNumber()
  @Min(0) // Total supply can be 0 for some contracts
  totalSupply: number; // For protostone metadata
  
  @IsOptional()
  @IsInt()
  @Min(0)
  decimals?: number; // Optional, for protostone metadata
}
