<script setup lang="ts">
import type { Role } from '@myli/shared';
import { useId } from 'vue';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES_BY_ACCESS } from '@/lib/roles.ts';

/** A choice of role, least access first, each with a line on what it can do. */
const role = defineModel<Role>({ required: true });
defineProps<{
  /** Why the chosen role was refused, if it was. */
  error?: string;
}>();

const id = useId();
const errorId = `${id}-error`;
/** The radio button for `choice`; its description's ID adds `-description`. */
const choiceId = (choice: Role) => `${id}-${choice}`;
</script>

<template>
  <FieldSet>
    <FieldLegend variant="label">
      Role
    </FieldLegend>
    <RadioGroup
      v-model="role"
      :aria-describedby="error ? errorId : undefined"
    >
      <Field
        v-for="choice in ROLES_BY_ACCESS"
        :key="choice"
        orientation="horizontal"
      >
        <RadioGroupItem
          :id="choiceId(choice)"
          :value="choice"
          :aria-describedby="`${choiceId(choice)}-description`"
          :aria-invalid="error ? true : undefined"
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
      :id="errorId"
      :errors="error ? [error] : []"
    />
  </FieldSet>
</template>
