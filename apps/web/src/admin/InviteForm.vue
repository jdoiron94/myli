<script setup lang="ts">
import { createInvitationRequestSchema, type Role } from '@myli/shared';
import { useField, useForm } from 'vee-validate';
import { ref, useId, useTemplateRef } from 'vue';
import { failureMessage } from '@/api/failure.ts';
import { ApiProblem } from '@/api/problem.ts';
import FormTextField from '@/components/FormTextField.vue';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { apiFieldErrors, focusFirstInvalidField, formSchema } from '@/lib/forms.ts';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/roles.ts';
import { type InvitationWithLink, useCreateInvitation } from './invitations.ts';

const FIELDS = ['email', 'role'] as const;
/** Least access first, which is also the default. */
const ROLE_CHOICES: readonly Role[] = ['viewer', 'editor', 'admin'];

const emit = defineEmits<{ invited: [result: InvitationWithLink] }>();

const { handleSubmit, isSubmitting, setErrors, setFieldError, resetForm } = useForm({
  validationSchema: formSchema(createInvitationRequestSchema),
  initialValues: { email: '', role: ROLE_CHOICES[0] },
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

const roleId = useId();
const roleErrorId = `${roleId}-error`;

/** The radio button for `choice` and its description, for `for` and `aria-describedby`. */
const choiceId = (choice: Role) => `${roleId}-${choice}`;
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
      <FieldSet>
        <FieldLegend variant="label">
          Role
        </FieldLegend>
        <RadioGroup
          v-model="role"
          :aria-describedby="roleError ? roleErrorId : undefined"
        >
          <Field
            v-for="choice in ROLE_CHOICES"
            :key="choice"
            orientation="horizontal"
          >
            <RadioGroupItem
              :id="choiceId(choice)"
              :value="choice"
              :aria-describedby="`${choiceId(choice)}-description`"
              :aria-invalid="roleError ? true : undefined"
            />
            <FieldContent>
              <FieldLabel :for="choiceId(choice)">
                {{ ROLE_LABELS[choice] }}
              </FieldLabel>
              <FieldDescription :id="`${choiceId(choice)}-description`">
                {{ ROLE_DESCRIPTIONS[choice] }}
              </FieldDescription>
            </FieldContent>
          </Field>
        </RadioGroup>
        <FieldError
          :id="roleErrorId"
          :errors="roleError ? [roleError] : []"
        />
      </FieldSet>
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
