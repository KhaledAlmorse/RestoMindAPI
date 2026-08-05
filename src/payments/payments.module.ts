import { DynamicModule, Module } from '@nestjs/common';
import { PaymentModel, RefundModel } from 'src/DB/Models';
import { PaymentRepository, RefundRepository } from 'src/DB/Repositories';
import { PaymentsController } from './payments.controller';
import { PaymentsReconciliationService } from './payments-reconciliation.service';
import { PaymentsService } from './payments.service';
import { PaymobService } from './paymob.service';
import {
  PAYMENT_FULFILLERS,
  PaymentFulfillerRegistry,
} from './payment-fulfiller';

@Module({})
export class PaymentsModule {
  /**
   * The fulfiller registry is supplied by the composition root rather than
   * imported, so this module never depends on OrdersModule or
   * SubscriptionsModule. Both of those need PaymentsService to create an
   * intention, so importing them here would make the graph circular.
   *
   * Registered with an empty registry until the subscription and order plans
   * supply theirs. A payment that settles with no registered fulfiller logs
   * an error rather than failing silently — see PaymentsService.
   *
   * When the first real fulfiller arrives, replace the `useValue` below with
   * a `useFactory` that injects the relevant service and returns the map.
   * Keep the token and the interface unchanged.
   */
  static forRoot(fulfillers: PaymentFulfillerRegistry = {}): DynamicModule {
    return {
      module: PaymentsModule,
      imports: [PaymentModel, RefundModel],
      controllers: [PaymentsController],
      providers: [
        PaymentRepository,
        RefundRepository,
        PaymobService,
        PaymentsService,
        PaymentsReconciliationService,
        { provide: PAYMENT_FULFILLERS, useValue: fulfillers },
      ],
      exports: [
        PaymentsService,
        PaymobService,
        PaymentRepository,
        RefundRepository,
      ],
    };
  }
}
