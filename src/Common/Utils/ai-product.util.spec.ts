import { Types } from 'mongoose';
import {
  DEFAULT_CLOSE_HOUR,
  resolveCategoryName,
  resolveCloseHour,
} from './ai-product.util';

describe('resolveCategoryName', () => {
  it('returns the name of a populated category', () => {
    expect(resolveCategoryName({ name: 'Pastries' })).toBe('Pastries');
  });

  it('preserves an Arabic category name', () => {
    // The AI service keyword-matches Arabic as well as English, so the name
    // must survive verbatim — this is what resolves to the `pastry` priors.
    expect(resolveCategoryName({ name: 'معجنات' })).toBe('معجنات');
  });

  // The bug this guards: `product.category || 'General'` let an unpopulated
  // ObjectId through, which serialises to a 24-char hex string. The AI service
  // matched no keyword against it and silently fell back to neutral priors, so
  // the product lost its Ramadan and kahk-season behaviour with a 200 response.
  it('does NOT leak an unpopulated ObjectId as the category name', () => {
    const raw = new Types.ObjectId('507f1f77bcf86cd799439011');
    const resolved = resolveCategoryName(raw);
    expect(resolved).toBe('General');
    expect(resolved).not.toMatch(/^[a-f0-9]{24}$/);
  });

  it('falls back for a populated document with no usable name', () => {
    expect(resolveCategoryName({})).toBe('General');
    expect(resolveCategoryName({ name: '' })).toBe('General');
    expect(resolveCategoryName({ name: '   ' })).toBe('General');
    expect(resolveCategoryName({ name: 42 })).toBe('General');
  });

  it('falls back for missing values', () => {
    expect(resolveCategoryName(null)).toBe('General');
    expect(resolveCategoryName(undefined)).toBe('General');
    expect(resolveCategoryName('')).toBe('General');
  });

  it('trims surrounding whitespace', () => {
    expect(resolveCategoryName({ name: '  Fresh Bread  ' })).toBe('Fresh Bread');
  });
});

describe('resolveCloseHour', () => {
  it('uses the restaurant’s own closing hour', () => {
    expect(resolveCloseHour(18)).toBe(18);
    expect(resolveCloseHour(23)).toBe(23);
  });

  it('accepts midnight, which is a real closing hour', () => {
    // 0 is falsy — a `closeHour || DEFAULT` guard would silently turn a shop
    // that closes at midnight into one that closes at 22:00.
    expect(resolveCloseHour(0)).toBe(0);
  });

  it('falls back when unset, so existing restaurants need no migration', () => {
    expect(resolveCloseHour(undefined)).toBe(DEFAULT_CLOSE_HOUR);
    expect(resolveCloseHour(null)).toBe(DEFAULT_CLOSE_HOUR);
  });

  it('rejects values the AI service cannot index a sell-through curve with', () => {
    expect(resolveCloseHour(24)).toBe(DEFAULT_CLOSE_HOUR);
    expect(resolveCloseHour(-1)).toBe(DEFAULT_CLOSE_HOUR);
    expect(resolveCloseHour(18.5)).toBe(DEFAULT_CLOSE_HOUR);
    expect(resolveCloseHour(NaN)).toBe(DEFAULT_CLOSE_HOUR);
    expect(resolveCloseHour('18')).toBe(DEFAULT_CLOSE_HOUR);
  });

  it('keeps the previously hardcoded value as the default', () => {
    expect(DEFAULT_CLOSE_HOUR).toBe(22);
  });
});
