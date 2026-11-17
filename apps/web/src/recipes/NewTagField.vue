<script setup lang="ts">
import { tagNameSchema, type USER_TAG_TYPES } from '@myli/shared';
import { computed, ref, useId, useTemplateRef } from 'vue';
import { failureMessage } from '@/api/failure.ts';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { apiFieldErrors } from '@/lib/forms.ts';
import type { Tag } from './recipe.ts';
import { useCreateTag } from './tags.ts';

/**
 * Creates a tag of one type, from the recipe editor. A name the type already has, in any case or
 * spacing, gives back that tag rather than a second one (spec §3.2).
 */
const props = defineProps<{
  type: (typeof USER_TAG_TYPES)[number];
  /** What the tag is, as the field and its button say: "cuisine". */
  noun: string;
  /** An example, as the field's hint. */
  example: string;
}>();
const emit = defineEmits<{ added: [tag: Tag] }>();

const name = ref('');
const error = ref<string>();
const createTag = useCreateTag();

const id = useId();
const descriptionId = `${id}-description`;
const errorId = `${id}-error`;
const describedBy = computed(() => (error.value ? `${errorId} ${descriptionId}` : descriptionId));
const input = useTemplateRef<{ $el: HTMLInputElement }>('input');

async function add() {
  if (createTag.isPending.value) return;
  const parsed = tagNameSchema.safeParse(name.value);
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message;
    input.value?.$el.focus();
    return;
  }
  error.value = undefined;
  let tag: Tag;
  try {
    tag = await createTag.mutateAsync({ type: props.type, name: parsed.data });
  } catch (failure) {
    error.value = apiFieldErrors(failure, ['name'])?.name?.[0] ?? failureMessage(failure);
    input.value?.$el.focus();
    return;
  }
  name.value = '';
  emit('added', tag);
}

/** Enter adds the tag, rather than saving the recipe. */
function keydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing) return;
  event.preventDefault();
  void add();
}
</script>

<template>
  <Field :data-invalid="error ? true : undefined">
    <FieldLabel :for="id">
      New {{ noun }}
    </FieldLabel>
    <div class="flex gap-2">
      <Input
        :id="id"
        ref="input"
        v-model="name"
        class="max-w-xs"
        autocomplete="off"
        :aria-invalid="error ? true : undefined"
        :aria-describedby="describedBy"
        @keydown="keydown"
      />
      <Button
        type="button"
        variant="outline"
        class="aria-disabled:opacity-50"
        :aria-disabled="createTag.isPending.value ? true : undefined"
        @click="add"
      >
        Add {{ noun }}
      </Button>
    </div>
    <FieldError
      :id="errorId"
      :errors="error ? [error] : []"
    />
    <FieldDescription :id="descriptionId">
      {{ example }}
    </FieldDescription>
  </Field>
</template>
