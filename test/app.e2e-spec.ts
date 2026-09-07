import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

describe('Приложение (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
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
  });
});
