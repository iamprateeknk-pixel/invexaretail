-- Add a location-scoped manager role without changing existing users.
ALTER TABLE `User`
  MODIFY `role` ENUM('ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR') NOT NULL;
