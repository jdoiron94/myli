<script setup lang="ts">
import { ChevronDownIcon, DownloadIcon } from '@lucide/vue';
import { API_BASE_PATH } from '@myli/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const props = defineProps<{ recipeId: string }>();

/** The recipe's export in `format`, which the API names after its title. */
const exportAddress = (format: 'json' | 'jsonld') =>
  `${API_BASE_PATH}/recipes/${encodeURIComponent(props.recipeId)}/export?format=${format}`;
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="outline"
        size="sm"
      >
        <DownloadIcon aria-hidden="true" />
        Download
        <ChevronDownIcon aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="start"
      class="w-auto min-w-48"
    >
      <DropdownMenuLabel>Download as</DropdownMenuLabel>
      <DropdownMenuItem as-child>
        <a
          :href="exportAddress('json')"
          download
        >JSON, myli’s own format</a>
      </DropdownMenuItem>
      <DropdownMenuItem as-child>
        <a
          :href="exportAddress('jsonld')"
          download
        >JSON-LD, for other recipe apps</a>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
