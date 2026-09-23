-- Blueprint v4 §23: one order per platform + external order id (NULL references stay unrestricted).
CREATE UNIQUE INDEX `Order_channel_externalReference_key` ON `Order`(`channel`, `externalReference`);
