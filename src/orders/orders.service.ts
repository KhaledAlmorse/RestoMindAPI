import {
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, isValidObjectId, Types } from 'mongoose';
import {
  OrderRepository,
  OrderGroupRepository,
  CartRepository,
  ProductRepository,
  UserRepository,
  RestaurantRepository,
  OfferRepository,
  SalesTransactionRepository,
  RecipeRepository,
  IngredientRepository,
  InventoryBatchRepository,
  StockTransactionRepository,
} from 'src/DB/Repositories';
import { CreateOrderDto } from './dto/create-order.dto';
import { QueryOrderListingDto } from './dto/query-order-listing.dto';
import { Decrypt } from 'src/Common/Security';
import {
  OfferStatusEnum,
  OrderStatusEnum,
  PaymentMethodEnum,
  PaymentPurposeEnum,
  RolesEnum,
  SalesSourceEnum,
  StockTransactionTypeEnum,
} from 'src/Common/Types';
import { UserType } from 'src/DB/Models';
import {
  hasDashboardAccess,
  resolveSubscriptionState,
} from 'src/subscriptions/subscription-state';
import { OffersService } from 'src/offers/offers.service';
import { PaymentsService } from 'src/payments/payments.service';
import { getApiPublicUrl, getFrontendUrl } from 'src/payments/paymob.config';
import { PaymentFulfiller } from 'src/payments/payment-fulfiller';
import { PaymentType } from 'src/DB/Models/payment.model';
import {
  commissionCentsFor,
  commissionRateFor,
} from 'src/payouts/payout.config';
import { SystemSettingsService } from 'src/system-settings/system-settings.service';
import { RefundsService } from './refunds.service';

@Injectable()
export class OrdersService implements OnModuleInit, PaymentFulfiller {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly orderGroupRepository: OrderGroupRepository,
    private readonly cartRepository: CartRepository,
    private readonly productRepository: ProductRepository,
    private readonly userRepository: UserRepository,
    private readonly restaurantRepository: RestaurantRepository,
    private readonly offerRepository: OfferRepository,
    private readonly salesTransactionRepository: SalesTransactionRepository,
    private readonly recipeRepository: RecipeRepository,
    private readonly ingredientRepository: IngredientRepository,
    private readonly inventoryBatchRepository: InventoryBatchRepository,
    private readonly stockTransactionRepository: StockTransactionRepository,
    private readonly offersService: OffersService,
    private readonly paymentsService: PaymentsService,
    @Inject(forwardRef(() => RefundsService))
    private readonly refundsService: RefundsService,
    private readonly systemSettingsService: SystemSettingsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  onModuleInit(): void {
    this.paymentsService.registerFulfiller(PaymentPurposeEnum.ORDER, this);
  }

  private validateObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ObjectId: ${id}`);
    }
  }

  /**
   * Returns an order's reserved stock to its offers.
   *
   * One implementation shared by cancellation, payment failure, expiry and
   * refund — a per-caller copy is exactly how four code paths drift apart.
   * A single failing item must not strand the rest of the customer's stock,
   * so failures are logged and the loop continues.
   *
   * Idempotent: those same four paths can fire against one order (refund then
   * cancel, webhook then sweeper), and restocking twice invents inventory the
   * restaurant does not have. The claim is a conditional update on
   * `stockRestoredAt`, so two concurrent callers cannot both win it.
   */
  async restoreStockForOrder(order: any): Promise<void> {
    if (!order?._id) return;

    const claimed = await this.orderRepository.findOneAndUpdate({
      filters: { _id: order._id, stockRestoredAt: { $exists: false } },
      updateData: { $set: { stockRestoredAt: new Date() } },
    });
    if (!claimed) {
      this.logger.warn(
        `Stock for order ${String(order._id)} was already restored — skipping`,
      );
      return;
    }

    for (const item of order?.items || []) {
      if (!item.offerId) continue;
      const offerId = item.offerId._id || item.offerId;
      try {
        await this.offersService.restockFromCancelledOrderItem(
          offerId,
          item.quantity,
          item.lineTotal || 0,
        );
      } catch (error: any) {
        this.logger.error(
          `Failed to restock offer ${String(offerId)} for order ${String(order?._id)}: ${error?.message}`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------
  // PaymentFulfiller
  // ---------------------------------------------------------------------

  /**
   * Online payment confirmed. Promote the reserved group to a live order.
   *
   * Idempotent: only a group still in AWAITING_PAYMENT is promoted, so a
   * webhook retry or a reconciliation sweep landing on the same payment is a
   * no-op rather than a second promotion.
   */
  async onPaid(payment: PaymentType): Promise<void> {
    if (!payment.orderGroupId) return;

    const group = await this.orderGroupRepository.findOne({
      filters: { _id: payment.orderGroupId },
    });
    if (!group || group.overallStatus !== OrderStatusEnum.AWAITING_PAYMENT) {
      return;
    }

    await this.orderRepository.updateMany(
      {
        groupOrderId: group._id,
        status: OrderStatusEnum.AWAITING_PAYMENT,
      },
      { status: OrderStatusEnum.PENDING },
    );
    await this.orderGroupRepository.update({
      filters: { _id: group._id },
      body: { overallStatus: OrderStatusEnum.PENDING } as any,
    });

    // The cart is cleared here, not at creation — a failed payment must not
    // also destroy the customer's cart.
    const cart = await this.cartRepository.findOne({
      filters: { userId: group.userId },
    });
    if (cart) {
      cart.items = [];
      await this.cartRepository.save(cart);
    }

    this.logger.log(`Order group ${String(group._id)} paid and promoted`);
  }

  /**
   * Payment failed or expired. Return the reserved stock and park the group.
   *
   * The status transition is CLAIMED FIRST, conditionally on the group still
   * being AWAITING_PAYMENT. That ordering is the only thing preventing the
   * webhook and the reconciliation sweeper from both restocking the same
   * items — this codebase has no working transactions to fall back on.
   */
  async onFailed(payment: PaymentType): Promise<void> {
    if (!payment.orderGroupId) return;

    const claimed = await this.orderGroupRepository.findOneAndUpdate({
      filters: {
        _id: payment.orderGroupId,
        overallStatus: OrderStatusEnum.AWAITING_PAYMENT,
      },
      updateData: {
        $set: { overallStatus: OrderStatusEnum.PAYMENT_FAILED },
      },
    });
    // Someone else already handled it — do not restock a second time.
    if (!claimed) return;

    const childOrders = await this.orderRepository.findMany({
      filters: { groupOrderId: payment.orderGroupId },
    });
    for (const child of childOrders || []) {
      await this.restoreStockForOrder(child);
    }

    await this.orderRepository.updateMany(
      {
        groupOrderId: payment.orderGroupId,
        status: OrderStatusEnum.AWAITING_PAYMENT,
      },
      { status: OrderStatusEnum.PAYMENT_FAILED },
    );

    this.logger.warn(
      `Order group ${String(payment.orderGroupId)} payment failed; stock restored`,
    );
  }

  /**
   * Public wrapper so the refund flow recomputes a group's status with the
   * same rules as cancellation — the two must never disagree about what a
   * mixed group means.
   */
  computeGroupStatus(childOrders: any[]): string {
    return this.computeOverallStatus(childOrders);
  }

  private computeOverallStatus(childOrders: any[]): string {
    if (!childOrders || childOrders.length === 0)
      return OrderStatusEnum.PENDING;
    const statuses = childOrders.map((o) => o.status);

    const allCancelled = statuses.every((s) => s === OrderStatusEnum.CANCELLED);
    if (allCancelled) return OrderStatusEnum.CANCELLED;

    const firstStatus = statuses[0];
    const allSame = statuses.every((s) => s === firstStatus);
    if (allSame) return firstStatus;

    const hasDelivered = statuses.some((s) => s === OrderStatusEnum.DELIVERED);
    if (hasDelivered) return 'Partially Delivered';

    const hasCancelled = statuses.some((s) => s === OrderStatusEnum.CANCELLED);
    if (hasCancelled) return 'Partially Cancelled';

    return 'Processing';
  }

  private formatUser(userObj: any) {
    if (!userObj) return null;
    if (typeof userObj !== 'object') return userObj.toString();
    const raw = userObj.toObject ? userObj.toObject() : { ...userObj };
    delete raw.password;
    if (raw._id) {
      raw.id = raw._id.toString();
      raw._id = raw._id.toString();
    }
    return raw;
  }

  private async formatOrderGroup(groupDoc: any) {
    const group = groupDoc.toObject ? groupDoc.toObject() : { ...groupDoc };

    let childOrders = group.orderIds || [];

    const isUnpopulated =
      !childOrders.length ||
      childOrders.some(
        (sub: any) =>
          !sub ||
          typeof sub !== 'object' ||
          !sub._id ||
          typeof sub.status === 'undefined',
      );

    if (isUnpopulated && group._id) {
      const fetchedChildOrders = await this.orderRepository.findMany({
        filters: { groupOrderId: group._id },
        populationArray: [{ path: 'restaurantId' }],
      });
      if (fetchedChildOrders && fetchedChildOrders.length > 0) {
        childOrders = fetchedChildOrders;
      }
    }

    const validChildOrders = childOrders.filter(
      (sub: any) => sub && typeof sub === 'object' && sub._id,
    );

    const overallStatus = this.computeOverallStatus(validChildOrders);

    const formattedOrders: any[] = [];
    let computedOriginalPrice = 0;
    let computedDiscount = 0;
    let computedTotalPrice = 0;
    let computedQuantity = 0;

    for (const sub of validChildOrders) {
      const subObj = sub.toObject ? sub.toObject() : { ...sub };
      const restaurant = subObj.restaurantId;
      const subRestaurantId = restaurant?._id
        ? restaurant._id.toString()
        : restaurant?.toString() || '';
      const subRestaurantName =
        restaurant?.name ||
        restaurant?.restaurantName ||
        restaurant?.title ||
        subObj.restaurantName ||
        '';

      const restaurantObj: any = {
        _id: subRestaurantId,
        name: subRestaurantName,
      };
      if (restaurant?.logo) restaurantObj.logo = restaurant.logo;
      if (restaurant?.image) restaurantObj.image = restaurant.image;

      const subOrderItems: any[] = [];
      let subOrigPrice = 0;
      let subFinalPrice = 0;
      let subQty = 0;

      for (const item of subObj.items || []) {
        const pId = item.productId?._id
          ? item.productId._id.toString()
          : item.productId?.toString() || item.productId || '';
        const oId = item.offerId?._id
          ? item.offerId._id.toString()
          : item.offerId?.toString() || item.offerId || '';
        const title = item.productTitle || item.title || '';
        const origPrice = item.originalPrice ?? item.price ?? 0;
        const offPrice = item.offerPrice ?? origPrice;
        const qty = item.quantity ?? 1;
        const lineTot = item.lineTotal ?? offPrice * qty;
        const discPct = item.discountPercentage ?? 0;
        const img = item.productImage || item.image || '';

        const subItemObj: any = {
          productId: pId,
          title: title,
          price: origPrice,
          discountedPrice: offPrice,
          quantity: qty,
          lineTotal: lineTot,
        };
        if (oId) subItemObj.offerId = oId;
        if (discPct) subItemObj.discountPercentage = discPct;
        if (img) subItemObj.productImage = img;

        subOrderItems.push(subItemObj);

        subOrigPrice += origPrice * qty;
        subFinalPrice += lineTot;
        subQty += qty;
      }

      const subDiscPrice = Math.max(0, subOrigPrice - subFinalPrice);

      formattedOrders.push({
        orderId: subObj._id.toString(),
        restaurant: restaurantObj,
        status: subObj.status || OrderStatusEnum.PENDING,
        items: subOrderItems,
        totalOriginalPrice: subObj.totalOriginalPrice ?? subOrigPrice,
        totalDiscount: subObj.totalDiscount ?? subDiscPrice,
        finalTotalPrice: subObj.finalTotalPrice ?? subFinalPrice,
        totalQuantity: subObj.totalQuantity ?? subQty,
        createdAt: subObj.createdAt || group.createdAt,
      });

      computedOriginalPrice += subOrigPrice;
      computedDiscount += subDiscPrice;
      computedTotalPrice += subFinalPrice;
      computedQuantity += subQty;
    }

    return {
      _id: group._id.toString(),
      groupOrderId: group._id.toString(),
      user: this.formatUser(group.userId),
      fullName: group.fullName,
      phoneNumber: group.phoneNumber,
      emailAddress: group.emailAddress,
      deliveryMethod: group.deliveryMethod,
      deliveryAddress: group.deliveryAddress,
      paymentMethod: group.paymentMethod,
      specialNotes: group.specialNotes,
      overallStatus,
      totalOriginalPrice: validChildOrders.length
        ? computedOriginalPrice
        : (group.totalOriginalPrice ?? 0),
      totalDiscount: validChildOrders.length
        ? computedDiscount
        : (group.totalDiscount ?? 0),
      finalTotalPrice: validChildOrders.length
        ? computedTotalPrice
        : (group.finalTotalPrice ?? 0),
      totalQuantity: validChildOrders.length
        ? computedQuantity
        : (group.totalQuantity ?? 0),
      orders: formattedOrders,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt || group.createdAt,
    };
  }

  private formatChildOrder(orderDoc: any) {
    const order = orderDoc.toObject ? orderDoc.toObject() : { ...orderDoc };

    const restaurant = order.restaurantId;
    const restaurantObj: any =
      restaurant && typeof restaurant === 'object'
        ? {
            _id: restaurant._id
              ? restaurant._id.toString()
              : restaurant.toString(),
            name:
              restaurant.name || restaurant.title || order.restaurantName || '',
            logo: restaurant.logo,
            image: restaurant.image,
          }
        : {
            _id: restaurant ? restaurant.toString() : '',
            name: order.restaurantName || '',
          };

    const formattedItems = (order.items || []).map((item: any) => {
      const pId = item.productId?._id
        ? item.productId._id.toString()
        : item.productId?.toString() || item.productId || '';
      const oId = item.offerId?._id
        ? item.offerId._id.toString()
        : item.offerId?.toString() || item.offerId || '';

      return {
        productId: pId,
        productTitle: item.productTitle || item.title || '',
        productImage: item.productImage || '',
        offerId: oId || undefined,
        restaurantId: item.restaurantId?._id
          ? item.restaurantId._id.toString()
          : item.restaurantId?.toString() || restaurantObj._id,
        restaurantName: item.restaurantName || restaurantObj.name,
        originalPrice: item.originalPrice ?? item.price ?? 0,
        offerPrice: item.offerPrice ?? item.originalPrice ?? item.price ?? 0,
        discountPercentage: item.discountPercentage ?? 0,
        quantity: item.quantity ?? 1,
        lineTotal:
          item.lineTotal ?? (item.offerPrice ?? 0) * (item.quantity ?? 1),
        purchasedAt: item.purchasedAt || order.createdAt,
      };
    });

    return {
      _id: order._id.toString(),
      groupOrderId: order.groupOrderId
        ? order.groupOrderId.toString()
        : undefined,
      user: this.formatUser(order.userId),
      restaurant: restaurantObj,
      items: formattedItems,
      totalOriginalPrice: order.totalOriginalPrice ?? 0,
      totalDiscount: order.totalDiscount ?? 0,
      finalTotalPrice: order.finalTotalPrice ?? 0,
      totalQuantity: order.totalQuantity ?? 0,
      fullName: order.fullName,
      phoneNumber: order.phoneNumber,
      emailAddress: order.emailAddress,
      deliveryMethod: order.deliveryMethod,
      deliveryAddress: order.deliveryAddress,
      specialNotes: order.specialNotes,
      paymentMethod: order.paymentMethod,
      status: order.status || OrderStatusEnum.PENDING,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt || order.createdAt,
    };
  }

  private async runTransaction<T>(
    work: (session: any) => Promise<T>,
  ): Promise<T> {
    let session: any = null;
    try {
      session = await this.connection.startSession();
      session.startTransaction();
      const result = await work(session);
      await session.commitTransaction();
      return result;
    } catch (err: any) {
      if (session) {
        try {
          await session.abortTransaction();
        } catch (_) {
          //* ignore session abort error
        }
      }
      if (
        err?.message?.includes('Transaction numbers are only allowed') ||
        err?.message?.includes('replica set')
      ) {
        return await work(null);
      }
      throw err;
    } finally {
      if (session) {
        try {
          await session.endSession();
        } catch (_) {
          //* ignore session end error
        }
      }
    }
  }

  // 1. POST /orders - Create Order
  async createOrder(userId: string, body: CreateOrderDto) {
    this.validateObjectId(userId);
    const dbUser = await this.userRepository.findOne({
      filters: { _id: userId },
    });
    if (!dbUser) {
      throw new NotFoundException('User not found');
    }

    const isOnlinePayment = body.paymentMethod !== 'Cash on Delivery';
    const initialStatus = isOnlinePayment
      ? OrderStatusEnum.AWAITING_PAYMENT
      : OrderStatusEnum.PENDING;

    if (isOnlinePayment) {
      // A customer holding an unpaid group younger than the intention
      // lifetime cannot start a second one — that would reserve the stock
      // twice for the same person.
      const pendingGroup = await this.orderGroupRepository.findOne({
        filters: {
          userId: new Types.ObjectId(userId),
          overallStatus: OrderStatusEnum.AWAITING_PAYMENT,
          createdAt: { $gte: new Date(Date.now() - 15 * 60 * 1000) },
        },
      });
      if (pendingGroup) {
        throw new ConflictException({
          code: 'PAYMENT_IN_PROGRESS',
          message:
            'You already have an order awaiting payment. Complete or cancel it before starting another.',
          orderGroupId: String(pendingGroup._id),
        });
      }
    }

    const fullName = `${dbUser.firstName} ${dbUser.lastName}`.trim();

    let userPhone = dbUser.phone;
    try {
      userPhone = Decrypt(
        dbUser.phone,
        process.env.Encryption_SECRET as string,
      );
    } catch (e) {
      // fallback to stored value
    }

    const userObjId = new Types.ObjectId(userId);
    const cart = await this.cartRepository.findOne({
      filters: {
        $or: [{ userId: userObjId }, { userId }],
      },
    });

    if (!cart || !cart.items || cart.items.length === 0) {
      throw new BadRequestException('Your cart is empty');
    }

    // Resolve address snapshot
    let resolvedAddress: any = null;
    if (body.deliveryMethod === 'Home Delivery') {
      if (body.deliveryAddress.addressId) {
        const savedAddress = dbUser.addresses.find(
          (addr) => addr._id.toString() === body.deliveryAddress.addressId,
        );
        if (!savedAddress) {
          throw new BadRequestException(
            'Saved address not found in user profile',
          );
        }
        resolvedAddress = {
          addressId: savedAddress._id.toString(),
          street: savedAddress.street,
          city: savedAddress.city,
          country: savedAddress.country || '',
        };
      } else {
        resolvedAddress = {
          street: body.deliveryAddress.street,
          city: body.deliveryAddress.city,
          country: body.deliveryAddress.country,
        };
        if (body.saveAddress) {
          const isDefault = dbUser.addresses.length === 0;
          const newAddr = {
            _id: new Types.ObjectId(),
            fullName: fullName,
            phoneNumber: userPhone,
            street: body.deliveryAddress.street,
            city: body.deliveryAddress.city,
            country: body.deliveryAddress.country,
            label: 'Saved Address',
            isDefault,
          };
          dbUser.addresses.push(newAddr as any);
          await this.userRepository.update({
            filters: { _id: userId },
            body: { addresses: dbUser.addresses } as any,
          });
        }
      }
    }

    // Validate cart offers against live database items
    const now = new Date();
    const validatedCartEntries: {
      item: any;
      offer: any;
      product: any;
      restaurant: any;
    }[] = [];

    for (const item of cart.items) {
      const rawOfferId = item.offerId?._id ? item.offerId._id : item.offerId;

      const offer = await this.offerRepository.findOne({
        filters: { _id: new Types.ObjectId(rawOfferId), isDeleted: false },
        populationArray: [{ path: 'productId' }, { path: 'restaurantId' }],
      });

      if (!offer) {
        throw new BadRequestException(
          'One or more offers in your cart are no longer available',
        );
      }

      const product = offer.productId as any;
      const restaurant = offer.restaurantId as any;

      if (!product || product.isDeleted) {
        throw new BadRequestException(
          `Product for offer "${offer._id.toString()}" is no longer available`,
        );
      }

      if (offer.status !== OfferStatusEnum.ACTIVE) {
        throw new BadRequestException(
          `Offer for "${product.title || 'product'}" is currently ${offer.status}`,
        );
      }

      // Second line of defence, closing the up-to-5-minute window between a
      // subscription lapsing and the offers cron suspending its offers. The
      // restaurant document is already populated above, so this costs nothing.
      if (
        !hasDashboardAccess(resolveSubscriptionState(restaurant?.subscription))
      ) {
        throw new BadRequestException(
          `"${restaurant?.name || 'This restaurant'}" is not currently accepting orders`,
        );
      }
      if (now < offer.startDate || now > offer.endDate) {
        throw new BadRequestException(
          `Offer for "${product.title || 'product'}" is outside its active period`,
        );
      }
      if (offer.remainingQuantity <= 0) {
        throw new BadRequestException(
          `Offer for "${product.title || 'product'}" is sold out`,
        );
      }
      if (offer.remainingQuantity < item.quantity) {
        throw new BadRequestException(
          `Only ${offer.remainingQuantity} left in stock for "${product.title || 'offer'}"`,
        );
      }

      if (offer.maxPerCustomer && offer.maxPerCustomer > 0) {
        const pastOrders = await this.orderRepository.findMany({
          filters: {
            userId: userObjId,
            status: { $ne: OrderStatusEnum.CANCELLED },
            'items.offerId': offer._id,
          },
        });
        let pastQuantity = 0;
        for (const ord of pastOrders || []) {
          for (const ordItem of ord.items || []) {
            if (ordItem.offerId?.toString() === offer._id.toString()) {
              pastQuantity += ordItem.quantity;
            }
          }
        }
        if (pastQuantity + item.quantity > offer.maxPerCustomer) {
          throw new BadRequestException(
            `You have reached the purchase limit for offer "${product.title || 'offer'}"`,
          );
        }
      }

      validatedCartEntries.push({ item, offer, product, restaurant });
    }

    // Group items by restaurantId
    const restaurantGroups = new Map<string, typeof validatedCartEntries>();
    for (const entry of validatedCartEntries) {
      const restId = (
        entry.restaurant?._id || entry.offer.restaurantId
      ).toString();

      if (!restaurantGroups.has(restId)) {
        restaurantGroups.set(restId, []);
      }
      restaurantGroups.get(restId)!.push(entry);
    }

    // Read once for the whole checkout, before the transaction: every order in
    // one basket must be priced under the same platform default, and an admin
    // saving a new rate mid-loop must not split the group across two rates.
    const platformCommissionRate = (await this.systemSettingsService.get())
      .defaultCommissionRate;

    const groupOrderId = new Types.ObjectId();
    const createdOrderIds: Types.ObjectId[] = [];
    let groupTotalOriginalPrice = 0;
    let groupTotalDiscount = 0;
    let groupFinalTotalPrice = 0;
    let groupTotalQuantity = 0;
    const purchasedAt = new Date();

    await this.runTransaction(async (_session) => {
      for (const [restaurantId, entries] of restaurantGroups.entries()) {
        const orderItems: any[] = [];
        let totalQuantity = 0;
        let totalOriginalPrice = 0;
        let finalTotalPrice = 0;

        let restaurantName = '';

        for (const { item, offer, product, restaurant } of entries) {
          if (!restaurantName) {
            restaurantName =
              restaurant?.name ||
              restaurant?.restaurantName ||
              restaurant?.title ||
              '';
          }

          const quantity = item.quantity;
          const originalPrice =
            Number(offer.originalPrice) || Number(product.price) || 0;
          const offerPrice = Number(offer.offerPrice) || originalPrice;
          const discountPercentage = Number(offer.discountPercentage) || 0;
          const lineTotal = offerPrice * quantity;

          const productImage =
            product?.image?.secure_url || product?.image?.url || '';

          orderItems.push({
            offerId: offer._id,
            productId: product._id,
            productTitle: product.title,
            productImage,
            restaurantId: new Types.ObjectId(restaurantId),
            restaurantName,
            originalPrice,
            offerPrice,
            discountPercentage,
            quantity,
            purchasedAt,
            lineTotal,
          });

          totalQuantity += quantity;
          totalOriginalPrice += originalPrice * quantity;
          finalTotalPrice += lineTotal;

          // Atomic inventory reservation
          const updateResult = await this.offerRepository.update({
            filters: {
              _id: offer._id,
              remainingQuantity: { $gte: quantity },
            },
            body: {
              $inc: { remainingQuantity: -quantity },
            } as any,
          });

          if (!updateResult) {
            throw new BadRequestException(
              `Insufficient stock left for offer "${product.title}"`,
            );
          }

          // Check if offer became sold_out
          const updatedOffer = await this.offerRepository.findOne({
            filters: { _id: offer._id },
          });
          if (updatedOffer && updatedOffer.remainingQuantity === 0) {
            await this.offerRepository.update({
              filters: { _id: offer._id },
              body: { status: OfferStatusEnum.SOLD_OUT } as any,
            });
          }

          // AI recommendation feedback update
          if (offer.recommendationId) {
            await this.offerRepository.update({
              filters: { _id: offer._id },
              body: {
                $inc: {
                  actualUnitsSold: quantity,
                  actualRevenueRecovered: lineTotal,
                },
              } as any,
            });
          }
        }

        const totalDiscount = totalOriginalPrice - finalTotalPrice;

        // Commission is snapshotted per order, at the rate in force right now.
        const commissionRate = commissionRateFor(
          entries[0].restaurant ?? {},
          platformCommissionRate,
        );
        const commissionCents = commissionCentsFor(
          Math.round(finalTotalPrice * 100),
          commissionRate,
        );

        groupTotalQuantity += totalQuantity;
        groupTotalOriginalPrice += totalOriginalPrice;
        groupFinalTotalPrice += finalTotalPrice;
        groupTotalDiscount += totalDiscount;

        const newOrder = await this.orderRepository.create({
          groupOrderId,
          userId: new Types.ObjectId(userId),
          restaurantId: new Types.ObjectId(restaurantId),
          items: orderItems,
          totalOriginalPrice,
          totalDiscount,
          finalTotalPrice,
          commissionRate,
          commissionCents,
          totalQuantity,
          fullName,
          phoneNumber: userPhone,
          emailAddress: dbUser.email,
          deliveryMethod: body.deliveryMethod,
          deliveryAddress: resolvedAddress,
          specialNotes: body.specialNotes,
          paymentMethod: body.paymentMethod,
          status: initialStatus,
        });

        createdOrderIds.push(newOrder._id);
      }

      await this.orderGroupRepository.create({
        _id: groupOrderId,
        userId: new Types.ObjectId(userId),
        orderIds: createdOrderIds,
        fullName,
        phoneNumber: userPhone,
        emailAddress: dbUser.email,
        deliveryMethod: body.deliveryMethod,
        deliveryAddress: resolvedAddress,
        specialNotes: body.specialNotes,
        paymentMethod: body.paymentMethod,
        totalOriginalPrice: groupTotalOriginalPrice,
        totalDiscount: groupTotalDiscount,
        finalTotalPrice: groupFinalTotalPrice,
        totalQuantity: groupTotalQuantity,
        overallStatus: initialStatus,
      });
    });

    // For online payments the cart is cleared by the webhook (onPaid), not
    // here — a failed payment must not also destroy the customer's cart.
    if (!isOnlinePayment) {
      cart.items = [];
      await this.cartRepository.save(cart);
    }

    const populatedGroup = await this.orderGroupRepository.findOne({
      filters: { _id: groupOrderId },
      populationArray: [
        { path: 'userId', select: '-password' },
        {
          path: 'orderIds',
          populate: [{ path: 'restaurantId' }],
        },
      ],
    });

    if (isOnlinePayment) {
      // If this throws, the group is already AWAITING_PAYMENT with stock
      // reserved. Deliberately not unwound inline: the reconciliation sweeper
      // expires it and onFailed() restores the stock through the one code
      // path that does it correctly. Let the error surface and let the
      // customer retry.
      const { checkoutUrl } = await this.paymentsService.createPayment({
        purpose: PaymentPurposeEnum.ORDER,
        userId: new Types.ObjectId(userId),
        orderGroupId: groupOrderId,
        amountCents: Math.round(groupFinalTotalPrice * 100),
        method:
          body.paymentMethod === 'Card'
            ? PaymentMethodEnum.CARD
            : PaymentMethodEnum.WALLET,
        billingData: {
          first_name: dbUser.firstName,
          last_name: dbUser.lastName,
          phone_number: userPhone,
          email: dbUser.email,
          street: resolvedAddress?.street || 'NA',
          city: resolvedAddress?.city || 'Cairo',
          country: 'EGY',
        },
        items: [
          {
            name: `RestoMind order ${groupOrderId.toString()}`,
            amount: Math.round(groupFinalTotalPrice * 100),
            quantity: 1,
          },
        ],
        notificationUrl: `${getApiPublicUrl()}/payments/webhook`,
        redirectionUrl: `${getFrontendUrl()}/checkout/result?group=${groupOrderId.toString()}`,
        expirationSeconds: 900,
      });

      return {
        data: await this.formatOrderGroup(populatedGroup),
        checkoutUrl,
      };
    }

    return { data: await this.formatOrderGroup(populatedGroup) };
  }

  // 2. GET /orders/group/:id - Get Order Group By ID
  async getGroupOrderById(id: string, currentUser: UserType) {
    this.validateObjectId(id);
    const targetId = new Types.ObjectId(id);

    const group = await this.orderGroupRepository.findOne({
      filters: { _id: targetId },
      populationArray: [
        { path: 'userId', select: '-password' },
        {
          path: 'orderIds',
          populate: [{ path: 'restaurantId' }],
        },
      ],
    });

    if (!group) {
      throw new NotFoundException('Group order not found');
    }

    if (currentUser.role === RolesEnum.CUSTOMER) {
      const ownerId = group.userId?._id
        ? group.userId._id.toString()
        : group.userId?.toString();
      if (ownerId !== currentUser._id.toString()) {
        throw new ForbiddenException(
          'You do not have permission to view this group order',
        );
      }
    }

    return { data: await this.formatOrderGroup(group) };
  }

  // 2b. PATCH /orders/group/:id/cancel - Cancel Order Group (Client)
  async cancelOrderGroup(groupId: string, currentUser: UserType) {
    this.validateObjectId(groupId);
    const targetId = new Types.ObjectId(groupId);

    const group = await this.orderGroupRepository.findOne({
      filters: { _id: targetId },
      populationArray: [
        { path: 'userId', select: '-password' },
        {
          path: 'orderIds',
          populate: [{ path: 'restaurantId' }],
        },
      ],
    });

    if (!group) {
      throw new NotFoundException('Group order not found');
    }

    // Ownership check
    const ownerId = group.userId?._id
      ? group.userId._id.toString()
      : group.userId?.toString();
    if (
      ownerId !== currentUser._id.toString() &&
      currentUser.role !== RolesEnum.ADMIN
    ) {
      throw new ForbiddenException(
        'You do not have permission to cancel this group order',
      );
    }

    // Fetch child orders
    let childOrders: any[] = (group.orderIds as any[]) || [];
    if (
      !childOrders.length ||
      childOrders.some((o: any) => !o || typeof o !== 'object' || !o._id)
    ) {
      childOrders =
        (await this.orderRepository.findMany({
          filters: { groupOrderId: group._id },
          populationArray: [{ path: 'restaurantId' }],
        })) || [];
    }

    if (!childOrders.length) {
      throw new NotFoundException('No child orders found for this order group');
    }

    // Check if group is already fully cancelled
    const allAlreadyCancelled = childOrders.every(
      (o: any) => o.status === OrderStatusEnum.CANCELLED,
    );
    if (allAlreadyCancelled) {
      return { data: await this.formatOrderGroup(group) };
    }

    // Strict Option A: Check if ANY child order is non-cancellable
    const nonCancellableOrders = childOrders.filter((o: any) => {
      const s = o.status;
      return (
        s === OrderStatusEnum.PREPARING ||
        s === OrderStatusEnum.READY ||
        s === OrderStatusEnum.OUT_FOR_DELIVERY ||
        s === OrderStatusEnum.DELIVERED ||
        // Already refunded after delivery. Overwriting REFUNDED with CANCELLED
        // would falsify the fulfilment record the forecasting model trains on.
        s === OrderStatusEnum.REFUNDED
      );
    });

    if (nonCancellableOrders.length > 0) {
      const nonCancellableDetails = nonCancellableOrders
        .map((o: any) => {
          const restName =
            o.restaurantId?.name ||
            o.restaurantId?.title ||
            o.restaurantName ||
            'Restaurant';
          return `"${restName}" (status: ${o.status})`;
        })
        .join(', ');

      throw new BadRequestException(
        `Cannot cancel group order because the following restaurant order(s) are already being processed or delivered: ${nonCancellableDetails}`,
      );
    }

    if (group.overallStatus === OrderStatusEnum.AWAITING_PAYMENT) {
      // Nothing was ever paid — there is nothing to refund, and the refund
      // policy treats AWAITING_PAYMENT as terminal (would throw). Cancel
      // directly, exactly as before.
      for (const childOrder of childOrders) {
        if (childOrder.status === OrderStatusEnum.CANCELLED) continue;

        // Update child order status to CANCELLED
        await this.orderRepository.update({
          filters: { _id: childOrder._id },
          body: { status: OrderStatusEnum.CANCELLED } as any,
        });

        // Restore inventory and update offer metrics
        await this.restoreStockForOrder(childOrder);
      }

      // Update parent OrderGroup overallStatus
      await this.orderGroupRepository.update({
        filters: { _id: group._id },
        body: { overallStatus: OrderStatusEnum.CANCELLED } as any,
      });
    } else {
      // Money could have been committed. requestRefund creates the Refund
      // record, executes it, and — once the refund succeeds — writes
      // CANCELLED to every child order and restores stock itself via
      // applyOrderConsequences. Only PENDING/CONFIRMED groups reach this
      // branch (nonCancellableOrders above already excludes staff-only and
      // delivered statuses), and both are in CUSTOMER_AUTO_REFUNDABLE, so the
      // refund always executes synchronously.
      await this.refundsService.requestRefund(
        groupId,
        { reason: 'Order cancelled by customer' },
        currentUser,
      );
    }

    const updatedGroup = await this.orderGroupRepository.findOne({
      filters: { _id: group._id },
      populationArray: [
        { path: 'userId', select: '-password' },
        {
          path: 'orderIds',
          populate: [{ path: 'restaurantId' }],
        },
      ],
    });

    return { data: await this.formatOrderGroup(updatedGroup) };
  }

  // 3. GET /orders/:id - Get Child Order By ID
  async getChildOrderById(id: string, currentUser: UserType) {
    this.validateObjectId(id);
    const targetId = new Types.ObjectId(id);

    let order = await this.orderRepository.findOne({
      filters: { _id: targetId },
      populationArray: [
        { path: 'userId', select: '-password' },
        { path: 'restaurantId' },
      ],
    });

    if (!order) {
      const filters: Record<string, any> = { groupOrderId: targetId };
      if (currentUser.role === RolesEnum.MANAGER && currentUser.restaurantId) {
        filters.restaurantId = new Types.ObjectId(
          currentUser.restaurantId.toString(),
        );
      }
      order = await this.orderRepository.findOne({
        filters,
        populationArray: [
          { path: 'userId', select: '-password' },
          { path: 'restaurantId' },
        ],
      });
    }

    if (!order) {
      throw new NotFoundException('Child order not found');
    }

    // Role checks
    if (currentUser.role === RolesEnum.CUSTOMER) {
      const ownerId = order.userId?._id
        ? order.userId._id.toString()
        : order.userId?.toString();
      if (ownerId !== currentUser._id.toString()) {
        throw new ForbiddenException(
          'You do not have permission to view this order',
        );
      }
    } else if (currentUser.role === RolesEnum.MANAGER) {
      if (!currentUser.restaurantId) {
        throw new ForbiddenException('Manager is not assigned to a restaurant');
      }
      const restId = order.restaurantId?._id
        ? order.restaurantId._id.toString()
        : order.restaurantId?.toString();
      if (restId !== currentUser.restaurantId.toString()) {
        throw new ForbiddenException(
          'You can only view orders for your own restaurant',
        );
      }
    }

    return { data: this.formatChildOrder(order) };
  }

  // 4. PATCH /orders/:id/status - Update Child Order Status
  async updateOrderStatus(
    id: string,
    status: OrderStatusEnum,
    currentUser: UserType,
  ) {
    this.validateObjectId(id);
    const targetObjId = new Types.ObjectId(id);

    let order = await this.orderRepository.findOne({
      filters: { _id: targetObjId },
    });

    if (!order) {
      const filters: Record<string, any> = { groupOrderId: targetObjId };
      if (currentUser.role === RolesEnum.MANAGER && currentUser.restaurantId) {
        filters.restaurantId = new Types.ObjectId(
          currentUser.restaurantId.toString(),
        );
      }
      order = await this.orderRepository.findOne({ filters });
    }

    if (!order) {
      throw new NotFoundException('Child order not found');
    }

    if (currentUser.role === RolesEnum.MANAGER) {
      if (
        !currentUser.restaurantId ||
        order.restaurantId.toString() !== currentUser.restaurantId.toString()
      ) {
        throw new ForbiddenException(
          'You can only update status of orders belonging to your own restaurant',
        );
      }
    }

    if (order.status === status) {
      const populated = await this.orderRepository.findOne({
        filters: { _id: targetObjId },
        populationArray: [
          { path: 'userId', select: '-password' },
          { path: 'restaurantId' },
        ],
      });
      return { data: this.formatChildOrder(populated) };
    }

    if (
      order.status === OrderStatusEnum.DELIVERED ||
      order.status === OrderStatusEnum.CANCELLED ||
      order.status === OrderStatusEnum.REFUNDED
    ) {
      throw new BadRequestException(
        `Cannot change status of a finalized order (${order.status})`,
      );
    }

    const statusProgression: Record<string, number> = {
      [OrderStatusEnum.PENDING]: 0,
      [OrderStatusEnum.CONFIRMED]: 1,
      [OrderStatusEnum.PREPARING]: 2,
      [OrderStatusEnum.READY]: 3,
      [OrderStatusEnum.OUT_FOR_DELIVERY]: 4,
      [OrderStatusEnum.DELIVERED]: 5,
    };

    if (status !== OrderStatusEnum.CANCELLED) {
      const currentRank = statusProgression[order.status];
      const newRank = statusProgression[status];

      if (
        currentRank !== undefined &&
        newRank !== undefined &&
        newRank < currentRank
      ) {
        throw new BadRequestException(
          `Invalid status transition: Cannot revert order status from "${order.status}" back to "${status}"`,
        );
      }
    }

    if (status === OrderStatusEnum.CANCELLED) {
      if (
        order.groupOrderId &&
        order.status !== OrderStatusEnum.AWAITING_PAYMENT
      ) {
        // requestRefund creates the refund, runs gateway/offline execution, and
        // — once the money is provably back — writes CANCELLED, restores stock,
        // and recomputes the parent group's status itself.
        await this.refundsService.requestRefund(
          order.groupOrderId.toString(),
          {
            orderId: order._id.toString(),
            reason: 'Order cancelled by restaurant',
          },
          currentUser,
        );
      } else {
        // No parent group, or the group never got past AWAITING_PAYMENT — no
        // money was ever committed, so there is nothing to refund. Cancel
        // directly, exactly as before.
        await this.orderRepository.update({
          filters: { _id: targetObjId },
          body: { status } as any,
        });
        await this.restoreStockForOrder(order);
        if (order.groupOrderId) {
          const siblingOrders = await this.orderRepository.findMany({
            filters: { groupOrderId: order.groupOrderId },
          });
          const newOverallStatus = this.computeOverallStatus(
            siblingOrders || [],
          );
          await this.orderGroupRepository.update({
            filters: { _id: order.groupOrderId },
            body: { overallStatus: newOverallStatus } as any,
          });
        }
      }

      const cancelledOrder = await this.orderRepository.findOne({
        filters: { _id: targetObjId },
        populationArray: [
          { path: 'userId', select: '-password' },
          { path: 'restaurantId' },
        ],
      });
      return { data: this.formatChildOrder(cancelledOrder) };
    }

    await this.orderRepository.update({
      filters: { _id: targetObjId },
      body: {
        status,
        // Stamped once, here. The refund dispute window is measured from this
        // and must not move when the order is written to for any other reason.
        ...(status === OrderStatusEnum.DELIVERED
          ? { deliveredAt: new Date() }
          : {}),
      } as any,
    });

    // Handle DELIVERED logic
    if (status === OrderStatusEnum.DELIVERED) {
      try {
        for (const item of order.items || []) {
          let promotionActive = false;
          let featured = false;

          if (item.offerId) {
            const offerId = (item.offerId as any)._id || item.offerId;
            const offer = await this.offerRepository.findOne({
              filters: { _id: offerId },
            });
            if (offer) {
              promotionActive =
                offer.status === OfferStatusEnum.ACTIVE ||
                offer.discountPercentage > 0;
              featured = !!offer.featured;
            } else if (item.discountPercentage > 0) {
              promotionActive = true;
            }
          } else if (item.discountPercentage > 0) {
            promotionActive = true;
          }

          const existingTx = await this.salesTransactionRepository.findOne({
            filters: { orderId: order._id, productId: item.productId },
          });
          if (existingTx) continue;

          await this.salesTransactionRepository.create({
            restaurantId: order.restaurantId,
            productId: item.productId,
            date: item.purchasedAt || (order as any).createdAt || new Date(),
            quantitySold: item.quantity,
            basePrice: item.originalPrice,
            sellingPrice: item.offerPrice,
            promotionActive,
            featured,
            stockoutMinutes: 0,
            cancelledOrders: 0,
            returnedOrders: 0,
            salesChannel: 'marketplace',
            source: SalesSourceEnum.MARKETPLACE_ORDER,
            orderId: order._id,
          });
        }

        // Trigger automatic recipe-based inventory depletion
        await this.deductInventoryForDeliveredOrder(order);
      } catch (err: any) {
        this.logger.warn(
          `Failed to sync sales transaction for delivered order ${id}: ${err.message}`,
        );
      }
    }

    // Recalculate parent OrderGroup overallStatus
    if (order.groupOrderId) {
      const siblingOrders = await this.orderRepository.findMany({
        filters: { groupOrderId: order.groupOrderId },
      });
      const newOverallStatus = this.computeOverallStatus(siblingOrders || []);
      await this.orderGroupRepository.update({
        filters: { _id: order.groupOrderId },
        body: { overallStatus: newOverallStatus } as any,
      });
    }

    const updatedChildOrder = await this.orderRepository.findOne({
      filters: { _id: targetObjId },
      populationArray: [
        { path: 'userId', select: '-password' },
        { path: 'restaurantId' },
      ],
    });

    return { data: this.formatChildOrder(updatedChildOrder) };
  }

  // 5. GET /orders - Get All Orders Role Aware
  async getAllOrders(query: QueryOrderListingDto, currentUser: UserType) {
    const currentPage = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.max(1, Number(query.limit) || 10);
    const skip = (currentPage - 1) * pageSize;

    const sortOrder = query.sortOrder || query.order || 'desc';

    // SCENARIO 1: CLIENT / CUSTOMER -> Group Orders owned by client
    if (currentUser.role === RolesEnum.CUSTOMER) {
      const userObjId = currentUser._id;
      const filters: Record<string, any> = {
        $or: [{ userId: userObjId }, { userId: userObjId.toString() }],
      };

      if (query.status) {
        const matchingChildOrders = await this.orderRepository.findMany({
          filters: {
            $or: [{ userId: userObjId }, { userId: userObjId.toString() }],
            status: query.status,
          },
          select: 'groupOrderId',
        });
        const childGroupIds = (matchingChildOrders || [])
          .map((o: any) => o.groupOrderId?.toString())
          .filter(Boolean);

        filters.$and = [
          { $or: [{ userId: userObjId }, { userId: userObjId.toString() }] },
          {
            $or: [
              { overallStatus: query.status },
              {
                _id: { $in: childGroupIds.map((id) => new Types.ObjectId(id)) },
              },
            ],
          },
        ];
        delete filters.$or;
      }

      if (query.paymentMethod) filters.paymentMethod = query.paymentMethod;
      if (query.deliveryMethod) filters.deliveryMethod = query.deliveryMethod;

      if (query.startDate || query.endDate) {
        filters.createdAt = {};
        if (query.startDate) {
          const start = new Date(query.startDate);
          if (query.startDate.trim().length === 10)
            start.setUTCHours(0, 0, 0, 0);
          filters.createdAt.$gte = start;
        }
        if (query.endDate) {
          const end = new Date(query.endDate);
          if (query.endDate.trim().length === 10)
            end.setUTCHours(23, 59, 59, 999);
          filters.createdAt.$lte = end;
        }
      }

      if (
        query.minTotalPrice !== undefined ||
        query.maxTotalPrice !== undefined
      ) {
        filters.finalTotalPrice = {};
        if (query.minTotalPrice !== undefined)
          filters.finalTotalPrice.$gte = Number(query.minTotalPrice);
        if (query.maxTotalPrice !== undefined)
          filters.finalTotalPrice.$lte = Number(query.maxTotalPrice);
      }

      let sortField = query.sortBy || query.sort || 'createdAt';
      const allowedSortFields = [
        'createdAt',
        'updatedAt',
        'finalTotalPrice',
        'totalQuantity',
        'overallStatus',
      ];
      if (!allowedSortFields.includes(sortField)) sortField = 'createdAt';

      const paginatedResult = await this.orderGroupRepository.findManyPaginated(
        {
          filters,
          skip,
          limit: pageSize,
          sort: sortField,
          order: sortOrder,
          populationArray: [
            { path: 'userId', select: '-password' },
            {
              path: 'orderIds',
              populate: [{ path: 'restaurantId' }],
            },
          ],
        },
      );

      const formattedGroups = await Promise.all(
        (paginatedResult.items || []).map((group) =>
          this.formatOrderGroup(group),
        ),
      );

      return {
        data: formattedGroups,
        totalItems: paginatedResult.total,
        totalPages: Math.ceil(paginatedResult.total / pageSize) || 1,
        currentPage,
        pageSize,
        hasNextPage: currentPage < Math.ceil(paginatedResult.total / pageSize),
        hasPreviousPage: currentPage > 1,
      };
    }

    // SCENARIO 2: RESTAURANT MANAGER -> Child Orders owned by manager's restaurant
    if (currentUser.role === RolesEnum.MANAGER) {
      if (!currentUser.restaurantId) {
        throw new ForbiddenException('Manager is not assigned to a restaurant');
      }
      const restId = new Types.ObjectId(currentUser.restaurantId.toString());

      const filters: Record<string, any> = {
        restaurantId: restId,
      };

      if (query.status) filters.status = query.status;
      if (query.paymentMethod) filters.paymentMethod = query.paymentMethod;
      if (query.deliveryMethod) filters.deliveryMethod = query.deliveryMethod;

      if (query.startDate || query.endDate) {
        filters.createdAt = {};
        if (query.startDate) {
          const start = new Date(query.startDate);
          if (query.startDate.trim().length === 10)
            start.setUTCHours(0, 0, 0, 0);
          filters.createdAt.$gte = start;
        }
        if (query.endDate) {
          const end = new Date(query.endDate);
          if (query.endDate.trim().length === 10)
            end.setUTCHours(23, 59, 59, 999);
          filters.createdAt.$lte = end;
        }
      }

      if (
        query.minTotalPrice !== undefined ||
        query.maxTotalPrice !== undefined
      ) {
        filters.finalTotalPrice = {};
        if (query.minTotalPrice !== undefined)
          filters.finalTotalPrice.$gte = Number(query.minTotalPrice);
        if (query.maxTotalPrice !== undefined)
          filters.finalTotalPrice.$lte = Number(query.maxTotalPrice);
      }

      if (query.search && query.search.trim() !== '') {
        const searchTerm = query.search.trim();
        const searchRegex = { $regex: searchTerm, $options: 'i' };
        const searchOr: any[] = [
          { fullName: searchRegex },
          { emailAddress: searchRegex },
          { phoneNumber: searchRegex },
        ];
        if (isValidObjectId(searchTerm)) {
          const objId = new Types.ObjectId(searchTerm);
          searchOr.push({ _id: objId });
          searchOr.push({ groupOrderId: objId });
        }
        filters.$or = searchOr;
      }

      let sortField = query.sortBy || query.sort || 'createdAt';
      const allowedSortFields = [
        'createdAt',
        'updatedAt',
        'finalTotalPrice',
        'totalQuantity',
        'status',
      ];
      if (!allowedSortFields.includes(sortField)) sortField = 'createdAt';

      const paginatedResult = await this.orderRepository.findManyPaginated({
        filters,
        skip,
        limit: pageSize,
        sort: sortField,
        order: sortOrder,
        populationArray: [
          { path: 'userId', select: '-password' },
          { path: 'restaurantId' },
        ],
      });

      const formattedOrders = (paginatedResult.items || []).map((order) =>
        this.formatChildOrder(order),
      );

      return {
        data: formattedOrders,
        totalItems: paginatedResult.total,
        totalPages: Math.ceil(paginatedResult.total / pageSize) || 1,
        currentPage,
        pageSize,
        hasNextPage: currentPage < Math.ceil(paginatedResult.total / pageSize),
        hasPreviousPage: currentPage > 1,
      };
    }

    // SCENARIO 3: ADMIN -> Group Orders system-wide
    const filters: Record<string, any> = {};

    if (
      query.restaurantId &&
      query.restaurantId !== 'undefined' &&
      query.restaurantId !== ''
    ) {
      this.validateObjectId(query.restaurantId);
      const matchingChildOrders = await this.orderRepository.findMany({
        filters: { restaurantId: new Types.ObjectId(query.restaurantId) },
        select: 'groupOrderId',
      });
      const groupIds = (matchingChildOrders || [])
        .map((o: any) => o.groupOrderId?.toString())
        .filter(Boolean);

      filters._id = { $in: groupIds.map((id) => new Types.ObjectId(id)) };
    }

    if (query.status) {
      const matchingChildOrders = await this.orderRepository.findMany({
        filters: { status: query.status },
        select: 'groupOrderId',
      });
      const childGroupIds = (matchingChildOrders || [])
        .map((o: any) => o.groupOrderId?.toString())
        .filter(Boolean);

      filters.$or = [
        { overallStatus: query.status },
        { _id: { $in: childGroupIds.map((id) => new Types.ObjectId(id)) } },
      ];
    }

    if (query.paymentMethod) filters.paymentMethod = query.paymentMethod;
    if (query.deliveryMethod) filters.deliveryMethod = query.deliveryMethod;

    if (query.startDate || query.endDate) {
      filters.createdAt = {};
      if (query.startDate) {
        const start = new Date(query.startDate);
        if (query.startDate.trim().length === 10) start.setUTCHours(0, 0, 0, 0);
        filters.createdAt.$gte = start;
      }
      if (query.endDate) {
        const end = new Date(query.endDate);
        if (query.endDate.trim().length === 10)
          end.setUTCHours(23, 59, 59, 999);
        filters.createdAt.$lte = end;
      }
    }

    if (
      query.minTotalPrice !== undefined ||
      query.maxTotalPrice !== undefined
    ) {
      filters.finalTotalPrice = {};
      if (query.minTotalPrice !== undefined)
        filters.finalTotalPrice.$gte = Number(query.minTotalPrice);
      if (query.maxTotalPrice !== undefined)
        filters.finalTotalPrice.$lte = Number(query.maxTotalPrice);
    }

    if (query.search && query.search.trim() !== '') {
      const searchTerm = query.search.trim();
      const searchRegex = { $regex: searchTerm, $options: 'i' };
      const searchOr: any[] = [
        { fullName: searchRegex },
        { emailAddress: searchRegex },
        { phoneNumber: searchRegex },
      ];
      if (isValidObjectId(searchTerm)) {
        const objId = new Types.ObjectId(searchTerm);
        searchOr.push({ _id: objId });
        searchOr.push({ userId: objId });
        searchOr.push({ orderIds: objId });
      }

      if (filters.$or) {
        filters.$and = [{ $or: filters.$or }, { $or: searchOr }];
        delete filters.$or;
      } else {
        filters.$or = searchOr;
      }
    }

    let sortField = query.sortBy || query.sort || 'createdAt';
    const allowedSortFields = [
      'createdAt',
      'updatedAt',
      'finalTotalPrice',
      'totalQuantity',
      'overallStatus',
    ];
    if (!allowedSortFields.includes(sortField)) sortField = 'createdAt';

    const paginatedResult = await this.orderGroupRepository.findManyPaginated({
      filters,
      skip,
      limit: pageSize,
      sort: sortField,
      order: sortOrder,
      populationArray: [
        { path: 'userId', select: '-password' },
        {
          path: 'orderIds',
          populate: [{ path: 'restaurantId' }],
        },
      ],
    });

    const formattedGroups = await Promise.all(
      (paginatedResult.items || []).map((group) =>
        this.formatOrderGroup(group),
      ),
    );

    return {
      data: formattedGroups,
      totalItems: paginatedResult.total,
      totalPages: Math.ceil(paginatedResult.total / pageSize) || 1,
      currentPage,
      pageSize,
      hasNextPage: currentPage < Math.ceil(paginatedResult.total / pageSize),
      hasPreviousPage: currentPage > 1,
    };
  }

  private async deductInventoryForDeliveredOrder(order: any) {
    try {
      const orderIdObj = new Types.ObjectId(order._id.toString());
      const restaurantIdObj = new Types.ObjectId(order.restaurantId.toString());

      // Idempotency check: see if StockTransaction CONSUMPTION for this order already exists
      const existingConsumption = await this.stockTransactionRepository.findOne(
        {
          filters: {
            restaurantId: restaurantIdObj,
            transactionType: StockTransactionTypeEnum.CONSUMPTION,
            referenceId: orderIdObj,
            isDeleted: false,
          },
        },
      );

      if (existingConsumption) {
        this.logger.log(
          `Inventory deduction already performed for order ${order._id.toString()}`,
        );
        return;
      }

      // Only THIS order's items. A group order is split one Order per
      // restaurant (see checkout), each delivered on its own, so walking the
      // siblings would charge other restaurants' recipes against this
      // restaurant's batches — and charge them again for every sibling that
      // reaches DELIVERED. The group is covered because each child order
      // deducts its own items when it is delivered.
      const productQtyMap = new Map<
        string,
        { productId: Types.ObjectId; quantity: number }
      >();

      for (const item of order.items || []) {
        const prodKey = item.productId.toString();
        const existing = productQtyMap.get(prodKey) || {
          productId: new Types.ObjectId(prodKey),
          quantity: 0,
        };
        existing.quantity += item.quantity || 1;
        productQtyMap.set(prodKey, existing);
      }

      // Aggregate total ingredient requirements using product recipes
      const ingredientDemandMap = new Map<
        string,
        { ingredientId: Types.ObjectId; totalRequiredQty: number }
      >();

      for (const { productId, quantity } of productQtyMap.values()) {
        const recipe = await this.recipeRepository.findOne({
          filters: { productId, isDeleted: false },
        });

        if (!recipe || !recipe.ingredients || recipe.ingredients.length === 0) {
          continue;
        }

        for (const recipeIng of recipe.ingredients) {
          const ingKey = recipeIng.ingredientId.toString();
          const yieldFactor = (recipeIng.yieldPercentage || 100) / 100;
          const rawQuantityPerPortion =
            yieldFactor > 0
              ? recipeIng.quantityPerPortion / yieldFactor
              : recipeIng.quantityPerPortion;

          const requiredForProduct = quantity * rawQuantityPerPortion;

          const existingIng = ingredientDemandMap.get(ingKey) || {
            ingredientId: new Types.ObjectId(ingKey),
            totalRequiredQty: 0,
          };
          existingIng.totalRequiredQty += requiredForProduct;
          ingredientDemandMap.set(ingKey, existingIng);
        }
      }

      // Create StockTransactions and deduct from InventoryBatches using FEFO
      for (const {
        ingredientId,
        totalRequiredQty,
      } of ingredientDemandMap.values()) {
        if (totalRequiredQty <= 0) continue;

        const roundedQty = Math.round(totalRequiredQty * 100) / 100;

        const ingredient = await this.ingredientRepository.findOne({
          filters: {
            _id: ingredientId,
            restaurantId: restaurantIdObj,
            isDeleted: false,
          },
        });

        // 1. Create StockTransaction audit ledger entry
        await this.stockTransactionRepository.create({
          restaurantId: restaurantIdObj,
          ingredientId,
          transactionType: StockTransactionTypeEnum.CONSUMPTION,
          quantity: roundedQty,
          unit: ingredient?.unit || 'piece',
          date: new Date(),
          referenceType: 'ORDER',
          referenceId: orderIdObj,
        } as any);

        // 2. Perform FEFO inventory batch stock deduction
        const now = new Date();
        const activeBatches = await this.inventoryBatchRepository.findMany({
          filters: {
            restaurantId: restaurantIdObj,
            ingredientId,
            isDeleted: false,
            quantityRemaining: { $gt: 0 },
            expiryDate: { $gte: now },
          },
          sort: 'expiryDate',
          order: 'asc',
        });

        let remainingNeeded = roundedQty;
        for (const batch of activeBatches || []) {
          if (remainingNeeded <= 0) break;
          const currentQty = batch.quantityRemaining || 0;
          const deductAmount = Math.min(currentQty, remainingNeeded);
          const newQty = Math.round((currentQty - deductAmount) * 100) / 100;
          remainingNeeded -= deductAmount;

          await this.inventoryBatchRepository.update({
            filters: { _id: batch._id },
            body: { quantityRemaining: newQty } as any,
          });
        }

        if (remainingNeeded > 0) {
          // The ledger row says roundedQty was consumed; the batches could not
          // cover it. Silence here means stock drifts above reality unnoticed.
          this.logger.warn(
            `Order ${orderIdObj.toString()}: only ${roundedQty - remainingNeeded} of ${roundedQty} ${ingredient?.unit || ''} of ingredient ${ingredientId.toString()} could be deducted — no unexpired batches left for the remainder`,
          );
        }
      }
    } catch (err: any) {
      this.logger.warn(
        `Failed to deduct inventory for delivered order ${order._id}: ${err.message}`,
      );
    }
  }
}
