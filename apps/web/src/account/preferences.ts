import { DEFAULT_PREFERENCES, type UnitSystem } from '@myli/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed } from 'vue';
import { api, responseData } from '@/api/client.ts';
import type { components } from '@/api/schema.ts';

export type UserPreferences = components['schemas']['UserPreferences'];

/** The signed-in user's display preferences, which follow them from device to device. */
export const preferencesQuery = queryOptions({
  queryKey: ['me', 'preferences'],
  queryFn: async () => responseData(await api.GET('/me/preferences')).preferences,
});

/** Saves the user's preferences, and then shows them everywhere. */
export function useSavePreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (preferences: UserPreferences) =>
      responseData(await api.PUT('/me/preferences', { body: preferences })).preferences,
    onSuccess: (saved) => {
      queryClient.setQueryData(preferencesQuery.queryKey, saved);
    },
  });
}

/**
 * The unit system recipes are shown in, and a way to choose another. A choice shows at once, while
 * it's saved; if saving fails, the saved one comes back and `failure` says why. Until the saved one
 * is known, `ready` is false, so a page doesn't show imperial amounts and then switch.
 */
export function useUnitSystem() {
  const preferences = useQuery(preferencesQuery);
  const save = useSavePreferences();

  const saved = computed(() => preferences.data.value ?? DEFAULT_PREFERENCES);
  const system = computed<UnitSystem>(() =>
    save.isPending.value && save.variables.value
      ? save.variables.value.unitSystem
      : saved.value.unitSystem,
  );

  function choose(unitSystem: UnitSystem) {
    save.mutate({ ...saved.value, unitSystem });
  }

  return {
    system,
    choose,
    // A failure to load them leaves the defaults, which still work.
    ready: computed(() => !preferences.isPending.value),
    failure: save.error,
  };
}
