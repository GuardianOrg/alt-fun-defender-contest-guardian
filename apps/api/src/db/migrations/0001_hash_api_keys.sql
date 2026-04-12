ALTER TABLE "api_keys" ADD COLUMN "key_hash" varchar(64) NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "key_prefix" varchar(8) NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_key_unique";--> statement-breakpoint
ALTER TABLE "api_keys" DROP COLUMN "key";--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "key_hash" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "key_prefix" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash");
