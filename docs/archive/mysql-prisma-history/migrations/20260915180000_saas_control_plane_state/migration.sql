-- Additive SaaS control-plane snapshot. Studio publishes, company sessions,
-- entitlements and sync mutations survive API restarts on Hostinger MySQL.
CREATE TABLE `ControlPlaneState` (
  `id` VARCHAR(191) NOT NULL,
  `payload` JSON NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
