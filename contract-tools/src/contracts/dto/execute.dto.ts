// src/contracts/dto/execute.dto.ts
import { IsString, IsNotEmpty, IsArray, IsOptional, IsNumber, Min } from 'class-validator';
// class-transformer is not strictly needed for basic validation but good practice if transformation is expected
// import { Type } from 'class-transformer'; 

export class ExecuteDto {
  @IsString()
  @IsNotEmpty()
  contractId: string; // Format "txid:vout"

  @IsString()
  @IsNotEmpty()
  methodName: string;

  @IsArray()
  args: any[]; // Array of arguments for the contract method

  @IsString()
  @IsNotEmpty()
  mnemonic: string; // Mnemonic for the account executing the call

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  feeAddress?: string; // Optional address for frontend fees

  @IsOptional()
  @IsNumber()
  @Min(0)
  frontendFee?: number; // Optional frontend fee amount
}
