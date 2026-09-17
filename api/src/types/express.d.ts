declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: 'ADMIN' | 'ADMIN_USER' | 'STORE_USER' | 'WAREHOUSE_PICKER' | 'AUDITOR';
        assignedLocationIds: string[];
      };
      userId?: string;
      companyId?: string;
      controlScope?: import('../lib/saas/control-plane.js').ScopeContext;
      controlSessionType?: string;
      controlSession?: unknown;
    }
  }
}

export {};
