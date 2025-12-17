-- Migration: Add base_url and allowed_origins to app_config table
-- This allows the application base URL to be configured via the setup wizard
-- instead of relying solely on environment variables

ALTER TABLE `app_config` ADD `base_url` text;
ALTER TABLE `app_config` ADD `allowed_origins` text;
