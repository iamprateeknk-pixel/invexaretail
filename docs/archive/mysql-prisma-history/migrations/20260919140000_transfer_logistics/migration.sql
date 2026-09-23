-- Blueprint v4 P5: packing completion + dispatch/transit details for a transfer.
ALTER TABLE `Transfer` ADD COLUMN `logistics` JSON NULL;
