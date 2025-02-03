import { Controller, Get, Logger, Param, UseGuards,  } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('audit')
export class AuditController {
    private readonly logger = new Logger(AuditController.name);

    constructor(private readonly auditService: AuditService) {}

  @UseGuards(AuthGuard('jwt'))
    @Get('seed/:hash')
    async getGeneratedNumbersByHash(@Param('hash') hash: string) {
      this.logger.log(`Buscando dados de auditoria para o hash ${hash}...`);
      return this.auditService.getGeneratedNumbersByHash(hash);
    }

    @UseGuards(AuthGuard('jwt'))
    @Get('generate/:hash')
    async generateNumbersFromHash(@Param('hash') hash: string) {
          this.logger.log(`Gerando numeros para o hash ${hash}...`);
          return await this.auditService.generateNumbersFromHash(hash);
    }
}