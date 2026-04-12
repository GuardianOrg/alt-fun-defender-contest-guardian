DELETE FROM "api_keys";--> statement-breakpoint
ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_key_unique";--> statement-breakpoint
ALTER TABLE "api_keys" DROP COLUMN "key";--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "key_hash" varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "key_prefix" varchar(8) NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash");
