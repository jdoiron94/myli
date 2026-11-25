import { DEFAULT_PREFERENCES, type UnitSystem } from '@myli/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, type InjectionKey, inject, type Ref, ref } from 'vue';
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

/** The unit system recipes are shown in, and a way to choose another. */
export interface UnitSystemSetting {
  system: Readonly<Ref<UnitSystem>>;
  choose: (unitSystem: UnitSystem) => void;
  /** False until the system to show is known, so a page doesn't show one and then switch. */
  ready: Readonly<Ref<boolean>>;
  /** Why the last choice wasn't kept. */
  failure: Readonly<Ref<Error | null>>;
}

/**
 * For a page whose reader isn't signed in, which keeps the unit system itself, as a public link's
 * does (`pageUnitSystem()`). Every other page takes the reader's preference.
 */
export const PAGE_UNIT_SYSTEM: InjectionKey<UnitSystemSetting> = Symbol('page unit system');

/** A unit system kept by the page, for as long as it's open: the default until another's chosen. */
export function pageUnitSystem(): UnitSystemSetting {
  const system = ref<UnitSystem>(DEFAULT_PREFERENCES.unitSystem);
  return {
    system,
    choose: (unitSystem) => {
      system.value = unitSystem;
    },
    ready: computed(() => true),
    failure: ref(null),
  };
}

/**
 * The unit system recipes are shown in, and a way to choose another: the page's own, if it keeps
 * one (`PAGE_UNIT_SYSTEM`), or else the reader's preference.
 */
export function useUnitSystem(): UnitSystemSetting {
  return inject(PAGE_UNIT_SYSTEM, null) ?? usePreferredUnitSystem();
}

/**
 * The reader's preferred unit system. A choice shows at once, while it's saved; if saving fails,
 * the saved one comes back and `failure` says why. Until the saved one is known, `ready` is false.
 */
function usePreferredUnitSystem(): UnitSystemSetting {
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
