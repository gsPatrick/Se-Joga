// src/auth/auth.service.ts
import { Injectable, BadRequestException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { User, UserRole } from '../models/user/user.model';
import * as bcrypt from 'bcrypt';
import { Op } from 'sequelize';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User)
    private userModel: typeof User,
  ) {}

  async signUp(userData: Partial<User>): Promise<User> {
    const { name, email, cpf, phone, password } = userData;

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
    const hashedPassword = await bcrypt.hash(password, 10); // 10 é o saltRounds, um bom valor padrão

    // Criar o usuário
    const newUser = await this.userModel.create({
      name,
      email,
      cpf,
      phone,
      password: hashedPassword,
      role: UserRole.USER, // Define o role como USER
    });

    return newUser;
  }

  async signIn(email: string, pass: string): Promise<User> {
    const user = await this.userModel.findOne({ where: { email } });

    if (!user) {
        throw new UnauthorizedException('Invalid credentials.');
      }

    const isMatch = await bcrypt.compare(pass, user.password);

    if (!isMatch) {
        throw new UnauthorizedException('Invalid credentials.');
      }

    return user;
    
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

}