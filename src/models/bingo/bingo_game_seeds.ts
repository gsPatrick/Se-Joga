    // src/models/bingo/bingo_game_seeds.ts
    import {
      Table,
      Column,
      Model,
      ForeignKey,
      BelongsTo,
      CreatedAt,
      UpdatedAt
      } from 'sequelize-typescript';
      import { Seed } from '../seed.model';
      import { BingoGame } from './bingo-game.model';
  
      @Table({ tableName: 'bingo_game_seeds' })
      export class BingoGameSeed extends Model {
          @Column({ primaryKey: true, autoIncrement: true })
          id!: number;
      
          @ForeignKey(() => BingoGame)
          @Column
          gameId!: number;
      
          @BelongsTo(() => BingoGame)
          bingoGame!: BingoGame;
  
          @ForeignKey(() => Seed)
           @Column
            seedId!: number;
  
           @BelongsTo(() => Seed)
           seed!: Seed;
             @CreatedAt
            createdAt!: Date;
    
            @UpdatedAt
           updatedAt!: Date;
     }