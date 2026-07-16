import { CommandBus, CommandHandler, ICommandHandler } from "@nestjs/cqrs";
import { forwardRef, Inject, Injectable, Module } from "@nestjs/common";
import { OnEvent, EventEmitter2 } from "@nestjs/event-emitter";
import type { Producer } from "kafkajs";
import { WorkerModule } from "./worker.module";

export const PAYMENT_PORT = "PAYMENT_PORT";
export const KAFKAJS_PRODUCER = "KAFKAJS_PRODUCER";
export const ORDER_AUDIT_TOPIC = "orders.audit";

export abstract class PaymentPort {
  abstract charge(): Promise<void>;
}

@Injectable()
export class PaymentAdapter implements PaymentPort {
  async charge() {}
}

export class CreateOrderCommand {}

@CommandHandler(CreateOrderCommand)
export class CreateOrderHandler implements ICommandHandler<CreateOrderCommand> {
  execute() { return true; }
}

@Injectable()
export class CheckoutService {
  constructor(
    @Inject(PAYMENT_PORT) private readonly payment: PaymentPort,
    private readonly commandBus: CommandBus,
    private readonly events: EventEmitter2,
    @Inject(KAFKAJS_PRODUCER) private readonly producer: Producer,
  ) {}

  async checkout() {
    await this.payment.charge();
    await this.commandBus.execute(new CreateOrderCommand());
    this.events.emit("order.completed", { id: "one" });
    await this.producer.send({ topic: ORDER_AUDIT_TOPIC, messages: [] });
  }
}

@Injectable()
export class OrderCompletedListener {
  @OnEvent("order.completed")
  handle() { return true; }
}

@Module({
  imports: [forwardRef(() => WorkerModule)],
  providers: [
    CheckoutService,
    PaymentAdapter,
    CreateOrderHandler,
    OrderCompletedListener,
    { provide: PAYMENT_PORT, useClass: PaymentAdapter },
    { provide: "PAYMENT_FACADE", useFactory: (payment: PaymentPort) => payment, inject: [PAYMENT_PORT] },
  ],
})
export class HiddenLinksModule {}
