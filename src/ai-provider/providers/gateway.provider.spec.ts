import { Logger } from '@nestjs/common';
import { GatewayProvider } from './gateway.provider';

/**
 * Leaving BEDROCK_GATEWAY_URL unset silently points this provider at the real
 * AWS Bedrock endpoint, which rejects its bearer-key auth with a SigV4 403 on
 * every single call. The only symptom was the assistant quietly answering in
 * degraded mode, so the misconfiguration is asserted here instead.
 */
describe('GatewayProvider configuration guard', () => {
  const envKeys = [
    'BEDROCK_GATEWAY_URL',
    'SCHOLARSHIP_API_KEY',
    'BEDROCK_GATEWAY_KEY',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_ACCESS_KEY_ID',
  ];
  let saved: Record<string, string | undefined>;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
    envKeys.forEach((k) => delete process.env[k]);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    envKeys.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
    jest.restoreAllMocks();
  });

  const messages = () => errorSpy.mock.calls.map((c) => String(c[0])).join('\n');

  it('reports the AWS-endpoint mismatch when BEDROCK_GATEWAY_URL is unset', () => {
    process.env.SCHOLARSHIP_API_KEY = 'sbg_test_key';

    new GatewayProvider();

    expect(messages()).toContain('MISCONFIGURED');
    expect(messages()).toContain('SigV4 required');
    expect(messages()).toContain('BEDROCK_GATEWAY_URL');
  });

  it('also catches an explicitly configured AWS endpoint', () => {
    process.env.SCHOLARSHIP_API_KEY = 'sbg_test_key';
    process.env.BEDROCK_GATEWAY_URL = 'https://bedrock-runtime.eu-west-1.amazonaws.com/';

    new GatewayProvider();

    expect(messages()).toContain('MISCONFIGURED');
  });

  it('stays quiet for a real gateway domain with a key', () => {
    process.env.SCHOLARSHIP_API_KEY = 'sbg_test_key';
    process.env.BEDROCK_GATEWAY_URL = 'https://gateway.example.edu';

    new GatewayProvider();

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('reports a missing key independently of the URL', () => {
    process.env.BEDROCK_GATEWAY_URL = 'https://gateway.example.edu';

    new GatewayProvider();

    expect(messages()).toContain('no API key');
  });
});
