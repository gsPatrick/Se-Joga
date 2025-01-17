// src/auth/auth.service.ts
import { Injectable, BadRequestException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { User, UserRole } from '../models/user/user.model';
import * as bcrypt from 'bcrypt';
import { Op } from 'sequelize';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User)
    private userModel: typeof User,
    private jwtService: JwtService, // Injete o JwtService no construtor
  ) {}

  async signUp(userData: Partial<User>): Promise<User> {
    const { name, email, cpf, phone, password, balance } = userData; // Adiciona balance aqui

    // Verificar se o usuário já existe (por email ou CPF)
    const existingUser = await this.userModel.findOne({
      where: {
        [Op.or]: [{ email }, { cpf }],
      },
    });

    if (existingUser) {
      throw new BadRequestException('Usuário já existe com este e-mail ou CPF.');
    }

    // Criptografar a senha
    const hashedPassword = await bcrypt.hash(password, 10);

    // Criar o usuário
    const newUser = await this.userModel.create({
      name,
      email,
      cpf,
      phone,
      password: hashedPassword,
      role: UserRole.USER, // Define o role como USER
      balance: balance || 0, // Define o balance se fornecido, senão usa 0
    });

    return newUser;
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

  async updateUserBalance(userId: number, amount: number): Promise<User> {
    const user = await this.userModel.findByPk(userId);

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    if (user.balance + amount < 0) {
        throw new BadRequestException('Saldo insuficiente.');
    }

    user.balance += amount;
    await user.save();

    return user;
  }

  async findAllUsers(): Promise<User[]> {
    return this.userModel.findAll();
  }

  async findCurrentUser(userId: number): Promise<User> {
    const user = await this.userModel.findByPk(userId, {
      attributes: { exclude: ['password'] }, // Exclui a senha do retorno
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

    // Impedir a atualização de senha e do balance por essa rota
    if (userData.password) {
        throw new BadRequestException('A senha não pode ser atualizada por esta rota.');
    }
    if (userData.balance !== undefined) {
        throw new BadRequestException('O saldo não pode ser atualizado por esta rota.');
    }

    await user.update(userData);
    return user;
  }

  async updateBalance(userId: number, amount: number): Promise<User> {
    const user = await this.userModel.findByPk(userId);
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const newBalance = Number(user.balance) + Number(amount);

    if (newBalance < 0) {
      throw new BadRequestException('Saldo insuficiente.');
    }

    user.balance = newBalance;
    await user.save();

    return user;
  }

}