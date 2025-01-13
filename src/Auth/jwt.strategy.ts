// src/auth/jwt.strategy.ts
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private authService: AuthService,
    private configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'), // Obter a chave secreta do .env
    });
  }

  async validate(payload: any) {
    // Aqui você pode buscar o usuário no banco de dados usando o payload.sub (ou payload.userId)
    // e retornar um objeto mais completo, se necessário.

    // Por enquanto, estamos retornando apenas o ID e o e-mail do usuário:
    return { id: payload.sub, email: payload.email };
  }
}