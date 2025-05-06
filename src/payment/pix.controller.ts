// src/payment/pix.controller.ts
import { Controller, Post, Get, Body, Param, ParseIntPipe, Req, UseGuards, HttpCode, HttpStatus, Logger, InternalServerErrorException, Headers } from '@nestjs/common';
import { EfiPixService } from './efi-pix.service';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express'; // Importar Request do express
import { Deposit } from '../models/payment/deposit.model'; // Importar modelos para tipagem de retorno
import { Withdrawal } from '../models/payment/withdrawal.model'; // Importar modelos para tipagem de retorno

// Definir DTOs de requisição (exemplo, criar arquivos separados para eles depois)
// Adicionado '!' para resolver o erro do compilador sobre inicialização
class CreateDepositDto {
    amount!: number; // Indica ao compilador que será atribuído externamente
}

class RequestWithdrawalDto {
    amount!: number; // Indica ao compilador que será atribuído externamente
    pixKeyType!: string; // Indica ao compilador que será atribuído externamente // e.g., 'cpf', 'email', 'phone', 'evp', 'cnpj'
    pixKeyValue!: string; // Indica ao compilador que será atribuído externamente
    // Opcional: nome, cpfCnpj para alguns tipos de chave ou registro
    name?: string;
    cpfCnpj?: string;
}


// Removida a tag ApiTags
@Controller('pix')
export class PixController {
    private readonly logger = new Logger(PixController.name);

    constructor(private readonly efiPixService: EfiPixService) {}

    @UseGuards(AuthGuard('jwt'))
    @Post('deposit')
    // Removidos decoradores Swagger
    @HttpCode(HttpStatus.CREATED) // Usar 201 Created para criação de recurso
    async createDeposit(@Req() req: Request, @Body() createDepositDto: CreateDepositDto): Promise<Deposit> {
        const userId = (req.user as any).id; // Assumindo que o usuário está anexado ao Request
        this.logger.log(`Usuário ${userId} solicitando depósito de R$ ${createDepositDto.amount}...`);
        // Chamar o service para criar a cobrança na Efí e o registro local
        return this.efiPixService.createDepositCharge(userId, createDepositDto.amount);
    }

    @UseGuards(AuthGuard('jwt'))
    @Post('withdrawal')
    // Removidos decoradores Swagger
    @HttpCode(HttpStatus.CREATED) // Usar 201 Created para solicitação que inicia um processo
    async requestWithdrawal(@Req() req: Request, @Body() requestWithdrawalDto: RequestWithdrawalDto): Promise<Withdrawal> {
        const userId = (req.user as any).id;
        this.logger.log(`Usuário ${userId} solicitando saque de R$ ${requestWithdrawalDto.amount} para chave ${requestWithdrawalDto.pixKeyValue} (${requestWithdrawalDto.pixKeyType})...`);
         // Chamar o service para debitar saldo e requisitar saque na Efí
        return this.efiPixService.requestWithdrawal(userId, requestWithdrawalDto.amount, {
            keyType: requestWithdrawalDto.pixKeyType,
            keyValue: requestWithdrawalDto.pixKeyValue,
             name: requestWithdrawalDto.name, // Passar dados adicionais se fornecidos
             cpfCnpj: requestWithdrawalDto.cpfCnpj,
        });
    }

    // Endpoint para o Webhook da Efí
    // Este endpoint NÃO deve usar AuthGuard('jwt') pois é chamado pela Efí.
    // A validação de segurança deve ser feita DENTRO do método do service,
    // usando mTLS (configurado no servidor/proxy) ou validando HMAC/IP (no código).
    // A URL configurada na Efí deve incluir a chave (ex: /pix/webhook/SEGREDO_DO_WEBHOOK)
    // E pode incluir um parâmetro HMAC se usar skip-mTLS (ex: /pix/webhook/SEGREDO_DO_WEBHOOK?hmac=VALOR_HMAC)
    // A Efí adiciona /pix ao final do URL configurado, então a rota final deve ser /pix/webhook/:chave/pix
    @Post('webhook/:webhookSecret/pix') // Ajustar a rota conforme a URL configurada na Efí
    @HttpCode(HttpStatus.OK) // A Efí espera uma resposta 200 OK
    // Removidos decoradores Swagger
    // Se usar skip-mTLS com HMAC na query param, pode adicionar @Query('hmac') hmac: string
    async handleEfiWebhook(@Param('webhookSecret') webhookSecret: string, @Body() efiPayload: any, @Req() req: Request /*, @Headers('X-Gerencianet-Signature') signatureHeader?: string */): Promise<string> {
         // TODO: Implementar validação do webhookSecret aqui ou passar para o service
         // Ex: verificar se webhookSecret é o valor esperado do .env

         // TODO: Obter o rawBody da requisição se for necessário para validação de HMAC.
         // Depende de como o NestJS está configurado para processar raw body (pode precisar de um middleware ou parser customizado).
         // A doc da Efí sobre validação HMAC usa o rawBody. Você provavelmente precisará configurar o NestJS para ter acesso a ele.
         // No main.ts, por exemplo, pode adicionar: app.use(json({ verify: (req, res, buf) => { (req as any).rawBody = buf; } }));
         // const rawBody = (req as any).rawBody; // Exemplo, pode variar
         // const hmac = (req as any).query.hmac; // Exemplo se estiver na query param


        this.logger.log(`Webhook da Efí recebido na rota /pix/webhook/${webhookSecret}/pix`);

        try {
            // Chamar o service para processar o payload.
            // O service lida com transações, crédito/débito de saldo, e atualização de status.
            // Passar o rawBody e/ou hmac/signatureHeader se for usar validação de HMAC/assinatura no service.
            // await this.efiPixService.handleWebhook(efiPayload, rawBody, signatureHeader, hmac); // Exemplo passando tudo
             await this.efiPixService.handleWebhook(efiPayload); // Chamada simplificada por enquanto


            // Sempre retornar 200 OK para a Efí para evitar retentativas excessivas,
            // mesmo que o processamento interno tenha tido um erro (que já foi logado no service).
            return 'OK';
        } catch (error) {
             // Este catch só será alcançado por erros que o service *não* capturou e logou internamente.
             // Erros de validação inicial no controller (antes de chamar o service) também viriam para cá.
             // Em um webhook, é CRUCIAL não lançar exceções HTTP que a Efí não entenda.
             // A Efí espera 200 OK para indicar que você recebeu a notificação.
             // Se houver um erro fatal aqui, logamos e ainda retornamos 200 OK.
             this.logger.error(`Erro FATAL no controlador ao processar webhook da Efí: ${(error as any).message}`, (error as any).stack);
             // Retornar 200 OK mesmo assim, para seguir a especificação da Efí para webhooks.
             return 'OK (Internal Error)'; // Adicionar uma mensagem indicativa no corpo, opcional
        }
    }

    @UseGuards(AuthGuard('jwt'))
    @Get('my/deposits')
    // Removidos decoradores Swagger
    async getUserDeposits(@Req() req: Request): Promise<Deposit[]> {
        const userId = (req.user as any).id;
        this.logger.log(`Buscando depósitos para o usuário ${userId}...`);
        return this.efiPixService.getUserDeposits(userId);
    }

    @UseGuards(AuthGuard('jwt'))
    @Get('my/withdrawals')
    // Removidos decoradores Swagger
    async getUserWithdrawals(@Req() req: Request): Promise<Withdrawal[]> {
        const userId = (req.user as any).id;
        this.logger.log(`Buscando saques para o usuário ${userId}...`);
        return this.efiPixService.getUserWithdrawals(userId);
    }

     @UseGuards(AuthGuard('jwt'))
    @Get('deposit/:id')
    // Removidos decoradores Swagger
    async getDepositDetails(@Param('id', ParseIntPipe) id: number): Promise<Deposit> {
        this.logger.log(`Buscando detalhes do depósito ${id}...`);
        return this.efiPixService.getDepositDetails(id);
    }

    @UseGuards(AuthGuard('jwt'))
    @Get('withdrawal/:id')
    // Removidos decoradores Swagger
    async getWithdrawalDetails(@Param('id', ParseIntPipe) id: number): Promise<Withdrawal> {
        this.logger.log(`Buscando detalhes do saque ${id}...`);
        return this.efiPixService.getWithdrawalDetails(id);
    }

    // TODO: Implementar endpoint para configurar o webhook na Efí (PUT /v2/webhook/:chave)
    // Isso geralmente é feito por um administrador na interface de administração.

}