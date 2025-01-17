// src/roulette/dto/create-roulette-bet.dto.ts
import { IsNotEmpty, IsInt, IsEnum, IsOptional, IsPositive, Min, Max, IsIn } from 'class-validator';

export type BetType = 'NUMBER' | 'COLOR' | 'COLUMN' | 'DOZEN' | 'ODD_EVEN';

export class CreateRouletteBetDto {
  @IsNotEmpty()
  @IsEnum(['NUMBER', 'COLOR', 'COLUMN', 'DOZEN', 'ODD_EVEN'])
  betType: BetType;

  @IsNotEmpty()
  @IsPositive()
  betAmount: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(36)
  betNumber?: number; // Válido apenas para apostas do tipo 'NUMBER'

  @IsOptional()
  @IsIn(['RED', 'BLACK'])
  betColor?: string; // Válido apenas para apostas do tipo 'COLOR'

  @IsOptional()
  @IsIn([1, 2, 3])
  betColumn?: number; // Válido apenas para apostas do tipo 'COLUMN'

  @IsOptional()
  @IsIn(['1', '2', '3'])
  betDozen?: string; // Válido apenas para apostas do tipo 'DOZEN'

  @IsOptional()
  @IsIn(['ODD', 'EVEN'])
  betOddEven?: string; // Válido apenas para apostas do tipo 'ODD_EVEN'
    betChoice: unknown;
}