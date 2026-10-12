import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { StatusController } from './../src/api/status/status.controller.js';
import { IndexStateRepository } from './../src/database/repositories/index-state.repository.js';

describe('Status API (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [StatusController],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'robonomics.accounts' ? ['legacy-agent'] : undefined,
            ),
          },
        },
        {
          provide: IndexStateRepository,
          useValue: { getValue: jest.fn().mockResolvedValue(42) },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['/metrics'] });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/status/agents возвращает список агентов', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/status/agents')
      .expect(200);

    expect(Array.isArray(response.body.result)).toBe(true);
    expect(response.headers.deprecation).toBe('@1791763200');
    expect(response.headers.link).toContain('rel="deprecation"');
    expect(response.headers['access-control-expose-headers']).toBe(
      'Deprecation, Link',
    );
  });

  it('GET /api/status/last-block остаётся актуальным', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/status/last-block')
      .expect(200);

    expect(response.body).toEqual({ result: 42 });
    expect(response.headers.deprecation).toBeUndefined();
    expect(response.headers.link).toBeUndefined();
  });
});
