import { Module } from '@nestjs/common';
import { FuelCardsController } from './cards/fuel-cards.controller';
import { FuelCardsService } from './cards/fuel-cards.service';
import { FuelController } from './fuel.controller';
import { FuelService } from './fuel.service';

@Module({ controllers: [FuelController, FuelCardsController], providers: [FuelService, FuelCardsService], exports: [FuelService, FuelCardsService] })
export class FuelModule {}
