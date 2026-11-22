import { afterEach, beforeEach } from 'vitest';
import { setMaintenanceBatch, setMaintenancePrincipal } from '../../src/services/maintenanceState';

/** Business-client tests execute the approved batch branch against an isolated fetch double. */
export function useMaintenanceBatchFixture(): void {
  beforeEach(() => {
    setMaintenancePrincipal({ principalId: 'e3e2a480-9bf4-49bb-a036-fef46b341da4', displayName: '测试维护主体' });
    setMaintenanceBatch('682ae67a-1be7-4dcf-8ebe-b414b9e949df');
  });
  afterEach(() => setMaintenancePrincipal(null));
}
