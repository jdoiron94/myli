<script setup lang="ts">
import type { Visibility } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import { useForm } from 'vee-validate';
import { computed, ref, useTemplateRef } from 'vue';
import { RouterLink } from 'vue-router';
import { failureMessage } from '@/api/failure.ts';
import { sessionQuery } from '@/auth/session.ts';
import FormRadioField from '@/components/FormRadioField.vue';
import FormTextField from '@/components/FormTextField.vue';
import MarkdownField from '@/components/MarkdownField.vue';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { FieldDescription, FieldGroup, FieldLegend, FieldSet } from '@/components/ui/field';
import { apiFieldErrors, focusFirstInvalidField, formSchema } from '@/lib/forms.ts';
import { DIFFICULTY_LABELS } from './format.ts';
import IngredientsEditor from './IngredientsEditor.vue';
import PhotosEditor from './PhotosEditor.vue';
import { recipePhotos, usePhotoLibrary } from './photo-library.ts';
import {
  type Recipe,
  type RecipeDraft,
  staleRecipe,
  useCreateRecipe,
  useDiscardDraft,
  usePublishRecipe,
  useSaveDraft,
} from './recipe.ts';
import {
  contentFormValues,
  DIFFICULTY_CHOICES,
  NUTRIENTS,
  RECIPE_FORM_FIELDS,
  recipeFormSchema,
  recipeFormValues,
} from './recipe-form.ts';
import StepsEditor from './StepsEditor.vue';
import TagsEditor from './TagsEditor.vue';

/**
 * The recipe editor: creates a recipe, or edits `recipe`, continuing its `draft` when it has one.
 * An edit is saved as the recipe's draft, or published (spec §3.3).
 */
const props = defineProps<{ recipe?: Recipe; draft?: RecipeDraft | null }>();
const emit = defineEmits<{ saved: [recipe: Recipe]; discarded: [] }>();

const { handleSubmit, isSubmitting, setErrors } = useForm({
  validationSchema: formSchema(recipeFormSchema),
  // Taken once: the recipe changing underneath (a refetch) doesn't undo what's been typed.
  initialValues:
    props.recipe && props.draft
      ? contentFormValues(props.draft.content, props.recipe.visibility)
      : recipeFormValues(props.recipe),
});

const difficultyChoices = DIFFICULTY_CHOICES.map((value) => ({
  value,
  label: value === 'none' ? 'Not set' : DIFFICULTY_LABELS[value],
}));

const VISIBILITY_CHOICES: { value: Visibility; label: string; description: string }[] = [
  { value: 'private', label: 'Private', description: 'Only you can see it.' },
  {
    value: 'shared',
    label: 'Shared',
    description: 'Everyone on myli can see it, and editors can change it.',
  },
];

const NUTRIENT_LABELS: Readonly<Record<(typeof NUTRIENTS)[number], string>> = {
  calories: 'Calories',
  proteinGrams: 'Protein (grams)',
  carbsGrams: 'Carbohydrates (grams)',
  fatGrams: 'Fat (grams)',
  fiberGrams: 'Fiber (grams)',
  sugarGrams: 'Sugar (grams)',
  sodiumMilligrams: 'Sodium (milligrams)',
};

const library = usePhotoLibrary([
  ...(props.recipe ? recipePhotos(props.recipe) : []),
  ...(props.draft?.photos ?? []),
]);
const form = useTemplateRef('form');
const createRecipe = useCreateRecipe();
const publishRecipe = usePublishRecipe();
const saveDraft = useSaveDraft();
const discardDraft = useDiscardDraft();

/** The draft it's continuing, or saved since it opened. */
const draft = ref(props.draft ?? null);
/**
 * The version the edit is based on: the one it opened with, then its own draft's. A change is
 * refused if someone else changed the recipe since. Not the one `recipe` has later, which a refetch
 * can move on while the form keeps what it opened with.
 */
const basedOn = ref(props.draft?.version ?? props.recipe?.version);
/** Why saving failed, when it isn't a problem with one of the fields. */
const failure = ref<string>();
/** That the draft was saved. */
const status = ref<string>();

/** Explains a refused save, at its fields when the problem is theirs. */
function refused(error: unknown) {
  const fieldErrors = apiFieldErrors(error, RECIPE_FORM_FIELDS);
  if (staleRecipe(error)) {
    failure.value =
      'Someone saved this recipe after you opened it, and saving now would undo their ' +
      'changes. Copy anything you want to keep, then open the editor again.';
  } else if (fieldErrors) {
    setErrors(fieldErrors);
    focusFirstInvalidField(form.value);
  } else {
    failure.value = failureMessage(error);
  }
}

function invalid() {
  focusFirstInvalidField(form.value);
}

/** Creates the recipe, or publishes the edit as its next revision, which discards its draft. */
const publishOnSubmit = handleSubmit(async ({ content, visibility, message }) => {
  failure.value = undefined;
  status.value = undefined;
  let saved: Recipe;
  try {
    saved =
      props.recipe && basedOn.value !== undefined
        ? await publishRecipe.mutateAsync({
            id: props.recipe.id,
            version: basedOn.value,
            body: { ...content, message },
          })
        : await createRecipe.mutateAsync({ ...content, visibility });
  } catch (error) {
    refused(error);
    return;
  }
  emit('saved', saved);
}, invalid);

/** Saves the edit as the recipe's draft, staying in the editor. */
const draftOnSubmit = handleSubmit(async ({ content }) => {
  if (!props.recipe || basedOn.value === undefined) return;
  failure.value = undefined;
  status.value = undefined;
  let saved: RecipeDraft;
  try {
    saved = await saveDraft.mutateAsync({
      id: props.recipe.id,
      version: basedOn.value,
      body: content,
    });
  } catch (error) {
    refused(error);
    return;
  }
  draft.value = saved;
  basedOn.value = saved.version;
  status.value = 'Draft saved. Publish it when it’s ready, or come back to it later.';
}, invalid);

/**
 * One save at a time: a second click while saving would create the recipe twice. Nor while a photo
 * is uploading, which would leave it out.
 */
function save(event: Event, action: (event: Event) => Promise<unknown>) {
  event.preventDefault();
  if (library.uploading.value) {
    failure.value = 'Wait for the photos to finish uploading, then save.';
    return;
  }
  if (!isSubmitting.value) void action(event);
}

/** Discards the draft, and with it what's been typed since. The page then goes back to the recipe. */
async function discard() {
  if (!props.recipe || basedOn.value === undefined || discardDraft.isPending.value) return;
  failure.value = undefined;
  status.value = undefined;
  try {
    await discardDraft.mutateAsync({ id: props.recipe.id, version: basedOn.value });
  } catch (error) {
    failure.value = staleRecipe(error)
      ? 'Someone changed this recipe or its draft after you opened it, so the draft is still ' +
        'there. Open the editor again to see their changes.'
      : failureMessage(error);
    return;
  }
  emit('discarded');
}

const { data: signedInUser } = useQuery(sessionQuery);
const savedFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Whose draft this is and when it was saved, and whether the recipe was published since. */
const draftNote = computed(() => {
  if (!draft.value || !props.recipe) return undefined;
  const { author, updatedAt, revision } = draft.value;
  const who = author.id === signedInUser.value?.id ? 'you' : author.name;
  return {
    saved: `You're continuing the draft ${who} saved on ${savedFormat.format(new Date(updatedAt))}.`,
    publishedSince:
      revision < props.recipe.revision
        ? `It started from revision ${String(revision)}, and the recipe was published again ` +
          `since, as revision ${String(props.recipe.revision)}. Publishing the draft replaces ` +
          'what that revision changed.'
        : undefined,
  };
});

const cancelTo = computed(() =>
  props.recipe ? { name: 'recipe', params: { id: props.recipe.id } } : { name: 'home' },
);
</script>

<template>
  <form
    ref="form"
    novalidate
    @submit="save($event, publishOnSubmit)"
  >
    <FieldGroup>
      <div
        v-if="draftNote"
        class="space-y-1 rounded-md border px-4 py-3 text-sm"
      >
        <p>{{ draftNote.saved }}</p>
        <p v-if="draftNote.publishedSince">
          {{ draftNote.publishedSince }}
        </p>
      </div>

      <FormTextField
        name="title"
        label="Title"
      />
      <MarkdownField
        name="description"
        label="Description"
      />
      <PhotosEditor :library="library" />

      <FieldSet>
        <FieldLegend>Servings and time</FieldLegend>
        <div class="grid gap-4 sm:grid-cols-3">
          <FormTextField
            name="servings"
            label="Servings"
            inputmode="numeric"
            description="How many it serves. Scaling starts from this."
          />
          <FormTextField
            name="yield.qty"
            label="Makes"
            inputmode="decimal"
            description="Optional: how many, like 24."
          />
          <FormTextField
            name="yield.unit"
            label="What it makes"
            description="Like cookies, or a loaf."
          />
        </div>
        <div class="grid gap-4 sm:grid-cols-3">
          <FormTextField
            name="prepMinutes"
            label="Prep time (minutes)"
            inputmode="numeric"
          />
          <FormTextField
            name="cookMinutes"
            label="Cook time (minutes)"
            inputmode="numeric"
          />
          <FormTextField
            name="totalMinutes"
            label="Total time (minutes)"
            inputmode="numeric"
            description="Only when it isn't prep plus cook, like dough that rises overnight."
          />
        </div>
      </FieldSet>

      <IngredientsEditor />
      <StepsEditor :library="library" />
      <TagsEditor />

      <FormRadioField
        name="difficulty"
        label="Difficulty"
        :choices="difficultyChoices"
        inline
      />

      <FieldSet>
        <FieldLegend>Source</FieldLegend>
        <FieldDescription>Where the recipe came from, if anywhere.</FieldDescription>
        <FormTextField
          name="source.url"
          label="Web address"
          inputmode="url"
        />
        <div class="grid gap-4 sm:grid-cols-2">
          <FormTextField
            name="source.title"
            label="Book or site"
          />
          <FormTextField
            name="source.author"
            label="Author"
          />
        </div>
      </FieldSet>

      <FormTextField
        name="equipment"
        label="Equipment"
        description="One per line, like a loaf pan or a stand mixer."
        multiline
      />

      <FieldSet>
        <FieldLegend>Nutrition per serving</FieldLegend>
        <FieldDescription>Optional. Fill in what you know: nobody checks it.</FieldDescription>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <FormTextField
            v-for="nutrient in NUTRIENTS"
            :key="nutrient"
            :name="`nutrition.${nutrient}`"
            :label="NUTRIENT_LABELS[nutrient]"
            inputmode="decimal"
          />
        </div>
      </FieldSet>

      <FormRadioField
        v-if="!recipe"
        name="visibility"
        label="Who can see it"
        :choices="VISIBILITY_CHOICES"
      />

      <FormTextField
        v-if="recipe"
        name="message"
        label="What changed"
        description="Optional. Shown with this version in the recipe's history when you publish."
      />

      <p
        v-if="failure"
        role="alert"
        class="text-sm text-destructive"
      >
        {{ failure }}
      </p>
      <!-- Always there, so screen readers announce what it says as it changes. -->
      <p
        role="status"
        class="text-sm empty:hidden"
      >
        {{ status }}
      </p>
      <div class="flex flex-wrap gap-3">
        <Button
          type="submit"
          class="aria-disabled:opacity-50"
          :aria-disabled="isSubmitting ? true : undefined"
        >
          {{ recipe ? 'Publish' : 'Create recipe' }}
        </Button>
        <Button
          v-if="recipe"
          type="button"
          variant="outline"
          class="aria-disabled:opacity-50"
          :aria-disabled="isSubmitting ? true : undefined"
          @click="save($event, draftOnSubmit)"
        >
          Save draft
        </Button>
        <AlertDialog v-if="draft">
          <AlertDialogTrigger as-child>
            <Button
              type="button"
              variant="outline"
            >
              Discard draft
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Discard this draft?</AlertDialogTitle>
              <AlertDialogDescription>
                Its changes are gone for everyone, with anything typed since it was saved. The recipe
                stays as it was published.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep editing</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                @click="discard"
              >
                Discard draft
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button
          variant="outline"
          as-child
        >
          <RouterLink :to="cancelTo">
            Cancel
          </RouterLink>
        </Button>
      </div>
    </FieldGroup>
  </form>
</template>
