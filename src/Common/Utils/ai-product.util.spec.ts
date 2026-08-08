import { Types } from 'mongoose';
import { resolveCategoryName } from './ai-product.util';

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
