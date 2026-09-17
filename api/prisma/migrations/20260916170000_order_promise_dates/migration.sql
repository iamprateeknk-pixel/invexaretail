-- P5: promise engine - estimated dispatch/delivery on Order.

ALTER TABLE `Order`
  ADD COLUMN IF NOT EXISTS `estimatedDispatchAt` DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS `estimatedDeliveryAt` DATETIME(3) NULL;
