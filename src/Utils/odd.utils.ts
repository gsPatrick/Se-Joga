// src/utils/odd.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class OddUtils  {
  // Método temporário para retornar multiplicadores fixos
  // TODO: Substituir pela lógica real de cálculo de ODDs quando a fórmula for fornecida
  getMultiplier(betType: string): number {
    switch (betType) {
      case 'NUMBER':
        return 35; // Pagamento padrão para aposta em número único
      case 'COLOR':
        return 2; // Pagamento provisório para aposta em cor
      case 'COLUMN':
        return 3; // Pagamento provisório para aposta em coluna
      case 'DOZEN':
        return 3; // Pagamento para aposta em dúzia
      case 'ODD_EVEN':
        return 2; // Pagamento para aposta em par/ímpar
      default:
        return 0; // Retorna 0 para tipos de aposta inválidos
    }
  }
}