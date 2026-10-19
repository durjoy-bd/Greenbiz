import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const installations = sqliteTable("installations", {
  id: text("id").primaryKey(),
  secretHash: text("secret_hash").notNull(),
  createdDay: text("created_day").notNull(),
});
export const dailyUsage = sqliteTable("daily_usage", {
  day: text("day").notNull(),
  scope: text("scope").notNull(),
  subject: text("subject").notNull(),
  used: integer("used").notNull(),
}, table => [primaryKey({ columns: [table.day, table.scope, table.subject] })]);
export const requestClaims = sqliteTable("request_claims", {
  installationId: text("installation_id").notNull().references(() => installations.id),
  requestId: text("request_id").notNull(),
  digest: text("digest").notNull(),
  task: text("task").notNull(),
  status: text("status").notNull(),
  createdDay: text("created_day").notNull(),
}, table => [primaryKey({ columns: [table.installationId, table.requestId] })]);
