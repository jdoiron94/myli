<script setup lang="ts">
import { useForm } from 'vee-validate';
import { useTemplateRef, watch } from 'vue';
import { z } from 'zod';
import { focusFirstInvalidField, formSchema } from '@/lib/forms.ts';
import { linkAddressSchema } from '@/lib/link-address.ts';
import FormTextField from './FormTextField.vue';
import { Button } from './ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

/** Asks where a link in the markdown editor goes. */
const props = defineProps<{
  open: boolean;
  /** Where the link being changed goes, when there is one. */
  href?: string;
  /** Nothing is selected to link, so the words to show are asked for too. */
  askText: boolean;
}>();

const emit = defineEmits<{
  'update:open': [open: boolean];
  save: [href: string, text: string];
  remove: [];
  /** Closed, and focus can go back to the editor. */
  closed: [];
}>();

const linkFormSchema = z.object({ href: linkAddressSchema, text: z.string().trim() });

const { handleSubmit, resetForm } = useForm({
  validationSchema: formSchema(linkFormSchema),
  initialValues: { href: '', text: '' },
});

// Each time it opens, it starts from the link the cursor is in, or empty.
watch(
  () => props.open,
  (open) => {
    if (open) resetForm({ values: { href: props.href ?? '', text: '' } });
  },
);

const form = useTemplateRef('form');
const save = handleSubmit(
  ({ href, text }) => {
    emit('save', href, text);
    emit('update:open', false);
  },
  () => {
    focusFirstInvalidField(form.value);
  },
);

function remove() {
  emit('remove');
  emit('update:open', false);
}

function closeAutoFocus(event: Event) {
  // Back to the editor, not the toolbar button that opened it.
  event.preventDefault();
  emit('closed');
}
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <DialogContent @close-auto-focus="closeAutoFocus">
      <form
        ref="form"
        class="grid gap-6"
        novalidate
        @submit.prevent="save"
      >
        <DialogHeader>
          <DialogTitle>{{ href ? 'Change the link' : 'Add a link' }}</DialogTitle>
          <DialogDescription>
            {{ askText ? 'The words to show, and where they lead.' : 'Where the words lead.' }}
          </DialogDescription>
        </DialogHeader>
        <FormTextField
          name="href"
          label="Address"
          description="Like example.com/bread, or sam@example.com."
        />
        <FormTextField
          v-if="askText"
          name="text"
          label="Text"
          description="Empty to show the address."
        />
        <DialogFooter>
          <DialogClose as-child>
            <Button
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
          </DialogClose>
          <Button
            v-if="href"
            type="button"
            variant="outline"
            @click="remove"
          >
            Remove link
          </Button>
          <Button type="submit">
            Save link
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
