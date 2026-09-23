-- Blueprint section 16.2: "manual stock adjustment -> dual control for
-- high-value category" needs a category scope alongside the existing
-- branch scope on ApprovalRule.
ALTER TABLE `ApprovalRule` ADD COLUMN `category` VARCHAR(191) NULL;
