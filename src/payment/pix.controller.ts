// src/payment/pix.controller.ts
import {
    Controller,
    Post,
    Get,
    Body,
    UseGuards,
    Param,
    ParseIntPipe,
    BadRequestException,
    NotFoundException,
    InternalServerErrorException,
    UnauthorizedException,
    Logger,
    // CORRIGIDO: Importar Put
    Put,
    Patch,
    Req // Importar Req
  } from '@nestjs/common';
  import { AuthGuard } from '@nestjs/passport';
  import { AuthUser } from '../Auth/decorators/auth-user.decorator';
  import { User } from '../models/user/user.model';
  import { EfiPixService } from './efi-pix.service';
  import { Deposit, DepositStatus } from '../models/payment/deposit.model';
  import { Withdrawal, WithdrawalStatus } from '../models/payment/withdrawal.model';
  import { v4 as uuidv4 } from 'uuid';
  // CORRIGIDO: Importar o tipo Request do Express
  import { Request } from 'express';
  
  
  // Removido @UseGuards(AuthGuard('jwt')) do controlador inteiro
  @Controller('pix')
  export class PixController {
       private readonly logger = new Logger(PixController.name);
  
    constructor(
      private readonly efiPixService: EfiPixService,
    ) {}
  
    // --- Endpoints de Configuração ---
  
    /**
     * Endpoint para configurar a URL do webhook na Efí.
     * Requer chave Pix da Efí e a URL pública deste endpoint.
     * NOTE: Proteja este endpoint (ex: apenas ADMINs) em produção!
     */
     // CORRIGIDO: Adicionado Put no decorator e UseGuards para proteger este endpoint
     @UseGuards(AuthGuard('jwt'))
     @Put('webhook/config/:chave')
     // Requer um guarda para restringir acesso (ex: role admin)
     // @UseGuards(RolesGuard(UserRole.ADMIN)) // Exemplo, se você tiver RolesGuard
     async configureWebhook(
         @AuthUser() user: User, // Opcional, para saber quem configurou (ou para RoleGuard)
         @Param('chave') chave: string, // Sua chave Pix Efí para associar o webhook
         @Body('webhookUrl') webhookUrl: string, // A URL pública do seu endpoint /pix/webhook
     ): Promise<void> {
         this.logger.warn(`ATENÇÃO: Configurando Webhook na Efí com x-skip-mtls-checking: true. Verifique a URL e proteja este endpoint em produção.`);
  
         if (!webhookUrl || !webhookUrl.startsWith('https://')) {
              throw new BadRequestException('URL do webhook inválida. Deve ser uma URL HTTPS válida.');
         }
  
         try {
             // Chama o método configureWebhook no service
             await this.efiPixService.configureWebhook(chave, webhookUrl);
             // Status 200 OK ou 204 No Content para sucesso
         } catch (error) {
             const err = error as Error;
              this.logger.error(`Erro no controller ao configurar webhook para chave ${chave}: ${err.message}`, err.stack);
             throw error; // Lança erro do service (BadRequestException, InternalServerErrorException)
         }
     }
  
     // --- Endpoints de Depósito ---
     // CORRIGIDO: Adicionado guarda JWT para este endpoint de usuário
     @UseGuards(AuthGuard('jwt'))
     @Post('deposit/request')
     async requestDeposit(
         @AuthUser() user: User,
         @Body('amount') amount: number,
     ): Promise<{ depositId: number; qrCodeImage?: string; pixCopiaECola?: string; status: DepositStatus; message?: string }> {
         if (typeof amount !== 'number' || amount <= 0) {
         throw new BadRequestException('Valor do depósito inválido. Deve ser um número positivo.');
         }
  
         const amountFormatted = parseFloat(amount.toFixed(2));
          if (amountFormatted <= 0) {
             throw new BadRequestException('Valor do depósito inválido após formatação.');
          }
  
         try {
         const deposit = await this.efiPixService.createDepositCharge(
             user.id,
             amountFormatted,
         );
  
         return {
             depositId: deposit.id,
             qrCodeImage: deposit.qrCodeImage,
             pixCopiaECola: deposit.pixCopiaECola,
             status: deposit.status,
             message: deposit.pixCopiaECola ? 'Depósito solicitado com sucesso. Pague o Pix para creditar o saldo.' : 'Depósito solicitado, mas falha ao gerar dados de pagamento. Consulte o status mais tarde.',
         };
         } catch (error) {
          const err = error as Error;
         this.logger.error(`Erro no controller ao solicitar depósito para userId ${user.id}: ${err.message}`, err.stack);
         throw error;
         }
     }
  
     /**
      * Endpoint para consultar o status ATUAL de um depósito Pix na Efí.
      * Este endpoint consulta a API Efí em tempo real.
      * O status local no DB é atualizado pelo webhook.
      */
     // CORRIGIDO: Adicionado guarda JWT
     @UseGuards(AuthGuard('jwt'))
     @Get('deposit/:depositId/status')
     async getDepositStatus(
         @AuthUser() user: User,
         @Param('depositId', ParseIntPipe) depositId: number,
     ): Promise<{ depositId: number; statusLocal: DepositStatus; statusEfi: string; amount: number; e2eId?: string; message?: string }> {
         try {
             // Buscar o registro local para obter o status local e o txid
             const deposit = await this.efiPixService.getUserDepositById(user.id, depositId);
  
             // Consultar o status ATUAL na Efí usando o método dedicado
             const statusEfiData = await this.efiPixService.checkDepositStatusEfí(depositId);
  
  
             return {
                 depositId: deposit.id,
                 statusLocal: deposit.status, // Status no seu DB (atualizado pelo webhook)
                 statusEfi: statusEfiData.status, // Status atual na Efí
                 amount: parseFloat(Number(deposit.amount).toFixed(2)),
                 e2eId: deposit.e2eId || statusEfiData.e2eId, // Preferir e2eId do DB, fallback para Efí
                 message: `Status local: ${deposit.status}. Status Efí: ${statusEfiData.status}.`,
             };
         } catch (error) {
          const err = error as Error;
          this.logger.error(`Erro no controller ao consultar status do depósito ${depositId} para userId ${user.id}: ${err.message}`, err.stack);
          throw error;
         }
     }
  
      // --- Endpoints de Saque ---
      // CORRIGIDO: Adicionado guarda JWT
      @UseGuards(AuthGuard('jwt'))
      @Post('withdrawal/request')
      async requestWithdrawal(
         @AuthUser() user: User,
         @Body() withdrawalData: { amount: number; pixKey: string; pixKeyType: string; favorecidoName?: string; favorecidoCpfCnpj?: string }
      ): Promise<{ withdrawalId: number; status: WithdrawalStatus; message?: string }> {
  
         const { amount, pixKey, pixKeyType, favorecidoName, favorecidoCpfCnpj } = withdrawalData;
  
         if (typeof amount !== 'number' || amount <= 0) {
             throw new BadRequestException('Valor do saque inválido. Deve ser um número positivo.');
         }
         if (!pixKey || !pixKeyType) {
              throw new BadRequestException('Chave Pix e tipo de chave são obrigatórios.');
         }
          const validPixKeyTypes = ['cpf', 'cnpj', 'email', 'phone', 'evp'];
          if (!validPixKeyTypes.includes(pixKeyType.toLowerCase())) {
               throw new BadRequestException(`Tipo de chave Pix inválido. Tipos permitidos: ${validPixKeyTypes.join(', ')}.`);
          }
  
         const amountFormatted = parseFloat(amount.toFixed(2));
         if (amountFormatted <= 0) {
            throw new BadRequestException('Valor do saque inválido após formatação.');
         }
  
         try {
             const withdrawal = await this.efiPixService.requestWithdrawal(
                 user.id,
                 amountFormatted,
                 pixKey,
                 pixKeyType,
                 favorecidoName,
                 favorecidoCpfCnpj
             );
  
             return {
                 withdrawalId: withdrawal.id,
                 status: withdrawal.status,
                 message: 'Saque solicitado com sucesso. O processamento pode levar alguns minutos.',
             };
  
         } catch (error) {
              const err = error as Error;
              this.logger.error(`Erro no controller ao solicitar saque para userId ${user.id}: ${err.message}`, err.stack);
              throw error;
         }
      }
  
      /**
       * Endpoint para consultar o status ATUAL de um saque Pix na Efí.
       * Este endpoint consulta a API Efí em tempo real.
       * O status local no DB é atualizado pelo webhook.
       */
      // CORRIGIDO: Adicionado guarda JWT
      @UseGuards(AuthGuard('jwt'))
      @Get('withdrawal/:withdrawalId/status')
      async getWithdrawalStatus(
         @AuthUser() user: User,
         @Param('withdrawalId', ParseIntPipe) withdrawalId: number
      ): Promise<{ withdrawalId: number; statusLocal: WithdrawalStatus; statusEfi: string; amount: number; e2eId?: string; message?: string }> {
          try {
             // Buscar o registro local para obter status local e idEnvio
             const withdrawal = await this.efiPixService.getUserWithdrawalById(user.id, withdrawalId);
  
              // Consultar o status ATUAL na Efí usando o método dedicado
             const statusEfiData = await this.efiPixService.checkWithdrawalStatusEfí(withdrawalId);
  
  
             return {
                 withdrawalId: withdrawal.id,
                 statusLocal: withdrawal.status, // Status no seu DB (atualizado pelo webhook)
                 statusEfi: statusEfiData.status, // Status atual na Efí
                 amount: parseFloat(Number(withdrawal.amount).toFixed(2)),
                 e2eId: withdrawal.e2eId || statusEfiData.e2eId, // Preferir e2eId do DB, fallback para Efí
                 message: `Status local: ${withdrawal.status}. Status Efí: ${statusEfiData.status}.`,
             };
          } catch (error) {
               const err = error as Error;
               this.logger.error(`Erro no controller ao consultar status do saque ${withdrawalId} para userId ${user.id}: ${err.message}`, err.stack);
              throw error;
          }
      }
  
  
      // --- Endpoints para Receber Webhook ---
      // Este endpoint NÃO é protegido por JWT, pois a Efí que o chamará.
      // Adicionar @Public() se você removeu o @UseGuards(AuthGuard('jwt')) do controlador inteiro.
      // Se @UseGuards(AuthGuard('jwt')) ESTÁ no controlador inteiro, este endpoint PRECISA ter @Public()
      // se você não quiser JWT nele (que é o caso para webhooks).
      // Importe @Public do seu módulo Auth, se você tiver implementado um decorator @Public().
      // Para simplificar, vamos remover o guarda JWT do controlador inteiro e adicioná-lo APENAS aos endpoints que precisam.
      // REMOVIDO: @UseGuards(AuthGuard('jwt')) do controlador inteiro
  
      /**
       * Endpoint para receber notificações de webhook da Efí.
       * Este endpoint NÃO é protegido por autenticação do seu sistema (como JWT).
       * A validação da origem (mTLS ou skip-mTLS com IP/HMAC) DEVE ser feita aqui no controller ou service.
       * @param payload O corpo JSON da notificação.
       * @param req A requisição Express original (para acessar rawBody).
       * @returns HTTP status 200 para indicar recebimento bem-sucedido (string "200").
       */
       @Post('webhook') // O caminho deve corresponder ao configurado na Efí (/pix/webhook)
       // CORRIGIDO: Usar Request do express como tipo para req
       // ESTE ENDPOINT NÃO DEVE TER GUARDA JWT. Se você usar um guarda global no controller,
       // este endpoint precisará de um decorator para torná-lo público, como @Public() se você tiver um.
       // Como removemos o guarda global, este endpoint já é público.
       async receiveWebhook(@Body() payload: any, @Req() req: Request): Promise<string> {
  
            // --- Validação de Origem (Crucial!) ---
            // Se estiver usando x-skip-mtls-checking: true na configuração do webhook,
            // VOCÊ DEVE validar que a requisição veio da Efí aqui.
            // Opções (implementar uma ou mais):
            // 1. Verificar o IP de origem (`req.ip` ou `req.ips` se atrás de proxy).
            // 2. Validar uma assinatura HMAC (se você configurou uma hash na URL e a Efí a re-envia).
            // 3. (Ideal em Prod) Configurar mTLS no seu servidor e validar o certificado da Efí (não usa skip-mtls-checking).
  
            this.logger.log('!!! WEBHOOK RECEBIDO !!!');
            // Logar o rawBody para depuração e possível validação de assinatura
            // req.rawBody é adicionado pelo middleware em main.ts. Precisamos do cast para any
            this.logger.debug(`Webhook rawBody: ${(req as any).rawBody?.toString()}`); // CORRIGIDO: Cast para any
            this.logger.debug(`Webhook Headers: ${JSON.stringify(req.headers)}`);
            this.logger.debug(`Webhook Body (parsed): ${JSON.stringify(payload)}`);
  
  
            try {
                 // Passar o payload para o serviço processar
                 await this.efiPixService.processWebhookNotification(payload);
  
                 // Retornar status 200 OK para a Efí. Isso indica que você recebeu a notificação.
                 // A documentação da Efí exige que o corpo da resposta seja EXATAMENTE a string "200".
                 return '200';
            } catch (error) {
                 const err = error as Error;
                 this.logger.error(`Erro ao processar webhook: ${err.message}`, err.stack);
                 // Conforme a documentação da Efí, mesmo em caso de erro no processamento,
                 // a Efí espera um 200 OK para não tentar reenviar a notificação indefinidamente.
                 // Os erros internos devem ser tratados e logados do seu lado.
                 return '200'; // Retornar 200 mesmo em caso de erro de processamento, conforme docs Efí.
            }
       }
  
  
      // --- Endpoints de Histórico ---
      // CORRIGIDO: Adicionado guarda JWT onde necessário após removê-lo do controlador inteiro.
      @UseGuards(AuthGuard('jwt'))
      @Get('history/deposits')
      async getDepositHistory(@AuthUser() user: User): Promise<Deposit[]> {
          try {
              return this.efiPixService.getUserDeposits(user.id);
          } catch (error) {
               const err = error as Error;
               this.logger.error(`Erro no controller ao obter histórico de depósitos para userId ${user.id}: ${err.message}`, err.stack);
              throw new InternalServerErrorException('Erro ao obter histórico de depósitos.');
          }
      }
  
      // CORRIGIDO: Adicionado guarda JWT
      @UseGuards(AuthGuard('jwt'))
      @Get('history/withdrawals')
      async getWithdrawalHistory(@AuthUser() user: User): Promise<Withdrawal[]> {
          try {
              return this.efiPixService.getUserWithdrawals(user.id);
          } catch (error) {
              const err = error as Error;
               this.logger.error(`Erro no controller ao obter histórico de saques para userId ${user.id}: ${err.message}`, err.stack);
              throw new InternalServerErrorException('Erro ao obter histórico de saques.');
          }
      }
  
      // CORRIGIDO: Adicionado guarda JWT
      @UseGuards(AuthGuard('jwt'))
      @Get('deposit/:depositId')
      async getDepositDetails(
         @AuthUser() user: User,
         @Param('depositId', ParseIntPipe) depositId: number
      ): Promise<Deposit> {
          try {
              return this.efiPixService.getUserDepositById(user.id, depositId);
          } catch (error) {
              const err = error as Error;
              this.logger.error(`Erro no controller ao obter detalhes do depósito ${depositId} para userId ${user.id}: ${err.message}`, err.stack);
              throw error;
          }
      }
  
      // CORRIGIDO: Adicionado guarda JWT
      @UseGuards(AuthGuard('jwt'))
      @Get('withdrawal/:withdrawalId')
      async getWithdrawalDetails(
         @AuthUser() user: User,
         @Param('withdrawalId', ParseIntPipe) withdrawalId: number
      ): Promise<Withdrawal> {
          try {
              return this.efiPixService.getUserWithdrawalById(user.id, withdrawalId);
          } catch (error) {
              const err = error as Error;
              this.logger.error(`Erro no controller ao obter detalhes do saque ${withdrawalId} para userId ${user.id}: ${err.message}`, err.stack);
              throw error;
          }
      }
  
      // --- ENDPOINT DE TESTE DE SIMULAÇÃO ---
      // CORRIGIDO: Adicionado guarda JWT
      @UseGuards(AuthGuard('jwt'))
      @Patch('deposit/:depositId/simulate-completion-test')
      async simulateDepositCompletionTest(
          @AuthUser() user: User,
          @Param('depositId', ParseIntPipe) depositId: number,
          @Body('e2eId') e2eId?: string
      ): Promise<{ depositId: number; status: DepositStatus; amount: number; simulatedE2eId?: string; message: string }> {
  
          this.logger.warn(`ENDPOINT DE TESTE ATIVADO: Simulando conclusão para Depósito ID ${depositId} para userId ${user.id}.`);
  
          try {
               // Chamar o método de simulação no service
               const updatedDeposit = await this.efiPixService.simulateDepositCompletionTest(depositId, e2eId);
  
               // Verificar se o depósito pertence ao usuário (segurança extra)
               if (updatedDeposit.userId !== user.id) {
                    throw new NotFoundException(`Depósito com ID ${depositId} não encontrado para este usuário.`);
               }
  
               return {
                   depositId: updatedDeposit.id,
                   status: updatedDeposit.status,
                   amount: parseFloat(Number(updatedDeposit.amount).toFixed(2)),
                   simulatedE2eId: updatedDeposit.e2eId,
                   message: `Depósito ID ${depositId} simulado como CONCLUIDO com sucesso. Saldo creditado.`,
               };
  
          } catch (error) {
              const err = error as Error;
              this.logger.error(`Simulate Completion Test: Erro no controller ao tentar simular conclusão para Depósito ID ${depositId} para userId ${user.id}: ${err.message}`, err.stack);
               throw error;
          }
      }
      // --- FIM ENDPOINT DE TESTE ---
  
  
  }