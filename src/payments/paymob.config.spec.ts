import { getPaymentWindowMs } from './paymob.config';

/**
 * The payment window is the single knob deciding how long an abandoned
 * checkout keeps stock off the shelf. A silently-wrong value here is invisible
 * — it just looks like inventory that never comes back.
 */
describe('getPaymentWindowMs', () => {
  const original = process.env.PAYMENT_WINDOW_MINUTES;

  afterEach(() => {
    if (original === undefined) delete process.env.PAYMENT_WINDOW_MINUTES;
    else process.env.PAYMENT_WINDOW_MINUTES = original;
  });

  it('defaults to 5 minutes when unset or blank', () => {
    delete process.env.PAYMENT_WINDOW_MINUTES;
    expect(getPaymentWindowMs()).toBe(5 * 60 * 1000);

    process.env.PAYMENT_WINDOW_MINUTES = '';
    expect(getPaymentWindowMs()).toBe(5 * 60 * 1000);
  });

  it('reads the configured value', () => {
    process.env.PAYMENT_WINDOW_MINUTES = '15';
    expect(getPaymentWindowMs()).toBe(15 * 60 * 1000);
  });

  it('yields a whole number of seconds, which is what Paymob accepts', () => {
    process.env.PAYMENT_WINDOW_MINUTES = '7.5';
    expect(getPaymentWindowMs() / 1000).toBe(450);
    expect(Number.isInteger(getPaymentWindowMs() / 1000)).toBe(true);
  });

  // Falling back to the default on a typo would hide the misconfiguration
  // behind behaviour that looks deliberate.
  it.each(['0', '-5', 'ten', 'NaN'])('rejects %p', (value) => {
    process.env.PAYMENT_WINDOW_MINUTES = value;
    expect(() => getPaymentWindowMs()).toThrow(/PAYMENT_WINDOW_MINUTES/);
  });
});
