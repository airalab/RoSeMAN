import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IndexStateRepository } from '../../database/repositories/index-state.repository.js';

@Controller('status')
export class StatusController {
  constructor(
    private readonly config: ConfigService,
    private readonly indexStateRepo: IndexStateRepository,
  ) {}

  /**
   * Возвращает список адресов агентов из конфига.
   * GET /api/status/agents
   */
  @Get('agents')
  getAgents(): { result: string[] } {
    const accounts = this.config.get<string[]>('robonomics.accounts') ?? [];
    return { result: accounts };
  }

  /**
   * Возвращает номер последнего обработанного блока.
   * GET /api/status/last-block?chain=polkadot_robonomics
   * @param chain - ключ цепочки (по умолчанию из конфига robonomics.stateKey)
   */
  @Get('last-block')
  async getLastBlock(
    @Query('chain') chain?: string,
  ): Promise<{ result: number }> {
    const key =
      chain ||
      this.config.get<string>('robonomics.stateKey') ||
      'polkadot_robonomics';

    const value = await this.indexStateRepo.getValue(key);

    if (value === null) {
      throw new NotFoundException({
        error: `State not found for chain "${key}"`,
      });
    }

    return { result: value };
  }
}
