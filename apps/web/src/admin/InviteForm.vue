<script setup lang="ts">
import { createInvitationRequestSchema, type Role } from '@myli/shared';
import { useField, useForm } from 'vee-validate';
import { ref, useTemplateRef } from 'vue';
import { failureMessage } from '@/api/failure.ts';
import { ApiProblem } from '@/api/problem.ts';
import FormTextField from '@/components/FormTextField.vue';
import RoleChoice from '@/components/RoleChoice.vue';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { apiFieldErrors, focusFirstInvalidField, formSchema } from '@/lib/forms.ts';
import { ROLES_BY_ACCESS } from '@/lib/roles.ts';
import { type InvitationWithLink, useCreateInvitation } from './invitations.ts';

const FIELDS = ['email', 'role'] as const;

const emit = defineEmits<{ invited: [result: InvitationWithLink] }>();

const { handleSubmit, isSubmitting, setErrors, setFieldError, resetForm } = useForm({
  validationSchema: formSchema(createInvitationRequestSchema),
  initialValues: { email: '', role: ROLES_BY_ACCESS[0] as Role },
});
const { value: role, errorMessage: roleError } = useField<Role>('role');

const form = useTemplateRef('form');
const createInvitation = useCreateInvitation();
/** Why inviting failed, when it isn't a problem with one of the fields. */
const failure = ref<string>();

const inviteOnSubmit = handleSubmit(
  async (values) => {
    failure.value = undefined;
    let result: InvitationWithLink;
    try {
      result = await createInvitation.mutateAsync(values);
    } catch (error) {
      const fieldErrors = apiFieldErrors(error, FIELDS);
      if (fieldErrors) {
        setErrors(fieldErrors);
        focusFirstInvalidField(form.value);
      } else if (error instanceof ApiProblem && error.status === 409) {
        // Someone already has an account or an open invitation with this email.
        setFieldError('email', failureMessage(error));
        focusFirstInvalidField(form.value);
      } else {
        failure.value = failureMessage(error);
      }
      return;
    }
    resetForm();
    emit('invited', result);
  },
  () => {
    focusFirstInvalidField(form.value);
  },
);

/** One invitation at a time, as on the setup page. */
function submit(event: Event) {
  event.preventDefault();
  if (!isSubmitting.value) void inviteOnSubmit(event);
}
</script>

<template>
  <form
    ref="form"
    novalidate
    @submit="submit"
  >
    <FieldGroup>
      <p
        v-if="failure"
        role="alert"
        class="text-sm text-destructive"
      >
        {{ failure }}
      </p>
      <FormTextField
        name="email"
        label="Email"
        type="email"
        autocomplete="off"
      />
      <RoleChoice
        v-model="role"
        :error="roleError"
      />
      <Button
        type="submit"
        class="self-start aria-disabled:opacity-50"
        :aria-disabled="isSubmitting ? true : undefined"
      >
        Invite
      </Button>
    </FieldGroup>
  </form>
</template>
