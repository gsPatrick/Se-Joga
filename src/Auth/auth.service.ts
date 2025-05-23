// src/auth/auth.service.ts
import { Injectable, BadRequestException, UnauthorizedException, NotFoundException, Logger } from '@nestjs/common'; // Importar Logger
import { InjectModel } from '@nestjs/sequelize';
import { User, UserRole } from '../models/user/user.model';
import * as bcrypt from 'bcrypt';
import { Op, Transaction, Sequelize } from 'sequelize'; // Importar Op, Transaction, Sequelize
import { JwtService } from '@nestjs/jwt';
import { v4 as uuidv4 } from 'uuid'; // Importar uuidv4

// Importar modelos de jogos para checar atividade
import { RaffleTicket } from 'src/models/raffle/raffle-ticket.model';
import { RouletteBet } from 'src/models/roulette/roulette-bet.model';
import { SlotMachineBet } from 'src/models/slot-machine/slot-machine-bet.model';
import { BingoCard } from 'src/models/bingo/bingo-card.model';
import { DiceBet } from 'src/models/dice/dice-bet.model';
import { Bet } from 'src/models/bet/bet.model';
import { PokerBet } from 'src/models/poker/poker-bet.model';


//import { MailService } from '../mail/mail.service'; // Assuming you have a MailService - REMOVED

@Injectable()
export class AuthService {
  private readonly resetPasswordTokens: Map<string, { userId: number; expiry: Date }> = new Map();
   private readonly logger = new Logger(AuthService.name); // Adicionar logger


  constructor(
    @InjectModel(User)
    private userModel: typeof User,
    private jwtService: JwtService,
    // Injetar modelos de jogos
    @InjectModel(RaffleTicket) private raffleTicketModel: typeof RaffleTicket,
    @InjectModel(RouletteBet) private rouletteBetModel: typeof RouletteBet,
    @InjectModel(SlotMachineBet) private slotMachineBetModel: typeof SlotMachineBet,
    @InjectModel(BingoCard) private bingoCardModel: typeof BingoCard,
    @InjectModel(DiceBet) private diceBetModel: typeof DiceBet,
    @InjectModel(Bet) private betModel: typeof Bet,
    @InjectModel(PokerBet) private pokerBetModel: typeof PokerBet,
    //private mailService: MailService // Inject MailService - REMOVED
  ) {}

  async signUp(userData: Partial<User>, makeAdmin: boolean = false): Promise<Omit<User, 'password'>> {
    const { name, email, cpf, phone, password, balance, referralCode: referringCode } = userData;

    if (!name || !email || !cpf || !phone || !password) {
      throw new BadRequestException('Nome, email, CPF, telefone e senha são obrigatórios.');
    }

    const existingUser = await this.userModel.findOne({
      where: {
        [Op.or]: [{ email }, { cpf }],
      },
    });

    if (existingUser) {
      throw new BadRequestException('Usuário já existe com este e-mail ou CPF.');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    let referrerId: number | undefined;
    if (referringCode) {
        this.logger.debug(`Código de indicação recebido: ${referringCode}`);
        const referrer = await this.userModel.findOne({ where: { referralCode: referringCode } });
        if (referrer) {
            referrerId = referrer.id;
            this.logger.log(`Usuário será indicado por User ID: ${referrerId}`);
        } else {
            this.logger.warn(`Código de indicação inválido recebido: ${referringCode}. Ignorando indicação.`);
            // Poderia lançar BadRequestException se o código de indicação for obrigatório ou inválido
        }
    }

    let newUserReferralCode: string = '';
    let isCodeUnique = false;
    while (!isCodeUnique) {
        newUserReferralCode = uuidv4().substring(0, 8).toUpperCase();
        const existingCodeUser = await this.userModel.findOne({ where: { referralCode: newUserReferralCode } });
        isCodeUnique = !existingCodeUser;
         if (!isCodeUnique) {
             this.logger.debug(`Código de indicação gerado '${newUserReferralCode}' já existe. Tentando novamente.`);
         } else {
             this.logger.debug(`Código de indicação gerado e único: ${newUserReferralCode}`);
         }
    }

    const newUser = await this.userModel.create({
      name,
      email,
      cpf,
      phone,
      password: hashedPassword,
      role: makeAdmin ? UserRole.ADMIN : UserRole.USER, // <<-- Define a role aqui
      balance: balance || 0,
      referralCode: newUserReferralCode,
      referrerId: referrerId,
    });

    this.logger.log(`Novo usuário (${newUser.role}) criado com ID ${newUser.id}, código de indicação '${newUserReferralCode}' e referrerId ${referrerId}`);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _, ...result } = newUser.get({ plain: true });
    return result;
  }

  async signIn(email: string, pass: string): Promise<{ access_token: string }> { // Modifique a tipagem
    const user = await this.userModel.findOne({ where: { email } });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const isMatch = await bcrypt.compare(pass, user.password);

    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    // Gerar o token JWT
    const payload = { sub: user.id, email: user.email }; // Defina o payload do token (sub é o ID do usuário, por convenção)
    return {
      access_token: this.jwtService.sign(payload), // Retorna um objeto com o token
    };
  }

  async updateUserBalance(userId: number, amount: number, transaction?: Transaction): Promise<User> { // Aceitar transaction opcional
    const user = await this.userModel.findByPk(userId, { transaction }); // Passar transaction

    if (!user) {
      // Não lançar NotFoundException se estiver em uma transação e o erro puder ser tratado externamente
       // Se não houver transação, lançamos. Se houver, lançamos um erro genérico para o caller tratar o rollback.
       if (!transaction) throw new NotFoundException('Usuário não encontrado.');
       this.logger.warn(`updateUserBalance chamado para userId ${userId} em transação, mas usuário não encontrado.`);
       // Em um cenário transacional, falhar explicitamente pode ser melhor para garantir o rollback
       // Lançar um erro que pode ser identificado no catch do caller, mas que não é uma exceção HTTP
       const error = new Error(`Usuário ${userId} não encontrado durante operação de saldo em transação.`);
       (error as any).isHandled = true; // Adiciona uma flag para indicar que é um erro esperado dentro da lógica
       throw error;
    }

    // A validação de saldo insuficiente deve ocorrer antes de chamar esta função com o valor final,
    // mas um check defensivo ainda é bom.
    const newBalance = Number(user.balance) + Number(amount);
    if (newBalance < 0) {
        this.logger.error(`Saldo insuficiente para userId ${userId}. Tentativa de subtrair ${amount}, saldo atual ${user.balance}`);
        if (!transaction) throw new BadRequestException('Saldo insuficiente.');
        // Se estiver em transação, lançar um erro genérico ou específico para que o caller dê rollback
        const error = new Error('Insufficient balance during transaction');
        (error as any).isHandled = true; // Adiciona uma flag
        throw error;
    }

    // Usar increment/decrement dentro da transação
     const updatedUser = amount > 0
         ? await user.increment('balance', { by: amount, transaction })
         : await user.decrement('balance', { by: Math.abs(amount), transaction }); // Decrementa com valor absoluto


    // Recarregar o usuário para obter o saldo atualizado
    await updatedUser.reload({ transaction });

    this.logger.log(`Saldo do usuário ${userId} atualizado em ${amount}. Novo saldo: ${updatedUser.balance}`);

    return updatedUser;
  }


  async findAllUsers(): Promise<User[]> {
    return this.userModel.findAll({
         attributes: { exclude: ['password'] }, // Exclui a senha do retorno
          include: [
               { model: User, as: 'referrer', attributes: ['id', 'name'] }, // Inclui o indicador
               { model: User, as: 'referredUsers', attributes: ['id', 'name'] } // Inclui os indicados (pode ser grande)
          ]
      });
  }

  async findCurrentUser(userId: number): Promise<User> {
    const user = await this.userModel.findByPk(userId, {
      attributes: { exclude: ['password'] }, // Exclui a senha do retorno
       include: [
           { model: User, as: 'referrer', attributes: ['id', 'name'] }, // Inclui o indicador
           // Não incluir 'referredUsers' aqui para evitar carregar muitos dados no perfil
       ]
    });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }
    return user;
  }

  async updateUser(userId: number, userData: Partial<User>): Promise<User> {
    const user = await this.userModel.findByPk(userId);
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    // Impedir a atualização de senha, balance e referralCode por essa rota
    if (userData.password) {
        throw new BadRequestException('A senha não pode ser atualizada por esta rota.');
    }
    if (userData.balance !== undefined) {
        throw new BadRequestException('O saldo não pode ser atualizado por esta rota.');
    }
     if (userData.referralCode !== undefined) {
         throw new BadRequestException('O código de indicação não pode ser atualizado por esta rota.');
     }
      if (userData.referrerId !== undefined) {
         throw new BadRequestException('O indicador não pode ser atualizado por esta rota.');
     }


    await user.update(userData);
    // Recarregar para garantir que os dados retornados estejam consistentes, excluindo a senha novamente
    await user.reload({ attributes: { exclude: ['password'] } });
    return user;
  }

  async updateBalance(userId: number, amount: number): Promise<User> {
    // Este endpoint específico para updateBalance não usa transação por padrão,
    // mas a função interna `updateUserBalance` pode.
    // Para evitar problemas de concorrência se múltiplos pedidos chegarem rápido,
    // é melhor usar a função transacional.
     // Vamos criar uma nova transação apenas para esta operação, ou refatorar o controller
     // para usar o updateUserBalance transacional se for parte de uma operação maior.
     // Por enquanto, manter a lógica simples, mas ciente da limitação de concorrência sem transaction.
     const user = await this.userModel.findByPk(userId);
     if (!user) {
         throw new NotFoundException('Usuário não encontrado.');
     }

     const newBalance = Number(user.balance) + Number(amount);

     if (newBalance < 0) {
         throw new BadRequestException('Saldo insuficiente.');
     }

     user.balance = newBalance;
     await user.save(); // save() também pode ter problemas de concorrência se não for transacional

     // Alternativa mais robusta (exigiria refatoração ou nova transação):
     // return this.updateUserBalance(userId, amount); // Chamaria a versão interna com nova transação

     return user; // Retorna o usuário atualizado (pode não ter o saldo mais fresco em alta concorrência)
  }


  async logout(): Promise<void> {
    // Invalidate JWT (client-side usually handles this by removing the token)
    // There's no server-side session management, so this function is mostly for placeholder/future use.
    return;
  }


  async forgotPassword(email: string): Promise<string> { //Changed return type to string (the token)
    const user = await this.userModel.findOne({ where: { email } });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const resetToken = uuidv4();
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 1); // Token expires in 1 hour

    this.resetPasswordTokens.set(resetToken, { userId: user.id, expiry });


    // Send email with reset link - REMOVED
    //const resetLink = `http://your-frontend-url/reset-password?token=${resetToken}`; // Replace with your frontend URL
    //await this.mailService.sendPasswordResetEmail(user.email, resetLink); // Adapt this to your MailService method

    return resetToken; // Return the reset token to the controller. The controller is now responsible for sending it to the Frontend.
  }


  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenData = this.resetPasswordTokens.get(token);

    if (!tokenData) {
      throw new BadRequestException('Token inválido.');
    }

    if (tokenData.expiry < new Date()) {
      this.resetPasswordTokens.delete(token); // Remove expired token
      throw new BadRequestException('Token expirado.');
    }

    const user = await this.userModel.findByPk(tokenData.userId);

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }


    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();


    this.resetPasswordTokens.delete(token); // Remove the token after use
  }

  // --- Métodos para o sistema de indicação ---

  async findUserByReferralCode(referralCode: string): Promise<User | null> {
       if (!referralCode) return null;
       this.logger.debug(`Buscando usuário pelo código de indicação: ${referralCode}`);
       const user = await this.userModel.findOne({ where: { referralCode } });
       if (user) {
           this.logger.debug(`Usuário encontrado para o código ${referralCode}: ID ${user.id}`);
       } else {
           this.logger.debug(`Nenhum usuário encontrado para o código ${referralCode}.`);
       }
       return user;
   }

  async getReferralData(userId: number): Promise<any> {
      const user = await this.userModel.findByPk(userId, {
          attributes: ['id', 'name', 'referralCode'], // Dados básicos do usuário + código
           // Incluir os usuários indicados
          include: [
              {
                  model: User,
                  as: 'referredUsers',
                  attributes: ['id', 'name', 'createdAt'], // Dados básicos dos indicados
                  order: [['createdAt', 'ASC']] // Ordenar indicados pela data de cadastro
              }
          ]
      });

      if (!user) {
          throw new NotFoundException('Usuário não encontrado.');
      }

      return {
          userId: user.id,
          name: user.name,
          referralCode: user.referralCode, // Código de indicação DESTE usuário
          referredUsers: user.referredUsers?.map(referred => ({ // Lista de usuários indicados POR ESTE usuário
              id: referred.id,
              name: referred.name,
              signUpDate: referred.createdAt,
          })) || [],
           // Futuramente, pode adicionar resumo de comissões ganhas, etc.
      };
   }

   async findReferrerById(userId: number, transaction?: Transaction): Promise<User | null> {
        // Encontra o usuário e inclui o indicador se houver
       const user = await this.userModel.findByPk(userId, {
           attributes: ['id'], // Só precisamos do ID para verificar a existência e o referrerId
           include: [{ model: User, as: 'referrer', attributes: ['id'] }], // Inclui apenas o ID do indicador
           transaction
       });

       if (!user || !user.referrer) {
           return null; // Usuário não encontrado ou não tem indicador
       }

       // Retorna o objeto completo do indicador
        // Buscar o indicador usando o ID do user.referrer.id e a mesma transação
        const referrer = await this.userModel.findByPk(user.referrer.id, { transaction });
        return referrer || null; // Retorna o indicador ou null se não encontrar (improvável se user.referrer existe)
   }

    // --- NOVO MÉTODO: Verificar se o usuário jogou no mês atual ---
    async hasPlayedThisMonth(userId: number, transaction?: Transaction): Promise<boolean> {
        if (!userId) {
            this.logger.warn(`hasPlayedThisMonth chamado com userId nulo/inválido.`);
            return false; // Usuário inválido não jogou
        }

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1); // Primeiro dia do mês atual

        this.logger.debug(`Verificando atividade de jogo para o usuário ${userId} desde ${startOfMonth.toISOString()}`);

        // Consultar cada modelo de jogo. Podemos parar assim que encontrar uma atividade.
        const rafflePlayed = await this.raffleTicketModel.findOne({
            where: { userId: userId, createdAt: { [Op.gte]: startOfMonth } },
            transaction,
            attributes: ['id'], // Buscar apenas ID para otimização
        });
        if (rafflePlayed) {
            this.logger.debug(`Usuário ${userId} jogou Rifa este mês.`);
            return true;
        }

         const roulettePlayed = await this.rouletteBetModel.findOne({
            where: { userId: userId, createdAt: { [Op.gte]: startOfMonth } },
            transaction,
            attributes: ['id'],
         });
         if (roulettePlayed) {
            this.logger.debug(`Usuário ${userId} jogou Roleta este mês.`);
            return true;
         }

         const slotMachinePlayed = await this.slotMachineBetModel.findOne({
             where: { userId: userId, createdAt: { [Op.gte]: startOfMonth } },
             transaction,
             attributes: ['id'],
         });
         if (slotMachinePlayed) {
             this.logger.debug(`Usuário ${userId} jogou Caca Niquel este mês.`);
             return true;
         }

         const bingoPlayed = await this.bingoCardModel.findOne({
             where: { userId: userId, createdAt: { [Op.gte]: startOfMonth } },
             transaction,
             attributes: ['id'],
         });
         if (bingoPlayed) {
             this.logger.debug(`Usuário ${userId} jogou Bingo este mês.`);
             return true;
         }

         const dicePlayed = await this.diceBetModel.findOne({
             where: { userId: userId, createdAt: { [Op.gte]: startOfMonth } },
             transaction,
             attributes: ['id'],
         });
         if (dicePlayed) {
             this.logger.debug(`Usuário ${userId} jogou Dados este mês.`);
             return true;
         }

         const betGamePlayed = await this.betModel.findOne({
              where: { userId: userId, createdAt: { [Op.gte]: startOfMonth } },
              transaction,
              attributes: ['id'],
          });
          if (betGamePlayed) {
              this.logger.debug(`Usuário ${userId} jogou BetGame (Crash, etc.) este mês.`);
              return true;
          }

          const pokerPlayed = await this.pokerBetModel.findOne({
              where: { userId: userId, createdAt: { [Op.gte]: startOfMonth } },
              transaction,
              attributes: ['id'],
          });
          if (pokerPlayed) {
              this.logger.debug(`Usuário ${userId} jogou Poker este mês.`);
              return true;
          }


        this.logger.debug(`Usuário ${userId} NÃO jogou nenhum jogo este mês.`);
        return false; // Nenhuma atividade encontrada neste mês
    }

    

  // --- Fim dos métodos de indicação ---
}