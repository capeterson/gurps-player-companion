import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createApp } from '../../app.ts';
import { integrationTestConfig } from '../../testConfig.ts';
import { mediaConfig } from './config.ts';

const keys = [
  'ENVIRONMENT',
  'NODE_ENV',
  'MEDIA_STORAGE',
  'MEDIA_LOCAL_DIR',
  'MEDIA_S3_ENDPOINT',
  'MEDIA_S3_BUCKET',
  'MEDIA_S3_ACCESS_KEY',
  'MEDIA_S3_SECRET_KEY',
  'MEDIA_UPLOADS_ENABLED',
] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  saved.clear();
  for (const key of keys) saved.set(key, process.env[key]);
});

afterEach(() => {
  for (const key of keys) {
    const value = saved.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else process.env[key] = value;
  }
  saved.clear();
});

function withEnvironment(mutator: (env: NodeJS.ProcessEnv) => void) {
  const env: NodeJS.ProcessEnv = {};
  mutator(env);
  return mediaConfig(env);
}

describe('media storage configuration', () => {
  it('selects local storage automatically only for development and test without S3 intent', () => {
    for (const environment of ['development', 'test']) {
      const result = withEnvironment((env) => {
        env.ENVIRONMENT = environment;
        env.NODE_ENV = 'test';
      });
      expect(result).toMatchObject({
        backend: 'local',
        configured: true,
        enabled: true,
        MEDIA_LOCAL_DIR: '.local/media',
      });
    }

    expect(withEnvironment(() => undefined)).toMatchObject({
      backend: 's3',
      configured: false,
      enabled: false,
    });
    expect(
      withEnvironment((env) => {
        env.ENVIRONMENT = 'production';
      }),
    ).toMatchObject({ backend: 's3', configured: false, enabled: false });
    expect(
      withEnvironment((env) => {
        env.ENVIRONMENT = 'test';
        env.NODE_ENV = 'production';
      }),
    ).toMatchObject({ backend: 's3', configured: false, enabled: false });
  });

  it('keeps explicitly disabled local uploads configured but unavailable', () => {
    const result = withEnvironment((env) => {
      env.ENVIRONMENT = 'development';
      env.MEDIA_STORAGE = 'local';
      env.MEDIA_UPLOADS_ENABLED = 'false';
      env.MEDIA_LOCAL_DIR = '/tmp/gpc-local-media';
    });
    expect(result).toMatchObject({
      backend: 'local',
      configured: true,
      enabled: false,
      MEDIA_LOCAL_DIR: '/tmp/gpc-local-media',
    });
  });

  it('does not silently choose local storage when any S3 connection setting is present', () => {
    for (const setting of [
      ['MEDIA_S3_ENDPOINT', 'https://s3.example.test'],
      ['MEDIA_S3_BUCKET', 'gpc-images'],
      ['MEDIA_S3_ACCESS_KEY', 'access'],
      ['MEDIA_S3_SECRET_KEY', 'secret'],
    ] as const) {
      const result = withEnvironment((env) => {
        env.ENVIRONMENT = 'development';
        env[setting[0]] = setting[1];
      });
      expect(result.backend).toBe('s3');
      expect(result.configured).toBe(false);
      expect(result.enabled).toBe(false);
    }

    expect(
      withEnvironment((env) => {
        env.ENVIRONMENT = 'development';
        env.MEDIA_STORAGE = 's3';
      }),
    ).toMatchObject({ backend: 's3', configured: false, enabled: false });
  });

  it('rejects explicit local storage in production or when NODE_ENV is production', () => {
    for (const environment of [
      { ENVIRONMENT: 'production', NODE_ENV: 'test', MEDIA_UPLOADS_ENABLED: 'false' },
      { ENVIRONMENT: 'development', NODE_ENV: 'production' },
      { ENVIRONMENT: 'test', NODE_ENV: 'production' },
      { ENVIRONMENT: undefined, NODE_ENV: 'test' },
    ]) {
      expect(() =>
        withEnvironment((env) => {
          env.MEDIA_STORAGE = 'local';
          if (environment.ENVIRONMENT) env.ENVIRONMENT = environment.ENVIRONMENT;
          if (environment.NODE_ENV) env.NODE_ENV = environment.NODE_ENV;
          if (environment.MEDIA_UPLOADS_ENABLED)
            env.MEDIA_UPLOADS_ENABLED = environment.MEDIA_UPLOADS_ENABLED;
        }),
      ).toThrow(/forbidden in production/);
    }
  });

  it('createApp rejects local storage when the supplied server config is production', () => {
    process.env.ENVIRONMENT = 'test';
    process.env.NODE_ENV = 'test';
    process.env.MEDIA_STORAGE = 'local';

    expect(() => createApp({ ...integrationTestConfig, environment: 'production' })).toThrow(
      'Local media storage is forbidden in production',
    );
  });
});
