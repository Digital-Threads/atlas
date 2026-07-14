import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const drizzleAccounts = pgTable("drizzle_accounts", {
  id: uuid("id").primaryKey(),
  email: text("email_address").notNull(),
});

export const drizzleEvents = pgTable("drizzle_events", {
  id: uuid("id").primaryKey(),
  accountId: uuid("account_id").notNull().references(() => drizzleAccounts.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
