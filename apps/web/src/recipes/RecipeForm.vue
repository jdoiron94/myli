<script setup lang="ts">
import type { Visibility } from '@myli/shared';
import { useForm } from 'vee-validate';
import { computed, ref, useTemplateRef } from 'vue';
import { RouterLink } from 'vue-router';
import { failureMessage } from '@/api/failure.ts';
import FormRadioField from '@/components/FormRadioField.vue';
import FormTextField from '@/components/FormTextField.vue';
import MarkdownField from '@/components/MarkdownField.vue';
import { Button } from '@/components/ui/button';
import { FieldDescription, FieldGroup, FieldLegend, FieldSet } from '@/components/ui/field';
import { apiFieldErrors, focusFirstInvalidField, formSchema } from '@/lib/forms.ts';
import { DIFFICULTY_LABELS } from './format.ts';
import IngredientsEditor from './IngredientsEditor.vue';
import PhotosEditor from './PhotosEditor.vue';
import { usePhotoLibrary } from './photo-library.ts';
import { type Recipe, staleRecipe, useCreateRecipe, useSaveRecipe } from './recipe.ts';
import {
  DIFFICULTY_CHOICES,
  NUTRIENTS,
  RECIPE_FORM_FIELDS,
  recipeFormSchema,
  recipeFormValues,
} from './recipe-form.ts';
import StepsEditor from './StepsEditor.vue';
import TagsEditor from './TagsEditor.vue';

/** The recipe editor: creates a recipe, or edits `recipe`. */
const props = defineProps<{ recipe?: Recipe }>();
const emit = defineEmits<{ saved: [recipe: Recipe] }>();

const { handleSubmit, isSubmitting, setErrors } = useForm({
  validationSchema: formSchema(recipeFormSchema),
  // Taken once: the recipe changing underneath (a refetch) doesn't undo what's been typed.
  initialValues: recipeFormValues(props.recipe),
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

const library = usePhotoLibrary(props.recipe);
const form = useTemplateRef('form');
const createRecipe = useCreateRecipe();
const saveRecipe = useSaveRecipe();
/**
 * The version the editor opened: a save is refused if the recipe changed since. Not the one
 * `recipe` has later, which a refetch can move on while the form keeps what it opened with.
 */
const openedVersion = props.recipe?.version;
/** Why saving failed, when it isn't a problem with one of the fields. */
const failure = ref<string>();

const saveOnSubmit = handleSubmit(
  async ({ content, visibility }) => {
    failure.value = undefined;
    let saved: Recipe;
    try {
      saved =
        props.recipe && openedVersion !== undefined
          ? await saveRecipe.mutateAsync({
              id: props.recipe.id,
              version: openedVersion,
              body: content,
            })
          : await createRecipe.mutateAsync({ ...content, visibility });
    } catch (error) {
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
      return;
    }
    emit('saved', saved);
  },
  () => {
    focusFirstInvalidField(form.value);
  },
);

/**
 * One save at a time: a second click while saving would create the recipe twice. Nor while a photo
 * is uploading, which would leave it out.
 */
function submit(event: Event) {
  event.preventDefault();
  if (library.uploading.value) {
    failure.value = 'Wait for the photos to finish uploading, then save.';
    return;
  }
  if (!isSubmitting.value) void saveOnSubmit(event);
}

const cancelTo = computed(() =>
  props.recipe ? { name: 'recipe', params: { id: props.recipe.id } } : { name: 'home' },
);
</script>

<template>
  <form
    ref="form"
    novalidate
    @submit="submit"
  >
    <FieldGroup>
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

      <p
        v-if="failure"
        role="alert"
        class="text-sm text-destructive"
      >
        {{ failure }}
      </p>
      <div class="flex flex-wrap gap-3">
        <Button
          type="submit"
          class="aria-disabled:opacity-50"
          :aria-disabled="isSubmitting ? true : undefined"
        >
          {{ recipe ? 'Save changes' : 'Create recipe' }}
        </Button>
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
