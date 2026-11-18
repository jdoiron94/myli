import { describeBlobStore } from './contract.ts';
import { createMemoryBlobStore } from './memory.ts';

describeBlobStore('memory', createMemoryBlobStore);
