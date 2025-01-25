// src/auth/auth.controller.ts
import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, BadRequestException, Get, ParseFloatPipe, Patch, Put, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { User } from '../models/user/user.model';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';


@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  async signUp(@Body() userData: Partial<User>): Promise<User> {
    return this.authService.signUp(userData);
  }

  @HttpCode(HttpStatus.OK)
  @Post('signin')
  async signIn(@Body() userData: Partial<User>): Promise<{ access_token: string }> {
    if (!userData.email || !userData.password) {
      throw new BadRequestException('Email and password are required');
    }
    return this.authService.signIn(userData.email, userData.password);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('users')
  async findAllUsers() {
    return this.authService.findAllUsers();
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  async getProfile(@Req() req: Request) {
    return this.authService.findCurrentUser((req.user as any).id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Put('me')
  async updateUser(@Req() req: Request, @Body() userData: Partial<User>) {
    return this.authService.updateUser((req.user as any).id, userData);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('me/balance')
  async updateBalance(
    @Req() req: Request,
    @Body('amount', ParseFloatPipe) amount: number,
  ) {
    if(amount == 0) throw new BadRequestException('O valor do deposito não pode ser zero')
    return this.authService.updateBalance((req.user as any).id, amount);
  }
}