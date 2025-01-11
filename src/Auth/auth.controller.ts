// src/auth/auth.controller.ts
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { User } from '../models/user/user.model';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  async signUp(@Body() userData: Partial<User>): Promise<User> {
    return this.authService.signUp(userData);
  }

  @HttpCode(HttpStatus.OK)
  @Post('signin')
  async signIn(@Body() userData: Partial<User>): Promise<User> {
    return this.authService.signIn(userData.email, userData.password);
  }
}