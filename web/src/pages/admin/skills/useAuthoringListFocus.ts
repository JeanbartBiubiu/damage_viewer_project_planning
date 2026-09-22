import { useEffect, useRef } from 'react';
import type { AuthoringLocation } from '../../../types/authoringLocation';
import { authoringLocateMessage, type AuthoringNavigationRequest } from './authoringFocus';

export function useAuthoringListFocus<T>(
  request: AuthoringNavigationRequest | null | undefined,
  items: readonly T[],
  keyOf: (item: T) => string,
  ready: boolean,
  onFound: (item: T, location: AuthoringLocation) => void,
  onMissing: (message: string) => void
): void {
  const consumedId = useRef<string | null>(null);
  useEffect(() => {
    if (!request || consumedId.current === request.requestId || !ready) return;
    consumedId.current = request.requestId;
    const item = items.find((entry) => keyOf(entry) === request.location.objectKey);
    if (!item) {
      onMissing(authoringLocateMessage({ originalFieldPath: request.location.fieldPath, reason: 'MISSING_KEY' }));
      return;
    }
    onFound(item, request.location);
  }, [items, onFound, onMissing, ready, request]);
}
