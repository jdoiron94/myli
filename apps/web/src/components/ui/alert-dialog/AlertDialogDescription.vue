<script setup lang="ts">
import { reactiveOmit } from '@vueuse/core';
import type { AlertDialogDescriptionProps } from 'reka-ui';
import { AlertDialogDescription } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

const props = defineProps<AlertDialogDescriptionProps & { class?: HTMLAttributes['class'] }>();

const delegatedProps = reactiveOmit(props, 'class');
</script>

<template>
  <!-- Local edit: balanced only while the header is centered, then normal wrapping. Upstream has
       `md:text-pretty`, which Firefox doesn't support, so its left-aligned text stayed balanced,
       stopping short of the buttons. -->
  <AlertDialogDescription
    data-slot="alert-dialog-description"
    v-bind="delegatedProps"
    :class="cn('text-muted-foreground *:[a]:hover:text-foreground text-sm text-balance sm:group-data-[size=default]/alert-dialog-content:text-wrap *:[a]:underline *:[a]:underline-offset-3', props.class)"
  >
    <slot />
  </AlertDialogDescription>
</template>
