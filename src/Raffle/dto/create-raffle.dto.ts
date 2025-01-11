import { IsNotEmpty, IsString, IsNumber, IsPositive, IsDate, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateRaffleDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  ticketPrice: number;

  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  totalTickets: number;

  @IsNotEmpty()
  @IsDate()
  @Type(() => Date)
  startDate: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  endDate?: Date;

  @IsNotEmpty()
  @IsDate()
  @Type(() => Date)
  drawDate: Date;
}