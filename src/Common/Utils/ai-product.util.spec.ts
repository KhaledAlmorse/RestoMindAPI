import { Types } from 'mongoose';
import {
  buildAiProductPayload,
  buildAiProductPayloadsFor,
  resolveCategoryName,
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

describe('buildAiProductPayload', () => {
  const product = {
    _id: new Types.ObjectId('507f1f77bcf86cd799439011'),
    title: 'Butter Croissant',
    category: { name: 'Pastries' },
    price: 18,
    freshnessWindow: 2,
  };

  // The economics are the point: the AI service computes the newsvendor
  // service level q* from price and shelf life. The CSV ingest path used to
  // omit both, so products onboarded that way had no economics at all.
  it('always carries the economics the newsvendor quantile needs', () => {
    expect(buildAiProductPayload(product)).toEqual({
      productId: '507f1f77bcf86cd799439011',
      title: 'Butter Croissant',
      category: 'Pastries',
      price: 18,
      freshnessWindow: 2,
    });
  });

  it('reports an unknown shelf life as null rather than inventing one', () => {
    const payload = buildAiProductPayload({ ...product, freshnessWindow: undefined });
    expect(payload.freshnessWindow).toBeNull();
  });

  it('keeps a zero shelf life, which means same-day', () => {
    // `|| null` would erase this; 0 days is a real, and the most severe, value.
    expect(buildAiProductPayload({ ...product, freshnessWindow: 0 })
      .freshnessWindow).toBe(0);
  });

  it('falls back for a missing title or price', () => {
    const payload = buildAiProductPayload({ _id: product._id });
    expect(payload.title).toBe('Product');
    expect(payload.price).toBe(0);
    expect(payload.category).toBe('General');
  });
});

describe('buildAiProductPayloadsFor', () => {
  const mk = (id: string, title: string) => ({
    _id: new Types.ObjectId(id),
    title,
    price: 5,
    freshnessWindow: 1,
  });

  const inFile = mk('507f1f77bcf86cd799439011', 'Baladi Bread');
  const notInFile = mk('507f1f77bcf86cd799439012', 'Kunafa');

  // An ingest used to re-describe the restaurant's entire catalogue. Combined
  // with the registry replacing records wholesale, that let one CSV import
  // overwrite metadata for products the file never mentioned.
  it('describes only the products the records refer to', () => {
    const payloads = buildAiProductPayloadsFor(
      [inFile, notInFile],
      ['507f1f77bcf86cd799439011'],
    );

    expect(payloads).toHaveLength(1);
    expect(payloads[0].title).toBe('Baladi Bread');
  });

  it('tolerates records naming a product that no longer exists', () => {
    const payloads = buildAiProductPayloadsFor(
      [inFile],
      ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439099'],
    );
    expect(payloads).toHaveLength(1);
  });

  it('de-duplicates repeated product ids across many rows', () => {
    const ids = Array.from({ length: 50 }, () => '507f1f77bcf86cd799439011');
    expect(buildAiProductPayloadsFor([inFile, notInFile], ids)).toHaveLength(1);
  });

  it('returns nothing when no records reference any known product', () => {
    expect(buildAiProductPayloadsFor([inFile], [])).toEqual([]);
  });
});
