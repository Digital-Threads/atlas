import { Controller, Inject, Injectable } from "@nestjs/common";
import { InjectQueue, Process, Processor } from "@nestjs/bull";
import { ClientKafka, EventPattern, Payload } from "@nestjs/microservices";
import type { Queue } from "bull";

export const ORDER_TOPIC = "orders.created";
export const EMAIL_QUEUE = "email-jobs";

@Injectable()
export class OrderPublisher {
  constructor(
    @Inject("KAFKA_SERVICE") private readonly kafka: ClientKafka,
    @InjectQueue(EMAIL_QUEUE) private readonly jobs: Queue,
  ) {}

  publishOrder() {
    this.kafka.emit(ORDER_TOPIC, { id: "order-1" });
  }

  scheduleEmail() {
    return this.jobs.add("send-email", { id: "order-1" });
  }
}

@Controller()
export class OrderEventsConsumer {
  @EventPattern(ORDER_TOPIC)
  handleOrder(@Payload() event: unknown) {
    return event;
  }
}

@Processor(EMAIL_QUEUE)
export class EmailProcessor {
  @Process("send-email")
  handleEmail() {
    return true;
  }
}
