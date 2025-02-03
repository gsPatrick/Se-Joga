
import {
    Table,
    Column,
    Model,
    DataType,
    ForeignKey,
    BelongsTo,
    } from 'sequelize-typescript';
    import { BetGameRound } from './bet-game-round.model';
    import { Seed } from '../seed.model';
    
    @Table({ tableName: 'bet_game_round_seeds' })
        export class BetGameRoundSeed extends Model {
        @Column({
            type: DataType.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        })
        id!: number;
    
        @ForeignKey(() => BetGameRound)
        @Column({
            type: DataType.INTEGER,
             allowNull: false,
        })
        roundId!: number;
    
       @BelongsTo(() => BetGameRound)
       betGameRound!: BetGameRound;
    
       @ForeignKey(() => Seed)
        @Column({
          type: DataType.INTEGER,
          allowNull: false,
        })
         seedId!: number;
    
        @BelongsTo(() => Seed)
         seed!: Seed;
    }