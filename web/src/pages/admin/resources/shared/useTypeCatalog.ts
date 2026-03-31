import { useEffect, useMemo, useState } from 'react';
import { getErrorMessage } from '../../../../services/apiClient';
import {
  buildTargetTypeIdsMap,
  buildTypeParentMap,
  buildTypeTree,
  clearTypeCatalogCache,
  loadTypeCatalog
} from '../../../../services/typeCatalog';
import type { TypeDefinition, TypeRelation } from '../../../../types/api';

type UseTypeCatalogResult = {
  types: TypeDefinition[];
  typeRelations: TypeRelation[];
  loading: boolean;
  error: string | null;
  parentTypeIdByChildId: Map<number, number>;
  targetTypeIdsByKey: Map<string, number[]>;
  treeRoots: ReturnType<typeof buildTypeTree>;
  refresh: () => void;
};

export function useTypeCatalog(
  apiBaseUrl: string,
  selectedGameId: string | null,
  adminToken: string
): UseTypeCatalogResult {
  const token = adminToken.trim();
  const [types, setTypes] = useState<TypeDefinition[]>([]);
  const [typeRelations, setTypeRelations] = useState<TypeRelation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshSeed, setRefreshSeed] = useState(0);

  useEffect(() => {
    if (!selectedGameId || !token) {
      setTypes([]);
      setTypeRelations([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    loadTypeCatalog(apiBaseUrl, selectedGameId, token, refreshSeed > 0)
      .then((catalog) => {
        if (cancelled) {
          return;
        }
        setTypes(catalog.types);
        setTypeRelations(catalog.typeRelations);
        setLoading(false);
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        setTypes([]);
        setTypeRelations([]);
        setLoading(false);
        setError(getErrorMessage(loadError));
      });

    return () => {
      cancelled = true;
    };
  }, [adminToken, apiBaseUrl, refreshSeed, selectedGameId, token]);

  const parentTypeIdByChildId = useMemo(() => buildTypeParentMap(typeRelations), [typeRelations]);
  const targetTypeIdsByKey = useMemo(() => buildTargetTypeIdsMap(typeRelations), [typeRelations]);
  const treeRoots = useMemo(() => buildTypeTree(types, typeRelations), [typeRelations, types]);

  return {
    types,
    typeRelations,
    loading,
    error,
    parentTypeIdByChildId,
    targetTypeIdsByKey,
    treeRoots,
    refresh: () => {
      if (selectedGameId) {
        clearTypeCatalogCache(selectedGameId);
      }
      setRefreshSeed((value) => value + 1);
    }
  };
}