import { SchemaFactory } from '@nestjs/mongoose';
import { model, Types } from 'mongoose';
import { Cart } from './cart.model';

/**
 * Guards the bug that let a customer pay and keep a full cart.
 *
 * `@Prop({ type: Types.ObjectId })` resolves to Mixed, so CartService's raw
 * string userId was stored as a string while OrdersService.onPaid looked the
 * cart up by ObjectId — two documents, and the clear hit the wrong one.
 */
describe('Cart schema', () => {
  const schema = SchemaFactory.createForClass(Cart);

  it('types userId as ObjectId, not Mixed', () => {
    expect(schema.path('userId').instance).toBe('ObjectId');
  });

  it('casts a string userId on write, so one user can only have one cart', () => {
    const CartModel = model('CartSchemaSpec', schema);
    const raw = '6a749ec92127a5df364bf480';

    const doc = new CartModel({ userId: raw, items: [] });

    expect(doc.userId).toBeInstanceOf(Types.ObjectId);
    expect(String(doc.userId)).toBe(raw);
  });

  it('casts a string userId in query filters, so reads find that one cart', () => {
    const CartModel = model('CartFilterSpec', schema);
    const raw = '6a749ec92127a5df364bf480';

    // Mongoose casts at execution time, so getFilter() is still the raw input.
    const filter = CartModel.find({ userId: raw }).cast(CartModel);

    expect(filter.userId).toBeInstanceOf(Types.ObjectId);
  });
});
