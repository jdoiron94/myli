<script setup lang="ts">
import { MonitorIcon, MoonIcon, SunIcon } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { isThemeChoice, useTheme } from '@/theme.ts';

const { choice, active } = useTheme();

function choose(value: unknown) {
  if (isThemeChoice(value)) choice.value = value;
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Theme"
      >
        <MoonIcon
          v-if="active === 'dark'"
          aria-hidden="true"
        />
        <SunIcon
          v-else
          aria-hidden="true"
        />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuRadioGroup
        :model-value="choice"
        @update:model-value="choose"
      >
        <DropdownMenuRadioItem value="auto">
          <MonitorIcon aria-hidden="true" />
          System
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="light">
          <SunIcon aria-hidden="true" />
          Light
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="dark">
          <MoonIcon aria-hidden="true" />
          Dark
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
