<script setup lang="ts">
import { IMAGE_UPLOAD_TYPES } from '@myli/shared';
import { useTemplateRef } from 'vue';
import { Button } from '@/components/ui/button';

/** A button that opens the device's picker for photos. Its attributes go on the button. */
defineOptions({ inheritAttrs: false });
defineProps<{
  multiple?: boolean;
  /** Shown, but does nothing, as when the recipe has as many photos as it can. */
  unavailable?: boolean;
}>();
const emit = defineEmits<{ picked: [files: File[]] }>();

const input = useTemplateRef('input');

function picked() {
  if (!input.value) return;
  const files = [...(input.value.files ?? [])];
  // Emptied, so that picking the same file again counts too.
  input.value.value = '';
  if (files.length > 0) emit('picked', files);
}
</script>

<template>
  <Button
    v-bind="$attrs"
    type="button"
    variant="outline"
    size="sm"
    class="aria-disabled:opacity-50"
    :aria-disabled="unavailable ? true : undefined"
    @click="unavailable || input?.click()"
  >
    <slot />
  </Button>
  <!-- The button opens it: a file input can't be styled, and shows the file it last had. -->
  <input
    ref="input"
    type="file"
    class="hidden"
    tabindex="-1"
    aria-hidden="true"
    :accept="IMAGE_UPLOAD_TYPES.join(',')"
    :multiple="multiple"
    @change="picked"
  >
</template>
