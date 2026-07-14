import { Injectable } from "@nestjs/common";
import { drizzleEvents } from "./drizzle-schema";

declare class DatabaseClient {
  select(): any;
  insert(table: unknown): any;
  update(table: unknown): any;
  delete(table: unknown): any;
}

@Injectable()
export class DrizzleEventsRepository {
  constructor(private readonly db: DatabaseClient) {}

  listEvents() {
    return this.db.select().from(drizzleEvents);
  }

  addEvent() {
    return this.db.insert(drizzleEvents).values({});
  }

  updateEvent() {
    return this.db.update(drizzleEvents).set({});
  }

  deleteEvent() {
    return this.db.delete(drizzleEvents);
  }
}
