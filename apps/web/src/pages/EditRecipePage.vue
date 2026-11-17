<script setup lang="ts">
import { can } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { ApiProblem } from '@/api/problem.ts';
import { useRetry } from '@/api/retry.ts';
import { sessionQuery } from '@/auth/session.ts';
import RetryableFailure from '@/components/RetryableFailure.vue';
import RecipeForm from '@/recipes/RecipeForm.vue';
import { type Recipe, recipeQuery } from '@/recipes/recipe.ts';

const props = defineProps<{ id: string }>();

const query = useQuery(computed(() => recipeQuery(props.id)));
const { failure, retrying, stillFailing, retry } = useRetry(query);
const recipe = computed(() => query.data.value);
const { data: signedInUser } = useQuery(sessionQuery);

/** The API answers 404 alike for a recipe that doesn't exist and one the reader may not see. */
const notFound = computed(
  () => failure.value instanceof ApiProblem && failure.value.status === 404,
);

/**
 * Whether they may edit this recipe, which depends on the recipe as well as their role, so the
 * router can't tell before it's loaded. It follows the session: a role taken away while the page is
 * open takes the form away too.
 */
const allowed = computed(
  () =>
    recipe.value !== undefined &&
    can(signedInUser.value ?? null, 'recipe.edit', {
      ownerId: recipe.value.owner.id,
      visibility: recipe.value.visibility,
    }),
);

// One heading from the start, so focus can move to it after navigating, whatever the page then shows.
const heading = computed(() => {
  if (notFound.value) return 'Recipe not found';
  if (recipe.value && !allowed.value) return "You can't edit this recipe";
  return 'Edit recipe';
});

const router = useRouter();

function open(saved: Recipe) {
  void router.push({ name: 'recipe', params: { id: saved.id } });
}
</script>

<template>
  <h1 class="text-2xl font-semibold">
    {{ heading }}
  </h1>

  <template v-if="recipe">
    <RecipeForm
      v-if="allowed"
      :key="recipe.id"
      class="mt-6"
      :recipe="recipe"
      @saved="open"
    />
    <template v-else>
      <p class="mt-2 text-muted-foreground">
        Your role doesn't include editing recipes. If you need it, ask an admin.
      </p>
      <p class="mt-4">
        <RouterLink
          :to="{ name: 'recipe', params: { id: recipe.id } }"
          class="underline underline-offset-4"
        >
          Back to the recipe
        </RouterLink>
      </p>
    </template>
  </template>
  <p
    v-else-if="notFound"
    class="mt-2 text-muted-foreground"
  >
    This recipe doesn't exist, was deleted, or isn't shared with you.
  </p>
  <RetryableFailure
    v-else-if="failure"
    class="mt-4"
    :error="failure"
    :retrying="retrying"
    :still-failing="stillFailing"
    @retry="retry"
  />
  <p
    v-else
    class="mt-2 text-muted-foreground"
  >
    Loading the recipe…
  </p>
</template>
